/**
 * Capture replay (T043): turn one redacted `NetworkEntry` into an editable
 * request draft, without sending anything.
 *
 * The conversion is pure and host-side so the preview collector and the API
 * workbench never import each other: the drawer passes the captured row and
 * gets a spec back. Non-idempotent methods are refused unless the caller sends
 * an explicit `confirm`, which makes "never auto-replay" a transport property
 * rather than only a UI habit.
 *
 * Fidelity rules, in order of importance:
 *  - URL bytes are kept whole; query rows are not split or re-encoded.
 *  - Headers are copied verbatim except those that cannot be reproduced:
 *    HTTP/2 pseudo-headers, runtime-owned names, redacted secret values,
 *    invalid values and case-insensitive duplicates. Omitted real names are
 *    reported so the panel can ask the user to re-supply them.
 *  - A captured body becomes JSON only when the declared content type says
 *    JSON and the text still parses; everything else stays exact text with the
 *    captured content type.
 */
import {
  HTTP_HEADER_VALUE_CHARS_MAX,
  HTTP_METHODS,
  REPLAY_SAFE_METHODS,
  type ApiReplayResult,
  type HttpKeyValue,
  type HttpMethod,
  type HttpRequestBody,
  type HttpRequestSpec,
  type ReplayWarning,
} from '../../contracts/api'
import { utf8Bytes } from '../../contracts/budget'
import { studioError } from '../../contracts/errors'
import { REDACTED, isSensitiveKey } from '../../contracts/redact'
import {
  MAX_CAPTURED_REQUEST_BODY_BYTES,
  type NetworkEntry,
} from '../../contracts/telemetry'
import { isForbiddenRequestHeader, isValidHeaderName } from './request'

/** Headers the executor negotiates itself; a captured copy would be wrong. */
const RUNTIME_OWNED_HEADERS: ReadonlySet<string> = new Set(['content-encoding'])

const JSON_CONTENT_TYPE = /^application\/(?:[A-Za-z0-9.+-]+\+)?json\b/i

const WARNING_ORDER: readonly ReplayWarning[] = [
  'body_truncated',
  'body_unavailable',
  'body_dropped',
  'url_redacted',
  'headers_omitted',
]

export interface ReplayPrepareOptions {
  /** Required for methods outside `REPLAY_SAFE_METHODS`. */
  readonly confirm?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(message: string, field: string): never {
  throw studioError('invalid_input', `vibe-studio: ${message}`, { field })
}

function asHttpMethod(value: unknown): HttpMethod | null {
  if (typeof value !== 'string') return null
  const upper = value.trim().toUpperCase()
  return (HTTP_METHODS as readonly string[]).includes(upper) ? (upper as HttpMethod) : null
}

function parseUrl(value: unknown): { readonly raw: string; readonly url: URL } {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (raw === '') invalid('the captured URL is missing', 'entry.url')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    invalid('the captured URL is not valid', 'entry.url')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    invalid('only http and https URLs can be replayed', 'entry.url')
  }
  if (url.username !== '' || url.password !== '') {
    invalid('remove credentials from the captured URL', 'entry.url')
  }
  return { raw, url }
}

/**
 * Redacted secret values cannot be restored host-side, and a literal
 * `REDACTED` would be sent as if it were a credential. The placeholder form
 * (`{{name}}`) has no secret in it and survives.
 */
function isReplayableHeader(name: string, value: string): boolean {
  if (!isValidHeaderName(name)) return false
  if (isForbiddenRequestHeader(name)) return false
  if (RUNTIME_OWNED_HEADERS.has(name.trim().toLowerCase())) return false
  if (/[\r\n]/.test(value)) return false
  if (value.length > HTTP_HEADER_VALUE_CHARS_MAX) return false
  if (isSensitiveKey(name) && value === REDACTED) return false
  return true
}

