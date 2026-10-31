/**
 * HTTP executor for the API workbench (T035).
 *
 * One request in, one bounded result out: timeout and caller cancellation
 * share a single AbortController, redirects are followed by hand so the hop
 * list and the policy (`follow` / `manual` / `error`) stay observable, and the
 * response body is capped while streaming so a huge payload can never be
 * buffered whole. Response headers are redacted before they leave, and error
 * messages never echo request headers or bodies.
 */
import {
  type HttpExecutionResult,
  type HttpMethod,
  type HttpRedirectHop,
  type HttpResponseBody,
} from '../../contracts/api'
import { isStudioError, studioError, type StudioError } from '../../contracts/errors'
import { isSensitiveKey, redactHeaders } from '../../contracts/redact'
import { isBlockedHost, normalizeHttpRequest, type NormalizedHttpRequest } from './request'

export interface HttpExecutorOptions {
  /** Injected for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch
  readonly now?: () => number
  /** Deterministic multipart boundary, mainly for tests. */
  readonly boundary?: () => string
}

export interface HttpExecuteOptions {
  /** Caller cancellation; aborting rejects with `network_error` / `cancelled`. */
  readonly signal?: AbortSignal
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

/** Content types the panel can show as text without a binary preview. */
const TEXTUAL_CONTENT_TYPE =
  /^(?:text\/|application\/(?:json|xml|javascript|ecmascript|x-ndjson|x-www-form-urlencoded)|application\/[A-Za-z0-9.+-]+\+(?:json|xml))/i

const MAX_ERROR_CHARS = 200

function cancelledError(): StudioError {
  return studioError('network_error', 'vibe-studio: request was cancelled', { reason: 'cancelled' })
}

function sanitizeMessage(value: string): string {
  const cleaned = value.replace(/[^\x20-\x7E]/g, ' ').trim()
  return cleaned.length > MAX_ERROR_CHARS ? `${cleaned.slice(0, MAX_ERROR_CHARS)}…` : cleaned
}

/** Surfaces an undici cause code (`ECONNREFUSED`) without leaking the stack. */
function causeSuffix(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause
  const code = cause?.code
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,39}$/.test(code) ? ` (${code})` : ''
}

function mapExecuteError(
  error: unknown,
  state: { readonly timedOut: boolean; readonly cancelled: boolean; readonly timeoutMs: number },
): StudioError {
  if (isStudioError(error)) return error
  if (state.timedOut) {
    return studioError('timeout', 'vibe-studio: request timed out', {
      reason: 'timeout',
      timeoutMs: state.timeoutMs,
    })
  }
  if (state.cancelled) return cancelledError()
  const message = error instanceof Error ? sanitizeMessage(error.message) : 'request failed'
  return studioError('network_error', `vibe-studio: ${message}${causeSuffix(error)}`, {
    reason: 'request_failed',
  })
}

function nextRequest(status: number, method: HttpMethod): { method: HttpMethod; dropBody: boolean } {
  if (status === 303 && method !== 'HEAD') return { method: 'GET', dropBody: true }
  if ((status === 301 || status === 302) && method === 'POST') return { method: 'GET', dropBody: true }
  return { method, dropBody: false }
}

function withoutBodyHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (/^content-(?:type|length|encoding)$/i.test(name) || /^transfer-encoding$/i.test(name)) {
      continue
    }
    result[name] = value
  }
  return result
}

/**
 * T059: a redirect is decided by the target server, so credentials must not
 * follow it to a different origin — the same rule browsers and curl apply.
 * The executor follows redirects by hand (`redirect: 'manual'`), which
 * otherwise forwards them unchecked. The predicate is the redaction one
 * (`isSensitiveKey`), so a custom `X-Api-Key` or `X-Client-Secret` header is
 * dropped just like `Authorization`/`Cookie`.
 */
function withoutCrossOriginCredentials(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (isSensitiveKey(name)) continue
    result[name] = value
  }
  return result
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // The body may already be unusable; the socket is destroyed either way.
  }
}

function headerRecord(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [name, value] of headers.entries()) result[name] = value
  return result
}

/** Reads at most `maxBytes`; marks `truncated` and closes the stream early. */
async function readResponseBody(
  response: Response,
  maxBytes: number,
): Promise<HttpResponseBody> {
  const contentType = response.headers.get('content-type')
  const source = response.body
  if (source === null) {
    return { text: '', base64: '', bytes: 0, truncated: false, contentType }
  }

  const reader = source.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || value.byteLength === 0) continue
      const remaining = maxBytes - total
      if (value.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(value.subarray(0, remaining))
          total += remaining
        }
        truncated = true
        break
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    if (truncated) {
      try {
        await reader.cancel()
      } catch {
        // Already closed or aborted; nothing to release.
      }
    }
    reader.releaseLock()
  }

  const bytes = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
    total,
  )
  const textual = contentType === null || TEXTUAL_CONTENT_TYPE.test(contentType)
  return {
    text: textual ? new TextDecoder('utf-8', { fatal: false }).decode(bytes) : null,
    base64: bytes.toString('base64'),
    bytes: total,
    truncated,
    contentType,
  }
}

