/**
 * Host entry for dsh-vibecode-studio.
 *
 * T008 scaffold: plugin identity, config validation and the service slot.
 * T011 adds the authenticated `/api/vibe` transport (health + unary methods);
 * later preview features register methods on the same registry.
 */
import { Config, resolveConfig, type VibeStudioConfig } from './config'
import {
  createStudioSettingsService,
  registerSettingsMethods,
  type StudioSettingsService,
} from './studio/settings'
import {
  registerTransport,
  type TransportHostContext,
  type UnaryRegistry,
} from './transport'

export { Config, LOG_LEVELS, normalizeOrigin, resolveConfig } from './config'
export type { LogLevel, VibeStudioConfig } from './config'
export {
  createStudioSettingsService,
  registerSettingsMethods,
  StudioSettingsService,
} from './studio/settings'
export type { StudioSettingsServiceOptions } from './studio/settings'
export {
  createHealthPayload,
  registerTransport,
  UnaryRegistry,
} from './transport'
export type { UnaryCallContext, UnaryHandler } from './transport'

export const name = 'dsh-vibecode-studio'
export const inject = ['connection']

/** The service this plugin exposes to later host modules (T011+). */
export interface VibeStudioService {
  readonly config: VibeStudioConfig
  /** Unary method registry shared by preview, inspect and API features. */
  readonly transport: UnaryRegistry
  /** `.vibe/studio.json` settings, shared with the panel. */
  readonly settings: StudioSettingsService
}

/** Minimal Cordis surface used at this stage. */
export interface HostContext extends TransportHostContext {
  provide(name: string, value: unknown): void
}

export function apply(ctx: HostContext, config: VibeStudioConfig = new Config()): void {
  const resolved = resolveConfig(config)
  const { registry } = registerTransport(ctx, { plugin: name, config: resolved })

  // M1 binds the project root to the Host process cwd; `apply` has no session
  // yet. Revisit once preview targets resolve a workspace directory (M2).
  const settings = createStudioSettingsService({ projectDir: process.cwd(), config: resolved })
  const setupSettings = () => registerSettingsMethods(registry, settings)
  if (typeof ctx.effect === 'function') {
    ctx.effect(setupSettings, 'vibe-studio: settings methods')
  } else {
    setupSettings()
  }

  ctx.provide('vibeStudio', {
    config: resolved,
    transport: registry,
    settings,
  } satisfies VibeStudioService)
}
