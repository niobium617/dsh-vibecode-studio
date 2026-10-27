/**
 * Host-side unary method registry (T011).
 *
 * Later preview features register methods here instead of adding routes, so
 * every browser → Host call shares one authenticated exact route, one envelope
 * and one error mapping. Handlers receive already-validated JSON params.
 */
import {
  isStudioError,
  studioError,
  type StudioError,
} from '../../contracts/errors'
import { isValidUnaryMethod, type UnaryResponse } from '../../contracts/transport'

export interface UnaryCallContext {
  readonly request: Request
  readonly signal: AbortSignal
}

export type UnaryHandler = (
  params: unknown,
  context: UnaryCallContext,
) => unknown | Promise<unknown>

export interface UnaryDispatchResult {
  readonly status: number
  readonly body: UnaryResponse
}

/** HTTP status for each stable Studio error code. */
const STATUS_BY_CODE: Record<string, number> = {
  invalid_input: 400,
  invalid_config: 400,
  not_found: 404,
  permission_denied: 403,
  unsupported: 501,
  target_unavailable: 503,
  preview_failed: 502,
  timeout: 504,
  network_error: 502,
  artifact_missing: 404,
  internal: 500,
}

export class UnaryRegistry {
  private readonly handlers = new Map<string, UnaryHandler>()

  /** Registers a method and returns an idempotent unregister function. */
  register(method: string, handler: UnaryHandler): () => void {
    if (!isValidUnaryMethod(method)) {
      throw new Error(`vibe-studio: invalid unary method ${JSON.stringify(method)}`)
    }
    if (this.handlers.has(method)) {
      throw new Error(`vibe-studio: unary method ${JSON.stringify(method)} is already registered`)
    }
    this.handlers.set(method, handler)
    return () => {
      if (this.handlers.get(method) === handler) this.handlers.delete(method)
    }
  }

  has(method: string): boolean {
    return this.handlers.has(method)
  }

  /** Runs one method, converting thrown errors into the wire envelope. */
  async dispatch(
    method: string,
    params: unknown,
    context: UnaryCallContext,
    id?: string,
  ): Promise<UnaryDispatchResult> {
    const handler = this.handlers.get(method)
    if (!handler) {
      return failure(404, studioError('not_found', `unknown method "${method}"`), id)
    }
    try {
      const value = await handler(params, context)
      return { status: 200, body: id === undefined ? { ok: true, value } : { ok: true, value, id } }
    } catch (error) {
      if (isStudioError(error)) {
        return failure(STATUS_BY_CODE[error.code] ?? 500, error, id)
      }
      // Handlers may touch page/API content; never echo the raw failure.
      console.error('[vibe-studio] unary handler failed', error instanceof Error ? error.message : typeof error)
      return failure(500, studioError('internal', 'request handler failed'), id)
    }
  }
}

export function failure(
  status: number,
  error: StudioError,
  id?: string,
): UnaryDispatchResult {
  return { status, body: id === undefined ? { ok: false, error } : { ok: false, error, id } }
}
