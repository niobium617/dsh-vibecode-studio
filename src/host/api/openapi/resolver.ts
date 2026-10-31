/**
 * `$ref` bundling and resolution (T042).
 *
 * Remote documents are fetched only after the SSRF policy approves them, and
 * only once per absolute URL. The default policy is "no network": a document
 * that references a public URL fails with `remote_ref_blocked` before any
 * socket is opened. Loopback and extra origins must be enabled explicitly by
 * the caller; metadata/link-local hosts, credentials in URLs and non-http(s)
 * schemes are always refused.
 *
 * Local resolution follows pure alias chains only. A structural cycle (A has a
 * property of type A) is not an error here — the example generator bounds it
 * with its own stack — while an alias loop like A -> B -> A is a readable
 * `ref_cycle`.
 */
import {
  OPENAPI_MAX_REF_DEPTH,
  OpenApiError,
  errorMessage,
  isJsonObject,
  locationText,
  lookupPointer,
  scanRefs,
  shortText,
  type JsonObject,
  type OpenApiExternalRef,
  type ParsedOpenApi,
} from './parser'
import { isBlockedHost } from '../request'

export const OPENAPI_MAX_REMOTE_DOCUMENTS = 10
export const OPENAPI_MAX_REMOTE_BYTES = 1024 * 1024
export const OPENAPI_REMOTE_TIMEOUT_MS = 5_000

export interface OpenApiRemotePolicyOptions {
  /** Fetch documents from 127.0.0.0/8, `::1` or `localhost`. Default off. */
  readonly allowLoopback?: boolean
  /** Exact `scheme://host:port` origins that may be fetched. Default none. */
  readonly allowedOrigins?: readonly string[]
  readonly maxBytes?: number
  readonly maxDocuments?: number
  readonly requestTimeoutMs?: number
}

export interface ResolvedRemotePolicy {
  readonly allowLoopback: boolean
  readonly allowedOrigins: readonly string[]
  readonly maxBytes: number
  readonly maxDocuments: number
  readonly requestTimeoutMs: number
}

function normalizedHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

export function isLoopbackHost(hostname: string): boolean {
  const host = normalizedHost(hostname)
  if (host === 'localhost' || host === '::1') return true
  if (!/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return false
  return host.split('.').every((part, index) => index === 0 || Number(part) <= 255)
}

/**
 * T059: one metadata/link-local predicate for both the API executor and remote
 * `$ref` fetches, so a trailing-dot FQDN or an IPv4-mapped IPv6 address cannot
 * pass one gate and fail the other.
 */
function isMetadataHost(hostname: string): boolean {
  return isBlockedHost(hostname)
}

/** Validates and freezes the policy once, before a document is scanned. */
export function resolveRemotePolicy(
  options: OpenApiRemotePolicyOptions = {},
): ResolvedRemotePolicy {
  const origins = (options.allowedOrigins ?? []).map((entry) => {
    let url: URL
    try {
      url = new URL(entry)
    } catch {
      throw new OpenApiError(
        'invalid_options',
        `allowed origin is not a URL: ${shortText(entry, 80)}`,
      )
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new OpenApiError(
        'invalid_options',
        `allowed origin must be http(s): ${shortText(entry, 80)}`,
      )
    }
    return url.origin
  })
  const maxBytes = options.maxBytes ?? OPENAPI_MAX_REMOTE_BYTES
  const maxDocuments = options.maxDocuments ?? OPENAPI_MAX_REMOTE_DOCUMENTS
  const requestTimeoutMs = options.requestTimeoutMs ?? OPENAPI_REMOTE_TIMEOUT_MS
  for (const [label, value] of [
    ['maxBytes', maxBytes],
    ['maxDocuments', maxDocuments],
    ['requestTimeoutMs', requestTimeoutMs],
  ] as const) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new OpenApiError('invalid_options', `${label} must be a positive integer`)
    }
  }
  return Object.freeze({
    allowLoopback: options.allowLoopback === true,
    allowedOrigins: origins,
    maxBytes,
    maxDocuments,
    requestTimeoutMs,
  })
}