function collectHeaders(
  raw: unknown,
  omitted: string[],
): HttpKeyValue[] {
  if (raw === undefined) return []
  if (!isRecord(raw)) invalid('captured headers are not a map', 'entry.requestHeaders')

  const headers: HttpKeyValue[] = []
  const seen = new Set<string>()
  for (const [name, value] of Object.entries(raw)) {
    // HTTP/2 pseudo-headers describe the wire version, not the request.
    if (name.startsWith(':')) continue
    if (typeof value !== 'string' || !isReplayableHeader(name, value)) {
      omitted.push(name)
      continue
    }
    const key = name.toLowerCase()
    if (seen.has(key)) {
      omitted.push(name)
      continue
    }
    seen.add(key)
    headers.push({ name, value })
  }
  return headers
}

function findHeader(headers: readonly HttpKeyValue[], name: string): string | null {
  const lower = name.toLowerCase()
  for (const header of headers) {
    if (header.name.toLowerCase() === lower) return header.value
  }
  return null
}

function buildBody(
  method: HttpMethod,
  rawBody: unknown,
  headers: readonly HttpKeyValue[],
  warnings: Set<ReplayWarning>,
): HttpRequestBody | undefined {
  if (typeof rawBody !== 'string' || rawBody === '') return undefined
  if (utf8Bytes(rawBody) > MAX_CAPTURED_REQUEST_BODY_BYTES) {
    invalid('the captured body is too large to replay', 'entry.requestBody')
  }
  // The executor refuses bodies on GET/HEAD; keep the draft sendable.
  if (method === 'GET' || method === 'HEAD') {
    warnings.add('body_dropped')
    return undefined
  }

  const contentType = findHeader(headers, 'content-type')
  if (contentType !== null && JSON_CONTENT_TYPE.test(contentType.trim())) {
    try {
      JSON.parse(rawBody)
      return { kind: 'json', text: rawBody }
    } catch {
      // A truncated JSON body cannot parse; keep its exact prefix as text.
    }
  }
  return contentType === null
    ? { kind: 'text', text: rawBody }
    : { kind: 'text', text: rawBody, contentType }
}

function hasRedactedQuery(url: URL): boolean {
  for (const [, value] of url.searchParams) {
    if (value === REDACTED) return true
  }
  return false
}

function orderedWarnings(warnings: Set<ReplayWarning>): ReplayWarning[] {
  return WARNING_ORDER.filter((warning) => warnings.has(warning))
}

/**
 * Converts one captured row into a draft. Throws `invalid_input` for rows the
 * executor can never send and `permission_denied` when a non-idempotent method
 * was not confirmed. Nothing here performs I/O.
 */
export function prepareReplay(input: unknown, options: ReplayPrepareOptions = {}): ApiReplayResult {
  if (!isRecord(input)) invalid('a captured request is required', 'entry')
  const entry = input as Partial<NetworkEntry>

  const method = asHttpMethod(entry.method)
  if (method === null) invalid('the captured method is not supported', 'entry.method')
  const { raw: rawUrl, url } = parseUrl(entry.url)

  const requiresConfirmation = !(REPLAY_SAFE_METHODS as readonly string[]).includes(method)
  if (requiresConfirmation && options.confirm !== true) {
    throw studioError(
      'permission_denied',
      'vibe-studio: replay of a non-idempotent request needs confirmation',
      { reason: 'confirmation_required', method },
    )
  }

  const warnings = new Set<ReplayWarning>()
  const omittedHeaders: string[] = []
  const headers = collectHeaders(entry.requestHeaders, omittedHeaders)

  if (entry.requestBodyTruncated === true) warnings.add('body_truncated')
  if (entry.requestBodyUnavailable === true) warnings.add('body_unavailable')
  const body = buildBody(method, entry.requestBody, headers, warnings)

  if (hasRedactedQuery(url)) warnings.add('url_redacted')
  if (omittedHeaders.length > 0) warnings.add('headers_omitted')

  const draft: HttpRequestSpec = {
    method,
    // The captured string is kept byte-for-byte; `URL` normalization could
    // reorder or re-encode query rows that were not redacted.
    url: rawUrl,
    ...(headers.length === 0 ? {} : { headers }),
    ...(body === undefined ? {} : { body }),
  }

  return {
    draft,
    requiresConfirmation,
    omittedHeaders,
    warnings: orderedWarnings(warnings),
  }
}
