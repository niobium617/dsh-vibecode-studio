/**
 * OpenAPI 3.x / Swagger 2.0 parsing (T042).
 *
 * The importer is split into parse → bundle → map so the network decision is
 * made *before* any I/O (see `spikes/s7/REPORT.md` §7). This module owns the
 * document-shape checks, the operation inventory and the structural `$ref`
 * scan. It never fetches: remote references are collected as
 * `OpenApiExternalRef` values and the resolver applies the SSRF policy.
 *
 * Values inside `example`, `default`, `enum`, `const`, `examples[*].value` and
 * `x-*` extensions are data, not schema; a `$ref` string there is never
 * followed and never counted as a remote reference.
 */
import type { HttpMethod } from '../../../contracts/api'

export const OPENAPI_MAX_DOCUMENT_BYTES = 8 * 1024 * 1024
export const OPENAPI_MAX_OPERATIONS = 1_000
export const OPENAPI_MAX_TRAVERSAL_DEPTH = 128
export const OPENAPI_MAX_TRAVERSAL_NODES = 500_000
export const OPENAPI_MAX_REF_DEPTH = 32

export const OPENAPI_METHODS = [
  'get',
  'head',
  'post',
  'put',
  'patch',
  'delete',
  'options',
] as const

export type OpenApiVersion = '3' | '2'

export type OpenApiErrorCode =
  | 'invalid_json'
  | 'invalid_document'
  | 'invalid_options'
  | 'document_too_large'
  | 'too_many_operations'
  | 'ref_unresolved'
  | 'ref_cycle'
  | 'remote_ref_blocked'
  | 'remote_ref_redirect'
  | 'remote_ref_too_large'
  | 'remote_ref_failed'

/** Import failures are typed and single-line: the panel shows `message` as-is. */
export class OpenApiError extends Error {
  readonly code: OpenApiErrorCode
  readonly pointer: string | undefined

  constructor(code: OpenApiErrorCode, message: string, pointer?: string) {
    super(message)
    this.name = 'OpenApiError'
    this.code = code
    this.pointer = pointer
  }
}

export type JsonObject = Record<string, unknown>

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

