/**
 * `.vibe/studio.json` persistence (plan D7/D11).
 *
 * Persistent JSON uses hand-written validation instead of schemastery. Reads
 * never throw for bad content: invalid fields fall back to defaults and are
 * reported as issues. Writes validate first, then atomically replace the file
 * via a same-directory temp file. The resolved file must stay inside the
 * project, including through `.vibe` junctions/symlinks.
 */
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  DEFAULT_ALLOWED_ORIGINS,
  LOG_LEVELS,
  normalizeOrigin,
  type LogLevel,
} from '../config'

export const STUDIO_FILE_VERSION = 1
export const STUDIO_FILE_NAME = 'studio.json'
export const MAX_STUDIO_FILE_BYTES = 256 * 1024

export interface StudioSettings {
  allowedOrigins: string[]
  retentionDays: number
  contextBudgetBytes: number
  screenshotEnabled: boolean
  logLevel: LogLevel
}

export interface StudioDocument {
  readonly version: typeof STUDIO_FILE_VERSION
  readonly settings: StudioSettings
}

export type StudioReadStatus = 'ok' | 'missing' | 'invalid'

export interface StudioReadResult {
  readonly status: StudioReadStatus
  readonly document: StudioDocument
  /** Non-fatal problems; an `invalid` result still carries recovered defaults. */
  readonly issues: readonly string[]
}

export type StudioStoreErrorCode =
  | 'invalid-project-path'
  | 'project-missing'
  | 'path-outside-project'
  | 'invalid-studio-dir'
  | 'invalid-document'
  | 'io'

export class StudioStoreError extends Error {
  readonly code: StudioStoreErrorCode

  constructor(code: StudioStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'StudioStoreError'
    this.code = code
  }
}

export const DEFAULT_STUDIO_SETTINGS: Readonly<StudioSettings> = {
  allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS],
  retentionDays: 7,
  contextBudgetBytes: 8192,
  screenshotEnabled: true,
  logLevel: 'info',
}

const KNOWN_SETTINGS = new Set<keyof StudioSettings>([
  'allowedOrigins',
  'retentionDays',
  'contextBudgetBytes',
  'screenshotEnabled',
  'logLevel',
])

const RANGES = {
  retentionDays: [1, 365],
  contextBudgetBytes: [1024, 65536],
} as const

function createDefaultSettings(): StudioSettings {
  return {
    ...DEFAULT_STUDIO_SETTINGS,
    allowedOrigins: [...DEFAULT_STUDIO_SETTINGS.allowedOrigins],
  }
}

export function createDefaultStudioDocument(): StudioDocument {
  return { version: STUDIO_FILE_VERSION, settings: createDefaultSettings() }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

/**
 * Validates a `settings` object field by field. Missing fields keep defaults;
 * invalid fields are replaced by defaults and reported.
 */
export function parseStudioSettings(raw: unknown): {
  settings: StudioSettings
  issues: string[]
} {
  const settings = createDefaultSettings()
  const issues: string[] = []
  if (raw === undefined) return { settings, issues }
  if (!isRecord(raw)) {
    return { settings, issues: ['settings: expected an object'] }
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_SETTINGS.has(key as keyof StudioSettings)) {
      issues.push(`settings.${key}: unknown key`)
    }
  }

  if (raw.allowedOrigins !== undefined) {
    if (!Array.isArray(raw.allowedOrigins)) {
      issues.push('settings.allowedOrigins: expected an array of origin strings')
    } else {
      const origins: string[] = []
      raw.allowedOrigins.forEach((entry, index) => {
        if (typeof entry !== 'string') {
          issues.push(`settings.allowedOrigins[${index}]: expected a string`)
          return
        }
        try {
          origins.push(normalizeOrigin(entry))
        } catch {
          issues.push(`settings.allowedOrigins[${index}]: invalid origin ${describeValue(entry)}`)
        }
      })
      const unique = [...new Set(origins)]
      if (unique.length === 0) {
        issues.push('settings.allowedOrigins: at least one valid origin is required')
      } else {
        settings.allowedOrigins = unique
      }
    }
  }

  for (const key of ['retentionDays', 'contextBudgetBytes'] as const) {
    const value = raw[key]
    if (value === undefined) continue
    const [min, max] = RANGES[key]
    if (!isIntegerInRange(value, min, max)) {
      issues.push(`settings.${key}: expected an integer between ${min} and ${max}`)
    } else {
      settings[key] = value
    }
  }

  if (raw.screenshotEnabled !== undefined) {
    if (typeof raw.screenshotEnabled !== 'boolean') {
      issues.push('settings.screenshotEnabled: expected a boolean')
    } else {
      settings.screenshotEnabled = raw.screenshotEnabled
    }
  }

  if (raw.logLevel !== undefined) {
    const value = raw.logLevel
    if (typeof value !== 'string' || !(LOG_LEVELS as readonly string[]).includes(value)) {
      issues.push(`settings.logLevel: expected one of ${LOG_LEVELS.join(', ')}`)
    } else {
      settings.logLevel = value as LogLevel
    }
  }

  return { settings, issues }
}

