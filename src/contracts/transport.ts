/**
 * Wire contract for the Host ↔ Studio transport (T011, plan D3/D4).
 *
 * The Host owns exact authenticated routes under `/api/vibe`; the browser
 * always calls the document-relative form so DSH Desktop's `dsh-app://` fetch
 * bridge and DSH Web's origin-root mount both resolve the same path.
 *
 * Responses use one envelope for health and unary calls:
 * `{ ok: true, value }` or `{ ok: false, error }`. DSH Connection applies the
 * Host/Origin fence and browser authentication before a handler runs, so this
 * module never invents its own credential scheme.
 */
import { isStudioError, type StudioError } from './errors'

export const TRANSPORT_VERSION = 1

export const VIBE_API_PREFIX = '/api/vibe'
export const HEALTH_PATH = `${VIBE_API_PREFIX}/health`
export const REQUEST_PATH = `${VIBE_API_PREFIX}/request`

/** Unary requests carry input events and small commands; 64 KiB is ample. */
export const MAX_UNARY_BODY_BYTES = 64 * 1024
export const DEFAULT_UNARY_TIMEOUT_MS = 10_000

/** Built-in method proving the unary path end to end. */
export const STUDIO_PING_METHOD = 'studio.ping'

const UNARY_METHOD_PATTERN = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Config projection safe to show in the Studio panel. */
export interface TransportConfigSummary {
  readonly logLevel: string
  readonly allowedOrigins: readonly string[]
  readonly retentionDays: number
  readonly contextBudgetBytes: number
  readonly screenshotEnabled: boolean
}

export interface TransportHealth {
  readonly plugin: string
  readonly transportVersion: number
  readonly serverTime: string
  readonly uptimeMs: number
  readonly config: TransportConfigSummary
}

export interface UnaryRequest {
  readonly id?: string
  readonly method: string
  readonly params?: unknown
}

export interface UnarySuccess<T = unknown> {
  readonly ok: true
  readonly value: T
  readonly id?: string
}

export interface UnaryFailure {
  readonly ok: false
  readonly error: StudioError
  readonly id?: string
}

export type UnaryResponse<T = unknown> = UnarySuccess<T> | UnaryFailure

export interface PingResult {
  readonly pong: true
  readonly serverTime: string
  readonly transportVersion: number
  readonly echo: unknown
}

/**
 * Browser-relative form of an app route. DSH Desktop serves the panel from
 * `dsh-app://app/`, where a leading `/` would bypass the fetch bridge.
 */
export function appRoute(path: string): string {
  return path.replace(/^\/+/, '')
}

export function isValidUnaryMethod(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && UNARY_METHOD_PATTERN.test(value)
}

export function isUnaryRequest(value: unknown): value is UnaryRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (!isValidUnaryMethod(candidate.method)) return false
  if (candidate.id !== undefined) {
    if (typeof candidate.id !== 'string' || !REQUEST_ID_PATTERN.test(candidate.id)) return false
  }
  return candidate.params === undefined || isJsonValue(candidate.params)
}

export function isUnarySuccess(value: unknown): value is UnarySuccess {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.ok !== true || !('value' in candidate)) return false
  if (candidate.id !== undefined && typeof candidate.id !== 'string') return false
  return true
}

export function isUnaryFailure(value: unknown): value is UnaryFailure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.ok !== false || !isStudioError(candidate.error)) return false
  if (candidate.id !== undefined && typeof candidate.id !== 'string') return false
  return true
}

export function isTransportHealth(value: unknown): value is TransportHealth {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.plugin !== 'string') return false
  if (candidate.transportVersion !== TRANSPORT_VERSION) return false
  if (typeof candidate.serverTime !== 'string') return false
  if (!Number.isFinite(candidate.uptimeMs) || (candidate.uptimeMs as number) < 0) return false
  const config = candidate.config
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false
  const summary = config as Record<string, unknown>
  return (
    typeof summary.logLevel === 'string' &&
    Array.isArray(summary.allowedOrigins) &&
    summary.allowedOrigins.every((origin) => typeof origin === 'string') &&
    Number.isFinite(summary.retentionDays) &&
    Number.isFinite(summary.contextBudgetBytes) &&
    typeof summary.screenshotEnabled === 'boolean'
  )
}

/** JSON-only check so an untrusted request never smuggles class instances. */
function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 32) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1))
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    return Object.values(value as Record<string, unknown>).every((entry) =>
      isJsonValue(entry, depth + 1),
    )
  }
  return false
}
