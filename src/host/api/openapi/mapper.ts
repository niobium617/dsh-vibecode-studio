/**
 * OpenAPI → `HttpRequestSpec` mapper (T042).
 *
 * One operation becomes one saved request. The mapper never sends anything:
 * path parameters become `{{name}}` placeholders, auth schemes become
 * `{{scheme}}` placeholders, optional rows start disabled, and server
 * variables fall back to `{{name}}` when the document gives no default.
 * Examples come from `example` → `const` → `default` → `enum[0]` → `allOf`
 * merge → `oneOf`/`anyOf` first → type defaults, bounded in depth, ref stack,
 * node count, per-body bytes and a document-wide budget so the result always
 * fits a collection file.
 *
 * Every mapped request is validated with the real `isHttpRequestSpec`; a
 * request that fails is counted in `skipped`, never returned half-built.
 */
import {
  API_COLLECTION_ITEMS_MAX,
  HTTP_HEADERS_MAX,
  HTTP_PARAMS_MAX,
  HTTP_URL_CHARS_MAX,
  isApiCollection,
  isApiEnvironmentVariableName,
  isApiStoreId,
  isHttpRequestSpec,
  type ApiCollection,
  type ApiCollectionFolder,
  type ApiSavedRequest,
  type HttpAuth,
  type HttpKeyValue,
  type HttpMethod,
  type HttpRequestBody,
  type HttpRequestSpec,
} from '../../../contracts/api'
import {
  OpenApiError,
  isJsonObject,
  parseOpenApiDocument,
  shortText,
  type JsonObject,
  type OpenApiVersion,
  type ParsedOpenApi,
  type ParsedOperation,
} from './parser'
import {
  OpenApiRefResolver,
  bundleRemoteRefs,
  defaultOpenApiFetch,
  resolveRemotePolicy,
  type DerefResult,
  type OpenApiFetch,
  type OpenApiRemotePolicyOptions,
} from './resolver'

/** Example bodies for one document share this budget, keeping files savable. */
export const OPENAPI_IMPORT_BODY_BUDGET_BYTES = 512 * 1024

const EXAMPLE_MAX_DEPTH = 8
const EXAMPLE_MAX_REF_DEPTH = 6
const EXAMPLE_MAX_NODES = 2_000
const EXAMPLE_MAX_BYTES = 4 * 1024
const EXAMPLE_MAX_ARRAY_ITEMS = 2
const EXAMPLE_MAX_PROPERTIES = 25

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

/* -------------------------------------------------------------------------
 * Example generation
 * ---------------------------------------------------------------------- */

interface ExampleContext {
  readonly resolver: OpenApiRefResolver
  readonly stack: string[]
  nodes: number
}

function createExampleContext(resolver: OpenApiRefResolver): ExampleContext {
  return { resolver, stack: [], nodes: 0 }
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
  if (!isJsonObject(node)) return undefined
  if (ctx.nodes >= EXAMPLE_MAX_NODES) return undefined
  ctx.nodes += 1

  // A literal example wins over everything; it is data, never dereferenced.
  if (node.example !== undefined) return node.example
  if (node.const !== undefined) return node.const
  if (node.default !== undefined) return node.default
  if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0]

  if (Array.isArray(node.allOf)) {
    const merged: JsonObject = {}
    for (const branch of node.allOf) {
      const value = exampleFromSchema(branch, baseUrl, depth + 1, ctx)
      if (isJsonObject(value)) Object.assign(merged, value)
    }
    const rest: JsonObject = { ...node }
    delete rest.allOf
    const own = exampleFromResolved(rest, baseUrl, depth, ctx)
    if (isJsonObject(own)) Object.assign(merged, own)
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
    for (let index = 0; index < EXAMPLE_MAX_ARRAY_ITEMS; index += 1) {
      const value = exampleFromSchema(node.items, baseUrl, depth + 1, ctx)
      if (value !== undefined) values.push(value)
    }
    return values
  }

  if (type === 'object' || isJsonObject(node.properties)) {
    const properties = isJsonObject(node.properties) ? node.properties : {}
    const output: JsonObject = {}
    let count = 0
    for (const [name, property] of Object.entries(properties)) {
      if (count >= EXAMPLE_MAX_PROPERTIES) break
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
  if (depth > EXAMPLE_MAX_DEPTH) return undefined
  const hit = ctx.resolver.deref(schema, baseUrl)
  let pushed = false
  if (hit.refKey !== undefined) {
    // A structural cycle stops at the first repeated schema; the object so far
    // is still valid and readable.
    if (ctx.stack.includes(hit.refKey)) return undefined
    if (ctx.stack.length >= EXAMPLE_MAX_REF_DEPTH) return undefined
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
 * Small value helpers
 * ---------------------------------------------------------------------- */

function sanitizeVariableName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z_]+/, '')
  return cleaned === '' ? 'value' : cleaned
}

