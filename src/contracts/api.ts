/**
 * API workbench wire shapes (T035).
 *
 * Requests arrive over the authenticated unary transport as plain JSON, so no
 * Buffers, streams or fetch objects appear here: bodies travel as text or
 * base64 and every size is a byte count. The host normalizes and executes a
 * request; the panel only builds this shape and renders the result.
 */
import { REDACTED, isSensitiveKey, redactJsonBody, redactUrl } from './redact'

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

/** Placeholder names: `{{baseUrl}}`, `{{token}}`; no spaces or braces inside. */
export const API_ENV_NAME_PATTERN = '[A-Za-z_][A-Za-z0-9_.-]*'
export const API_ENV_VARS_MAX = 200
export const API_ENV_VALUE_CHARS_MAX = 8192

/**
 * One environment variable. A secret carries the *name* of a credential
 * reference in `value`; the value itself only ever lives in `ctx.credentials`
 * and never crosses the wire.
 */
export interface ApiEnvironmentVariable {
  readonly name: string
  readonly value: string
  readonly secret?: boolean
  readonly enabled?: boolean
}

export interface ApiEnvironment {
  readonly id?: string
  readonly name?: string
  readonly variables: readonly ApiEnvironmentVariable[]
}

/** One variable as a configuration surface may show it — never a secret value. */
export interface ApiEnvironmentVariableView {
  readonly name: string
  readonly secret: boolean
  readonly enabled: boolean
  /** Plain variables only; absent for secrets. */
  readonly value?: string
  /** Secrets only: whether the reference currently resolves at all. */
  readonly configured?: boolean
  /** Secrets only: whether the active provider can write the reference. */
  readonly writable?: boolean
  /** Secrets only: supplying source layer, when configured. */
  readonly source?: string
}

export interface ApiEnvironmentView {
  readonly name?: string
  readonly variables: readonly ApiEnvironmentVariableView[]
}

/** A `{{name}}` that could not be resolved while expanding a request. */
export interface UnresolvedVariable {
  readonly name: string
  /** Where it was found: `url`, `header:X-Key`, `query:q`, `body`, `auth`… */
  readonly where: string
  /** `missing` when no variable matches; `secret_not_configured` for secrets. */
  readonly reason: 'missing' | 'secret_not_configured' | 'disabled'
}

const ENV_NAME_RE = new RegExp(`^${API_ENV_NAME_PATTERN}$`)

/** True when `name` fits the `{{...}}` grammar used by environments. */
export function isApiEnvironmentVariableName(name: string): boolean {
  return ENV_NAME_RE.test(name)
}

export function isApiEnvironmentVariable(value: unknown): value is ApiEnvironmentVariable {
  if (!isRecord(value)) return false
  return (
    typeof value.name === 'string' &&
    isApiEnvironmentVariableName(value.name) &&
    isBoundedString(value.value, 0, API_ENV_VALUE_CHARS_MAX) &&
    (value.secret === undefined || typeof value.secret === 'boolean') &&
    (value.enabled === undefined || typeof value.enabled === 'boolean')
  )
}

export function isApiEnvironment(value: unknown): value is ApiEnvironment {
  if (!isRecord(value)) return false
  return (
    (value.id === undefined || isBoundedString(value.id, 1, 256)) &&
    (value.name === undefined || isBoundedString(value.name, 1, 256)) &&
    Array.isArray(value.variables) &&
    value.variables.length <= API_ENV_VARS_MAX &&
    value.variables.every(isApiEnvironmentVariable)
  )
}

export function isApiEnvironmentView(value: unknown): value is ApiEnvironmentView {
  if (!isRecord(value)) return false
  return (
    (value.name === undefined || typeof value.name === 'string') &&
    Array.isArray(value.variables) &&
    value.variables.every((variable) => {
      if (!isRecord(variable)) return false
      if (typeof variable.name !== 'string' || typeof variable.secret !== 'boolean') return false
      if (typeof variable.enabled !== 'boolean') return false
      if (variable.value !== undefined && typeof variable.value !== 'string') return false
      if (variable.configured !== undefined && typeof variable.configured !== 'boolean') return false
      if (variable.writable !== undefined && typeof variable.writable !== 'boolean') return false
      if (variable.source !== undefined && typeof variable.source !== 'string') return false
      // A secret row must not carry a value, even an empty one.
      return !(variable.secret === true && variable.value !== undefined)
    })
  )
}

