/**
 * Host configuration schema for dsh-vibecode-studio (plan D1/D11).
 *
 * Schemastery only checks types and enum values; semantic checks (unknown
 * keys, origin shape) run in {@link resolveConfig} and fail the plugin mount
 * with a readable message instead of silently accepting bad input.
 */
import Schema from '@deepseek-ai/schemastery'

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost', 'http://127.0.0.1']

export const Config = Schema.object({
  logLevel: Schema.union(LOG_LEVELS.map((level) => Schema.const(level)))
    .default('info')
    .description('Host log level.'),
  allowedOrigins: Schema.array(Schema.string())
    .default([...DEFAULT_ALLOWED_ORIGINS])
    .description('HTTP(S) origins the preview may navigate to; entries are normalized to their origin.'),
  retentionDays: Schema.number()
    .min(1)
    .max(365)
    .step(1)
    .default(7)
    .description('Retention for screenshots, captures and logs; 7 days by default.'),
  contextBudgetBytes: Schema.number()
    .min(1024)
    .max(65536)
    .step(1024)
    .default(8192)
    .description('Maximum bytes of untrusted page context returned to the model.'),
  screenshotEnabled: Schema.boolean()
    .default(true)
    .description('Allow screenshot capture into the artifact store.'),
})

export type VibeStudioConfig = ReturnType<typeof Config>

const KNOWN_KEYS = new Set([
  'logLevel',
  'allowedOrigins',
  'retentionDays',
  'contextBudgetBytes',
  'screenshotEnabled',
])

/** Parses one allowed-origin entry and returns its normalized `URL.origin`. */
export function normalizeOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`vibe-studio: invalid origin "${value}"`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`vibe-studio: origin "${value}" must use http or https`)
  }
  if (url.username || url.password) {
    throw new Error(`vibe-studio: origin "${value}" must not contain credentials`)
  }
  if (url.search || url.hash) {
    throw new Error(`vibe-studio: origin "${value}" must not contain a query or hash`)
  }
  return url.origin
}

/** Applies semantic validation and returns the normalized config. */
export function resolveConfig(config: VibeStudioConfig): VibeStudioConfig {
  for (const key of Object.keys(config)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new Error(`vibe-studio: unknown config key "${key}"`)
    }
  }
  const allowedOrigins = [...new Set(config.allowedOrigins.map(normalizeOrigin))]
  if (allowedOrigins.length === 0) {
    throw new Error('vibe-studio: allowedOrigins must contain at least one origin')
  }
  return { ...config, allowedOrigins }
}
