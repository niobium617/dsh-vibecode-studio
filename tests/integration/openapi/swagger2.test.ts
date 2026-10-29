/**
 * T042 Swagger 2.0: `host`/`basePath`/`schemes`, body and formData parameters,
 * `basic`/`apiKey` security definitions and the multipart file warning.
 */
import { describe, expect, it } from 'vitest'
import { isApiCollection, isHttpRequestSpec } from '../../../src/contracts'
import { importOpenApi } from '../../../src/host/api/openapi/mapper'

const DOC = {
  swagger: '2.0',
  info: { title: 'Legacy API', version: '1.0.0' },
  host: 'legacy.example.com',
  basePath: '/api',
  schemes: ['https'],
  consumes: ['application/json'],
  securityDefinitions: {
    basicAuth: { type: 'basic' },
    keyAuth: { type: 'apiKey', name: 'api_key', in: 'query' },
  },
  paths: {
    '/items/{id}': {
      get: {
        tags: ['items'],
        summary: 'Read item',
        operationId: 'readItem',
        security: [{ basicAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, type: 'string' },
          { name: 'expand', in: 'query', type: 'boolean' },
        ],
      },
    },
    '/items': {
      post: {
        tags: ['items'],
        summary: 'Create item',
        operationId: 'createItem',
        security: [{ keyAuth: [] }],
        consumes: ['application/x-www-form-urlencoded'],
        parameters: [
          { name: 'title', in: 'formData', required: true, type: 'string' },
          { name: 'qty', in: 'formData', type: 'integer' },
        ],
      },
    },
    '/upload': {
      post: {
        tags: ['files'],
        operationId: 'upload',
        consumes: ['multipart/form-data'],
        parameters: [
          { name: 'file', in: 'formData', required: true, type: 'file' },
          { name: 'label', in: 'formData', type: 'string' },
        ],
      },
    },
    '/json': {
      post: {
        tags: ['items'],
        operationId: 'sendJson',
        parameters: [
          {
            name: 'payload',
            in: 'body',
            required: true,
            schema: {
              type: 'object',
              properties: { name: { type: 'string' }, count: { type: 'integer' } },
            },
          },
        ],
      },
    },
  },
}

async function importDoc(): Promise<Awaited<ReturnType<typeof importOpenApi>>> {
  return importOpenApi(JSON.stringify(DOC), { fetch: null })
}

function findByOperation(
  result: Awaited<ReturnType<typeof importOpenApi>>,
  id: string,
): Awaited<ReturnType<typeof importOpenApi>>['endpoints'][number] {
  const found = result.endpoints.find((endpoint) => endpoint.id === id.toLowerCase())
  if (found === undefined) throw new Error(`endpoint ${id} is missing`)
  return found
}

describe('importOpenApi (Swagger 2.0)', () => {
  it('builds the base URL from host, basePath and schemes', async () => {
    const result = await importDoc()
    expect(result.version).toBe('2')
    expect(result.title).toBe('Legacy API')
    expect(result.endpoints).toHaveLength(4)
    expect(result.groups).toEqual(['items', 'files'])
    expect(isApiCollection(result.collection)).toBe(true)
    const read = findByOperation(result, 'readItem')
    expect(read.request.url).toBe('https://legacy.example.com/api/items/{{id}}')
    expect(read.request.query).toEqual([{ name: 'expand', value: '', enabled: false }])
    expect(isHttpRequestSpec(read.request)).toBe(true)
  })

  it('maps basic auth to username and password placeholders', async () => {
    const result = await importDoc()
    expect(findByOperation(result, 'readItem').request.auth).toEqual({
      kind: 'basic',
      username: '{{basicAuthUser}}',
      password: '{{basicAuthPassword}}',
    })
  })

  it('maps an apiKey definition and formData fields', async () => {
    const result = await importDoc()
    const create = findByOperation(result, 'createItem')
    expect(create.request.auth).toEqual({
      kind: 'api-key',
      name: 'api_key',
      value: '{{keyAuth}}',
      in: 'query',
    })
    expect(create.request.body).toEqual({
      kind: 'form',
      fields: [
        { name: 'title', value: 'string', enabled: true },
        // Optional fields without a default stay empty and disabled.
        { name: 'qty', value: '', enabled: false },
      ],
    })
  })

  it('warns about multipart file fields instead of emitting them', async () => {
    const result = await importDoc()
    const upload = findByOperation(result, 'upload')
    expect(upload.request.body).toEqual({
      kind: 'multipart',
      fields: [{ name: 'label', value: '', enabled: false }],
      files: [],
    })
    expect(upload.warnings).toContain('multipart_file_unsupported:file')
    expect(upload.group).toBe('files')
  })

  it('uses the consumes preference and a generated JSON body for body parameters', async () => {
    const result = await importDoc()
    const send = findByOperation(result, 'sendJson')
    expect(send.request.body).toEqual({
      kind: 'json',
      text: JSON.stringify({ name: 'string', count: 0 }),
    })
    expect(isHttpRequestSpec(send.request)).toBe(true)
  })

  it('falls back to {{baseUrl}} when the host is missing', async () => {
    const withoutHost: Record<string, unknown> = { ...DOC }
    delete withoutHost.host
    const result = await importOpenApi(JSON.stringify(withoutHost), { fetch: null })
    expect(result.warnings).toContain('missing_host')
    expect(findByOperation(result, 'readItem').request.url).toBe(
      '{{baseUrl}}/api/items/{{id}}',
    )
  })
})
