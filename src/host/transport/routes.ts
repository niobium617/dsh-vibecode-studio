/**
 * Exact Fetch-route handlers for `/api/vibe/*` (T011).
 *
 * DSH Connection calls these only after its Host/Origin fence and browser
 * authentication pass. These handlers stay strict anyway: JSON content type,
 * a bounded body, exact request keys, and an envelope on every outcome so the
 * client never has to parse an HTML error page.
 */
import { utf8Bytes } from '../../contracts/budget'
import { studioError } from '../../contracts/errors'
import {
  MAX_UNARY_BODY_BYTES,
  isUnaryRequest,
  type TransportHealth,
} from '../../contracts/transport'
import { type UnaryRegistry } from './unary'

const JSON_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

const REQUEST_KEYS = new Set(['id', 'method', 'params'])

/** Serializes an envelope; a non-JSON handler result becomes an internal error. */
export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Readonly<Record<string, string>> = {},
): Response {
  const headers = { ...JSON_HEADERS, ...extraHeaders }
  let text: string
  try {
    text = JSON.stringify(body)
  } catch {
    text = JSON.stringify({
      ok: false,
      error: studioError('internal', 'response is not serializable'),
    })
    status = 500
  }
  return new Response(text, { status, headers })
}

export function createHealthRoute(
  health: () => TransportHealth,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET') {
      return jsonResponse(
        { ok: false, error: studioError('unsupported', 'health accepts GET only') },
        405,
        { allow: 'GET' },
      )
    }
    try {
      return jsonResponse({ ok: true, value: health() })
    } catch (error) {
      console.error(
        '[vibe-studio] health handler failed',
        error instanceof Error ? error.message : typeof error,
      )
      return jsonResponse(
        { ok: false, error: studioError('internal', 'health check failed') },
        500,
      )
    }
  }
}

export function createUnaryRoute(
  registry: UnaryRegistry,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') {
      return jsonResponse(
        { ok: false, error: studioError('unsupported', 'unary requests use POST') },
        405,
        { allow: 'POST' },
      )
    }

    const mediaType = (request.headers.get('content-type') ?? '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase()
    if (mediaType !== 'application/json') {
      return jsonResponse(
        { ok: false, error: studioError('unsupported', 'content type must be application/json') },
        415,
      )
    }

    const declared = Number(request.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_UNARY_BODY_BYTES) {
      return jsonResponse(
        {
          ok: false,
          error: studioError('invalid_input', 'request body is too large', {
            limitBytes: MAX_UNARY_BODY_BYTES,
          }),
        },
        413,
      )
    }

    let text: string
    try {
      text = await request.text()
    } catch {
      return jsonResponse(
        { ok: false, error: studioError('invalid_input', 'request body could not be read') },
        400,
      )
    }
    if (utf8Bytes(text) > MAX_UNARY_BODY_BYTES) {
      return jsonResponse(
        {
          ok: false,
          error: studioError('invalid_input', 'request body is too large', {
            limitBytes: MAX_UNARY_BODY_BYTES,
          }),
        },
        413,
      )
    }

    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      return jsonResponse(
        { ok: false, error: studioError('invalid_input', 'request body is not valid JSON') },
        400,
      )
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return jsonResponse(
        { ok: false, error: studioError('invalid_input', 'request body must be an object') },
        400,
      )
    }
    const candidate = payload as Record<string, unknown>
    if (Object.keys(candidate).some((key) => !REQUEST_KEYS.has(key))) {
      return jsonResponse(
        { ok: false, error: studioError('invalid_input', 'request contains unknown keys') },
        400,
      )
    }
    if (!isUnaryRequest(payload)) {
      return jsonResponse(
        { ok: false, error: studioError('invalid_input', 'invalid method or request id') },
        400,
      )
    }

    const result = await registry.dispatch(
      payload.method,
      payload.params,
      { request, signal: request.signal },
      payload.id,
    )
    return jsonResponse(result.body, result.status)
  }
}
