/**
 * Browser-side transport for the Studio panel (T011).
 *
 * Every request uses the document-relative `api/vibe/...` form: DSH Web mounts
 * the Host at the origin root, while Desktop serves `dsh-app://app/` and only
 * forwards relative requests through its fetch bridge (S1). Cookies stay
 * same-origin; DSH Connection owns authentication, so this module never reads
 * or stores credentials.
 */
import { utf8Bytes } from '../../contracts/budget'
import type { StudioError, StudioErrorCode } from '../../contracts/errors'
import {
  DEFAULT_UNARY_TIMEOUT_MS,
  HEALTH_PATH,
  MAX_UNARY_BODY_BYTES,
  REQUEST_PATH,
  appRoute,
  isTransportHealth,
  isUnaryFailure,
  isUnarySuccess,
  isValidUnaryMethod,
  type TransportHealth,
} from '../../contracts/transport'

export interface TransportOptions {
  readonly signal?: AbortSignal
  /** Bounded wait; caller abort and timeout are reported distinctly. */
  readonly timeoutMs?: number
  /** Injection point for tests and non-fetch carriers. */
  readonly fetchImpl?: typeof fetch
}

export class TransportError extends Error {
  readonly code: StudioErrorCode
  readonly status: number | null
  readonly details?: Readonly<Record<string, unknown>>

  constructor(
    code: StudioErrorCode,
    message: string,
    options: {
      readonly status?: number | null
      readonly details?: Readonly<Record<string, unknown>>
      readonly cause?: unknown
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'TransportError'
    this.code = code
    this.status = options.status ?? null
    this.details = options.details
  }
}

interface GuardedSignal {
  readonly signal: AbortSignal
  readonly timedOut: () => boolean
  readonly dispose: () => void
}

function guardedSignal(timeoutMs: number, external?: AbortSignal): GuardedSignal {
  const controller = new AbortController()
  let timedOut = false
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_UNARY_TIMEOUT_MS
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeout)
  const relay = (): void => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', relay, { once: true })
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', relay)
    },
  }
}

function codeForStatus(status: number): StudioErrorCode {
  if (status === 401 || status === 403) return 'permission_denied'
  if (status === 404) return 'not_found'
  if (status === 413) return 'invalid_input'
  if (status === 415) return 'unsupported'
  if (status === 503) return 'target_unavailable'
  if (status === 504) return 'timeout'
  if (status >= 500) return 'internal'
  return 'invalid_input'
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '')
  if (text.length === 0) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function httpError(status: number, body: unknown): TransportError {
  if (isUnaryFailure(body)) {
    return new TransportError(body.error.code, body.error.message, {
      status,
      details: body.error.details,
    })
  }
  return new TransportError(codeForStatus(status), `request failed with HTTP ${status}`, { status })
}

function normalizeError(
  error: unknown,
  guard: GuardedSignal,
  external?: AbortSignal,
): TransportError {
  if (error instanceof TransportError) return error
  if (guard.timedOut()) {
    return new TransportError('timeout', 'request timed out', { cause: error })
  }
  if (external?.aborted) {
    return new TransportError('network_error', 'request aborted', { cause: error })
  }
  const message = error instanceof Error ? error.message : String(error)
  return new TransportError('network_error', `request failed: ${message}`, { cause: error })
}

function studioErrorOf(error: TransportError): StudioError {
  return error.details === undefined
    ? { code: error.code, message: error.message }
    : { code: error.code, message: error.message, details: error.details }
}

/** Exposed for callers that need the stable error shape without throwing. */
export function toStudioError(error: unknown): StudioError {
  if (error instanceof TransportError) return studioErrorOf(error)
  return { code: 'internal', message: error instanceof Error ? error.message : String(error) }
}

/** GET `/api/vibe/health`; throws {@link TransportError} on any non-success. */
export async function fetchHealth(options: TransportOptions = {}): Promise<TransportHealth> {
  const guard = guardedSignal(options.timeoutMs ?? DEFAULT_UNARY_TIMEOUT_MS, options.signal)
  try {
    const response = await (options.fetchImpl ?? fetch)(appRoute(HEALTH_PATH), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal: guard.signal,
    })
    const body = await readJson(response)
    if (!response.ok) throw httpError(response.status, body)
    if (!isUnarySuccess(body) || !isTransportHealth(body.value)) {
      throw new TransportError('internal', 'invalid health response')
    }
    return body.value
  } catch (error) {
    throw normalizeError(error, guard, options.signal)
  } finally {
    guard.dispose()
  }
}

/** POST `/api/vibe/request`; resolves with the method's value. */
export async function callUnary<T = unknown>(
  method: string,
  params?: unknown,
  options: TransportOptions = {},
): Promise<T> {
  if (!isValidUnaryMethod(method)) {
    throw new TransportError('invalid_input', `invalid unary method ${JSON.stringify(method)}`)
  }
  let bodyText: string
  try {
    bodyText = JSON.stringify(params === undefined ? { method } : { method, params })
  } catch {
    throw new TransportError('invalid_input', 'params are not JSON-serializable')
  }
  if (utf8Bytes(bodyText) > MAX_UNARY_BODY_BYTES) {
    throw new TransportError('invalid_input', 'request is too large', {
      details: { limitBytes: MAX_UNARY_BODY_BYTES },
    })
  }

  const guard = guardedSignal(options.timeoutMs ?? DEFAULT_UNARY_TIMEOUT_MS, options.signal)
  try {
    const response = await (options.fetchImpl ?? fetch)(appRoute(REQUEST_PATH), {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: bodyText,
      signal: guard.signal,
    })
    const body = await readJson(response)
    if (!response.ok) throw httpError(response.status, body)
    if (isUnaryFailure(body)) {
      throw new TransportError(body.error.code, body.error.message, {
        status: response.status,
        details: body.error.details,
      })
    }
    if (!isUnarySuccess(body)) {
      throw new TransportError('internal', 'invalid unary response')
    }
    return body.value as T
  } catch (error) {
    throw normalizeError(error, guard, options.signal)
  } finally {
    guard.dispose()
  }
}
