/**
 * S7 spike — OpenAPI import: parser, $ref resolver, SSRF policy and mapper.
 *
 * This file is deliberately standalone: T042 will move the proven parts into
 * `src/host/api/openapi/`. It has no runtime dependency beyond Node, so the
 * measurements below describe the code we can actually ship, not a library.
 *
 * Run: `pnpm tsx spikes/s7/run.ts`
 * Raw data: `.tmp/logs/s7-results.json`
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HTTP_HEADERS_MAX,
  HTTP_PARAMS_MAX,
  HTTP_URL_CHARS_MAX,
  isApiEnvironmentVariableName,
  isHttpRequestSpec,
  type HttpAuth,
  type HttpKeyValue,
  type HttpMethod,
  type HttpRequestBody,
  type HttpRequestSpec,
} from '../../src/contracts/api'

/* -------------------------------------------------------------------------
 * Limits
 * ---------------------------------------------------------------------- */

const IMPORT_BUDGET_MS = 5_000
const OPENAPI_MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
const OPENAPI_MAX_OPERATIONS = 1_000
const OPENAPI_MAX_TRAVERSAL_DEPTH = 128
const OPENAPI_MAX_TRAVERSAL_NODES = 500_000
const OPENAPI_MAX_REF_DEPTH = 32
const OPENAPI_MAX_REMOTE_DOCUMENTS = 10
const OPENAPI_MAX_REMOTE_BYTES = 1024 * 1024
const REMOTE_FETCH_TIMEOUT_MS = 5_000

const EXAMPLE_MAX_DEPTH = 8
const EXAMPLE_MAX_REF_DEPTH = 6
const EXAMPLE_MAX_NODES = 2_000
const EXAMPLE_MAX_BYTES = 4 * 1024

const RUNS_SAMPLE = 10
const RUNS_SCALE = 3
const SCALE_PATH_COUNTS = [50, 200] as const

const OPENAPI_METHODS = ['get', 'head', 'post', 'put', 'patch', 'delete', 'options'] as const

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** Same set as `src/host/api/request.ts`; the importer must not emit them. */
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

const METADATA_HOSTNAMES: ReadonlySet<string> = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
])

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '..', '..')
const RESULTS_PATH = join(ROOT, '.tmp', 'logs', 's7-results.json')

/* -------------------------------------------------------------------------
 * Errors
 * ---------------------------------------------------------------------- */

type OpenApiErrorCode =
  | 'invalid_json'
  | 'invalid_document'
  | 'document_too_large'
  | 'too_many_operations'
  | 'ref_unresolved'
  | 'ref_cycle'
  | 'remote_ref_blocked'
  | 'remote_ref_redirect'
  | 'remote_ref_too_large'
  | 'remote_ref_failed'

class OpenApiError extends Error {
  readonly code: OpenApiErrorCode
  readonly pointer: string | undefined

  constructor(code: OpenApiErrorCode, message: string, pointer?: string) {
    super(message)
    this.name = 'OpenApiError'
    this.code = code
    this.pointer = pointer
  }
}

interface ErrorInfo {
  readonly code: string
  readonly message: string
  readonly pointer?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toErrorInfo(error: unknown): ErrorInfo {
  if (error instanceof OpenApiError) {
    return { code: error.code, message: error.message, ...(error.pointer === undefined ? {} : { pointer: error.pointer }) }
  }
  return { code: 'unexpected_error', message: errorMessage(error) }
}

function short(value: string, max = 140): string {
  const single = value.replace(/[\r\n]+/g, ' ')
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`
}

function locationText(location: string | undefined): string {
  return location === undefined || location === '' ? '' : ` (at ${short(location, 100)})`
}

/* -------------------------------------------------------------------------
 * SSRF policy
 * ---------------------------------------------------------------------- */

interface RemoteRefPolicy {
  readonly allowLoopback: boolean
  readonly allowedOrigins: readonly string[]
  readonly maxBytes: number
  readonly maxDocuments: number
}

const DEFAULT_POLICY: RemoteRefPolicy = Object.freeze({
  allowLoopback: false,
  allowedOrigins: [] as readonly string[],
  maxBytes: OPENAPI_MAX_REMOTE_BYTES,
  maxDocuments: OPENAPI_MAX_REMOTE_DOCUMENTS,
})

function makePolicy(overrides: Partial<RemoteRefPolicy> = {}): RemoteRefPolicy {
  const origins = (overrides.allowedOrigins ?? []).map((entry) => {
    let url: URL
    try {
      url = new URL(entry)
    } catch {
      throw new Error(`invalid allowed origin: ${entry}`)
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`allowed origin must be http(s): ${entry}`)
    }
    return url.origin
  })
  return {
    allowLoopback: overrides.allowLoopback ?? false,
    allowedOrigins: origins,
    maxBytes: overrides.maxBytes ?? OPENAPI_MAX_REMOTE_BYTES,
    maxDocuments: overrides.maxDocuments ?? OPENAPI_MAX_REMOTE_DOCUMENTS,
  }
}

function normalizedHost(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

function isLoopbackHost(hostname: string): boolean {
  const host = normalizedHost(hostname)
  if (host === 'localhost' || host === '::1') return true
  if (!/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return false
  return host.split('.').every((part, index) => index === 0 || Number(part) <= 255)
}

function isMetadataHost(hostname: string): boolean {
  const host = normalizedHost(hostname)
  if (METADATA_HOSTNAMES.has(host)) return true
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  // Alibaba Cloud and AWS IMDS IPv6 endpoints.
  if (host === '100.100.100.200' || host === 'fd00:ec2::254') return true
  return host.startsWith('fe80:')
}

/**
 * The single gate for every remote document. It is intentionally stricter than
 * the executor's host check: an imported document may only reach loopback
 * (explicitly enabled) or an origin the user listed by hand.
 */
function assertRemoteAllowed(url: URL, policy: RemoteRefPolicy, location: string | undefined): void {
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
      `remote $ref must not contain credentials: ${short(url.href)}${where}`,
      location,
    )
  }
  if (isMetadataHost(url.hostname)) {
    throw new OpenApiError(
      'remote_ref_blocked',
      `remote $ref targets a link-local or metadata host: ${short(url.hostname)}${where}`,
      location,
    )
  }
  if (policy.allowedOrigins.includes(url.origin)) return
  if (policy.allowLoopback && isLoopbackHost(url.hostname)) return
  throw new OpenApiError(
    'remote_ref_blocked',
    `remote $ref is not allowed: ${short(url.href)}${where}; only loopback or explicitly allowed origins may be fetched`,
    location,
  )
}

/* -------------------------------------------------------------------------
 * JSON helpers and JSON Pointer
 * ---------------------------------------------------------------------- */

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function decodePointerSegment(raw: string, ref: string, location: string | undefined): string {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    throw new OpenApiError(
      'ref_unresolved',
      `$ref ${JSON.stringify(short(ref, 100))} has invalid percent-encoding in "${short(raw, 40)}"${locationText(location)}`,
      location,
    )
  }
  return decoded.replace(/~1/g, '/').replace(/~0/g, '~')
}

function lookupPointer(
  root: unknown,
  pointer: string,
  ref: string,
  location: string | undefined,
): unknown {
  if (pointer === '') return root
  if (!pointer.startsWith('/')) {
    throw new OpenApiError(
      'ref_unresolved',
      `$ref ${JSON.stringify(short(ref, 100))} has a fragment that is not a JSON Pointer${locationText(location)}`,
      location,
    )
  }

  let current: unknown = root
  let walked = ''
  for (const raw of pointer.slice(1).split('/')) {
    const segment = decodePointerSegment(raw, ref, location)
    walked += `/${raw}`
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) {
        throw new OpenApiError(
          'ref_unresolved',
          `$ref ${JSON.stringify(short(ref, 100))} needs an array index at "${short(walked, 60)}"${locationText(location)}`,
          location,
        )
      }
      const index = Number(segment)
      if (index >= current.length) {
        throw new OpenApiError(
          'ref_unresolved',
          `$ref ${JSON.stringify(short(ref, 100))} points past the array end at "${short(walked, 60)}"${locationText(location)}`,
          location,
        )
      }
      current = current[index]
      continue
    }
    if (!isObject(current)) {
      throw new OpenApiError(
        'ref_unresolved',
        `$ref ${JSON.stringify(short(ref, 100))} cannot descend into ${typeName(current)} at "${short(walked, 60)}"${locationText(location)}`,
        location,
      )
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new OpenApiError(
        'ref_unresolved',
        `$ref ${JSON.stringify(short(ref, 100))} cannot be resolved: "${short(segment, 40)}" does not exist${locationText(location)}`,
        location,
      )
    }
    current = current[segment]
  }
  return current
}

function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
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
      `$ref ${JSON.stringify(short(ref, 100))} has a fragment that is not a JSON Pointer${locationText(location)}`,
      location,
    )
  }
  return raw
}

/* -------------------------------------------------------------------------
 * Structural scan: validates local refs, classifies remote refs
 * ---------------------------------------------------------------------- */

interface ExternalRef {
  readonly ref: string
  readonly pointer: string
}

interface ScanResult {
  readonly refs: number
  readonly externalRefs: readonly ExternalRef[]
}

interface ScanFrame {
  readonly value: unknown
  readonly pointer: string
  readonly depth: number
  readonly mode: 'doc' | 'example'
  /** True while visiting the entries of an `examples` map. */
  readonly inExamplesMap: boolean
}

/**
 * Walks a document iteratively (no recursion limit to hit) and validates every
 * structural local `$ref`. Values in `example`, `default`, `enum`, `const`,
 * `examples[*].value` and `x-*` are data, not schema: a `$ref` string inside
 * them is never followed.
 */
function scanDocument(
  root: unknown,
  policy: RemoteRefPolicy,
  label: string,
): ScanResult {
  const stack: ScanFrame[] = [
    { value: root, pointer: '', depth: 0, mode: 'doc', inExamplesMap: false },
  ]
  const externalRefs: ExternalRef[] = []
  let nodes = 0
  let refs = 0

  while (stack.length > 0) {
    const frame = stack.pop()!
    if (frame.depth > OPENAPI_MAX_TRAVERSAL_DEPTH) {
      throw new OpenApiError(
        'invalid_document',
        `${label} nests deeper than ${OPENAPI_MAX_TRAVERSAL_DEPTH} levels${locationText(frame.pointer || '#')}`,
        frame.pointer || '#',
      )
    }
    nodes += 1
    if (nodes > OPENAPI_MAX_TRAVERSAL_NODES) {
      throw new OpenApiError(
        'invalid_document',
        `${label} has more than ${OPENAPI_MAX_TRAVERSAL_NODES} nodes; it is too large to import`,
        frame.pointer || '#',
      )
    }

    if (Array.isArray(frame.value)) {
      for (let index = frame.value.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: frame.value[index],
          pointer: `${frame.pointer}/${index}`,
          depth: frame.depth + 1,
          mode: frame.mode,
          inExamplesMap: frame.inExamplesMap,
        })
      }
      continue
    }
    if (!isObject(frame.value)) continue

    if (frame.mode === 'doc' && typeof frame.value.$ref === 'string') {
      const ref = frame.value.$ref
      if (ref === '') {
        throw new OpenApiError(
          'invalid_document',
          `empty $ref${locationText(frame.pointer || '#')}`,
          frame.pointer || '#',
        )
      }
      if (ref.length > 2048) {
        throw new OpenApiError(
          'invalid_document',
          `$ref is longer than 2048 characters${locationText(frame.pointer || '#')}`,
          frame.pointer || '#',
        )
      }
      refs += 1
      if (ref.startsWith('#')) {
        // Throws a readable ref_unresolved before any import work begins.
        lookupPointer(root, ref.slice(1), ref, frame.pointer || '#')
      } else {
        let url: URL
        try {
          url = new URL(ref)
        } catch {
          throw new OpenApiError(
            'remote_ref_blocked',
            `external $ref must be an absolute loopback or allowed URL: ${short(ref)}${locationText(frame.pointer || '#')}`,
            frame.pointer || '#',
          )
        }
        assertRemoteAllowed(url, policy, frame.pointer || '#')
        externalRefs.push({ ref, pointer: frame.pointer || '#' })
      }
    }

    const entries = Object.entries(frame.value)
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, value] = entries[index]!
      const pointer = `${frame.pointer}/${escapePointerSegment(key)}`
      let mode: 'doc' | 'example' = frame.mode
      let inExamplesMap = false
      if (frame.mode === 'doc') {
        if (key === 'example' || key === 'default' || key === 'enum' || key === 'const') {
          mode = 'example'
        } else if (key === 'examples') {
          inExamplesMap = true
        } else if (frame.inExamplesMap && key === 'value') {
          mode = 'example'
        } else if (key.startsWith('x-')) {
          mode = 'example'
        } else if (frame.inExamplesMap) {
          // Entry object of an `examples` map: keep the flag so its `value`
          // child is data while a `$ref` on the entry itself is still resolved.
          inExamplesMap = true
        }
      }
      stack.push({ value, pointer, depth: frame.depth + 1, mode, inExamplesMap })
    }
  }

  return { refs, externalRefs }
}

/* -------------------------------------------------------------------------
 * Remote document bundling
 * ---------------------------------------------------------------------- */

interface FetchHeadersLike {
  get(name: string): string | null
}

interface FetchResponseLike {
  readonly ok: boolean
  readonly status: number
  readonly headers: FetchHeadersLike
  text(): Promise<string>
}

type FetchLike = (
  url: string,
  init: { redirect: 'manual'; signal: AbortSignal },
) => Promise<FetchResponseLike>

interface RemoteBundle {
  readonly documents: ReadonlyMap<string, unknown>
  readonly documentsFetched: readonly string[]
}

async function fetchRemoteDocument(
  fetchImpl: FetchLike,
  url: URL,
  policy: RemoteRefPolicy,
  location: string,
): Promise<string> {
  const key = documentKey(url)
  const where = locationText(location)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS)
  try {
    let response: FetchResponseLike
    try {
      response = await fetchImpl(key, { redirect: 'manual', signal: controller.signal })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new OpenApiError(
          'remote_ref_failed',
          `remote $ref document ${short(key)} timed out after ${REMOTE_FETCH_TIMEOUT_MS} ms${where}`,
          location,
        )
      }
      throw new OpenApiError(
        'remote_ref_failed',
        `remote $ref document ${short(key)} could not be fetched: ${short(errorMessage(error), 100)}${where}`,
        location,
      )
    }

    if (response.status >= 300 && response.status < 400) {
      const target = response.headers.get('location')
      throw new OpenApiError(
        'remote_ref_redirect',
        `remote $ref document ${short(key)} redirected with HTTP ${response.status}; redirects are not followed${target === null ? '' : ` (to ${short(target, 80)})`}${where}`,
        location,
      )
    }
    if (!response.ok) {
      throw new OpenApiError(
        'remote_ref_failed',
        `remote $ref document ${short(key)} returned HTTP ${response.status}${where}`,
        location,
      )
    }

    const declared = response.headers.get('content-length')
    if (declared !== null && /^\d+$/.test(declared) && Number(declared) > policy.maxBytes) {
      throw new OpenApiError(
        'remote_ref_too_large',
        `remote $ref document ${short(key)} reports ${declared} bytes; the limit is ${policy.maxBytes} bytes${where}`,
        location,
      )
    }

    let text: string
    try {
      text = await response.text()
    } catch (error) {
      throw new OpenApiError(
        'remote_ref_failed',
        `remote $ref document ${short(key)} could not be read: ${short(errorMessage(error), 100)}${where}`,
        location,
      )
    }
    const bytes = Buffer.byteLength(text)
    if (bytes > policy.maxBytes) {
      throw new OpenApiError(
        'remote_ref_too_large',
        `remote $ref document ${short(key)} is ${bytes} bytes; the limit is ${policy.maxBytes} bytes${where}`,
        location,
      )
    }
    return text
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetches only the documents that survived the policy check. Each document is
 * fetched once, scanned for nested refs, and its fragment is validated before
 * the mapper ever sees it.
 */
async function bundleRemoteRefs(
  parsed: ParsedDocument,
  policy: RemoteRefPolicy,
  fetchImpl: FetchLike | null,
): Promise<RemoteBundle> {
  const documents = new Map<string, unknown>()
  const documentsFetched: string[] = []
  const seen = new Set<string>()
  const queue: ExternalRef[] = [...parsed.externalRefs]

  while (queue.length > 0) {
    const item = queue.shift()!
    let url: URL
    try {
      url = new URL(item.ref)
    } catch {
      throw new OpenApiError(
        'remote_ref_blocked',
        `external $ref must be absolute: ${short(item.ref)}${locationText(item.pointer)}`,
        item.pointer,
      )
    }
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
          `remote $ref documents cannot be fetched in this environment: ${short(key)}${locationText(item.pointer)}`,
          item.pointer,
        )
      }
      const text = await fetchRemoteDocument(fetchImpl, url, policy, item.pointer)
      try {
        document = JSON.parse(text)
      } catch (error) {
        throw new OpenApiError(
          'remote_ref_failed',
          `remote $ref document ${short(key)} is not valid JSON: ${short(errorMessage(error), 90)}${locationText(item.pointer)}`,
          item.pointer,
        )
      }
      documents.set(key, document)
      documentsFetched.push(key)

      const nested = scanDocument(document, policy, `remote document ${short(key, 100)}`)
      for (const external of nested.externalRefs) queue.push(external)
    }

    // Validate this ref's fragment against the (possibly reused) document.
    lookupPointer(document, fragmentPointer(url, item.ref, item.pointer), item.ref, item.pointer)
  }

  return { documents, documentsFetched }
}

/* -------------------------------------------------------------------------
 * Document parsing
 * ---------------------------------------------------------------------- */

interface ParsedOperation {
  readonly method: HttpMethod
  readonly path: string
  readonly pathItem: JsonObject
  readonly operation: JsonObject
}

interface ParsedDocument {
  readonly root: JsonObject
  readonly version: '3' | '2'
  readonly operations: readonly ParsedOperation[]
  readonly externalRefs: readonly ExternalRef[]
  readonly refs: number
  readonly bytes: number
}

function parseOpenApiDocument(text: string, policy: RemoteRefPolicy): ParsedDocument {
  const bytes = Buffer.byteLength(text)
  if (bytes > OPENAPI_MAX_DOCUMENT_BYTES) {
    throw new OpenApiError(
      'document_too_large',
      `OpenAPI document is ${bytes} bytes; the limit is ${OPENAPI_MAX_DOCUMENT_BYTES} bytes`,
    )
  }

  let root: unknown
  try {
    root = JSON.parse(text)
  } catch (error) {
    throw new OpenApiError(
      'invalid_json',
      `OpenAPI document is not valid JSON: ${short(errorMessage(error), 120)}`,
    )
  }
  if (!isObject(root)) {
    throw new OpenApiError('invalid_document', 'OpenAPI document must be a JSON object')
  }

  let version: '3' | '2'
  if (typeof root.openapi === 'string') {
    if (!/^3\.\d+\.\d+(-[A-Za-z0-9.]+)?$/.test(root.openapi.trim())) {
      throw new OpenApiError(
        'invalid_document',
        `unsupported OpenAPI version ${JSON.stringify(short(root.openapi, 30))}; expected 3.x`,
      )
    }
    version = '3'
  } else if (typeof root.swagger === 'string' && root.swagger.trim() === '2.0') {
    version = '2'
  } else {
    throw new OpenApiError(
      'invalid_document',
      'document has neither "openapi" (3.x) nor "swagger": "2.0"',
    )
  }

  if (!isObject(root.info)) {
    throw new OpenApiError('invalid_document', 'OpenAPI document is missing the info object')
  }
  if (!isObject(root.paths)) {
    throw new OpenApiError('invalid_document', 'OpenAPI document is missing the paths object')
  }

  const scan = scanDocument(root, policy, 'OpenAPI document')

  const operations: ParsedOperation[] = []
  for (const [path, pathItemRaw] of Object.entries(root.paths)) {
    if (path.startsWith('x-')) continue
    if (!path.startsWith('/')) {
      throw new OpenApiError(
        'invalid_document',
        `path ${JSON.stringify(short(path, 60))} must start with "/"`,
        `#/paths/${escapePointerSegment(path)}`,
      )
    }
    if (!isObject(pathItemRaw)) {
      throw new OpenApiError(
        'invalid_document',
        `path item ${short(path, 60)} must be an object`,
        `#/paths/${escapePointerSegment(path)}`,
      )
    }
    if (typeof pathItemRaw.$ref === 'string') {
      throw new OpenApiError(
        'invalid_document',
        `path-item $ref is not supported by this importer; inline ${short(path, 60)}`,
        `#/paths/${escapePointerSegment(path)}`,
      )
    }
    for (const method of OPENAPI_METHODS) {
      const operation = pathItemRaw[method]
      if (operation === undefined) continue
      if (!isObject(operation)) {
        throw new OpenApiError(
          'invalid_document',
          `operation ${method.toUpperCase()} ${short(path, 60)} must be an object`,
          `#/paths/${escapePointerSegment(path)}/${method}`,
        )
      }
      operations.push({
        method: method.toUpperCase() as HttpMethod,
        path,
        pathItem: pathItemRaw,
        operation,
      })
    }
  }

  if (operations.length > OPENAPI_MAX_OPERATIONS) {
    throw new OpenApiError(
      'too_many_operations',
      `OpenAPI document declares ${operations.length} operations; the limit is ${OPENAPI_MAX_OPERATIONS}`,
    )
  }
  if (operations.length === 0) {
    throw new OpenApiError('invalid_document', 'OpenAPI document has no supported operations')
  }

  return { root, version, operations, externalRefs: scan.externalRefs, refs: scan.refs, bytes }
}

