/**
 * Studio settings service (T014, plan 3.2).
 *
 * `.vibe/studio.json` is the single persisted source. On first use the service
 * reads it once and projects the values onto the same `config` object the
 * transport health payload exposes, so the UI, the health summary and later
 * host modules never disagree. Writes go through `StudioStore.write()`, which
 * validates and atomically replaces the file; validation failures are rejected
 * before anything is persisted.
 */
import { studioError } from '../../contracts/errors'
import {
  SETTINGS_GET_METHOD,
  SETTINGS_UPDATE_METHOD,
  isStudioSettingsUpdateParams,
  type StudioSettingsSnapshot,
  type StudioSettingsStatus,
  type StudioSettingsValues,
} from '../../contracts/settings'
import type { VibeStudioConfig } from '../config'
import type { UnaryRegistry } from '../transport'
import {
  STUDIO_FILE_VERSION,
  StudioStoreError,
  createStudioStore,
  parseStudioSettings,
  type StudioStore,
} from './store'

export interface StudioSettingsServiceOptions {
  /** Project root that owns `.vibe/studio.json`. */
  readonly projectDir: string
  /** Resolved plugin config; mutated in place as settings load and change. */
  readonly config: VibeStudioConfig
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class StudioSettingsService {
  readonly store: StudioStore
  private readonly config: VibeStudioConfig
  private status: StudioSettingsStatus = 'missing'
  private issues: string[] = []
  private loaded?: Promise<void>

  constructor(options: StudioSettingsServiceOptions) {
    if (!options || typeof options.projectDir !== 'string' || options.projectDir.trim() === '') {
      throw new Error('vibe-studio: settings service requires a projectDir')
    }
    this.store = createStudioStore(options.projectDir)
    this.config = options.config
  }

  /** Reads `studio.json` once; read failures become issues instead of throws. */
  ready(): Promise<void> {
    this.loaded ??= this.load()
    return this.loaded
  }

  /** Current settings plus the status/issues of the last read or write. */
  get(): StudioSettingsSnapshot {
    return {
      settings: this.current(),
      status: this.status,
      issues: [...this.issues],
    }
  }

  /**
   * Merges a partial patch over the current values, validates the result and
   * persists it. Invalid input rejects with `invalid_input` and per-field
   * issues before touching the file.
   */
  async update(raw: unknown): Promise<StudioSettingsSnapshot> {
    await this.ready()
    if (!isRecord(raw)) {
      throw studioError('invalid_input', 'settings must be an object')
    }

    const parsed = parseStudioSettings({ ...this.current(), ...raw })
    if (parsed.issues.length > 0) {
      throw studioError('invalid_input', 'settings are invalid', { issues: parsed.issues })
    }

    try {
      await this.store.write({ version: STUDIO_FILE_VERSION, settings: parsed.settings })
    } catch (error) {
      if (error instanceof StudioStoreError) {
        throw studioError('invalid_config', error.message)
      }
      throw error
    }

    this.apply(parsed.settings)
    this.status = 'ok'
    this.issues = []
    return this.get()
  }

  private async load(): Promise<void> {
    try {
      const result = await this.store.read()
      this.status = result.status
      this.issues = [...result.issues]
      // A missing file keeps the profile config; recovered values (including
      // defaults) win for an invalid file so the panel can repair what it sees.
      if (result.status !== 'missing') this.apply(result.document.settings)
    } catch (error) {
      this.status = 'invalid'
      this.issues = [errorMessage(error)]
    }
  }

  private apply(settings: StudioSettingsValues): void {
    this.config.allowedOrigins = [...settings.allowedOrigins]
    this.config.retentionDays = settings.retentionDays
    this.config.contextBudgetBytes = settings.contextBudgetBytes
    this.config.screenshotEnabled = settings.screenshotEnabled
    this.config.logLevel = settings.logLevel
  }

  private current(): StudioSettingsValues {
    return {
      allowedOrigins: [...this.config.allowedOrigins],
      retentionDays: this.config.retentionDays,
      contextBudgetBytes: this.config.contextBudgetBytes,
      screenshotEnabled: this.config.screenshotEnabled,
      logLevel: this.config.logLevel,
    }
  }
}

export function createStudioSettingsService(
  options: StudioSettingsServiceOptions,
): StudioSettingsService {
  return new StudioSettingsService(options)
}

/** Registers `studio.settings.get/update`; returns an idempotent unregister. */
export function registerSettingsMethods(
  registry: UnaryRegistry,
  service: StudioSettingsService,
): () => void {
  const disposers = [
    registry.register(SETTINGS_GET_METHOD, async () => {
      await service.ready()
      return service.get()
    }),
    registry.register(SETTINGS_UPDATE_METHOD, async (params) => {
      if (!isStudioSettingsUpdateParams(params)) {
        throw studioError('invalid_input', 'expected { settings }')
      }
      return service.update(params.settings)
    }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}
