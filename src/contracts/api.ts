/**
 * API workbench wire shapes (T035).
 *
 * Requests arrive over the authenticated unary transport as plain JSON, so no
 * Buffers, streams or fetch objects appear here: bodies travel as text or
 * base64 and every size is a byte count. The host normalizes and executes a
 * request; the panel only builds this shape and renders the result.
 */

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

export const HTTP_REDIRECT_POLICIES = ['follow', 'manual', 'error'] as const
export type HttpRedirectPolicy = (typeof HTTP_REDIRECT_POLICIES)[number]

export const HTTP_AUTH_KINDS = ['none', 'bearer', 'basic', 'api-key'] as const
export type HttpAuthKind = (typeof HTTP_AUTH_KINDS)[number]

export const HTTP_TIMEOUT_MIN_MS = 100
export const HTTP_TIMEOUT_DEFAULT_MS = 30_000
export const HTTP_TIMEOUT_MAX_MS = 300_000

export const HTTP_MAX_REDIRECTS_DEFAULT = 5
export const HTTP_MAX_REDIRECTS_LIMIT = 10

export const HTTP_RESPONSE_BYTES_MIN = 1024
export const HTTP_RESPONSE_BYTES_DEFAULT = 4 * 1024 * 1024
export const HTTP_RESPONSE_BYTES_MAX = 16 * 1024 * 1024

export const HTTP_REQUEST_BODY_BYTES_MAX = 8 * 1024 * 1024
export const HTTP_MULTIPART_FILE_BYTES_MAX = 4 * 1024 * 1024

export const HTTP_HEADERS_MAX = 100
export const HTTP_PARAMS_MAX = 200
export const HTTP_URL_CHARS_MAX = 4096
export const HTTP_HEADER_VALUE_CHARS_MAX = 8192

export interface HttpKeyValue {
  readonly name: string
  readonly value: string
  /** Disabled rows are kept in the UI but never sent. */
  readonly enabled?: boolean
}

export interface HttpFilePart {
  /** Multipart field name the file is attached to. */
  readonly field: string
  readonly fileName: string
  readonly contentType?: string
  /** File bytes as base64; the unary transport never carries a Buffer. */
  readonly base64: string
}

export type HttpRequestBody =
  | { readonly kind: 'none' }
  | { readonly kind: 'json'; readonly text: string }
  | { readonly kind: 'text'; readonly text: string; readonly contentType?: string }
  | { readonly kind: 'form'; readonly fields: readonly HttpKeyValue[] }
  | {
      readonly kind: 'multipart'
      readonly fields: readonly HttpKeyValue[]
      readonly files: readonly HttpFilePart[]
    }

export type HttpAuth =
  | { readonly kind: 'none' }
  | { readonly kind: 'bearer'; readonly token: string }
  | { readonly kind: 'basic'; readonly username: string; readonly password: string }
  | {
      readonly kind: 'api-key'
      readonly name: string
      readonly value: string
      readonly in: 'header' | 'query'
    }

export interface HttpRequestSpec {
  readonly method: HttpMethod
  readonly url: string
  readonly query?: readonly HttpKeyValue[]
  readonly headers?: readonly HttpKeyValue[]
  readonly body?: HttpRequestBody
  readonly auth?: HttpAuth
  readonly timeoutMs?: number
  readonly redirect?: HttpRedirectPolicy
  readonly maxRedirects?: number
  readonly maxResponseBytes?: number
}

export interface HttpRedirectHop {
  /** Status of the redirect response, e.g. 302. */
  readonly status: number
  /** URL that answered with the redirect. */
  readonly url: string
  /** Absolute URL the redirect points at. */
  readonly location: string
}

export interface HttpResponseBody {
  /** UTF-8 text for textual responses; null for known binary content types. */
  readonly text: string | null
  readonly base64: string
  /** Bytes captured, after the cap; smaller than the wire body when truncated. */
  readonly bytes: number
  readonly truncated: boolean
  readonly contentType: string | null
}

