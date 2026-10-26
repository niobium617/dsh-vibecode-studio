/**
 * Host entry for dsh-vibecode-studio.
 *
 * T008 scaffold: plugin identity, config validation and the service slot.
 * Transport routes arrive in T011.
 */
import { Config, resolveConfig, type VibeStudioConfig } from './config'

export { Config, LOG_LEVELS, normalizeOrigin, resolveConfig } from './config'
export type { LogLevel, VibeStudioConfig } from './config'

export const name = 'dsh-vibecode-studio'
export const inject = ['connection']

/** The service this plugin exposes to later host modules (T011+). */
export interface VibeStudioService {
  readonly config: VibeStudioConfig
}

/** Minimal Cordis surface used at this stage. */
export interface HostContext {
  provide(name: string, value: unknown): void
}

export function apply(ctx: HostContext, config: VibeStudioConfig = new Config()): void {
  const resolved = resolveConfig(config)
  ctx.provide('vibeStudio', { config: resolved } satisfies VibeStudioService)
}