/** Validates a whole `studio.json` document. Unknown top-level keys are ignored. */
export function parseStudioDocument(raw: unknown): {
  document: StudioDocument
  issues: string[]
} {
  if (!isRecord(raw)) {
    return {
      document: createDefaultStudioDocument(),
      issues: [`studio.json: expected a JSON object, got ${describeValue(raw)}`],
    }
  }
  if (raw.version !== STUDIO_FILE_VERSION) {
    return {
      document: createDefaultStudioDocument(),
      issues: [`studio.json.version: expected ${STUDIO_FILE_VERSION}, got ${describeValue(raw.version)}`],
    }
  }
  const { settings, issues } = parseStudioSettings(raw.settings)
  return { document: { version: STUDIO_FILE_VERSION, settings }, issues }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function lstatSafe(target: string) {
  try {
    return await lstat(target)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined
    throw error
  }
}

export class StudioStore {
  readonly projectDir: string
  readonly vibeDir: string
  readonly filePath: string

  constructor(projectDir: string) {
    if (typeof projectDir !== 'string' || projectDir.trim() === '') {
      throw new StudioStoreError('invalid-project-path', 'vibe-studio: projectDir is required')
    }
    this.projectDir = resolve(projectDir)
    this.vibeDir = join(this.projectDir, '.vibe')
    this.filePath = join(this.vibeDir, STUDIO_FILE_NAME)
    if (!isInside(this.projectDir, this.filePath)) {
      throw new StudioStoreError(
        'invalid-project-path',
        `vibe-studio: studio.json resolves outside the project: ${this.filePath}`,
      )
    }
  }

  /** Reads the document; missing or invalid content falls back to defaults. */
  async read(): Promise<StudioReadResult> {
    try {
      const realRoot = await this.realProjectRoot()
      const vibe = await this.inspectVibeDir(realRoot)
      if (!vibe) return this.missingResult()

      const fileInfo = await lstatSafe(this.filePath)
      if (!fileInfo) return this.missingResult()

      const realFile = await realpath(this.filePath)
      if (!isInside(vibe.realPath, realFile)) {
        throw new StudioStoreError(
          'path-outside-project',
          `vibe-studio: studio.json resolves outside .vibe: ${realFile}`,
        )
      }

      const info = await stat(this.filePath)
      if (info.size > MAX_STUDIO_FILE_BYTES) {
        return {
          status: 'invalid',
          document: createDefaultStudioDocument(),
          issues: [`studio.json: file exceeds ${MAX_STUDIO_FILE_BYTES} bytes`],
        }
      }

      const text = await readFile(this.filePath, 'utf8')
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        return {
          status: 'invalid',
          document: createDefaultStudioDocument(),
          issues: ['studio.json: not valid JSON'],
        }
      }

      const parsed = parseStudioDocument(raw)
      return {
        status: parsed.issues.length === 0 ? 'ok' : 'invalid',
        document: parsed.document,
        issues: parsed.issues,
      }
    } catch (error) {
      if (error instanceof StudioStoreError) throw error
      throw new StudioStoreError('io', `vibe-studio: cannot read studio.json: ${errorMessage(error)}`, {
        cause: error,
      })
    }
  }

  /** Validates, normalizes and atomically replaces studio.json. */
  async write(document: StudioDocument): Promise<void> {
    const parsed = parseStudioDocument(document)
    if (parsed.issues.length > 0) {
      throw new StudioStoreError(
        'invalid-document',
        `vibe-studio: refusing to write invalid studio.json: ${parsed.issues.join('; ')}`,
      )
    }

    try {
      const realRoot = await this.realProjectRoot()
      await mkdir(this.vibeDir, { recursive: true })
      const vibe = await this.inspectVibeDir(realRoot)
      if (!vibe) {
        throw new StudioStoreError('invalid-studio-dir', 'vibe-studio: .vibe is not a directory')
      }

      const existing = await lstatSafe(this.filePath)
      if (existing) {
        const realFile = await realpath(this.filePath)
        if (!isInside(vibe.realPath, realFile)) {
          throw new StudioStoreError(
            'path-outside-project',
            `vibe-studio: studio.json resolves outside .vibe: ${realFile}`,
          )
        }
      }

      const payload = `${JSON.stringify(parsed.document, null, 2)}\n`
      const tempPath = join(vibe.realPath, `.${STUDIO_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`)
      try {
        await writeFile(tempPath, payload, { encoding: 'utf8', flag: 'wx' })
        await rename(tempPath, this.filePath)
      } catch (error) {
        await rm(tempPath, { force: true }).catch(() => undefined)
        throw error
      }
    } catch (error) {
      if (error instanceof StudioStoreError) throw error
      throw new StudioStoreError('io', `vibe-studio: cannot write studio.json: ${errorMessage(error)}`, {
        cause: error,
      })
    }
  }

  private missingResult(): StudioReadResult {
    return {
      status: 'missing',
      document: createDefaultStudioDocument(),
      issues: [],
    }
  }

  private async realProjectRoot(): Promise<string> {
    try {
      return await realpath(this.projectDir)
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        throw new StudioStoreError(
          'project-missing',
          `vibe-studio: project directory does not exist: ${this.projectDir}`,
          { cause: error },
        )
      }
      throw error
    }
  }

  /** Resolves `.vibe` and rejects junctions/symlinks that leave the project. */
  private async inspectVibeDir(realRoot: string): Promise<{ realPath: string } | undefined> {
    const info = await lstatSafe(this.vibeDir)
    if (!info) return undefined
    const realPath = await realpath(this.vibeDir)
    if (!isInside(realRoot, realPath)) {
      throw new StudioStoreError(
        'path-outside-project',
        `vibe-studio: .vibe resolves outside the project: ${realPath}`,
      )
    }
    const resolved = await stat(this.vibeDir)
    if (!resolved.isDirectory()) {
      throw new StudioStoreError('invalid-studio-dir', 'vibe-studio: .vibe is not a directory')
    }
    return { realPath }
  }
}

export function createStudioStore(projectDir: string): StudioStore {
  return new StudioStore(projectDir)
}