function variableName(name: string): string {
  return isApiEnvironmentVariableName(name) ? name : sanitizeVariableName(name)
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

function firstExampleValue(
  examples: unknown,
  resolver: OpenApiRefResolver,
  baseUrl: string,
): unknown {
  if (!isJsonObject(examples)) return undefined
  for (const candidate of Object.values(examples)) {
    if (!isJsonObject(candidate)) continue
    if (candidate.value !== undefined) return candidate.value
    if (typeof candidate.$ref === 'string') {
      try {
        const resolved = resolver.deref(candidate, baseUrl).value
        if (isJsonObject(resolved) && resolved.value !== undefined) return resolved.value
      } catch (error) {
        if (!(error instanceof OpenApiError)) throw error
      }
    }
  }
  return undefined
}

/* -------------------------------------------------------------------------
 * Request bodies
 * ---------------------------------------------------------------------- */

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
  resolver: OpenApiRefResolver,
  baseUrl: string,
): ReadonlySet<string> {
  const names = new Set<string>()
  try {
    const hit = resolver.deref(schema, baseUrl)
    const node = isJsonObject(hit.value) ? hit.value : {}
    const properties = isJsonObject(node.properties) ? node.properties : {}
    for (const [name, property] of Object.entries(properties)) {
      const propertyHit = resolver.deref(property, hit.baseUrl)
      if (isJsonObject(propertyHit.value) && propertyHit.value.format === 'binary') {
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
  resolver: OpenApiRefResolver,
  ctx: ExampleContext,
): BodyOutcome {
  const media = isJsonObject(mediaRaw) ? mediaRaw : {}
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
    if (Buffer.byteLength(text) > EXAMPLE_MAX_BYTES) return noneBody(['example_too_large'])
    return { body: { kind: 'json', text }, warnings: [], bytes: Buffer.byteLength(text) }
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
    if (isJsonObject(example)) {
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

/* -------------------------------------------------------------------------
 * Parameters and auth
 * ---------------------------------------------------------------------- */

interface ParameterHit {
  readonly param: JsonObject
  readonly baseUrl: string
}

function collectParameters(
  entry: ParsedOperation,
  resolver: OpenApiRefResolver,
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
    if (!isJsonObject(hit.value)) {
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
      // Operation-level parameters override path-item ones.
      params[existing] = { param: hit.value, baseUrl: hit.baseUrl }
    }
  }

  return { params, warnings }
}

function paramExample(
  param: JsonObject,
  baseUrl: string,
  resolver: OpenApiRefResolver,
  required: boolean,
  ctx: ExampleContext,
): unknown {
  if (param.example !== undefined) return param.example
  if (isJsonObject(param.examples)) {
    for (const candidate of Object.values(param.examples)) {
      if (isJsonObject(candidate) && candidate.value !== undefined) return candidate.value
    }
  }

  const schemaRaw = isJsonObject(param.schema) ? param.schema : param
  const schemaHit = resolver.deref(schemaRaw, baseUrl)
  const schema = isJsonObject(schemaHit.value) ? schemaHit.value : {}
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
  parsed: ParsedOpenApi,
  operation: JsonObject,
  resolver: OpenApiRefResolver,
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
  if (!isJsonObject(requirement)) {
    warnings.push('invalid_security_requirement')
    return { auth: { kind: 'none' }, warnings }
  }
  const names = Object.keys(requirement)
  if (names.length === 0) return { auth: { kind: 'none' }, warnings }
  if (names.length > 1) warnings.push('multiple_security_schemes')

  const name = names[0]!
  const schemes =
    parsed.version === '3'
      ? isJsonObject(root.components) && isJsonObject(root.components.securitySchemes)
        ? root.components.securitySchemes
        : {}
      : isJsonObject(root.securityDefinitions)
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
  if (!isJsonObject(scheme)) {
    warnings.push(`invalid_security_scheme:${name}`)
    return { auth: { kind: 'none' }, warnings }
  }

  const variable = variableName(name)
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

/* -------------------------------------------------------------------------
 * Bodies (Swagger 2.0 body/formData parameters)
 * ---------------------------------------------------------------------- */

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
  parsed: ParsedOpenApi,
  params: readonly ParameterHit[],
  resolver: OpenApiRefResolver,
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
    if (!isJsonObject(bodyHit.value)) return noneBody(['invalid_request_body'])
    const content = isJsonObject(bodyHit.value.content) ? bodyHit.value.content : null
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

/* -------------------------------------------------------------------------
 * Servers and URLs
 * ---------------------------------------------------------------------- */

interface ServerResolution {
  /** Never empty: a missing server becomes a `{{baseUrl}}` placeholder. */
  readonly baseUrl: string
  readonly warnings: readonly string[]
}

function placeholderBase(url: string): string {
  if (url === '') return '{{baseUrl}}'
  if (/^https?:\/\//i.test(url)) return url
  return `{{baseUrl}}${url.startsWith('/') ? url : `/${url}`}`
}

function resolveServerUrl(parsed: ParsedOpenApi): ServerResolution {
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
      return { baseUrl: placeholderBase(basePath), warnings }
    }
    const scheme = schemes.includes('https') ? 'https' : (schemes[0] ?? 'https')
    if (scheme !== 'http' && scheme !== 'https') warnings.push(`unsupported_scheme:${scheme}`)
    return { baseUrl: `${scheme}://${host}${basePath}`.replace(/\/+$/, ''), warnings }
  }

  const servers = Array.isArray(root.servers) ? root.servers.filter(isJsonObject) : []
  if (servers.length === 0) {
    warnings.push('missing_server')
    return { baseUrl: '{{baseUrl}}', warnings }
  }
  if (servers.length > 1) warnings.push('multiple_servers')
  const server = servers[0]!
  const rawUrl = typeof server.url === 'string' ? server.url.trim() : ''
  if (rawUrl === '') {
    warnings.push('empty_server_url')
    return { baseUrl: '{{baseUrl}}', warnings }
  }

  const variables = isJsonObject(server.variables) ? server.variables : {}
  const url = rawUrl.replace(/\{([^{}]+)\}/g, (_match, rawName: string) => {
    const name = rawName.trim()
    const variable = variables[name]
    if (isJsonObject(variable)) {
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
    return `{{${variableName(name)}}}`
  })

  if (!/^https?:\/\//i.test(url)) warnings.push('relative_server')
  return { baseUrl: placeholderBase(url.replace(/\/+$/, '')), warnings }
}

function joinUrl(base: string, path: string): string {
  if (base === '') return path
  const left = base.replace(/\/+$/, '')
  return `${left}${path.startsWith('/') ? path : `/${path}`}`
}

function storeIdFrom(text: string, fallback: string): string {
  const id = text
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[-.]+$/, '')
    .slice(0, 64)
  return isApiStoreId(id) ? id : fallback
}

function makeId(base: string, used: Set<string>, fallback: string): string {
  let candidate = storeIdFrom(base, fallback)
  if (candidate === '') candidate = fallback
  let suffix = 2
  while (used.has(candidate)) {
    const tail = `-${suffix}`
    suffix += 1
    candidate = `${candidate.slice(0, 64 - tail.length)}${tail}`
  }
  used.add(candidate)
  return candidate
}

/* -------------------------------------------------------------------------
 * Mapping
 * ---------------------------------------------------------------------- */

export interface OpenApiEndpoint {
  readonly id: string
  readonly name: string
  /** First tag, or `default`. */
  readonly group: string
  readonly method: HttpMethod
  /** Document path, e.g. `/pets/{id}`. */
  readonly path: string
  readonly request: HttpRequestSpec
  readonly warnings: readonly string[]
}

export interface OpenApiImportOptions extends OpenApiRemotePolicyOptions {
  /** Collection id; defaults to a slug of the document title. */
  readonly id?: string
  /** Collection name; defaults to `info.title`. */
  readonly name?: string
  /** Injected for tests; defaults to the global fetch. `null` disables fetching. */
  readonly fetch?: OpenApiFetch | null
}

export interface OpenApiImportResult {
  readonly version: OpenApiVersion
  readonly title: string
  readonly groups: readonly string[]
  readonly endpoints: readonly OpenApiEndpoint[]
  /** Document-level warnings (server, security). */
  readonly warnings: readonly string[]
  /** Operations that could not be turned into a valid request. */
  readonly skipped: number
  /** Ready for `ApiCollectionStore.save`; placeholders stay as `{{name}}`. */
  readonly collection: ApiCollection
  /** Absolute URLs of remote documents that were actually fetched. */
  readonly remoteDocuments: readonly string[]
}

interface MapResult {
  readonly endpoints: readonly OpenApiEndpoint[]
  readonly groups: readonly string[]
  readonly globalWarnings: readonly string[]
  readonly skipped: number
}

function mapDocument(parsed: ParsedOpenApi, resolver: OpenApiRefResolver): MapResult {
  const globalWarnings: string[] = []
  const server = resolveServerUrl(parsed)
  globalWarnings.push(...server.warnings)

  const endpoints: OpenApiEndpoint[] = []
  const groups = new Set<string>()
  const usedIds = new Set<string>()
  let skipped = 0
  let bodyBudget = OPENAPI_IMPORT_BODY_BUDGET_BYTES

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
      if (bodyOutcome.bytes > bodyBudget) {
        warnings.push('example_budget_exceeded')
      } else {
        body = bodyOutcome.body
        bodyBytes = bodyOutcome.bytes
        bodyBudget -= bodyBytes
      }
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
      const variable = variableName(name)
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
      continue
    }

    const request: HttpRequestSpec = { method: entry.method, url, query, headers, body, auth }
    if (!isHttpRequestSpec(request)) {
      warnings.push('invalid_request_spec')
      skipped += 1
      continue
    }

    const summary = typeof entry.operation.summary === 'string' ? entry.operation.summary.trim() : ''
    const operationId =
      typeof entry.operation.operationId === 'string' ? entry.operation.operationId.trim() : ''
    const name = (summary || operationId || `${entry.method} ${entry.path}`).slice(0, 200)
    const rawId = operationId || `${entry.method.toLowerCase()}_${entry.path}`
    const id = makeId(rawId, usedIds, 'endpoint')
    const tags = entry.operation.tags
    const group =
      Array.isArray(tags) && typeof tags[0] === 'string' && tags[0].trim() !== ''
        ? tags[0].trim().slice(0, 100)
        : 'default'

    endpoints.push({
      id,
      name,
      group,
      method: entry.method,
      path: entry.path,
      request,
      warnings: [...new Set(warnings)],
    })
    groups.add(group)
  }

  return { endpoints, groups: [...groups], globalWarnings, skipped }
}

/**
 * Packs endpoints into the T037 collection shape: one folder per tag so the
 * panel can render groups without another file format. A tag with more
 * requests than `API_COLLECTION_ITEMS_MAX` is split into numbered folders ("(2)",
 * "(3)") because the collection guard caps one folder at 200 entries. Request
 * ids are unique across the collection.
 */
function buildCollection(
  endpoints: readonly OpenApiEndpoint[],
  groups: readonly string[],
  id: string,
  name: string,
): ApiCollection {
  const usedFolderIds = new Set<string>()
  const folders: ApiCollectionFolder[] = []
  for (const group of groups) {
    const requests: ApiSavedRequest[] = endpoints
      .filter((endpoint) => endpoint.group === group)
      .map((endpoint) => ({ id: endpoint.id, name: endpoint.name, request: endpoint.request }))
    if (requests.length === 0) continue
    for (let start = 0; start < requests.length; start += API_COLLECTION_ITEMS_MAX) {
      const part = Math.floor(start / API_COLLECTION_ITEMS_MAX)
      folders.push({
        id: makeId(`group-${group}`, usedFolderIds, 'group'),
        name: part === 0 ? group : `${group} (${part + 1})`,
        requests: requests.slice(start, start + API_COLLECTION_ITEMS_MAX),
      })
    }
  }
  return { id, name, folders }
}

function documentTitle(parsed: ParsedOpenApi): string {
  const info = parsed.root.info
  if (!isJsonObject(info)) return ''
  return typeof info.title === 'string' ? info.title.trim().slice(0, 200) : ''
}

/**
 * Parses, bundles remote refs under the SSRF policy and maps every operation.
 * Throws `OpenApiError` with a stable code for an unusable document; returns
 * warnings and `skipped` for partial loss.
 */
export async function importOpenApi(
  text: string,
  options: OpenApiImportOptions = {},
): Promise<OpenApiImportResult> {
  const policy = resolveRemotePolicy(options)
  const parsed = parseOpenApiDocument(text)
  const fetchImpl = options.fetch === undefined ? defaultOpenApiFetch() : options.fetch
  const bundle = await bundleRemoteRefs(parsed, policy, fetchImpl)
  const resolver = new OpenApiRefResolver(parsed.root, bundle.documents, policy)
  const mapped = mapDocument(parsed, resolver)

  const title = documentTitle(parsed) || 'OpenAPI import'
  const collectionName = options.name?.trim() || title
  if (collectionName.length > 200) {
    throw new OpenApiError('invalid_options', 'collection name is longer than 200 characters')
  }
  const collectionId = options.id ?? storeIdFrom(title, 'openapi-import')
  if (!isApiStoreId(collectionId)) {
    throw new OpenApiError(
      'invalid_options',
      `"${shortText(collectionId, 64)}" is not a usable collection id`,
    )
  }

  const collection = buildCollection(mapped.endpoints, mapped.groups, collectionId, collectionName)
  if (!isApiCollection(collection)) {
    // A bug guard, not a user error: every request passed `isHttpRequestSpec`.
    throw new OpenApiError('invalid_document', 'imported collection failed validation')
  }

  return {
    version: parsed.version,
    title,
    groups: mapped.groups,
    endpoints: mapped.endpoints,
    warnings: mapped.globalWarnings,
    skipped: mapped.skipped,
    collection,
    remoteDocuments: bundle.fetched,
  }
}