export interface HttpExecutionResult {
  readonly status: number
  readonly statusText: string
  /** Final URL after followed redirects. */
  readonly url: string
  readonly redirects: readonly HttpRedirectHop[]
  /** Response headers after redaction; cookies and tokens never leave raw. */
  readonly headers: Readonly<Record<string, string>>
  readonly elapsedMs: number
  readonly body: HttpResponseBody
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isBoundedString(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === 'string' && value.length >= minLength && value.length <= maxLength
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

export function isHttpKeyValue(value: unknown): value is HttpKeyValue {
  if (!isRecord(value)) return false
  return (
    isBoundedString(value.name, 0, 256) &&
    typeof value.value === 'string' &&
    (value.enabled === undefined || typeof value.enabled === 'boolean')
  )
}

function isKeyValueArray(value: unknown, max: number): value is readonly HttpKeyValue[] {
  return Array.isArray(value) && value.length <= max && value.every(isHttpKeyValue)
}

function isHttpFilePart(value: unknown): value is HttpFilePart {
  if (!isRecord(value)) return false
  return (
    isBoundedString(value.field, 1, 256) &&
    isBoundedString(value.fileName, 1, 255) &&
    (value.contentType === undefined || isBoundedString(value.contentType, 1, 256)) &&
    typeof value.base64 === 'string'
  )
}

export function isHttpRequestBody(value: unknown): value is HttpRequestBody {
  if (!isRecord(value)) return false
  const fields = value.fields
  switch (value.kind) {
    case 'none':
      return Object.keys(value).length === 1
    case 'json':
      return typeof value.text === 'string'
    case 'text':
      return (
        typeof value.text === 'string' &&
        (value.contentType === undefined || isBoundedString(value.contentType, 1, 256))
      )
    case 'form':
      return isKeyValueArray(fields, HTTP_PARAMS_MAX)
    case 'multipart':
      return (
        isKeyValueArray(fields, HTTP_PARAMS_MAX) &&
        Array.isArray(value.files) &&
        value.files.length <= HTTP_PARAMS_MAX &&
        value.files.every(isHttpFilePart)
      )
    default:
      return false
  }
}

export function isHttpAuth(value: unknown): value is HttpAuth {
  if (!isRecord(value)) return false
  switch (value.kind) {
    case 'none':
      return true
    case 'bearer':
      return isBoundedString(value.token, 1, 8192)
    case 'basic':
      return typeof value.username === 'string' && typeof value.password === 'string'
    case 'api-key':
      return (
        isBoundedString(value.name, 1, 128) &&
        typeof value.value === 'string' &&
        (value.in === 'header' || value.in === 'query')
      )
    default:
      return false
  }
}

export function isHttpRequestSpec(value: unknown): value is HttpRequestSpec {
  if (!isRecord(value)) return false
  return (
    typeof value.method === 'string' &&
    (HTTP_METHODS as readonly string[]).includes(value.method) &&
    isBoundedString(value.url, 1, HTTP_URL_CHARS_MAX) &&
    (value.query === undefined || isKeyValueArray(value.query, HTTP_PARAMS_MAX)) &&
    (value.headers === undefined || isKeyValueArray(value.headers, HTTP_HEADERS_MAX)) &&
    (value.body === undefined || isHttpRequestBody(value.body)) &&
    (value.auth === undefined || isHttpAuth(value.auth)) &&
    (value.timeoutMs === undefined ||
      isIntegerInRange(value.timeoutMs, HTTP_TIMEOUT_MIN_MS, HTTP_TIMEOUT_MAX_MS)) &&
    (value.redirect === undefined ||
      (typeof value.redirect === 'string' &&
        (HTTP_REDIRECT_POLICIES as readonly string[]).includes(value.redirect))) &&
    (value.maxRedirects === undefined ||
      isIntegerInRange(value.maxRedirects, 0, HTTP_MAX_REDIRECTS_LIMIT)) &&
    (value.maxResponseBytes === undefined ||
      isIntegerInRange(value.maxResponseBytes, HTTP_RESPONSE_BYTES_MIN, HTTP_RESPONSE_BYTES_MAX))
  )
}
