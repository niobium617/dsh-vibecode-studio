/**
 * HTTP request normalization (T035).
 *
 * The panel sends a declarative `HttpRequestSpec`; the executor needs one
 * fully resolved request. This module owns the gap: URL and scheme checks,
 * query merging, header validation, auth application and body encoding
 * (JSON / text / urlencoded / multipart). Every rejection is a stable
 * `StudioError`, and nothing here performs I/O or logs request content.
 */
import { randomUUID } from 'node:crypto'
import {
  HTTP_MAX_REDIRECTS_DEFAULT,
  HTTP_REQUEST_BODY_BYTES_MAX,
  HTTP_MULTIPART_FILE_BYTES_MAX,
  HTTP_RESPONSE_BYTES_DEFAULT,
  HTTP_TIMEOUT_DEFAULT_MS,
  isHttpRequestSpec,
  type HttpAuth,
  type HttpKeyValue,
  type HttpMethod,
  type HttpRedirectPolicy,
  type HttpRequestBody,
  type HttpRequestSpec,
} from '../../contracts/api'
import { studioError, type StudioError } from '../../contracts/errors'

export interface NormalizedHttpRequest {
  readonly method: HttpMethod
  /** Absolute URL with query rows merged in; auth never lives in the URL. */
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: Uint8Array | null
  readonly timeoutMs: number
  readonly redirect: HttpRedirectPolicy
  readonly maxRedirects: number
  readonly maxResponseBytes: number
}

export interface NormalizeRequestOptions {
  /** Fixed multipart boundary; generated per request when omitted. */
  readonly boundary?: string
}

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const HEADER_NAME_CHARS_MAX = 128
const HEADER_VALUE_CHARS_MAX = 8192

/** Headers the runtime owns; letting callers set them produces confusing failures. */
const FORBIDDEN_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  'connection',
  'content-length',
  'expect',
  'host',
  'keep-alive',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

/** Shared with capture replay, which must not produce a name the executor rejects. */
export function isValidHeaderName(name: string): boolean {
  return name.length > 0 && name.length <= HEADER_NAME_CHARS_MAX && HEADER_NAME_PATTERN.test(name)
}

/** True for headers the executor owns and refuses to send (Host, Content-Length, …). */
export function isForbiddenRequestHeader(name: string): boolean {
  return FORBIDDEN_REQUEST_HEADERS.has(name.trim().toLowerCase())
}

/** Cloud metadata endpoints are never a legitimate API target. */
const BLOCKED_HOSTNAMES: ReadonlySet<string> = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
])

const encoder = new TextEncoder()

function invalidInput(message: string, field: string): StudioError {
  return studioError('invalid_input', `vibe-studio: ${message}`, { field })
}

function hasHeader(headers: Readonly<Record<string, string>>, name: string): boolean {
  const lower = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === lower)
}