/**
 * The single gate for every remote document. Metadata/link-local blocking is
 * shared with the executor (`isBlockedHost`); this gate is stricter about
 * everything else: loopback needs an explicit switch and any other host must
 * be listed by origin.
 */
export function assertRemoteAllowed(
  url: URL,
  policy: ResolvedRemotePolicy,
  location: string | undefined,
): void {
  const where = locationText(location)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OpenApiError(
      'remote_ref_blocked',
      `remote $ref scheme "${url.protocol}" is not allowed${where}; only http and https documents can be fetched`,
      location,
    )
  }
  if (url.username !== '' || url.password !== '') {
    throw new OpenApiError(
      'remote_ref_blocked',
      `remote $ref must not contain credentials: ${shortText(url.href)}${where}`,
      location,
    )
  }
  if (isMetadataHost(url.hostname)) {
    throw new OpenApiError(
      'remote_ref_blocked',
      `remote $ref targets a link-local or metadata host: ${shortText(url.hostname)}${where}`,
      location,
    )
  }
  if (policy.allowedOrigins.includes(url.origin)) return
  if (policy.allowLoopback && isLoopbackHost(url.hostname)) return
  throw new OpenApiError(
    'remote_ref_blocked',
    `remote $ref is not allowed: ${shortText(url.href)}${where}; only loopback or explicitly allowed origins may be fetched`,
    location,
  )
}

/* -------------------------------------------------------------------------
 * Remote fetching
 * ---------------------------------------------------------------------- */

export interface OpenApiFetchHeaders {
  get(name: string): string | null
}

export interface OpenApiFetchResponse {
  readonly ok: boolean
  readonly status: number
  readonly headers: OpenApiFetchHeaders
  text(): Promise<string>
}

export type OpenApiFetch = (
  url: string,
  init: { redirect: 'manual'; signal: AbortSignal },
) => Promise<OpenApiFetchResponse>

/** Node 24 ships a compatible global fetch; keep the type structural. */
export function defaultOpenApiFetch(): OpenApiFetch | null {
  const candidate = (globalThis as { fetch?: unknown }).fetch
  return typeof candidate === 'function' ? (candidate as OpenApiFetch) : null
}

export interface RemoteRefBundle {
  /** Absolute `origin + pathname + search` key → parsed remote document. */
  readonly documents: ReadonlyMap<string, unknown>
  readonly fetched: readonly string[]
}