/* -------------------------------------------------------------------------
 * Collections and history (T037)
 *
 * Both are plain JSON under `.vibe/api`, written after redaction: a stored
 * request never carries an expanded secret and never carries literal values
 * for sensitive headers, query parameters, auth or JSON body keys. Variables
 * stay as `{{name}}` placeholders and are only expanded at send time.
 * ---------------------------------------------------------------------- */

export const API_STORE_ID_PATTERN = '[A-Za-z0-9][A-Za-z0-9._-]{0,63}'
export const API_NAME_CHARS_MAX = 200
export const API_COLLECTION_ITEMS_MAX = 200
export const API_COLLECTION_FILE_BYTES_MAX = 256 * 1024
export const API_HISTORY_FILE_BYTES_MAX = 1024 * 1024
export const API_HISTORY_ENTRIES_MAX = 200
export const API_HISTORY_QUERY_CHARS_MAX = 200
export const API_HISTORY_LIMIT_DEFAULT = 50

const API_STORE_ID_RE = new RegExp(`^${API_STORE_ID_PATTERN}$`)

/** True for ids usable as a file stem inside `.vibe/api`. */
export function isApiStoreId(value: unknown): value is string {
  return typeof value === 'string' && API_STORE_ID_RE.test(value)
}

/** One request saved in a collection or folder. */
export interface ApiSavedRequest {
  readonly id: string
  readonly name: string
  /** Stored spec; secrets were redacted on the way to disk (T037). */
  readonly request: HttpRequestSpec
}

/** One level of folders keeps the file format trivial to validate. */
export interface ApiCollectionFolder {
  readonly id: string
  readonly name: string
  readonly requests: readonly ApiSavedRequest[]
}

export interface ApiCollection {
  readonly id: string
  readonly name: string
  readonly folders?: readonly ApiCollectionFolder[]
  /** Requests that live outside any folder. */
  readonly requests?: readonly ApiSavedRequest[]
}

/** One sent request; the request is the stored, already-redacted copy. */
export interface ApiHistoryEntry {
  readonly id: string
  /** ISO-8601 timestamp of the send. */
  readonly at: string
  readonly method: HttpMethod
  /** Display URL after redaction. */
  readonly url: string
  /** Response status when a response came back; absent on transport errors. */
  readonly status?: number
  readonly elapsedMs?: number
  readonly request: HttpRequestSpec
}

export interface ApiHistoryQuery {
  /** Case-insensitive substring over method, URL and status. */
  readonly query?: string
  readonly limit?: number
}

export function isApiSavedRequest(value: unknown): value is ApiSavedRequest {
  if (!isRecord(value)) return false
  return (
    isApiStoreId(value.id) &&
    isBoundedString(value.name, 1, API_NAME_CHARS_MAX) &&
    isHttpRequestSpec(value.request)
  )
}

export function isApiCollectionFolder(value: unknown): value is ApiCollectionFolder {
  if (!isRecord(value)) return false
  return (
    isApiStoreId(value.id) &&
    isBoundedString(value.name, 1, API_NAME_CHARS_MAX) &&
    Array.isArray(value.requests) &&
    value.requests.length <= API_COLLECTION_ITEMS_MAX &&
    value.requests.every(isApiSavedRequest)
  )
}

export function isApiCollection(value: unknown): value is ApiCollection {
  if (!isRecord(value)) return false
  return (
    isApiStoreId(value.id) &&
    isBoundedString(value.name, 1, API_NAME_CHARS_MAX) &&
    (value.folders === undefined ||
      (Array.isArray(value.folders) &&
        value.folders.length <= API_COLLECTION_ITEMS_MAX &&
        value.folders.every(isApiCollectionFolder))) &&
    (value.requests === undefined ||
      (Array.isArray(value.requests) &&
        value.requests.length <= API_COLLECTION_ITEMS_MAX &&
        value.requests.every(isApiSavedRequest)))
  )
}

