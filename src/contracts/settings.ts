/**
 * Wire contract for the Studio settings page (T014, plan 3.2).
 *
 * The Host owns `.vibe/studio.json`; the panel only sends and receives this
 * shape through the unary transport. Ranges mirror `Config` in
 * `src/host/config.ts` and `parseStudioSettings()` in `src/host/studio/store.ts`;
 * the Host remains the authority and reports per-field issues.
 */

export const SETTINGS_GET_METHOD = 'studio.settings.get'
export const SETTINGS_UPDATE_METHOD = 'studio.settings.update'

export const RETENTION_DAYS_MIN = 1
export const RETENTION_DAYS_MAX = 365
export const CONTEXT_BUDGET_BYTES_MIN = 1024
export const CONTEXT_BUDGET_BYTES_MAX = 65536

export const SETTINGS_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type StudioSettingsLogLevel = (typeof SETTINGS_LOG_LEVELS)[number]

export const SETTINGS_FIELDS = [
  'allowedOrigins',
  'retentionDays',
  'contextBudgetBytes',
  'screenshotEnabled',
  'logLevel',
] as const
export type StudioSettingsField = (typeof SETTINGS_FIELDS)[number]

export interface StudioSettingsValues {
  readonly allowedOrigins: readonly string[]
  readonly retentionDays: number
  readonly contextBudgetBytes: number
  readonly screenshotEnabled: boolean
  readonly logLevel: StudioSettingsLogLevel
}

/** Mirrors `StudioReadStatus` from the store without importing host code. */
export type StudioSettingsStatus = 'ok' | 'missing' | 'invalid'

export interface StudioSettingsSnapshot {
  readonly settings: StudioSettingsValues
  readonly status: StudioSettingsStatus
  /** Validation issues; non-empty when the stored document needed repair. */
  readonly issues: readonly string[]
}

/** Update accepts a partial patch; the Host merges it over the current values. */
export interface StudioSettingsUpdateParams {
  readonly settings: Partial<StudioSettingsValues>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIntegerInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

export function isStudioSettingsValues(value: unknown): value is StudioSettingsValues {
  if (!isRecord(value)) return false
  if (
    !Array.isArray(value.allowedOrigins) ||
    value.allowedOrigins.length === 0 ||
    !value.allowedOrigins.every((origin) => typeof origin === 'string' && origin.length > 0)
  ) {
    return false
  }
  if (!isIntegerInRange(value.retentionDays, RETENTION_DAYS_MIN, RETENTION_DAYS_MAX)) return false
  if (
    !isIntegerInRange(
      value.contextBudgetBytes,
      CONTEXT_BUDGET_BYTES_MIN,
      CONTEXT_BUDGET_BYTES_MAX,
    )
  ) {
    return false
  }
  if (typeof value.screenshotEnabled !== 'boolean') return false
  return (
    typeof value.logLevel === 'string' &&
    (SETTINGS_LOG_LEVELS as readonly string[]).includes(value.logLevel)
  )
}

export function isStudioSettingsSnapshot(value: unknown): value is StudioSettingsSnapshot {
  if (!isRecord(value)) return false
  if (!isStudioSettingsValues(value.settings)) return false
  if (value.status !== 'ok' && value.status !== 'missing' && value.status !== 'invalid') return false
  return Array.isArray(value.issues) && value.issues.every((issue) => typeof issue === 'string')
}

export function isStudioSettingsUpdateParams(
  value: unknown,
): value is StudioSettingsUpdateParams {
  return isRecord(value) && isRecord(value.settings)
}