export class HttpExecutor {
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly boundary?: () => string

  constructor(options: HttpExecutorOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.boundary = options.boundary
  }

  /**
   * Normalizes and sends one request. Resolves with the response even for
   * 4xx/5xx; only transport, policy or validation failures reject.
   */
  async execute(input: unknown, options: HttpExecuteOptions = {}): Promise<HttpExecutionResult> {
    if (options.signal?.aborted) throw cancelledError()
    const request = normalizeHttpRequest(input, { boundary: this.boundary?.() })
    return this.run(request, options.signal)
  }

  private async run(
    request: NormalizedHttpRequest,
    externalSignal?: AbortSignal,
  ): Promise<HttpExecutionResult> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, request.timeoutMs)
    const onExternalAbort = (): void => controller.abort()
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true })

    const started = this.now()
    try {
      return await this.followRedirects(request, controller.signal, started)
    } catch (error) {
      throw mapExecuteError(error, {
        timedOut,
        cancelled: externalSignal?.aborted === true,
        timeoutMs: request.timeoutMs,
      })
    } finally {
      clearTimeout(timer)
      externalSignal?.removeEventListener('abort', onExternalAbort)
    }
  }

  private async followRedirects(
    request: NormalizedHttpRequest,
    signal: AbortSignal,
    started: number,
  ): Promise<HttpExecutionResult> {
    let method = request.method
    let headers = request.headers
    let body = request.body
    let url = request.url
    const redirects: HttpRedirectHop[] = []

    for (;;) {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === null ? null : new Uint8Array(body),
        redirect: 'manual',
        signal,
      })

      const location = REDIRECT_STATUSES.has(response.status)
        ? response.headers.get('location')
        : null
      if (location === null) {
        return this.buildResult(response, url, redirects, request.maxResponseBytes, started)
      }

      if (request.redirect === 'manual') {
        return this.buildResult(response, url, redirects, request.maxResponseBytes, started)
      }
      if (request.redirect === 'error') {
        await discard(response)
        throw studioError('network_error', 'vibe-studio: redirect is not allowed', {
          reason: 'redirect_not_allowed',
          status: response.status,
        })
      }
      if (redirects.length >= request.maxRedirects) {
        await discard(response)
        throw studioError('network_error', 'vibe-studio: too many redirects', {
          reason: 'too_many_redirects',
          maxRedirects: request.maxRedirects,
        })
      }

      let next: URL
      try {
        next = new URL(location, url)
      } catch {
        await discard(response)
        throw studioError('network_error', 'vibe-studio: redirect location is not valid', {
          reason: 'invalid_redirect',
        })
      }
      if (
        (next.protocol !== 'http:' && next.protocol !== 'https:') ||
        isBlockedHost(next.hostname)
      ) {
        await discard(response)
        throw studioError('permission_denied', 'vibe-studio: this host is not allowed', {
          reason: 'blocked_redirect',
          field: 'url',
        })
      }

      redirects.push({ status: response.status, url, location: next.toString() })
      await discard(response)

      const rewrite = nextRequest(response.status, method)
      if (rewrite.dropBody) {
        method = rewrite.method
        body = null
        headers = withoutBodyHeaders(headers)
      }
      // Strip credentials before the next hop, not after: a cross-origin
      // redirect target must never receive the original Authorization/Cookie.
      if (new URL(url).origin !== next.origin) {
        headers = withoutCrossOriginCredentials(headers)
      }
      url = next.toString()
    }
  }

  private async buildResult(
    response: Response,
    url: string,
    redirects: readonly HttpRedirectHop[],
    maxResponseBytes: number,
    started: number,
  ): Promise<HttpExecutionResult> {
    const body = await readResponseBody(response, maxResponseBytes)
    return {
      status: response.status,
      statusText: response.statusText,
      url,
      redirects: [...redirects],
      headers: redactHeaders(headerRecord(response.headers)),
      elapsedMs: Math.max(0, Math.round(this.now() - started)),
      body,
    }
  }
}

export function createHttpExecutor(options: HttpExecutorOptions = {}): HttpExecutor {
  return new HttpExecutor(options)
}