/* -------------------------------------------------------------------------
 * $ref resolver
 * ---------------------------------------------------------------------- */

interface ResolvedRef {
  readonly value: unknown
  readonly baseUrl: string
  readonly refKey: string
}

interface DerefResult {
  readonly value: unknown
  readonly baseUrl: string
  readonly refKey: string | undefined
}

class RefResolver {
  constructor(
    private readonly mainRoot: JsonObject,
    private readonly remoteDocs: ReadonlyMap<string, unknown>,
    private readonly policy: RemoteRefPolicy,
  ) {}

  private documentFor(baseUrl: string, location: string): unknown {
    if (baseUrl === '') return this.mainRoot
    if (!this.remoteDocs.has(baseUrl)) {
      throw new OpenApiError(
        'remote_ref_failed',
        `remote $ref document was not prefetched: ${short(baseUrl)}${locationText(location)}`,
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
    let url: URL
    try {
      url = new URL(ref)
    } catch {
      throw new OpenApiError(
        'remote_ref_blocked',
        `external $ref must be absolute: ${short(ref)}${locationText(location)}`,
        location,
      )
    }
    assertRemoteAllowed(url, this.policy, location)
    const key = documentKey(url)
    if (!this.remoteDocs.has(key)) {
      throw new OpenApiError(
        'remote_ref_failed',
        `remote $ref document was not prefetched: ${short(key)}${locationText(location)}`,
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
   * Follows a chain of pure `$ref` values. A structural cycle (A has a property
   * of type A) is *not* handled here — the example generator bounds it by its
   * own stack. Only a chain like A -> B -> A is a hard `ref_cycle` error.
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
        throw new OpenApiError('ref_cycle', `circular $ref: ${short(cycle, 220)}`, key)
      }
      trail.push(key)

      const hit = this.lookup(currentRef, currentBase, key)
      if (isObject(hit.value) && typeof hit.value.$ref === 'string') {
        currentRef = hit.value.$ref
        currentBase = hit.baseUrl
        continue
      }
      return { value: hit.value, baseUrl: hit.baseUrl, refKey: key }
    }

    throw new OpenApiError(
      'ref_cycle',
      `$ref chain exceeds ${OPENAPI_MAX_REF_DEPTH} links: ${short(trail.join(' -> '), 200)}`,
      trail[trail.length - 1],
    )
  }

  deref(node: unknown, baseUrl: string): DerefResult {
    if (!isObject(node) || typeof node.$ref !== 'string') {
      return { value: node, baseUrl, refKey: undefined }
    }
    const hit = this.resolveRef(node.$ref, baseUrl)
    return { value: hit.value, baseUrl: hit.baseUrl, refKey: hit.refKey }
  }
}

/* -------------------------------------------------------------------------
 * Example generation
 * ---------------------------------------------------------------------- */

interface ExampleContext {
  readonly resolver: RefResolver
  readonly stack: string[]
  nodes: number
  cycleStops: number
  depthStops: number
  nodeStops: number
}

function createExampleContext(resolver: RefResolver): ExampleContext {
  return { resolver, stack: [], nodes: 0, cycleStops: 0, depthStops: 0, nodeStops: 0 }
}

function stringExample(schema: JsonObject): string {
  const format = typeof schema.format === 'string' ? schema.format.toLowerCase() : ''
  switch (format) {
    case 'date-time':
      return '2026-01-01T00:00:00Z'
    case 'date':
      return '2026-01-01'
    case 'email':
      return 'user@example.test'
    case 'uuid':
      return '00000000-0000-4000-8000-000000000000'
    case 'uri':
    case 'url':
      return 'https://example.test/resource'
    case 'binary':
    case 'byte':
      return 'AA=='
    case 'password':
      return 'password'
    default:
      return 'string'
  }
}

function exampleFromResolved(
  node: unknown,
  baseUrl: string,
  depth: number,
  ctx: ExampleContext,
): unknown {
  if (node === true) return {}
  if (!isObject(node)) return undefined
  if (ctx.nodes >= EXAMPLE_MAX_NODES) {
    ctx.nodeStops += 1
    return undefined
  }
  ctx.nodes += 1

  if (node.example !== undefined) return node.example
  if (node.const !== undefined) return node.const
  if (node.default !== undefined) return node.default
  if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0]

  if (Array.isArray(node.allOf)) {
    const merged: JsonObject = {}
    for (const branch of node.allOf) {
      const value = exampleFromSchema(branch, baseUrl, depth + 1, ctx)
      if (isObject(value)) Object.assign(merged, value)
    }
    const rest: JsonObject = { ...node }
    delete rest.allOf
    const own = exampleFromResolved(rest, baseUrl, depth, ctx)
    if (isObject(own)) Object.assign(merged, own)
    return merged
  }

  for (const key of ['oneOf', 'anyOf'] as const) {
    const branches = node[key]
    if (Array.isArray(branches) && branches.length > 0) {
      return exampleFromSchema(branches[0], baseUrl, depth + 1, ctx)
    }
  }

  const type = Array.isArray(node.type)
    ? node.type.find((entry) => typeof entry === 'string' && entry !== 'null')
    : node.type

  if (type === 'string') return stringExample(node)
  if (type === 'integer' || type === 'number') {
    const minimum = node.minimum
    return typeof minimum === 'number' && Number.isFinite(minimum) ? minimum : 0
  }
  if (type === 'boolean') return true
  if (type === 'null') return null

  if (type === 'array' || node.items !== undefined) {
    const values: unknown[] = []
    for (let index = 0; index < 2; index += 1) {
      const value = exampleFromSchema(node.items, baseUrl, depth + 1, ctx)
      if (value !== undefined) values.push(value)
    }
    return values
  }

  if (type === 'object' || isObject(node.properties)) {
    const properties = isObject(node.properties) ? node.properties : {}
    const output: JsonObject = {}
    let count = 0
    for (const [name, property] of Object.entries(properties)) {
      if (count >= 25) {
        ctx.nodeStops += 1
        break
      }
      const value = exampleFromSchema(property, baseUrl, depth + 1, ctx)
      if (value !== undefined) {
        output[name] = value
        count += 1
      }
    }
    return output
  }

  return {}
}

function exampleFromSchema(
  schema: unknown,
  baseUrl: string,
  depth: number,
  ctx: ExampleContext,
): unknown {
  if (depth > EXAMPLE_MAX_DEPTH) {
    ctx.depthStops += 1
    return undefined
  }
  const hit = ctx.resolver.deref(schema, baseUrl)
  let pushed = false
  if (hit.refKey !== undefined) {
    if (ctx.stack.includes(hit.refKey)) {
      ctx.cycleStops += 1
      return undefined
    }
    if (ctx.stack.length >= EXAMPLE_MAX_REF_DEPTH) {
      ctx.depthStops += 1
      return undefined
    }
    ctx.stack.push(hit.refKey)
    pushed = true
  }
  try {
    return exampleFromResolved(hit.value, hit.baseUrl, depth, ctx)
  } finally {
    if (pushed) ctx.stack.pop()
  }
}

/* -------------------------------------------------------------------------
 * Mapper
 * ---------------------------------------------------------------------- */

interface ParameterHit {
  readonly param: JsonObject
  readonly baseUrl: string
}

interface MappedEndpoint {
  readonly id: string
  readonly name: string
  readonly group: string
  readonly request: HttpRequestSpec
  readonly warnings: readonly string[]
}

interface MapStats {
  readonly authKinds: Record<string, number>
  readonly bodyKinds: Record<string, number>
  readonly warnings: Record<string, number>
  readonly exampleCycleStops: number
  readonly exampleDepthStops: number
  readonly exampleNodeStops: number
  readonly maxBodyBytes: number
  readonly totalBodyBytes: number
}

interface MapResult {
  readonly endpoints: readonly MappedEndpoint[]
  readonly groups: readonly string[]
  readonly globalWarnings: readonly string[]
  readonly skipped: number
  readonly stats: MapStats
}

interface MutableStats {
  authKinds: Record<string, number>
  bodyKinds: Record<string, number>
  warnings: Record<string, number>
  exampleCycleStops: number
  exampleDepthStops: number
  exampleNodeStops: number
  maxBodyBytes: number
  totalBodyBytes: number
}

function bump(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1
}

function warningKey(warning: string): string {
  const colon = warning.indexOf(':')
  return colon === -1 ? warning : warning.slice(0, colon)
}

function sanitizeVariableName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z_]+/, '')
  return cleaned === '' ? 'value' : cleaned
}