/** Collapses whitespace so messages stay one readable line. */
export function shortText(value: string, max = 140): string {
  const single = value.replace(/[\r\n]+/g, ' ')
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`
}

export function locationText(location: string | undefined): string {
  return location === undefined || location === '' ? '' : ` (at ${shortText(location, 100)})`
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

function decodePointerSegment(raw: string, ref: string, location: string | undefined): string {
  let decoded: string
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    throw new OpenApiError(
      'ref_unresolved',
      `$ref ${JSON.stringify(shortText(ref, 100))} has invalid percent-encoding in "${shortText(raw, 40)}"${locationText(location)}`,
      location,
    )
  }
  // RFC 6901: `~1` is `/` and `~0` is `~`; the order matters.
  return decoded.replace(/~1/g, '/').replace(/~0/g, '~')
}

/** Resolves a JSON Pointer (RFC 6901) against `root`; failures name the ref. */
export function lookupPointer(
  root: unknown,
  pointer: string,
  ref: string,
  location: string | undefined,
): unknown {
  if (pointer === '') return root
  if (!pointer.startsWith('/')) {
    throw new OpenApiError(
      'ref_unresolved',
      `$ref ${JSON.stringify(shortText(ref, 100))} has a fragment that is not a JSON Pointer${locationText(location)}`,
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
          `$ref ${JSON.stringify(shortText(ref, 100))} needs an array index at "${shortText(walked, 60)}"${locationText(location)}`,
          location,
        )
      }
      const index = Number(segment)
      if (index >= current.length) {
        throw new OpenApiError(
          'ref_unresolved',
          `$ref ${JSON.stringify(shortText(ref, 100))} points past the array end at "${shortText(walked, 60)}"${locationText(location)}`,
          location,
        )
      }
      current = current[index]
      continue
    }
    if (!isJsonObject(current)) {
      throw new OpenApiError(
        'ref_unresolved',
        `$ref ${JSON.stringify(shortText(ref, 100))} cannot descend into ${typeName(current)} at "${shortText(walked, 60)}"${locationText(location)}`,
        location,
      )
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new OpenApiError(
        'ref_unresolved',
        `$ref ${JSON.stringify(shortText(ref, 100))} cannot be resolved: "${shortText(segment, 40)}" does not exist${locationText(location)}`,
        location,
      )
    }
    current = current[segment]
  }
  return current
}

/* -------------------------------------------------------------------------
 * Structural scan
 * ---------------------------------------------------------------------- */

export interface OpenApiExternalRef {
  readonly ref: string
  readonly pointer: string
}

interface ScanFrame {
  readonly value: unknown
  readonly pointer: string
  readonly depth: number
  readonly mode: 'doc' | 'example'
  /** True while visiting the entries of an `examples` map. */
  readonly inExamplesMap: boolean
}

export interface OpenApiScanResult {
  readonly refs: number
  readonly externalRefs: readonly OpenApiExternalRef[]
}

/**
 * Walks a document iteratively (so deep documents cannot overflow the stack)
 * and validates every structural local `$ref` before any mapping happens.
 * Remote refs are only *collected* here; whether they may be fetched is the
 * resolver's policy decision.
 */
export function scanRefs(root: unknown, label: string): OpenApiScanResult {
  const stack: ScanFrame[] = [
    { value: root, pointer: '', depth: 0, mode: 'doc', inExamplesMap: false },
  ]
  const externalRefs: OpenApiExternalRef[] = []
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
    if (!isJsonObject(frame.value)) continue

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
        // Fail with a readable error before the mapper ever touches the ref.
        lookupPointer(root, ref.slice(1), ref, frame.pointer || '#')
      } else {
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
 * Document parsing
 * ---------------------------------------------------------------------- */

export interface ParsedOperation {
  readonly method: HttpMethod
  readonly path: string
  readonly pathItem: JsonObject
  readonly operation: JsonObject
}

export interface ParsedOpenApi {
  readonly root: JsonObject
  readonly version: OpenApiVersion
  readonly operations: readonly ParsedOperation[]
  readonly externalRefs: readonly OpenApiExternalRef[]
  readonly refs: number
  readonly bytes: number
}

function validateVersion(root: JsonObject): OpenApiVersion {
  if (typeof root.openapi === 'string') {
    if (!/^3\.\d+\.\d+(-[A-Za-z0-9.]+)?$/.test(root.openapi.trim())) {
      throw new OpenApiError(
        'invalid_document',
        `unsupported OpenAPI version ${JSON.stringify(shortText(root.openapi, 30))}; expected 3.x`,
      )
    }
    return '3'
  }
  if (typeof root.swagger === 'string' && root.swagger.trim() === '2.0') return '2'
  throw new OpenApiError(
    'invalid_document',
    'document has neither "openapi" (3.x) nor "swagger": "2.0"',
  )
}

function collectOperations(paths: JsonObject): ParsedOperation[] {
  const operations: ParsedOperation[] = []
  for (const [path, pathItemRaw] of Object.entries(paths)) {
    if (path.startsWith('x-')) continue
    if (!path.startsWith('/')) {
      throw new OpenApiError(
        'invalid_document',
        `path ${JSON.stringify(shortText(path, 60))} must start with "/"`,
        `#/paths/${escapePointerSegment(path)}`,
      )
    }
    if (!isJsonObject(pathItemRaw)) {
      throw new OpenApiError(
        'invalid_document',
        `path item ${shortText(path, 60)} must be an object`,
        `#/paths/${escapePointerSegment(path)}`,
      )
    }
    if (typeof pathItemRaw.$ref === 'string') {
      throw new OpenApiError(
        'invalid_document',
        `path-item $ref is not supported by this importer; inline ${shortText(path, 60)}`,
        `#/paths/${escapePointerSegment(path)}`,
      )
    }
    for (const method of OPENAPI_METHODS) {
      const operation = pathItemRaw[method]
      if (operation === undefined) continue
      if (!isJsonObject(operation)) {
        throw new OpenApiError(
          'invalid_document',
          `operation ${method.toUpperCase()} ${shortText(path, 60)} must be an object`,
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
  return operations
}

/**
 * Parses one JSON document and inventories its operations. Remote `$ref`s are
 * collected but not fetched; a document with a remote ref still parses even
 * when the policy will later refuse it.
 */
export function parseOpenApiDocument(text: string): ParsedOpenApi {
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
      `OpenAPI document is not valid JSON: ${shortText(errorMessage(error), 120)}`,
    )
  }
  if (!isJsonObject(root)) {
    throw new OpenApiError('invalid_document', 'OpenAPI document must be a JSON object')
  }

  const version = validateVersion(root)
  if (!isJsonObject(root.info)) {
    throw new OpenApiError('invalid_document', 'OpenAPI document is missing the info object')
  }
  if (!isJsonObject(root.paths)) {
    throw new OpenApiError('invalid_document', 'OpenAPI document is missing the paths object')
  }

  const scan = scanRefs(root, 'OpenAPI document')
  const operations = collectOperations(root.paths)

  if (operations.length > OPENAPI_MAX_OPERATIONS) {
    throw new OpenApiError(
      'too_many_operations',
      `OpenAPI document declares ${operations.length} operations; the limit is ${OPENAPI_MAX_OPERATIONS}`,
    )
  }
  if (operations.length === 0) {
    throw new OpenApiError('invalid_document', 'OpenAPI document has no supported operations')
  }

  return {
    root,
    version,
    operations,
    externalRefs: scan.externalRefs,
    refs: scan.refs,
    bytes,
  }
}
