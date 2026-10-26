/**
 * Stable error codes shared by host, client and agent tools.
 * Contracts stay dependency-free so every module can import them.
 */

export const STUDIO_ERROR_CODES = [
  'invalid_input',
  'invalid_config',
  'not_found',
  'permission_denied',
  'unsupported',
  'target_unavailable',
  'preview_failed',
  'timeout',
  'network_error',
  'artifact_missing',
  'internal',
] as const

export type StudioErrorCode = (typeof STUDIO_ERROR_CODES)[number]

export interface StudioError {
  readonly code: StudioErrorCode
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

const ERROR_CODE_SET: ReadonlySet<string> = new Set(STUDIO_ERROR_CODES)

export function studioError(
  code: StudioErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): StudioError {
  return details ? { code, message, details } : { code, message }
}

export function isStudioError(value: unknown): value is StudioError {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.code === 'string' &&
    ERROR_CODE_SET.has(candidate.code) &&
    typeof candidate.message === 'string' &&
    (candidate.details === undefined || (candidate.details !== null && typeof candidate.details === 'object'))
  )
}