/**
 * Rejects link-local addresses and well-known metadata hosts. The executor is
 * an API client by design, so public and local addresses stay allowed.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (host === '') return true
  if (BLOCKED_HOSTNAMES.has(host)) return true
  return /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)
}

function parseTargetUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw invalidInput('URL is not valid', 'url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalidInput('only http and https URLs are allowed', 'url')
  }
  if (url.username !== '' || url.password !== '') {
    throw invalidInput('remove credentials from the URL and use the auth field', 'url')
  }
  if (isBlockedHost(url.hostname)) {
    throw studioError('permission_denied', 'vibe-studio: this host is not allowed', {
      reason: 'blocked_host',
      field: 'url',
    })
  }
  return url
}

function appendQuery(url: URL, query: readonly HttpKeyValue[] | undefined): void {
  for (const entry of query ?? []) {
    if (entry.enabled === false) continue
    if (entry.name === '') throw invalidInput('query parameter name is required', 'query')
    url.searchParams.append(entry.name, entry.value)
  }
}

function normalizeHeaders(entries: HttpRequestSpec['headers']): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const entry of entries ?? []) {
    if (entry.enabled === false) continue
    if (!isValidHeaderName(entry.name)) {
      throw invalidInput(`header name ${JSON.stringify(entry.name)} is not valid`, 'headers')
    }
    if (/[\r\n]/.test(entry.value)) {
      throw invalidInput(`header ${entry.name} must not contain line breaks`, 'headers')
    }
    if (entry.value.length > HEADER_VALUE_CHARS_MAX) {
      throw invalidInput(`header ${entry.name} is too long`, 'headers')
    }
    if (isForbiddenRequestHeader(entry.name)) {
      throw invalidInput(`header ${entry.name} is managed by the executor`, 'headers')
    }
    if (hasHeader(headers, entry.name)) {
      throw invalidInput(`header ${entry.name} is set twice`, 'headers')
    }
    headers[entry.name] = entry.value
  }
  return headers
}

function applyAuth(
  headers: Record<string, string>,
  url: URL,
  auth: HttpAuth | undefined,
): void {
  if (!auth || auth.kind === 'none') return
  if (hasHeader(headers, 'authorization') && auth.kind !== 'api-key') {
    throw invalidInput('authorization is already set as a header', 'auth')
  }
  switch (auth.kind) {
    case 'bearer':
      headers.Authorization = `Bearer ${auth.token}`
      return
    case 'basic': {
      if (auth.username.includes(':')) {
        throw invalidInput('basic auth username must not contain ":"', 'auth')
      }
      const encoded = Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64')
      headers.Authorization = `Basic ${encoded}`
      return
    }
    case 'api-key': {
      if (auth.name.includes('\r') || auth.name.includes('\n') || auth.name.includes(':')) {
        throw invalidInput('api key name is not a valid header or query name', 'auth')
      }
      if (auth.in === 'header') {
        if (!isValidHeaderName(auth.name)) {
          throw invalidInput('api key name is not a valid header name', 'auth')
        }
        if (hasHeader(headers, auth.name)) {
          throw invalidInput(`header ${auth.name} is set twice`, 'auth')
        }
        headers[auth.name] = auth.value
      } else {
        url.searchParams.append(auth.name, auth.value)
      }
      return
    }
  }
}

function validateFieldName(name: string): void {
  if (name === '' || name.length > 200 || /[\r\n"]/.test(name)) {
    throw invalidInput(`form field name ${JSON.stringify(name)} is not valid`, 'body')
  }
}

function validateFileName(fileName: string): void {
  if (fileName.length > 255 || /[\r\n"]/.test(fileName)) {
    throw invalidInput(`file name ${JSON.stringify(fileName)} is not valid`, 'body')
  }
}

function decodeBase64(value: string, label: string): Buffer {
  const compact = value.replace(/\s+/g, '')
  if (compact === '') return Buffer.alloc(0)
  if (compact.length % 4 !== 0 || !BASE64_PATTERN.test(compact)) {
    throw invalidInput(`file ${JSON.stringify(label)} is not valid base64`, 'body')
  }
  return Buffer.from(compact, 'base64')
}

function concatBytes(parts: readonly Uint8Array[], total: number): Uint8Array {
  const result = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

interface EncodedBody {
  readonly bytes: Uint8Array | null
  readonly contentType: string | null
}

function encodeMultipart(
  body: Extract<HttpRequestBody, { kind: 'multipart' }>,
  boundary: string,
): EncodedBody {
  const parts: Uint8Array[] = []
  let total = 0
  const push = (value: string | Uint8Array): void => {
    const bytes = typeof value === 'string' ? encoder.encode(value) : value
    parts.push(bytes)
    total += bytes.byteLength
  }

  for (const field of body.fields) {
    if (field.enabled === false) continue
    validateFieldName(field.name)
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n`)
    push(field.value)
    push('\r\n')
  }

  for (const file of body.files) {
    validateFieldName(file.field)
    validateFileName(file.fileName)
    const bytes = decodeBase64(file.base64, file.fileName)
    if (bytes.byteLength > HTTP_MULTIPART_FILE_BYTES_MAX) {
      throw invalidInput(`file ${JSON.stringify(file.fileName)} is too large`, 'body')
    }
    const contentType = file.contentType ?? 'application/octet-stream'
    if (/[\r\n]/.test(contentType)) {
      throw invalidInput('file content type must not contain line breaks', 'body')
    }
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    )
    push(bytes)
    push('\r\n')
  }

  push(`--${boundary}--\r\n`)
  if (total > HTTP_REQUEST_BODY_BYTES_MAX) {
    throw invalidInput('multipart body is too large', 'body')
  }
  return {
    bytes: concatBytes(parts, total),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

function encodeBody(body: HttpRequestBody | undefined, boundary: string): EncodedBody {
  if (body === undefined || body.kind === 'none') return { bytes: null, contentType: null }

  switch (body.kind) {
    case 'json': {
      try {
        JSON.parse(body.text)
      } catch {
        throw invalidInput('JSON body is not valid JSON', 'body')
      }
      return { bytes: encoder.encode(body.text), contentType: 'application/json' }
    }
    case 'text':
      return {
        bytes: encoder.encode(body.text),
        contentType: body.contentType ?? 'text/plain; charset=utf-8',
      }
    case 'form': {
      const params = new URLSearchParams()
      for (const field of body.fields) {
        if (field.enabled === false) continue
        validateFieldName(field.name)
        params.append(field.name, field.value)
      }
      return {
        bytes: encoder.encode(params.toString()),
        contentType: 'application/x-www-form-urlencoded',
      }
    }
    case 'multipart':
      return encodeMultipart(body, boundary)
  }
}

/**
 * Validates a wire request and resolves it into what `fetch` needs. Throws a
 * `StudioError` for anything the panel or the runtime cannot send safely.
 */
export function normalizeHttpRequest(
  input: unknown,
  options: NormalizeRequestOptions = {},
): NormalizedHttpRequest {
  if (!isHttpRequestSpec(input)) {
    throw invalidInput('invalid HTTP request', 'request')
  }

  const url = parseTargetUrl(input.url)
  appendQuery(url, input.query)

  const headers = normalizeHeaders(input.headers)
  applyAuth(headers, url, input.auth)

  const boundary = options.boundary ?? `----vibe-studio-${randomUUID()}`
  const encoded = encodeBody(input.body, boundary)
  if (encoded.bytes !== null) {
    if (encoded.bytes.byteLength > HTTP_REQUEST_BODY_BYTES_MAX) {
      throw invalidInput('request body is too large', 'body')
    }
    if (input.method === 'GET' || input.method === 'HEAD') {
      throw invalidInput(`${input.method} requests cannot have a body`, 'body')
    }
    if (encoded.contentType !== null && !hasHeader(headers, 'content-type')) {
      headers['Content-Type'] = encoded.contentType
    }
  }

  return {
    method: input.method,
    url: url.toString(),
    headers,
    body: encoded.bytes,
    timeoutMs: input.timeoutMs ?? HTTP_TIMEOUT_DEFAULT_MS,
    redirect: input.redirect ?? 'follow',
    maxRedirects: input.maxRedirects ?? HTTP_MAX_REDIRECTS_DEFAULT,
    maxResponseBytes: input.maxResponseBytes ?? HTTP_RESPONSE_BYTES_DEFAULT,
  }
}