function documentKey(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}`
}

function fragmentPointer(url: URL, ref: string, location: string | undefined): string {
  if (url.hash === '' || url.hash === '#') return ''
  const raw = url.hash.slice(1)
  if (!raw.startsWith('/')) {
    throw new OpenApiError(
      'ref_unresolved',
      `$ref ${JSON.stringify(shortText(ref, 100))} has a fragment that is not a JSON Pointer${locationText(location)}`,
      location,
    )
  }
  return raw
}

function absoluteUrl(ref: string, location: string | undefined): URL {
  let url: URL
  try {
    url = new URL(ref)
  } catch {
    throw new OpenApiError(
      'remote_ref_blocked',
      `external $ref must be an absolute loopback or allowed URL: ${shortText(ref)}${locationText(location)}`,
      location,
    )
  }
  return url
}

async function fetchRemoteDocument(
  fetchImpl: OpenApiFetch,
  url: URL,
  policy: ResolvedRemotePolicy,
  location: string,
): Promise<string> {
  const key = documentKey(url)
  const where = locationText(location)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), policy.requestTimeoutMs)
  try {
    let response: OpenApiFetchResponse
    try {
      response = await fetchImpl(key, { redirect: 'manual', signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new OpenApiError(
          'remote_ref_failed',
          `remote $ref document ${shortText(key)} timed out after ${policy.requestTimeoutMs} ms${where}`,
          location,
        )
      }
      throw new OpenApiError(
        'remote_ref_failed',
        `remote $ref document ${shortText(key)} could not be fetched: ${shortText(errorMessage(error), 100)}${where}`,
        location,
      )
    }

    if (response.status >= 300 && response.status < 400) {
      const target = response.headers.get('location')
      throw new OpenApiError(
        'remote_ref_redirect',
        `remote $ref document ${shortText(key)} redirected with HTTP ${response.status}; redirects are not followed${target === null ? '' : ` (to ${shortText(target, 80)})`}${where}`,
        location,
      )
    }
    if (!response.ok) {
      throw new OpenApiError(
        'remote_ref_failed',
        `remote $ref document ${shortText(key)} returned HTTP ${response.status}${where}`,
        location,
      )
    }

    const declared = response.headers.get('content-length')
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) > policy.maxBytes) {
      throw new OpenApiError(
        'remote_ref_too_large',
        `remote $ref document ${shortText(key)} reports ${declared} bytes; the limit is ${policy.maxBytes} bytes${where}`,
        location,
      )
    }

    let text: string
    try {
      text = await response.text()
    } catch (error) {
      throw new OpenApiError(
        'remote_ref_failed',
        `remote $ref document ${shortText(key)} could not be read: ${shortText(errorMessage(error), 100)}${where}`,
        location,
      )
    }
    const bytes = Buffer.byteLength(text)
    if (bytes > policy.maxBytes) {
      throw new OpenApiError(
        'remote_ref_too_large',
        `remote $ref document ${shortText(key)} is ${bytes} bytes; the limit is ${policy.maxBytes} bytes${where}`,
        location,
      )
    }
    return text
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetches only documents the policy approved. Every document is fetched once,
 * scanned for nested refs (which are queued through the same gate) and its
 * fragment is validated before the mapper sees it.
 */
export async function bundleRemoteRefs(
  parsed: ParsedOpenApi,
  policy: ResolvedRemotePolicy,
  fetchImpl: OpenApiFetch | null,
): Promise<RemoteRefBundle> {
  const documents = new Map<string, unknown>()
  const fetched: string[] = []
  const seen = new Set<string>()
  const queue: OpenApiExternalRef[] = [...parsed.externalRefs]

  while (queue.length > 0) {
    const item = queue.shift()!
    const url = absoluteUrl(item.ref, item.pointer)
    assertRemoteAllowed(url, policy, item.pointer)
    const key = documentKey(url)
    const refKey = `${key}${url.hash}`
    if (seen.has(refKey)) continue
    seen.add(refKey)

    let document = documents.get(key)
    if (!documents.has(key)) {
      if (documents.size >= policy.maxDocuments) {
        throw new OpenApiError(
          'remote_ref_failed',
          `more than ${policy.maxDocuments} remote $ref documents were requested${locationText(item.pointer)}`,
          item.pointer,
        )
      }
      if (fetchImpl === null) {
        throw new OpenApiError(
          'remote_ref_failed',
          `remote $ref documents cannot be fetched in this environment: ${shortText(key)}${locationText(item.pointer)}`,
          item.pointer,
        )
      }
      const text = await fetchRemoteDocument(fetchImpl, url, policy, item.pointer)
      try {
        document = JSON.parse(text)
      } catch (error) {
        throw new OpenApiError(
          'remote_ref_failed',
          `remote $ref document ${shortText(key)} is not valid JSON: ${shortText(errorMessage(error), 90)}${locationText(item.pointer)}`,
          item.pointer,
        )
      }
      documents.set(key, document)
      fetched.push(key)

      const nested = scanRefs(document, `remote document ${shortText(key, 100)}`)
      for (const external of nested.externalRefs) queue.push(external)
    }

    // Validate this ref's fragment against the (possibly reused) document.
    lookupPointer(document, fragmentPointer(url, item.ref, item.pointer), item.ref, item.pointer)
  }

  return { documents, fetched }
}

/* -------------------------------------------------------------------------
 * Local/remote resolution
 * ---------------------------------------------------------------------- */

export interface ResolvedRef {
  readonly value: unknown
  /** Document the value came from: `''` for the main document. */
  readonly baseUrl: string
  readonly refKey: string
}

export interface DerefResult {
  readonly value: unknown
  readonly baseUrl: string
  readonly refKey: string | undefined
}

export class OpenApiRefResolver {
  constructor(
    private readonly mainRoot: JsonObject,
    private readonly remoteDocs: ReadonlyMap<string, unknown>,
    private readonly policy: ResolvedRemotePolicy,
  ) {}

  private documentFor(baseUrl: string, location: string): unknown {
    if (baseUrl === '') return this.mainRoot
    if (!this.remoteDocs.has(baseUrl)) {
      throw new OpenApiError(
        'remote_ref_failed',
        `remote $ref document was not prefetched: ${shortText(baseUrl)}${locationText(location)}`,
        location,
      )
    }
    return this.remoteDocs.get(baseUrl)
  }

  private keyFor(baseUrl: string, ref: string): string {
    if (ref.startsWith('#')) {
      return `${baseUrl === '' ? '<main>' : baseUrl}${ref}`
    }
    try {
      const url = new URL(ref)
      return `${documentKey(url)}${url.hash}`
    } catch {
      return ref
    }
  }

  private lookup(
    ref: string,
    baseUrl: string,
    location: string,
  ): { readonly value: unknown; readonly baseUrl: string } {
    if (ref.startsWith('#')) {
      return {
        value: lookupPointer(this.documentFor(baseUrl, location), ref.slice(1), ref, location),
        baseUrl,
      }
    }
    const url = absoluteUrl(ref, location)
    assertRemoteAllowed(url, this.policy, location)
    const key = documentKey(url)
    if (!this.remoteDocs.has(key)) {
      throw new OpenApiError(
        'remote_ref_failed',
        `remote $ref document was not prefetched: ${shortText(key)}${locationText(location)}`,
        location,
      )
    }
    return {
      value: lookupPointer(
        this.remoteDocs.get(key),
        fragmentPointer(url, ref, location),
        ref,
        location,
      ),
      baseUrl: key,
    }
  }

  /**
   * Follows a chain of pure `$ref` values. Only a chain like A -> B -> A is a
   * hard `ref_cycle`; structural recursion is bounded by the example generator.
   */
  resolveRef(ref: string, baseUrl: string): ResolvedRef {
    const trail: string[] = []
    let currentRef = ref
    let currentBase = baseUrl

    for (let depth = 0; depth <= OPENAPI_MAX_REF_DEPTH; depth += 1) {
      const key = this.keyFor(currentBase, currentRef)
      const cycleAt = trail.indexOf(key)
      if (cycleAt >= 0) {
        const cycle = [...trail.slice(cycleAt), key].join(' -> ')
        throw new OpenApiError('ref_cycle', `circular $ref: ${shortText(cycle, 220)}`, key)
      }
      trail.push(key)

      const hit = this.lookup(currentRef, currentBase, key)
      if (isJsonObject(hit.value) && typeof hit.value.$ref === 'string') {
        currentRef = hit.value.$ref
        currentBase = hit.baseUrl
        continue
      }
      return { value: hit.value, baseUrl: hit.baseUrl, refKey: key }
    }

    throw new OpenApiError(
      'ref_cycle',
      `$ref chain exceeds ${OPENAPI_MAX_REF_DEPTH} links: ${shortText(trail.join(' -> '), 200)}`,
      trail[trail.length - 1],
    )
  }

  deref(node: unknown, baseUrl: string): DerefResult {
    if (!isJsonObject(node) || typeof node.$ref !== 'string') {
      return { value: node, baseUrl, refKey: undefined }
    }
    const hit = this.resolveRef(node.$ref, baseUrl)
    return { value: hit.value, baseUrl: hit.baseUrl, refKey: hit.refKey }
  }
}