function valueString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function normalizeMediaType(mediaType: string): string {
  return mediaType.split(';')[0]!.trim().toLowerCase()
}

function mediaScore(mediaType: string): number {
  const normalized = normalizeMediaType(mediaType)
  if (normalized === 'application/json') return 0
  if (normalized.endsWith('+json')) return 1
  if (normalized === 'application/x-www-form-urlencoded') return 2
  if (normalized.startsWith('multipart/form-data')) return 3
  if (normalized.startsWith('text/')) return 4
  return 5
}

interface PickedMedia {
  readonly mediaType: string
  readonly media: unknown
}

function pickMedia(content: JsonObject): PickedMedia | null {
  let best: PickedMedia | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const [mediaType, media] of Object.entries(content)) {
    const score = mediaScore(mediaType)
    if (score < bestScore) {
      best = { mediaType, media }
      bestScore = score
    }
  }
  return best
}

function firstExampleValue(examples: unknown, resolver: RefResolver, baseUrl: string): unknown {
  if (!isObject(examples)) return undefined
  for (const candidate of Object.values(examples)) {
    if (!isObject(candidate)) continue
    if (candidate.value !== undefined) return candidate.value
    if (typeof candidate.$ref === 'string') {
      try {
        const resolved = resolver.deref(candidate, baseUrl).value
        if (isObject(resolved) && resolved.value !== undefined) return resolved.value
      } catch (error) {
        if (!(error instanceof OpenApiError)) throw error
      }
    }
  }
  return undefined
}

interface BodyOutcome {
  readonly body: HttpRequestBody
  readonly warnings: readonly string[]
  readonly bytes: number
}

function noneBody(warnings: readonly string[] = []): BodyOutcome {
  return { body: { kind: 'none' }, warnings, bytes: 0 }
}

function binaryPropertyNames(
  schema: unknown,
  resolver: RefResolver,
  baseUrl: string,
): ReadonlySet<string> {
  const names = new Set<string>()
  try {
    const hit = resolver.deref(schema, baseUrl)
    const node = isObject(hit.value) ? hit.value : {}
    const properties = isObject(node.properties) ? node.properties : {}
    for (const [name, property] of Object.entries(properties)) {
      const propertyHit = resolver.deref(property, hit.baseUrl)
      if (isObject(propertyHit.value) && propertyHit.value.format === 'binary') {
        names.add(name)
      }
    }
  } catch (error) {
    if (!(error instanceof OpenApiError)) throw error
  }
  return names
}

function bodyFromMedia(
  mediaType: string,
  mediaRaw: unknown,
  baseUrl: string,
  resolver: RefResolver,
  ctx: ExampleContext,
): BodyOutcome {
  const media = isObject(mediaRaw) ? mediaRaw : {}
  const normalized = normalizeMediaType(mediaType)
  const schema = media.schema

  if (normalized === 'application/json' || normalized.endsWith('+json')) {
    let example = media.example
    if (example === undefined) example = firstExampleValue(media.examples, resolver, baseUrl)
    if (example === undefined && schema !== undefined) {
      example = exampleFromSchema(schema, baseUrl, 0, ctx)
    }
    if (example === undefined) return noneBody(['no_json_example'])
    let text: string
    try {
      const serialized = JSON.stringify(example)
      if (serialized === undefined) return noneBody(['example_not_serializable'])
      text = serialized
    } catch {
      return noneBody(['example_not_serializable'])
    }
    const bytes = Buffer.byteLength(text)
    if (bytes > EXAMPLE_MAX_BYTES) return noneBody(['example_too_large'])
    return { body: { kind: 'json', text }, warnings: [], bytes }
  }

  if (
    normalized === 'application/x-www-form-urlencoded' ||
    normalized.startsWith('multipart/form-data')
  ) {
    const multipart = normalized.startsWith('multipart/form-data')
    let example = media.example
    if (example === undefined && schema !== undefined) {
      example = exampleFromSchema(schema, baseUrl, 0, ctx)
    }
    const binary = multipart ? binaryPropertyNames(schema, resolver, baseUrl) : new Set<string>()
    const fields: HttpKeyValue[] = []
    const warnings: string[] = []
    if (isObject(example)) {
      for (const [name, value] of Object.entries(example)) {
        if (binary.has(name)) {
          warnings.push(`multipart_file_unsupported:${name}`)
          continue
        }
        const text = valueString(value)
        if (text !== undefined) fields.push({ name, value: text, enabled: true })
      }
    }
    if (fields.length === 0) return noneBody([...warnings, 'empty_form_body'])
    if (multipart) return { body: { kind: 'multipart', fields, files: [] }, warnings, bytes: 0 }
    return { body: { kind: 'form', fields }, warnings, bytes: 0 }
  }

  if (normalized.startsWith('text/')) {
    let value = media.example
    if (value === undefined && schema !== undefined) {
      value = exampleFromSchema(schema, baseUrl, 0, ctx)
    }
    const text = valueString(value) ?? ''
    return {
      body: { kind: 'text', text, contentType: mediaType },
      warnings: [],
      bytes: Buffer.byteLength(text),
    }
  }

  return noneBody([`unsupported_media_type:${normalized}`])
}

function collectParameters(
  entry: ParsedOperation,
  resolver: RefResolver,
): { readonly params: readonly ParameterHit[]; readonly warnings: readonly string[] } {
  const rawParameters: unknown[] = []
  if (Array.isArray(entry.pathItem.parameters)) rawParameters.push(...entry.pathItem.parameters)
  if (Array.isArray(entry.operation.parameters)) rawParameters.push(...entry.operation.parameters)

  const params: ParameterHit[] = []
  const warnings: string[] = []
  const index = new Map<string, number>()

  for (const raw of rawParameters) {
    let hit: DerefResult
    try {
      hit = resolver.deref(raw, '')
    } catch (error) {
      if (error instanceof OpenApiError) {
        warnings.push(`${error.code}: ${error.message}`)
        continue
      }
      throw error
    }
    if (!isObject(hit.value)) {
      warnings.push('invalid_parameter')
      continue
    }
    const where = typeof hit.value.in === 'string' ? hit.value.in : ''
    const name = typeof hit.value.name === 'string' ? hit.value.name : ''
    if (where === '' || name === '') {
      warnings.push('invalid_parameter')
      continue
    }
    const key = `${where}:${name}`
    const existing = index.get(key)
    if (existing === undefined) {
      if (params.length >= HTTP_PARAMS_MAX) {
        warnings.push('too_many_parameters')
        break
      }
      index.set(key, params.length)
      params.push({ param: hit.value, baseUrl: hit.baseUrl })
    } else {
      params[existing] = { param: hit.value, baseUrl: hit.baseUrl }
    }
  }

  return { params, warnings }
}

function paramExample(
  param: JsonObject,
  baseUrl: string,
  resolver: RefResolver,
  required: boolean,
  ctx: ExampleContext,
): unknown {
  if (param.example !== undefined) return param.example
  if (isObject(param.examples)) {
    for (const candidate of Object.values(param.examples)) {
      if (isObject(candidate) && candidate.value !== undefined) return candidate.value
    }
  }

  const schemaRaw = isObject(param.schema) ? param.schema : param
  const schemaHit = resolver.deref(schemaRaw, baseUrl)
  const schema = isObject(schemaHit.value) ? schemaHit.value : {}
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (schema.const !== undefined) return schema.const
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  if (!required) return undefined
  return exampleFromSchema(schemaRaw, baseUrl, 0, ctx)
}

interface AuthOutcome {
  readonly auth: HttpAuth
  readonly warnings: readonly string[]
}