export function isApiHistoryEntry(value: unknown): value is ApiHistoryEntry {
  if (!isRecord(value)) return false
  return (
    isApiStoreId(value.id) &&
    isBoundedString(value.at, 10, 40) &&
    !Number.isNaN(Date.parse(value.at)) &&
    typeof value.method === 'string' &&
    (HTTP_METHODS as readonly string[]).includes(value.method) &&
    isBoundedString(value.url, 0, HTTP_URL_CHARS_MAX + 512) &&
    (value.status === undefined || isIntegerInRange(value.status, 100, 599)) &&
    (value.elapsedMs === undefined || isIntegerInRange(value.elapsedMs, 0, 86_400_000)) &&
    isHttpRequestSpec(value.request)
  )
}

export function isApiHistoryQuery(value: unknown): value is ApiHistoryQuery {
  if (!isRecord(value)) return false
  return (
    (value.query === undefined || isBoundedString(value.query, 0, API_HISTORY_QUERY_CHARS_MAX)) &&
    (value.limit === undefined || isIntegerInRange(value.limit, 1, API_HISTORY_ENTRIES_MAX))
  )
}

/** Sensitive row values become `REDACTED`; the row itself is kept visible. */
function redactRows(
  rows: readonly HttpKeyValue[] | undefined,
): readonly HttpKeyValue[] | undefined {
  if (rows === undefined) return undefined
  return rows.map((row) => (isSensitiveKey(row.name) ? { ...row, value: REDACTED } : { ...row }))
}

/** Re-serializes a JSON body with sensitive keys masked, when it parses. */
function redactJsonText(text: string): string {
  try {
    return JSON.stringify(redactJsonBody(JSON.parse(text)))
  } catch {
    // Not JSON despite the kind; nothing trustworthy to redact, keep the text.
    return text
  }
}

function redactBody(body: HttpRequestBody | undefined): HttpRequestBody | undefined {
  if (body === undefined) return undefined
  switch (body.kind) {
    case 'none':
      return { kind: 'none' }
    case 'json':
      return { kind: 'json', text: redactJsonText(body.text) }
    case 'text':
      return body.contentType === undefined
        ? { kind: 'text', text: body.text }
        : { kind: 'text', text: body.text, contentType: body.contentType }
    case 'form':
      return { kind: 'form', fields: redactRows(body.fields) ?? [] }
    case 'multipart':
      return {
        kind: 'multipart',
        fields: redactRows(body.fields) ?? [],
        // File bytes are never persisted: they are large and not replayable
        // from disk. The panel re-attaches the file before sending.
        files: body.files.map((file) => ({ ...file, base64: '' })),
      }
  }
}

function redactAuth(auth: HttpAuth | undefined): HttpAuth | undefined {
  if (auth === undefined) return undefined
  switch (auth.kind) {
    case 'none':
      return { kind: 'none' }
    case 'bearer':
      return { kind: 'bearer', token: REDACTED }
    case 'basic':
      // The username identifies the account; the password is the secret.
      return { kind: 'basic', username: auth.username, password: REDACTED }
    case 'api-key':
      return { kind: 'api-key', name: auth.name, value: REDACTED, in: auth.in }
  }
}

/**
 * The copy of a request that may be written to `.vibe/api`: URL credentials
 * and sensitive query values stripped, sensitive headers/rows/auth masked,
 * JSON body keys redacted and multipart file bytes dropped.
 */
export function redactHttpRequest(request: HttpRequestSpec): HttpRequestSpec {
  return {
    method: request.method,
    url: redactUrl(request.url),
    ...(request.query === undefined ? {} : { query: redactRows(request.query) ?? [] }),
    ...(request.headers === undefined ? {} : { headers: redactRows(request.headers) ?? [] }),
    ...(request.body === undefined ? {} : { body: redactBody(request.body) }),
    ...(request.auth === undefined ? {} : { auth: redactAuth(request.auth) }),
    ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
    ...(request.redirect === undefined ? {} : { redirect: request.redirect }),
    ...(request.maxRedirects === undefined ? {} : { maxRedirects: request.maxRedirects }),
    ...(request.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: request.maxResponseBytes }),
  }
}