function mapAuth(
  parsed: ParsedDocument,
  operation: JsonObject,
  resolver: RefResolver,
): AuthOutcome {
  const root = parsed.root
  const rawSecurity = Array.isArray(operation.security)
    ? operation.security
    : Array.isArray(root.security)
      ? root.security
      : []
  const warnings: string[] = []
  if (rawSecurity.length === 0) return { auth: { kind: 'none' }, warnings }
  if (rawSecurity.length > 1) warnings.push('alternative_security_schemes')

  const requirement = rawSecurity[0]
  if (!isObject(requirement)) {
    warnings.push('invalid_security_requirement')
    return { auth: { kind: 'none' }, warnings }
  }
  const names = Object.keys(requirement)
  if (names.length === 0) return { auth: { kind: 'none' }, warnings }
  if (names.length > 1) warnings.push('multiple_security_schemes')

  const name = names[0]!
  const schemes =
    parsed.version === '3'
      ? isObject(root.components) && isObject(root.components.securitySchemes)
        ? root.components.securitySchemes
        : {}
      : isObject(root.securityDefinitions)
        ? root.securityDefinitions
        : {}
  const rawScheme = schemes[name]
  if (rawScheme === undefined) {
    warnings.push(`unknown_security_scheme:${name}`)
    return { auth: { kind: 'none' }, warnings }
  }

  let scheme: unknown
  try {
    scheme = resolver.deref(rawScheme, '').value
  } catch (error) {
    if (error instanceof OpenApiError) {
      warnings.push(`${error.code}: ${error.message}`)
      return { auth: { kind: 'none' }, warnings }
    }
    throw error
  }
  if (!isObject(scheme)) {
    warnings.push(`invalid_security_scheme:${name}`)
    return { auth: { kind: 'none' }, warnings }
  }

  const variable = isApiEnvironmentVariableName(name) ? name : sanitizeVariableName(name)
  if (variable !== name) warnings.push(`security_scheme_renamed:${name}`)

  if (scheme.type === 'http') {
    const httpScheme = typeof scheme.scheme === 'string' ? scheme.scheme.toLowerCase() : ''
    if (httpScheme === 'bearer') {
      return { auth: { kind: 'bearer', token: `{{${variable}}}` }, warnings }
    }
    if (httpScheme === 'basic') {
      return {
        auth: {
          kind: 'basic',
          username: `{{${variable}User}}`,
          password: `{{${variable}Password}}`,
        },
        warnings,
      }
    }
    warnings.push(`unsupported_http_auth:${httpScheme === '' ? 'unknown' : httpScheme}`)
    return { auth: { kind: 'none' }, warnings }
  }

  if (scheme.type === 'basic') {
    return {
      auth: {
        kind: 'basic',
        username: `{{${variable}User}}`,
        password: `{{${variable}Password}}`,
      },
      warnings,
    }
  }

  if (scheme.type === 'apiKey') {
    const inValue = scheme.in === 'query' ? 'query' : scheme.in === 'header' ? 'header' : ''
    const keyName = typeof scheme.name === 'string' ? scheme.name : ''
    if (inValue === '' || keyName === '') {
      warnings.push(`invalid_api_key_scheme:${name}`)
      return { auth: { kind: 'none' }, warnings }
    }
    if (inValue === 'header' && (!HEADER_NAME_PATTERN.test(keyName) || keyName.length > 128)) {
      warnings.push(`invalid_api_key_header:${name}`)
      return { auth: { kind: 'none' }, warnings }
    }
    return {
      auth: { kind: 'api-key', name: keyName, value: `{{${variable}}}`, in: inValue },
      warnings,
    }
  }

  warnings.push(`unsupported_security_scheme:${String(scheme.type)}`)
  return { auth: { kind: 'none' }, warnings }
}

function chooseConsumes(operation: JsonObject, root: JsonObject, fallback: string): string {
  const raw = Array.isArray(operation.consumes)
    ? operation.consumes
    : Array.isArray(root.consumes)
      ? root.consumes
      : []
  const values = raw.filter((value): value is string => typeof value === 'string')
  const json = values.find((value) => {
    const normalized = normalizeMediaType(value)
    return normalized === 'application/json' || normalized.endsWith('+json')
  })
  return json ?? values[0] ?? fallback
}

function mapBody(
  entry: ParsedOperation,
  parsed: ParsedDocument,
  params: readonly ParameterHit[],
  resolver: RefResolver,
  ctx: ExampleContext,
): BodyOutcome {
  if (parsed.version === '3') {
    const requestBody = entry.operation.requestBody
    if (requestBody === undefined) return noneBody()
    let bodyHit: DerefResult
    try {
      bodyHit = resolver.deref(requestBody, '')
    } catch (error) {
      if (error instanceof OpenApiError) return noneBody([`${error.code}: ${error.message}`])
      throw error
    }
    if (!isObject(bodyHit.value)) return noneBody(['invalid_request_body'])
    const content = isObject(bodyHit.value.content) ? bodyHit.value.content : null
    if (content === null || Object.keys(content).length === 0) {
      return noneBody(['request_body_has_no_content'])
    }
    const picked = pickMedia(content)
    if (picked === null) return noneBody(['request_body_has_no_content'])
    try {
      return bodyFromMedia(picked.mediaType, picked.media, bodyHit.baseUrl, resolver, ctx)
    } catch (error) {
      if (error instanceof OpenApiError) return noneBody([`${error.code}: ${error.message}`])
      throw error
    }
  }

  const bodyParam = params.find((hit) => hit.param.in === 'body')
  const formParams = params.filter((hit) => hit.param.in === 'formData')
  const warnings: string[] = []
  if (bodyParam !== undefined && formParams.length > 0) warnings.push('mixed_body_and_form')

  if (bodyParam !== undefined) {
    const schema = bodyParam.param.schema
    if (schema === undefined) return noneBody([...warnings, 'missing_body_schema'])
    const mediaType = chooseConsumes(entry.operation, parsed.root, 'application/json')
    try {
      const outcome = bodyFromMedia(mediaType, { schema }, bodyParam.baseUrl, resolver, ctx)
      return { body: outcome.body, warnings: [...warnings, ...outcome.warnings], bytes: outcome.bytes }
    } catch (error) {
      if (error instanceof OpenApiError) {
        return noneBody([...warnings, `${error.code}: ${error.message}`])
      }
      throw error
    }
  }

  if (formParams.length > 0) {
    const mediaType = chooseConsumes(
      entry.operation,
      parsed.root,
      'application/x-www-form-urlencoded',
    )
    const multipart = normalizeMediaType(mediaType).startsWith('multipart/form-data')
    const fields: HttpKeyValue[] = []
    for (const hit of formParams) {
      const name = typeof hit.param.name === 'string' ? hit.param.name : ''
      const type = typeof hit.param.type === 'string' ? hit.param.type : 'string'
      if (name === '') {
        warnings.push('empty_form_field')
        continue
      }
      if (type === 'file') {
        warnings.push(`multipart_file_unsupported:${name}`)
        continue
      }
      let value: unknown
      try {
        value = paramExample(hit.param, hit.baseUrl, resolver, hit.param.required === true, ctx)
      } catch (error) {
        if (error instanceof OpenApiError) {
          warnings.push(`${error.code}: ${error.message}`)
          continue
        }
        throw error
      }
      fields.push({
        name,
        value: valueString(value) ?? '',
        enabled: hit.param.required === true,
      })
    }
    if (fields.length === 0) return noneBody([...warnings, 'empty_form_body'])
    if (multipart) return { body: { kind: 'multipart', fields, files: [] }, warnings, bytes: 0 }
    return { body: { kind: 'form', fields }, warnings, bytes: 0 }
  }

  return { body: { kind: 'none' }, warnings, bytes: 0 }
}

interface ServerResolution {
  readonly baseUrl: string
  readonly warnings: readonly string[]
}

function resolveServerUrl(parsed: ParsedDocument): ServerResolution {
  const root = parsed.root
  const warnings: string[] = []

  if (parsed.version === '2') {
    const host = typeof root.host === 'string' ? root.host.trim() : ''
    const basePath = typeof root.basePath === 'string' ? root.basePath.trim() : ''
    const schemes = Array.isArray(root.schemes)
      ? root.schemes.filter((value): value is string => typeof value === 'string')
      : []
    if (host === '') {
      warnings.push('missing_host')
      return { baseUrl: basePath, warnings }
    }
    const scheme = schemes.includes('https') ? 'https' : (schemes[0] ?? 'https')
    if (scheme !== 'http' && scheme !== 'https') warnings.push(`unsupported_scheme:${scheme}`)
    return { baseUrl: `${scheme}://${host}${basePath}`.replace(/\/+$/, ''), warnings }
  }

  const servers = Array.isArray(root.servers) ? root.servers.filter(isObject) : []
  if (servers.length === 0) {
    warnings.push('missing_server')
    return { baseUrl: '', warnings }
  }
  if (servers.length > 1) warnings.push('multiple_servers')
  const server = servers[0]!
  const rawUrl = typeof server.url === 'string' ? server.url.trim() : ''
  if (rawUrl === '') {
    warnings.push('empty_server_url')
    return { baseUrl: '', warnings }
  }

  const variables = isObject(server.variables) ? server.variables : {}
  const url = rawUrl.replace(/\{([^{}]+)\}/g, (_match, rawName: string) => {
    const name = rawName.trim()
    const variable = variables[name]
    if (isObject(variable)) {
      const fallback = variable.default
      if (
        typeof fallback === 'string' ||
        typeof fallback === 'number' ||
        typeof fallback === 'boolean'
      ) {
        return String(fallback)
      }
    }
    warnings.push(`missing_server_variable:${name}`)
    return `{{${isApiEnvironmentVariableName(name) ? name : sanitizeVariableName(name)}}}`
  })

  if (!/^https?:\/\//i.test(url)) warnings.push('relative_server')
  return { baseUrl: url.replace(/\/+$/, ''), warnings }
}

function joinUrl(base: string, path: string): string {
  if (base === '') return path
  const left = base.replace(/\/+$/, '')
  return `${left}${path.startsWith('/') ? path : `/${path}`}`
}

function makeEndpointId(base: string, used: Set<string>): string {
  let candidate = base
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 64)
  if (candidate === '') candidate = 'endpoint'
  let suffix = 2
  while (used.has(candidate)) {
    const tail = `-${suffix}`
    suffix += 1
    candidate = `${candidate.slice(0, 64 - tail.length)}${tail}`
  }
  used.add(candidate)
  return candidate
}

function mapDocument(parsed: ParsedDocument, resolver: RefResolver): MapResult {
  const stats: MutableStats = {
    authKinds: {},
    bodyKinds: {},
    warnings: {},
    exampleCycleStops: 0,
    exampleDepthStops: 0,
    exampleNodeStops: 0,
    maxBodyBytes: 0,
    totalBodyBytes: 0,
  }
  const globalWarnings: string[] = []
  const server = resolveServerUrl(parsed)
  globalWarnings.push(...server.warnings)

  const endpoints: MappedEndpoint[] = []
  const groups = new Set<string>()
  const usedIds = new Set<string>()
  let skipped = 0

  for (const entry of parsed.operations) {
    const warnings: string[] = []
    const ctx = createExampleContext(resolver)
    const authOutcome = mapAuth(parsed, entry.operation, resolver)
    warnings.push(...authOutcome.warnings)
    const auth = authOutcome.auth

    const collected = collectParameters(entry, resolver)
    warnings.push(...collected.warnings)
    const params = collected.params

    let body: HttpRequestBody = { kind: 'none' }
    let bodyBytes = 0
    const hasBody =
      parsed.version === '3'
        ? entry.operation.requestBody !== undefined
        : params.some((hit) => hit.param.in === 'body' || hit.param.in === 'formData')
    if (entry.method === 'GET' || entry.method === 'HEAD') {
      if (hasBody) warnings.push('body_dropped_for_get_head')
    } else {
      const bodyOutcome = mapBody(entry, parsed, params, resolver, ctx)
      warnings.push(...bodyOutcome.warnings)
      body = bodyOutcome.body
      bodyBytes = bodyOutcome.bytes
    }

    const pathNames = new Set<string>()
    for (const match of entry.path.matchAll(/\{([^{}]+)\}/g)) {
      if (match[1] !== undefined) pathNames.add(match[1])
    }
    const seenPathParams = new Set<string>()
    for (const hit of params) {
      if (hit.param.in !== 'path') continue
      const name = typeof hit.param.name === 'string' ? hit.param.name : ''
      seenPathParams.add(name)
      if (!pathNames.has(name)) warnings.push(`path_param_without_placeholder:${name}`)
    }
    for (const name of pathNames) {
      if (!seenPathParams.has(name)) warnings.push(`missing_path_param:${name}`)
    }

    let urlPath = entry.path
    for (const name of pathNames) {
      const variable = isApiEnvironmentVariableName(name) ? name : sanitizeVariableName(name)
      if (variable !== name) warnings.push(`path_param_renamed:${name}`)
      urlPath = urlPath.split(`{${name}}`).join(`{{${variable}}}`)
    }
    const url = joinUrl(server.baseUrl, urlPath)

    const query: HttpKeyValue[] = []
    const headers: HttpKeyValue[] = []
    for (const hit of params) {
      const param = hit.param
      const where = typeof param.in === 'string' ? param.in : ''
      const name = typeof param.name === 'string' ? param.name : ''
      if (where === 'path') continue
      if (where === 'body' || where === 'formData') continue
      if (where === 'cookie') {
        warnings.push(`cookie_param_unsupported:${name}`)
        continue
      }
      if (where !== 'query' && where !== 'header') {
        warnings.push(`unsupported_param_in:${where}`)
        continue
      }

      const required = param.required === true
      let value: unknown
      try {
        value = paramExample(param, hit.baseUrl, resolver, required, ctx)
      } catch (error) {
        if (error instanceof OpenApiError) {
          warnings.push(`${error.code}: ${error.message}`)
          continue
        }
        throw error
      }
      const text = valueString(value) ?? ''
      if (required && value === undefined) warnings.push(`missing_param_value:${where}:${name}`)

      if (where === 'header') {
        if (name.length > 128 || !HEADER_NAME_PATTERN.test(name)) {
          warnings.push(`invalid_header_name:${name}`)
          continue
        }
        if (FORBIDDEN_REQUEST_HEADERS.has(name.toLowerCase())) {
          warnings.push(`forbidden_header:${name}`)
          continue
        }
        if (name.toLowerCase() === 'authorization' && auth.kind !== 'none') {
          warnings.push('authorization_param_replaced')
          continue
        }
        if (/[\r\n]/.test(text) || text.length > 8192) {
          warnings.push(`invalid_header_value:${name}`)
          continue
        }
        if (headers.length >= HTTP_HEADERS_MAX) {
          warnings.push('too_many_headers')
          break
        }
        headers.push({ name, value: text, enabled: required })
      } else {
        if (name === '') {
          warnings.push('empty_query_name')
          continue
        }
        if (query.length >= HTTP_PARAMS_MAX) {
          warnings.push('too_many_query_params')
          break
        }
        query.push({ name, value: text, enabled: required })
      }
    }

    if (url.length > HTTP_URL_CHARS_MAX) {
      warnings.push('url_too_long')
      skipped += 1
      for (const warning of warnings) bump(stats.warnings, warningKey(warning))
      continue
    }

    const request: HttpRequestSpec = { method: entry.method, url, query, headers, body, auth }
    if (!isHttpRequestSpec(request)) {
      warnings.push('invalid_request_spec')
      skipped += 1
      for (const warning of warnings) bump(stats.warnings, warningKey(warning))
      continue
    }

    const summary = typeof entry.operation.summary === 'string' ? entry.operation.summary.trim() : ''
    const operationId =
      typeof entry.operation.operationId === 'string' ? entry.operation.operationId.trim() : ''
    const name = (summary || operationId || `${entry.method} ${entry.path}`).slice(0, 200)
    const rawId = operationId || `${entry.method.toLowerCase()}_${entry.path}`
    const id = makeEndpointId(rawId, usedIds)
    const tags = entry.operation.tags
    const group =
      Array.isArray(tags) && typeof tags[0] === 'string' && tags[0].trim() !== ''
        ? tags[0].trim().slice(0, 100)
        : 'default'

    const uniqueWarnings = [...new Set(warnings)]
    endpoints.push({ id, name, group, request, warnings: uniqueWarnings })
    groups.add(group)
    bump(stats.authKinds, auth.kind)
    bump(stats.bodyKinds, body.kind)
    for (const warning of uniqueWarnings) bump(stats.warnings, warningKey(warning))
    stats.exampleCycleStops += ctx.cycleStops
    stats.exampleDepthStops += ctx.depthStops
    stats.exampleNodeStops += ctx.nodeStops
    stats.maxBodyBytes = Math.max(stats.maxBodyBytes, bodyBytes)
    stats.totalBodyBytes += bodyBytes
  }

  for (const warning of globalWarnings) bump(stats.warnings, warningKey(warning))

  return {
    endpoints,
    groups: [...groups],
    globalWarnings,
    skipped,
    stats: {
      authKinds: stats.authKinds,
      bodyKinds: stats.bodyKinds,
      warnings: stats.warnings,
      exampleCycleStops: stats.exampleCycleStops,
      exampleDepthStops: stats.exampleDepthStops,
      exampleNodeStops: stats.exampleNodeStops,
      maxBodyBytes: stats.maxBodyBytes,
      totalBodyBytes: stats.totalBodyBytes,
    },
  }
}

/* -------------------------------------------------------------------------
 * Import pipeline
 * ---------------------------------------------------------------------- */

interface ImportOptions {
  readonly policy: RemoteRefPolicy
  readonly fetch: FetchLike | null
}

interface ImportTimings {
  readonly parseMs: number
  readonly bundleMs: number
  readonly mapMs: number
  readonly serializeMs: number
  /** Parse + bundle + map; persistence/UI work is not part of this number. */
  readonly totalMs: number
}

interface ImportOutcome {
  readonly parsed: ParsedDocument
  readonly bundle: RemoteBundle
  readonly mapped: MapResult
  readonly contractValid: number
  readonly requestJsonBytes: number
  readonly timings: ImportTimings
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

async function importOpenApiDocument(
  text: string,
  options: ImportOptions,
): Promise<ImportOutcome> {
  const started = performance.now()
  const parsed = parseOpenApiDocument(text, options.policy)
  const afterParse = performance.now()
  const bundle = await bundleRemoteRefs(parsed, options.policy, options.fetch)
  const afterBundle = performance.now()
  const resolver = new RefResolver(parsed.root, bundle.documents, options.policy)
  const mapped = mapDocument(parsed, resolver)
  const afterMap = performance.now()

  const requestJsonBytes =
    mapped.endpoints.length === 0
      ? 0
      : Buffer.byteLength(JSON.stringify(mapped.endpoints.map((endpoint) => endpoint.request)))
  const afterSerialize = performance.now()
  const contractValid = mapped.endpoints.filter((endpoint) =>
    isHttpRequestSpec(endpoint.request),
  ).length

  return {
    parsed,
    bundle,
    mapped,
    contractValid,
    requestJsonBytes,
    timings: {
      parseMs: round2(afterParse - started),
      bundleMs: round2(afterBundle - afterParse),
      mapMs: round2(afterMap - afterBundle),
      serializeMs: round2(afterSerialize - afterMap),
      totalMs: round2(afterMap - started),
    },
  }
}

/* -------------------------------------------------------------------------
 * Sample documents
 * ---------------------------------------------------------------------- */

const SAMPLE_TAGS = [
  'accounts',
  'billing',
  'catalog',
  'orders',
  'payments',
  'reports',
  'search',
  'shipping',
  'users',
  'webhooks',
]

const SAMPLE_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

function buildSampleDocument(pathCount: number): JsonObject {
  const paths: JsonObject = {}
  for (let index = 0; index < pathCount; index += 1) {
    const pathItem: JsonObject = {}
    for (const method of SAMPLE_METHODS) {
      const operation: JsonObject = {
        tags: [SAMPLE_TAGS[index % SAMPLE_TAGS.length]!],
        operationId: `${method}Resource${index}`,
        summary: `${method.toUpperCase()} resource ${index}`,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'integer', example: index + 1 },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 20, maximum: 100 },
          },
          {
            name: 'X-Tenant',
            in: 'header',
            required: false,
            schema: { type: 'string', example: 'acme' },
          },
          ...(index % 17 === 0
            ? [{ name: 'session', in: 'cookie', required: false, schema: { type: 'string' } }]
            : []),
        ],
        responses: {
          '200': {
            description: 'ok',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ResourcePage' },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
        },
      }
      if (method !== 'get' && method !== 'delete') {
        operation.requestBody = {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref:
                  index % 7 === 0
                    ? '#/components/schemas/AliasInput'
                    : '#/components/schemas/ResourceInput',
              },
            },
          },
        }
      }
      const override = index % 10
      if (override === 0) operation.security = [{ apiKeyAuth: [] }]
      else if (override === 1) operation.security = [{ basicAuth: [] }]
      else if (override === 2) operation.security = []
      pathItem[method] = operation
    }
    paths[`/resources/${index}/{id}`] = pathItem
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'S7 sample API',
      version: '1.0.0',
      description: 'Synthetic document used by the S7 OpenAPI spike.',
    },
    servers: [
      {
        url: 'https://{env}.example.test/{base}',
        variables: { env: { default: 'api' }, base: { default: 'v1' } },
      },
    ],
    tags: SAMPLE_TAGS.map((name) => ({ name, description: `${name} endpoints` })),
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      schemas: {
        BaseEntity: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'integer', example: 1 } },
        },
        ResourceInput: {
          allOf: [
            { $ref: '#/components/schemas/BaseEntity' },
            {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string', example: 'Widget' },
                description: { type: 'string', example: 'A demo resource' },
                tags: { type: 'array', items: { type: 'string' }, maxItems: 2 },
                owner: { $ref: '#/components/schemas/User' },
                parent: { $ref: '#/components/schemas/ResourceInput' },
                children: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ResourceInput' },
                  maxItems: 2,
                },
              },
            },
          ],
        },
        AliasInput: { $ref: '#/components/schemas/ResourceInput' },
        ResourcePage: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { $ref: '#/components/schemas/Resource' } },
            next: { type: 'string', example: 'cursor-2' },
          },
        },
        Resource: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            name: { type: 'string', example: 'Widget' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 7 },
            email: { type: 'string', format: 'email' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            code: { type: 'string', example: 'bad_request' },
            message: { type: 'string', example: 'Invalid input' },
          },
        },
      },
      responses: {
        BadRequest: {
          description: 'bad request',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Error' } },
          },
        },
      },
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        basicAuth: { type: 'http', scheme: 'basic' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
    },
  }
}

function buildSwagger2Document(): JsonObject {
  return {
    swagger: '2.0',
    info: { title: 'S7 Swagger 2.0 sample', version: '1.0.0' },
    host: 'api.example.test',
    basePath: '/v2',
    schemes: ['https'],
    consumes: ['application/json'],
    produces: ['application/json'],
    security: [{ basicAuth: [] }],
    securityDefinitions: { basicAuth: { type: 'basic' } },
    paths: {
      '/pets': {
        get: {
          tags: ['pets'],
          operationId: 'listPets',
          summary: 'List pets',
          parameters: [
            { name: 'limit', in: 'query', required: false, type: 'integer', default: 10 },
          ],
          responses: {
            '200': {
              description: 'ok',
              schema: { type: 'array', items: { $ref: '#/definitions/Pet' } },
            },
          },
        },
        post: {
          tags: ['pets'],
          operationId: 'createPet',
          summary: 'Create pet',
          parameters: [
            { name: 'body', in: 'body', required: true, schema: { $ref: '#/definitions/Pet' } },
          ],
          responses: {
            '201': { description: 'created', schema: { $ref: '#/definitions/Pet' } },
          },
        },
      },
      '/pets/{petId}': {
        get: {
          tags: ['pets'],
          operationId: 'getPet',
          summary: 'Get pet',
          parameters: [
            {
              name: 'petId',
              in: 'path',
              required: true,
              type: 'string',
              example: 'pet-1',
            },
          ],
          responses: {
            '200': { description: 'ok', schema: { $ref: '#/definitions/Pet' } },
          },
        },
      },
    },
    definitions: {
      Pet: {
        type: 'object',
        required: ['name'],
        properties: {
          id: { type: 'integer', example: 1 },
          name: { type: 'string', example: 'Rex' },
          tag: { type: 'string' },
        },
      },
    },
  }
}

function buildCycleDocument(): JsonObject {
  const requestBody = (ref: string): JsonObject => ({
    required: true,
    content: { 'application/json': { schema: { $ref: ref } } },
  })
  return {
    openapi: '3.0.3',
    info: { title: 'S7 cycle sample', version: '1.0.0' },
    paths: {
      '/a': {
        post: {
          operationId: 'postA',
          requestBody: requestBody('#/components/schemas/A'),
          responses: { '200': { description: 'ok' } },
        },
      },
      '/pure': {
        post: {
          operationId: 'postPure',
          requestBody: requestBody('#/components/schemas/PureA'),
          responses: { '200': { description: 'ok' } },
        },
      },
      '/node': {
        post: {
          operationId: 'postNode',
          requestBody: requestBody('#/components/schemas/Node'),
          responses: { '200': { description: 'ok' } },
        },
        get: {
          operationId: 'getNode',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Node' } },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
        B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
        PureA: { $ref: '#/components/schemas/PureB' },
        PureB: { $ref: '#/components/schemas/PureA' },
        Node: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'n1' },
            children: {
              type: 'array',
              items: { $ref: '#/components/schemas/Node' },
              maxItems: 2,
            },
          },
        },
      },
    },
  }
}

function buildMissingRefDocument(): JsonObject {
  return {
    openapi: '3.0.3',
    info: { title: 'S7 broken ref sample', version: '1.0.0' },
    paths: {
      '/broken': {
        get: {
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Missing' },
                },
              },
            },
          },
        },
      },
    },
    components: { schemas: {} },
  }
}

function buildExamplePayloadDocument(): JsonObject {
  return {
    openapi: '3.0.3',
    info: { title: 'S7 example payload sample', version: '1.0.0' },
    paths: {
      '/echo': {
        post: {
          operationId: 'echoExample',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ok: { type: 'boolean' } },
                  example: { $ref: 'https://evil.example/schema.json' },
                },
              },
            },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
      '/echo-examples': {
        post: {
          operationId: 'echoExamples',
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
                examples: { payload: { value: { $ref: 'https://evil.example/example.json' } } },
              },
            },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {},
  }
}

function buildProbeDocument(ref: string): JsonObject {
  return {
    openapi: '3.0.3',
    info: { title: 'S7 ref probe', version: '1.0.0' },
    paths: {
      '/probe': {
        post: {
          operationId: 'probe',
          requestBody: {
            content: { 'application/json': { schema: { $ref: ref } } },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    components: {},
  }
}

function buildTwoRemoteRefsDocument(first: string, second: string): JsonObject {
  return {
    openapi: '3.0.3',
    info: { title: 'S7 remote dedupe', version: '1.0.0' },
    paths: {
      '/remote-a': {
        post: {
          operationId: 'remoteA',
          requestBody: { content: { 'application/json': { schema: { $ref: first } } } },
          responses: { '200': { description: 'ok' } },
        },
      },
      '/remote-b': {
        post: {
          operationId: 'remoteB',
          requestBody: { content: { 'application/json': { schema: { $ref: second } } } },
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  }
}

/* -------------------------------------------------------------------------
 * Local ref fixture server
 * ---------------------------------------------------------------------- */

interface RefServer {
  readonly server: Server
  readonly origin: string
  readonly requests: string[]
}

const REMOTE_FIXTURE_DOCUMENT = {
  Thing: {
    type: 'object',
    properties: {
      ok: { type: 'boolean', example: true },
      nested: { $ref: '#/Nested' },
    },
  },
  Nested: {
    type: 'object',
    properties: { label: { type: 'string', example: 'inner' } },
  },
}

async function startRefServer(): Promise<RefServer> {
  const requests: string[] = []
  const big = JSON.stringify({ Thing: { type: 'string', description: 'x'.repeat(2 * 1024 * 1024) } })
  const server = createServer((request, response) => {
    const url = request.url ?? '/'
    requests.push(url)
    if (url === '/remote.json') {
      const body = JSON.stringify(REMOTE_FIXTURE_DOCUMENT)
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      })
      response.end(body)
      return
    }
    if (url === '/redirect') {
      response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' })
      response.end()
      return
    }
    if (url === '/big.json') {
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(big),
      })
      response.end(big)
      return
    }
    if (url === '/big-chunked.json') {
      response.writeHead(200, {
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
      })
      response.write(big.slice(0, 1024 * 1024))
      response.end(big.slice(1024 * 1024))
      return
    }
    if (url === '/bad.json') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"Thing":')
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('ref fixture server did not bind to a TCP port')
  }
  return { server, origin: `http://127.0.0.1:${address.port}`, requests }
}

/* -------------------------------------------------------------------------
 * Measurement helpers
 * ---------------------------------------------------------------------- */

interface Measurement {
  readonly timings: ImportTimings
  readonly endpoints: number
  readonly skipped: number
  readonly contractValid: number
  readonly documentBytes: number
  readonly requestJsonBytes: number
  readonly groups: readonly string[]
  readonly stats: MapStats
  readonly globalWarnings: readonly string[]
  readonly preview: readonly MappedEndpoint[] | undefined
}

async function measure(
  text: string,
  options: ImportOptions,
  keepPreview: boolean,
): Promise<Measurement> {
  const outcome = await importOpenApiDocument(text, options)
  return {
    timings: outcome.timings,
    endpoints: outcome.mapped.endpoints.length,
    skipped: outcome.mapped.skipped,
    contractValid: outcome.contractValid,
    documentBytes: outcome.parsed.bytes,
    requestJsonBytes: outcome.requestJsonBytes,
    groups: outcome.mapped.groups,
    stats: outcome.mapped.stats,
    globalWarnings: outcome.mapped.globalWarnings,
    preview: keepPreview ? outcome.mapped.endpoints : undefined,
  }
}

interface SeriesSummary {
  readonly min: number
  readonly median: number
  readonly max: number
}

function summarize(values: readonly number[]): SeriesSummary {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
  return {
    min: round2(sorted[0]!),
    median: round2(median),
    max: round2(sorted[sorted.length - 1]!),
  }
}

async function runSeries(
  text: string,
  options: ImportOptions,
  runs: number,
  keepPreview: boolean,
): Promise<readonly Measurement[]> {
  const results: Measurement[] = []
  for (let index = 0; index < runs; index += 1) {
    results.push(await measure(text, options, keepPreview && index === 0))
  }
  return results
}

/* -------------------------------------------------------------------------
 * Checks and reporting
 * ---------------------------------------------------------------------- */

interface Check {
  readonly name: string
  readonly pass: boolean
  readonly detail: string
}

interface ErrorRecord {
  readonly scenario: string
  readonly expected: string
  readonly actual: string
  readonly message: string
  readonly readable: boolean
}

interface PolicyProbe {
  readonly label: string
  readonly ref: string
  readonly expected: string
  readonly actual: string
  readonly pass: boolean
}

function isReadable(info: ErrorInfo): boolean {
  return info.message.length <= 300 && !/[\r\n]/.test(info.message)
}

async function expectOpenApiError(
  run: () => Promise<unknown> | unknown,
): Promise<ErrorInfo | null> {
  try {
    await run()
    return null
  } catch (error) {
    return toErrorInfo(error)
  }
}

function bodyJson(body: HttpRequestBody | undefined): unknown {
  if (body === undefined || body.kind !== 'json') return undefined
  try {
    return JSON.parse(body.text)
  } catch {
    return undefined
  }
}

function main(): Promise<void> {
  return run()
}

async function run(): Promise<void> {
  await mkdir(join(ROOT, '.tmp', 'logs'), { recursive: true })

  const checks: Check[] = []
  const errors: ErrorRecord[] = []
  const policyProbes: PolicyProbe[] = []
  const record = (name: string, pass: boolean, detail: string): void => {
    checks.push({ name, pass, detail })
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`)
  }
  const recordError = (
    scenario: string,
    expected: string,
    info: ErrorInfo | null,
  ): ErrorRecord => {
    const entry: ErrorRecord = {
      scenario,
      expected,
      actual: info?.code ?? 'no-error',
      message: info?.message ?? '',
      readable: info !== null && isReadable(info),
    }
    errors.push(entry)
    return entry
  }

  let refServer: RefServer | null = null
  let serverClosed = false
  let realFetchCalls = 0
  const realFetchUrls: string[] = []
  let fakeFetchCalls = 0

  const realFetch: FetchLike = async (url, init) => {
    realFetchCalls += 1
    realFetchUrls.push(url)
    const response = await fetch(url, init)
    return response as unknown as FetchResponseLike
  }

  const remoteSchemaDocument = {
    User: {
      type: 'object',
      properties: {
        id: { type: 'integer', example: 7 },
        email: { type: 'string', format: 'email' },
      },
    },
  }
  const fakeFetch: FetchLike = async () => {
    fakeFetchCalls += 1
    return {
      ok: true,
      status: 200,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-type' ? 'application/json' : null,
      },
      text: async () => JSON.stringify(remoteSchemaDocument),
    }
  }

  try {
    refServer = await startRefServer()
    const origin = refServer.origin
    const loopbackPolicy = makePolicy({ allowLoopback: true })

    console.log('S7 OpenAPI spike — parser, $ref resolver, SSRF policy, mapper')
    console.log(`node ${process.version} · ${process.platform} ${process.arch}`)
    console.log('')

    /* ---- Sample: 500 endpoints ------------------------------------- */

    const sampleText = JSON.stringify(buildSampleDocument(100))
    const sampleRuns = await runSeries(
      sampleText,
      { policy: DEFAULT_POLICY, fetch: realFetch },
      RUNS_SAMPLE,
      true,
    )
    const first = sampleRuns[0]!
    const endpoints = first.preview ?? []
    const warm = sampleRuns.slice(1)
    const warmTotal = summarize(warm.map((run) => run.timings.totalMs))
    const allTotal = summarize(sampleRuns.map((run) => run.timings.totalMs))
    const parseSummary = summarize(warm.map((run) => run.timings.parseMs))
    const mapSummary = summarize(warm.map((run) => run.timings.mapMs))
    const serializeSummary = summarize(warm.map((run) => run.timings.serializeMs))

    console.log(
      `[sample] ${first.endpoints} operations · ${first.documentBytes} bytes · ` +
        `${first.groups.length} tags · ${first.requestJsonBytes} bytes of requests`,
    )
    console.log(
      `[cold] total ${first.timings.totalMs} ms · parse ${first.timings.parseMs} · ` +
        `map ${first.timings.mapMs} · serialize ${first.timings.serializeMs}`,
    )
    console.log(
      `[warm] total min ${warmTotal.min} / median ${warmTotal.median} / max ${warmTotal.max} ms; ` +
        `parse median ${parseSummary.median}; map median ${mapSummary.median}; ` +
        `serialize median ${serializeSummary.median}`,
    )
    console.log(
      `[map] contract-valid ${first.contractValid}/${first.endpoints} · ` +
        `body ${JSON.stringify(first.stats.bodyKinds)} · auth ${JSON.stringify(first.stats.authKinds)}`,
    )
    console.log(
      `[warn] ${Object.entries(first.stats.warnings)
        .map(([key, count]) => `${key}=${count}`)
        .join(' · ')}`,
    )

    record(
      'sample imports 500 operations',
      first.endpoints === 500 && first.skipped === 0,
      `${first.endpoints} endpoints, ${first.skipped} skipped`,
    )
    record(
      'every mapped request satisfies HttpRequestSpec',
      first.contractValid === 500,
      `${first.contractValid}/${first.endpoints}`,
    )
    record(
      'sample document is below the 8 MiB cap',
      first.documentBytes <= OPENAPI_MAX_DOCUMENT_BYTES,
      `${first.documentBytes} bytes`,
    )
    record(
      'cold import is under 5 s',
      first.timings.totalMs < IMPORT_BUDGET_MS,
      `${first.timings.totalMs} ms`,
    )
    record(
      'warm import is under 5 s',
      warmTotal.max < IMPORT_BUDGET_MS,
      `max ${warmTotal.max} ms, median ${warmTotal.median} ms`,
    )
    record(
      'tag groups are preserved',
      first.groups.length === 10,
      first.groups.join(', '),
    )
    record(
      'path parameters become {{variables}}',
      endpoints.every((endpoint) => {
        const url = endpoint.request.url
        // Strip converted `{{id}}` first: it contains `{id}` as a substring.
        return url.includes('{{id}}') && !url.split('{{id}}').join('').includes('{id}')
      }),
      endpoints[0]?.request.url ?? 'no endpoints',
    )
    record(
      'server URL variables are substituted',
      endpoints.every((endpoint) =>
        endpoint.request.url.startsWith('https://api.example.test/v1/resources/'),
      ),
      endpoints[0]?.request.url ?? 'no endpoints',
    )
    const jsonBodies = endpoints.filter((endpoint) => endpoint.request.body?.kind === 'json')
    record(
      'JSON bodies are generated and parse',
      jsonBodies.length === 300 && jsonBodies.every((endpoint) => bodyJson(endpoint.request.body) !== undefined),
      `${jsonBodies.length} JSON bodies`,
    )
    record(
      'optional query rows are kept but disabled',
      endpoints.every((endpoint) =>
        (endpoint.request.query ?? []).some(
          (row) => row.name === 'limit' && row.value === '20' && row.enabled === false,
        ),
      ),
      'limit=20, enabled=false on all endpoints',
    )
    record(
      'optional header rows are kept but disabled',
      endpoints.every((endpoint) =>
        (endpoint.request.headers ?? []).some(
          (row) => row.name === 'X-Tenant' && row.value === 'acme' && row.enabled === false,
        ),
      ),
      'X-Tenant=acme, enabled=false on all endpoints',
    )
    record(
      'auth schemes map to environment placeholders',
      first.stats.authKinds.bearer === 350 &&
        first.stats.authKinds.basic === 50 &&
        first.stats.authKinds['api-key'] === 50 &&
        first.stats.authKinds.none === 50,
      JSON.stringify(first.stats.authKinds),
    )
    record(
      'generated bodies stay small',
      first.stats.maxBodyBytes <= EXAMPLE_MAX_BYTES,
      `max ${first.stats.maxBodyBytes} bytes, total ${first.stats.totalBodyBytes}`,
    )
    record(
      'serialized requests stay well below the 8 MiB body cap',
      first.requestJsonBytes < 4 * 1024 * 1024,
      `${first.requestJsonBytes} bytes`,
    )

    /* ---- Scaling: 250 and 1000 operations --------------------------- */

    const scaling: Array<{
      endpoints: number
      documentBytes: number
      summary: SeriesSummary
      parse: SeriesSummary
      map: SeriesSummary
      msPerOperation: number
    }> = []
    for (const pathCount of SCALE_PATH_COUNTS) {
      const text = JSON.stringify(buildSampleDocument(pathCount))
      const runs = await runSeries(
        text,
        { policy: DEFAULT_POLICY, fetch: realFetch },
        RUNS_SCALE,
        false,
      )
      const summary = summarize(runs.map((run) => run.timings.totalMs))
      const parse = summarize(runs.map((run) => run.timings.parseMs))
      const map = summarize(runs.map((run) => run.timings.mapMs))
      scaling.push({
        endpoints: pathCount * SAMPLE_METHODS.length,
        documentBytes: Buffer.byteLength(text),
        summary,
        parse,
        map,
        msPerOperation: round2(summary.median / (pathCount * SAMPLE_METHODS.length)),
      })
    }
    console.log(
      `[scale] ${scaling
        .map(
          (entry) =>
            `${entry.endpoints} ops ${entry.summary.median} ms (${entry.msPerOperation} ms/op)`,
        )
        .join(' · ')}`,
    )
    record(
      '1000 operations import under 5 s',
      scaling[scaling.length - 1]!.summary.max < IMPORT_BUDGET_MS,
      `${scaling[scaling.length - 1]!.summary.max} ms for 1000 ops`,
    )

    /* ---- Cycles ----------------------------------------------------- */

    const cycleText = JSON.stringify(buildCycleDocument())
    const cycleOutcome = await importOpenApiDocument(cycleText, {
      policy: DEFAULT_POLICY,
      fetch: realFetch,
    })
    const pureError = await expectOpenApiError(() => {
      const parsed = parseOpenApiDocument(cycleText, DEFAULT_POLICY)
      const resolver = new RefResolver(parsed.root, new Map(), DEFAULT_POLICY)
      resolver.resolveRef('#/components/schemas/PureA', '')
    })
    recordError('pure $ref cycle (A -> B -> A)', 'ref_cycle', pureError)
    const pureEndpoint = cycleOutcome.mapped.endpoints.find(
      (endpoint) => endpoint.request.method === 'POST' && endpoint.request.url.endsWith('/pure'),
    )
    const nodeEndpoint = cycleOutcome.mapped.endpoints.find(
      (endpoint) => endpoint.request.method === 'POST' && endpoint.request.url.endsWith('/node'),
    )
    const nodeBody = bodyJson(nodeEndpoint?.request.body)
    const nodeText =
      nodeEndpoint?.request.body !== undefined && nodeEndpoint.request.body.kind === 'json'
        ? nodeEndpoint.request.body.text
        : ''
    const aEndpoint = cycleOutcome.mapped.endpoints.find((endpoint) =>
      endpoint.request.url.endsWith('/a'),
    )

    record(
      'pure $ref cycle is a readable error',
      pureError?.code === 'ref_cycle' &&
        pureError.message.includes('PureA') &&
        pureError.message.includes('->'),
      pureError?.message ?? 'no error',
    )
    record(
      'structural $ref cycles do not crash the mapper',
      cycleOutcome.mapped.endpoints.length === 4 && cycleOutcome.contractValid === 4,
      `${cycleOutcome.mapped.endpoints.length} endpoints, ${cycleOutcome.contractValid} valid`,
    )
    record(
      'pure cycle body is dropped with a warning',
      pureEndpoint?.request.body?.kind === 'none' &&
        (pureEndpoint.warnings ?? []).some((warning) => warning.startsWith('ref_cycle')),
      pureEndpoint?.warnings.join(' | ') ?? 'no endpoint',
    )
    record(
      'structural cycle body is bounded',
      nodeText.length > 0 &&
        nodeText.length <= EXAMPLE_MAX_BYTES &&
        isObject(nodeBody) &&
        Array.isArray(nodeBody.children) &&
        nodeBody.children.length === 0,
      `${nodeText.length} bytes: ${nodeText}`,
    )
    record(
      'structural cycle example is finite',
      aEndpoint !== undefined &&
        aEndpoint.request.body?.kind === 'json' &&
        aEndpoint.request.body.text.length <= EXAMPLE_MAX_BYTES,
      aEndpoint?.request.body?.kind === 'json'
        ? `${aEndpoint.request.body.text.length} bytes`
        : 'no body',
    )

    /* ---- Missing local ref ------------------------------------------ */

    const missingError = await expectOpenApiError(() =>
      importOpenApiDocument(JSON.stringify(buildMissingRefDocument()), {
        policy: DEFAULT_POLICY,
        fetch: realFetch,
      }),
    )
    recordError('missing local $ref', 'ref_unresolved', missingError)
    record(
      'missing $ref error is readable and points at the ref',
      missingError?.code === 'ref_unresolved' &&
        missingError.message.includes('#/components/schemas/Missing') &&
        isReadable(missingError),
      missingError?.message ?? 'no error',
    )

    /* ---- Data-position $ref is not a structural ref ----------------- */

    fakeFetchCalls = 0
    const payloadOutcome = await importOpenApiDocument(
      JSON.stringify(buildExamplePayloadDocument()),
      { policy: DEFAULT_POLICY, fetch: fakeFetch },
    )
    record(
      'example payload $ref strings are not followed',
      payloadOutcome.parsed.externalRefs.length === 0 &&
        payloadOutcome.mapped.endpoints.length === 2 &&
        fakeFetchCalls === 0,
      `${payloadOutcome.parsed.externalRefs.length} external refs, ${fakeFetchCalls} fetches`,
    )
    record(
      'example payload $ref survives as body data',
      payloadOutcome.mapped.endpoints.every((endpoint) => {
        const parsedBody = bodyJson(endpoint.request.body)
        return isObject(parsedBody) && typeof parsedBody.$ref === 'string'
      }),
      payloadOutcome.mapped.endpoints
        .map((endpoint) => endpoint.request.body?.kind)
        .join(', '),
    )

    /* ---- Remote refs: blocked by default ---------------------------- */

    const blockedUrl = 'https://example.com/schemas/User.json#/User'
    const fetchCallsBeforeBlocked = realFetchCalls
    const blockedError = await expectOpenApiError(() =>
      importOpenApiDocument(JSON.stringify(buildProbeDocument(blockedUrl)), {
        policy: DEFAULT_POLICY,
        fetch: realFetch,
      }),
    )
    recordError('public remote $ref under default policy', 'remote_ref_blocked', blockedError)
    record(
      'blocked remote $ref performs no network call',
      blockedError?.code === 'remote_ref_blocked' && realFetchCalls === fetchCallsBeforeBlocked,
      `${realFetchCalls - fetchCallsBeforeBlocked} fetch calls`,
    )

    /* ---- Remote refs: loopback explicitly allowed ------------------- */

    const loopbackRef = `${origin}/remote.json#/Thing`
    const loopbackFetchBefore = realFetchCalls
    const loopbackOutcome = await importOpenApiDocument(
      JSON.stringify(buildProbeDocument(loopbackRef)),
      { policy: loopbackPolicy, fetch: realFetch },
    )
    const loopbackBody = bodyJson(loopbackOutcome.mapped.endpoints[0]?.request.body)
    record(
      'loopback $ref is fetched once and resolved',
      realFetchCalls - loopbackFetchBefore === 1 &&
        loopbackOutcome.bundle.documentsFetched.length === 1 &&
        isObject(loopbackBody) &&
        loopbackBody.ok === true &&
        isObject(loopbackBody.nested) &&
        loopbackBody.nested.label === 'inner',
      `${realFetchCalls - loopbackFetchBefore} fetch, body ${JSON.stringify(loopbackBody)}`,
    )

    const twoRefFetchBefore = realFetchCalls
    const twoRefOutcome = await importOpenApiDocument(
      JSON.stringify(
        buildTwoRemoteRefsDocument(
          `${origin}/remote.json#/Thing`,
          `${origin}/remote.json#/Nested`,
        ),
      ),
      { policy: loopbackPolicy, fetch: realFetch },
    )
    const secondBody = bodyJson(twoRefOutcome.mapped.endpoints[1]?.request.body)
    record(
      'two refs to one document are fetched once',
      realFetchCalls - twoRefFetchBefore === 1 &&
        twoRefOutcome.bundle.documentsFetched.length === 1 &&
        twoRefOutcome.mapped.endpoints.length === 2 &&
        isObject(secondBody) &&
        secondBody.label === 'inner',
      `${realFetchCalls - twoRefFetchBefore} fetch for 2 refs`,
    )

    fakeFetchCalls = 0
    const allowPolicy = makePolicy({ allowedOrigins: ['https://example.com'] })
    const fakeOutcome = await importOpenApiDocument(
      JSON.stringify(buildProbeDocument('https://example.com/schemas/User.json#/User')),
      { policy: allowPolicy, fetch: fakeFetch },
    )
    const fakeBody = bodyJson(fakeOutcome.mapped.endpoints[0]?.request.body)
    record(
      'explicit allowlist fetches only the allowed origin',
      fakeFetchCalls === 1 &&
        isObject(fakeBody) &&
        fakeBody.id === 7 &&
        fakeBody.email === 'user@example.test',
      `${fakeFetchCalls} fake fetch calls`,
    )

    /* ---- SSRF hard blocks ------------------------------------------- */

    const metadataRef = 'http://169.254.169.254/latest/meta-data#/x'
    const metadataError = await expectOpenApiError(() =>
      importOpenApiDocument(JSON.stringify(buildProbeDocument(metadataRef)), {
        policy: makePolicy({
          allowLoopback: true,
          allowedOrigins: ['http://169.254.169.254'],
        }),
        fetch: realFetch,
      }),
    )
    recordError('link-local metadata address', 'remote_ref_blocked', metadataError)

    const metadataHostError = await expectOpenApiError(() =>
      importOpenApiDocument(
        JSON.stringify(buildProbeDocument('http://metadata.google.internal/x#/y')),
        {
          policy: makePolicy({ allowLoopback: true, allowedOrigins: ['http://metadata.google.internal'] }),
          fetch: realFetch,
        },
      ),
    )
    recordError('metadata hostname', 'remote_ref_blocked', metadataHostError)

    const fileError = await expectOpenApiError(() =>
      importOpenApiDocument(JSON.stringify(buildProbeDocument('file:///etc/passwd#/x')), {
        policy: loopbackPolicy,
        fetch: realFetch,
      }),
    )
    recordError('file: scheme', 'remote_ref_blocked', fileError)

    const credentialError = await expectOpenApiError(() =>
      importOpenApiDocument(
        JSON.stringify(buildProbeDocument(`${origin.replace('http://', 'http://user:pass@')}/remote.json#/Thing`)),
        { policy: loopbackPolicy, fetch: realFetch },
      ),
    )
    recordError('URL credentials', 'remote_ref_blocked', credentialError)

    const relativeError = await expectOpenApiError(() =>
      importOpenApiDocument(JSON.stringify(buildProbeDocument('./schemas/User.json#/User')), {
        policy: loopbackPolicy,
        fetch: realFetch,
      }),
    )
    recordError('relative external ref', 'remote_ref_blocked', relativeError)

    record(
      'hard SSRF blocks are readable',
      [metadataError, metadataHostError, fileError, credentialError, relativeError].every(
        (info) => info !== null && info.code === 'remote_ref_blocked' && isReadable(info),
      ),
      'metadata, metadata DNS, file:, credentials, relative ref',
    )

    /* ---- Remote fetch failures -------------------------------------- */

    const redirectFetchBefore = realFetchCalls
    const redirectError = await expectOpenApiError(() =>
      importOpenApiDocument(JSON.stringify(buildProbeDocument(`${origin}/redirect#/Thing`)), {
        policy: loopbackPolicy,
        fetch: realFetch,
      }),
    )
    recordError('remote document redirect', 'remote_ref_redirect', redirectError)
    record(
      'redirects are rejected without following',
      redirectError?.code === 'remote_ref_redirect' &&
        realFetchCalls - redirectFetchBefore === 1,
      `${realFetchCalls - redirectFetchBefore} fetch call`,
    )

    const bigError = await expectOpenApiError(() =>
      importOpenApiDocument(JSON.stringify(buildProbeDocument(`${origin}/big.json#/Thing`)), {
        policy: makePolicy({ allowLoopback: true, maxBytes: 1024 * 1024 }),
        fetch: realFetch,
      }),
    )
    recordError('remote document over content-length cap', 'remote_ref_too_large', bigError)
    record(
      'content-length cap is enforced before reading',
      bigError?.code === 'remote_ref_too_large' && bigError.message.includes('reports'),
      bigError?.message ?? 'no error',
    )

    const chunkedError = await expectOpenApiError(() =>
      importOpenApiDocument(
        JSON.stringify(buildProbeDocument(`${origin}/big-chunked.json#/Thing`)),
        {
          policy: makePolicy({ allowLoopback: true, maxBytes: 1024 * 1024 }),
          fetch: realFetch,
        },
      ),
    )
    recordError('remote document over byte cap without content-length', 'remote_ref_too_large', chunkedError)
    record(
      'byte cap is enforced after reading chunked bodies',
      chunkedError?.code === 'remote_ref_too_large' && chunkedError.message.includes('is '),
      chunkedError?.message ?? 'no error',
    )

    const badJsonError = await expectOpenApiError(() =>
      importOpenApiDocument(JSON.stringify(buildProbeDocument(`${origin}/bad.json#/Thing`)), {
        policy: loopbackPolicy,
        fetch: realFetch,
      }),
    )
    recordError('remote document with invalid JSON', 'remote_ref_failed', badJsonError)
    record(
      'invalid remote JSON is readable',
      badJsonError?.code === 'remote_ref_failed' &&
        badJsonError.message.includes('not valid JSON') &&
        isReadable(badJsonError),
      badJsonError?.message ?? 'no error',
    )

    const missingDocError = await expectOpenApiError(() =>
      importOpenApiDocument(JSON.stringify(buildProbeDocument(`${origin}/missing.json#/Thing`)), {
        policy: loopbackPolicy,
        fetch: realFetch,
      }),
    )
    recordError('remote document HTTP 404', 'remote_ref_failed', missingDocError)

    /* ---- Document-level limits -------------------------------------- */

    const tooLargeText = 'x'.repeat(OPENAPI_MAX_DOCUMENT_BYTES + 1)
    const tooLargeError = await expectOpenApiError(() =>
      importOpenApiDocument(tooLargeText, { policy: DEFAULT_POLICY, fetch: realFetch }),
    )
    recordError('document over 8 MiB', 'document_too_large', tooLargeError)

    const invalidJsonError = await expectOpenApiError(() =>
      importOpenApiDocument('{ "openapi": ', { policy: DEFAULT_POLICY, fetch: realFetch }),
    )
    recordError('invalid JSON text', 'invalid_json', invalidJsonError)

    const invalidDocumentError = await expectOpenApiError(() =>
      importOpenApiDocument(
        JSON.stringify({ openapi: '3.0.3', info: {}, paths: [] }),
        { policy: DEFAULT_POLICY, fetch: realFetch },
      ),
    )
    recordError('paths is not an object', 'invalid_document', invalidDocumentError)

    const tooManyText = JSON.stringify(buildSampleDocument(201))
    const tooManyError = await expectOpenApiError(() =>
      importOpenApiDocument(tooManyText, { policy: DEFAULT_POLICY, fetch: realFetch }),
    )
    recordError('1005 operations over the 1000 cap', 'too_many_operations', tooManyError)

    /* ---- Swagger 2.0 smoke ------------------------------------------ */

    const swaggerOutcome = await importOpenApiDocument(
      JSON.stringify(buildSwagger2Document()),
      { policy: DEFAULT_POLICY, fetch: realFetch },
    )
    const swaggerList = swaggerOutcome.mapped.endpoints.find((endpoint) =>
      endpoint.request.url.endsWith('/pets'),
    )
    const swaggerCreate = swaggerOutcome.mapped.endpoints.find(
      (endpoint) =>
        endpoint.request.method === 'POST' && endpoint.request.url.endsWith('/pets'),
    )
    const swaggerGet = swaggerOutcome.mapped.endpoints.find((endpoint) =>
      endpoint.request.url.includes('/pets/{{petId}}'),
    )
    const swaggerBody = bodyJson(swaggerCreate?.request.body)
    record(
      'Swagger 2.0 maps base path, body and basic auth',
      swaggerOutcome.mapped.endpoints.length === 3 &&
        swaggerOutcome.contractValid === 3 &&
        swaggerList?.request.query?.[0]?.name === 'limit' &&
        swaggerList.request.query[0].value === '10' &&
        swaggerGet !== undefined &&
        swaggerCreate?.request.auth?.kind === 'basic' &&
        isObject(swaggerBody) &&
        swaggerBody.name === 'Rex',
      `${swaggerOutcome.mapped.endpoints.length} endpoints, ${swaggerCreate?.request.auth?.kind ?? 'none'} auth`,
    )

    /* ---- Policy matrix ---------------------------------------------- */

    const policyCases: ReadonlyArray<{
      label: string
      ref: string
      policy: RemoteRefPolicy
      expected: 'allowed' | 'remote_ref_blocked'
    }> = [
      { label: 'public URL, default', ref: 'https://example.com/x.json#/X', policy: DEFAULT_POLICY, expected: 'remote_ref_blocked' },
      { label: 'loopback, default', ref: 'http://127.0.0.1:1234/x.json#/X', policy: DEFAULT_POLICY, expected: 'remote_ref_blocked' },
      { label: 'loopback, allowLoopback', ref: 'http://127.0.0.1:1234/x.json#/X', policy: makePolicy({ allowLoopback: true }), expected: 'allowed' },
      { label: 'IPv6 loopback, allowLoopback', ref: 'http://[::1]:1234/x.json#/X', policy: makePolicy({ allowLoopback: true }), expected: 'allowed' },
      { label: 'localhost, allowLoopback', ref: 'http://localhost:1234/x.json#/X', policy: makePolicy({ allowLoopback: true }), expected: 'allowed' },
      { label: 'explicit origin', ref: 'https://example.com/x.json#/X', policy: makePolicy({ allowedOrigins: ['https://example.com'] }), expected: 'allowed' },
      { label: 'explicit origin, different port', ref: 'https://example.com:8443/x.json#/X', policy: makePolicy({ allowedOrigins: ['https://example.com'] }), expected: 'remote_ref_blocked' },
      { label: '169.254 even when allowlisted', ref: 'http://169.254.169.254/x#/X', policy: makePolicy({ allowLoopback: true, allowedOrigins: ['http://169.254.169.254'] }), expected: 'remote_ref_blocked' },
      { label: 'metadata.google.internal', ref: 'http://metadata.google.internal/x#/X', policy: makePolicy({ allowedOrigins: ['http://metadata.google.internal'] }), expected: 'remote_ref_blocked' },
      { label: 'file scheme', ref: 'file:///etc/passwd#/X', policy: makePolicy({ allowLoopback: true }), expected: 'remote_ref_blocked' },
      { label: 'credentials in URL', ref: 'http://user:pass@127.0.0.1:1234/x#/X', policy: makePolicy({ allowLoopback: true }), expected: 'remote_ref_blocked' },
      { label: 'private RFC1918', ref: 'http://10.0.0.1/x#/X', policy: makePolicy({ allowLoopback: true }), expected: 'remote_ref_blocked' },
      { label: 'Alibaba metadata', ref: 'http://100.100.100.200/x#/X', policy: makePolicy({ allowLoopback: true }), expected: 'remote_ref_blocked' },
    ]
    for (const testCase of policyCases) {
      let actual: string
      try {
        assertRemoteAllowed(new URL(testCase.ref), testCase.policy, '#/policy-probe')
        actual = 'allowed'
      } catch (error) {
        actual = toErrorInfo(error).code
      }
      policyProbes.push({
        label: testCase.label,
        ref: testCase.ref,
        expected: testCase.expected,
        actual,
        pass: actual === testCase.expected,
      })
    }
    record(
      'SSRF policy matrix',
      policyProbes.every((probe) => probe.pass),
      `${policyProbes.filter((probe) => probe.pass).length}/${policyProbes.length} cases`,
    )
    record(
      'all error messages are single-line and <= 300 chars',
      errors.every((entry) => entry.readable),
      `${errors.filter((entry) => entry.readable).length}/${errors.length} readable`,
    )
    record(
      'real network calls only target the loopback fixture',
      realFetchUrls.every((url) => url.startsWith(origin)),
      `${realFetchCalls} calls, ${new Set(realFetchUrls.map((url) => new URL(url).origin)).size} origins`,
    )

    const pass = checks.every((check) => check.pass)
    const result = {
      generatedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      budgets: {
        importBudgetMs: IMPORT_BUDGET_MS,
        documentBytes: OPENAPI_MAX_DOCUMENT_BYTES,
        operations: OPENAPI_MAX_OPERATIONS,
        remoteBytes: OPENAPI_MAX_REMOTE_BYTES,
        remoteDocuments: OPENAPI_MAX_REMOTE_DOCUMENTS,
        exampleBytes: EXAMPLE_MAX_BYTES,
      },
      sample: {
        paths: 100,
        endpoints: first.endpoints,
        documentBytes: first.documentBytes,
        requestJsonBytes: first.requestJsonBytes,
        timing: {
          cold: first.timings,
          warm: {
            total: warmTotal,
            parse: parseSummary,
            map: mapSummary,
            serialize: serializeSummary,
          },
          allRuns: allTotal,
        },
        stats: first.stats,
        groups: first.groups,
        globalWarnings: first.globalWarnings,
        samples: endpoints.slice(0, 3).map((endpoint) => ({
          id: endpoint.id,
          name: endpoint.name,
          group: endpoint.group,
          request: endpoint.request,
          warnings: endpoint.warnings,
        })),
      },
      scaling,
      cycle: {
        endpoints: cycleOutcome.mapped.endpoints.length,
        contractValid: cycleOutcome.contractValid,
        pureError,
        pureWarnings: pureEndpoint?.warnings ?? [],
        nodeBody: nodeText,
        aBody:
          aEndpoint?.request.body?.kind === 'json' ? aEndpoint.request.body.text : null,
      },
      remote: {
        blocked: blockedError,
        loopback: {
          fetches: 1,
          documentsFetched: loopbackOutcome.bundle.documentsFetched,
          body: loopbackBody,
        },
        dedupe: {
          endpoints: twoRefOutcome.mapped.endpoints.length,
          documentsFetched: twoRefOutcome.bundle.documentsFetched,
        },
        allowlist: { fakeFetchCalls, body: fakeBody },
        redirect: redirectError,
        tooLarge: { contentLength: bigError, chunked: chunkedError },
        badJson: badJsonError,
        missing: missingDocError,
      },
      swagger2: {
        endpoints: swaggerOutcome.mapped.endpoints.length,
        contractValid: swaggerOutcome.contractValid,
        urls: swaggerOutcome.mapped.endpoints.map((endpoint) => endpoint.request.url),
      },
      policy: policyProbes,
      errors,
      checks,
      network: {
        realFetchCalls,
        realFetchOrigins: [...new Set(realFetchUrls.map((url) => new URL(url).origin))],
        fixtureRequests: refServer.requests,
      },
      pass,
    }
    await writeFile(RESULTS_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8')

    console.log(`[checks] ${checks.filter((check) => check.pass).length}/${checks.length} pass`)
    console.log(`overall: ${pass ? 'PASS' : 'FAIL'}`)
    console.log(`results -> ${RESULTS_PATH}`)
    if (!pass) process.exitCode = 1
  } finally {
    if (refServer !== null) {
      const server = refServer.server
      server.closeAllConnections()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
      serverClosed = true
    }
    console.log(`[cleanup] fixture server closed: ${serverClosed}`)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
