/**
 * T042 OpenAPI 3.x import: tags become folders, path parameters become
 * `{{name}}` placeholders, examples become request bodies, unsupported pieces
 * are warnings rather than failures, and the result is a contract-valid
 * collection.
 */
import { describe, expect, it, vi } from 'vitest'
import { isApiCollection, isHttpRequestSpec, type HttpRequestSpec } from '../../../src/contracts'
import { importOpenApi } from '../../../src/host/api/openapi/mapper'
import type { OpenApiFetch } from '../../../src/host/api/openapi/resolver'

const DOC = {
  openapi: '3.0.3',
  info: { title: 'Pet Store', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/pets/{petId}': {
      get: {
        tags: ['pets'],
        summary: 'Get a pet',
        operationId: 'getPet',
        parameters: [
          { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
          {
            name: 'X-Trace',
            in: 'header',
            schema: { type: 'string', default: 'trace-default' },
          },
          { name: 'session', in: 'cookie', schema: { type: 'string' } },
          { name: 'verbose', in: 'query', schema: { type: 'boolean' } },
        ],
      },
      post: {
        tags: ['pets'],
        summary: 'Create pet',
        operationId: 'createPet',
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/health': { get: { operationId: 'health' } },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          age: { type: 'integer', minimum: 1 },
          tag: { type: 'string', example: 'cat' },
        },
      },
    },
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
  },
}

async function importDoc(): Promise<Awaited<ReturnType<typeof importOpenApi>>> {
  return importOpenApi(JSON.stringify(DOC), { fetch: null })
}

function requestOf(
  result: Awaited<ReturnType<typeof importOpenApi>>,
  method: string,
  path: string,
): HttpRequestSpec {
  const found = result.endpoints.find(
    (endpoint) => endpoint.method === method && endpoint.path === path,
  )
  if (found === undefined) throw new Error(`endpoint ${method} ${path} is missing`)
  return found.request
}

describe('importOpenApi (OpenAPI 3.x)', () => {
  it('maps metadata, tags and the base URL', async () => {
    const result = await importDoc()
    expect(result.version).toBe('3')
    expect(result.title).toBe('Pet Store')
    expect(result.endpoints).toHaveLength(3)
    expect(result.groups).toEqual(['pets', 'default'])
    expect(result.skipped).toBe(0)
    expect(result.collection.id).toBe('pet-store')
    expect(result.collection.name).toBe('Pet Store')
    expect(isApiCollection(result.collection)).toBe(true)
    for (const endpoint of result.endpoints) {
      expect(isHttpRequestSpec(endpoint.request), endpoint.id).toBe(true)
    }
  })

  it('turns path parameters into {{placeholders}} and keeps optional rows disabled', async () => {
    const request = requestOf(await importDoc(), 'GET', '/pets/{petId}')
    expect(request.method).toBe('GET')
    expect(request.url).toBe('https://api.example.com/v1/pets/{{petId}}')
    expect(request.query).toEqual([{ name: 'verbose', value: '', enabled: false }])
    expect(request.headers).toEqual([
      { name: 'X-Trace', value: 'trace-default', enabled: false },
    ])
    expect(request.body).toEqual({ kind: 'none' })
  })

  it('generates a JSON example body and a bearer placeholder', async () => {
    const result = await importDoc()
    const request = requestOf(result, 'POST', '/pets/{petId}')
    expect(request.body).toEqual({
      kind: 'json',
      text: JSON.stringify({ name: 'string', age: 1, tag: 'cat' }),
    })
    expect(request.auth).toEqual({ kind: 'bearer', token: '{{bearerAuth}}' })

    const created = result.endpoints.find((entry) => entry.id === 'createpet')!
    expect(created.group).toBe('pets')
    expect(created.name).toBe('Create pet')
    expect(created.warnings).toContain('missing_path_param:petId')
    const read = result.endpoints.find((entry) => entry.id === 'getpet')!
    expect(read.warnings).toContain('cookie_param_unsupported:session')
  })

  it('falls back to summary, operation id then method and path for the name', async () => {
    const result = await importDoc()
    const health = result.endpoints.find((entry) => entry.path === '/health')!
    expect(health.name).toBe('health')
    expect(health.group).toBe('default')
  })

  it('substitutes server variable defaults and keeps unknown ones as placeholders', async () => {
    const doc = {
      openapi: '3.0.0',
      info: { title: 'Vars', version: '1' },
      servers: [
        {
          url: 'https://{env}.example.com/{version}',
          variables: { env: { default: 'api' }, version: {} },
        },
      ],
      paths: { '/ping': { get: {} } },
    }
    const result = await importOpenApi(JSON.stringify(doc), { fetch: null })
    expect(result.endpoints[0]!.request.url).toBe('https://api.example.com/{{version}}/ping')
    expect(result.warnings).toContain('missing_server_variable:version')
  })

  it('uses {{baseUrl}} when the document has no server', async () => {
    const doc = {
      openapi: '3.0.0',
      info: { title: 'No server', version: '1' },
      paths: { '/ping': { get: {} } },
    }
    const result = await importOpenApi(JSON.stringify(doc), { fetch: null })
    expect(result.endpoints[0]!.request.url).toBe('{{baseUrl}}/ping')
    expect(result.warnings).toContain('missing_server')
  })

  it('never treats a $ref inside an example as a remote reference', async () => {
    const fetchSpy = vi.fn()
    const doc = {
      openapi: '3.0.3',
      info: { title: 'Data ref', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/items': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  example: { $ref: 'https://evil.example.test/meta.json' },
                },
              },
            },
          },
        },
      },
    }
    const result = await importOpenApi(JSON.stringify(doc), {
      fetch: fetchSpy as unknown as OpenApiFetch,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.remoteDocuments).toEqual([])
    expect(result.endpoints[0]!.request.body).toEqual({
      kind: 'json',
      text: JSON.stringify({ $ref: 'https://evil.example.test/meta.json' }),
    })
  })

  it('drops request bodies for GET and HEAD', async () => {
    const doc = {
      openapi: '3.0.3',
      info: { title: 'Get body', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/things': {
          get: {
            requestBody: { content: { 'application/json': { example: { a: 1 } } } },
          },
        },
      },
    }
    const result = await importOpenApi(JSON.stringify(doc), { fetch: null })
    const endpoint = result.endpoints[0]!
    expect(endpoint.request.body).toEqual({ kind: 'none' })
    expect(endpoint.warnings).toContain('body_dropped_for_get_head')
  })

  it('maps apiKey and basic security schemes to placeholders', async () => {
    const doc = {
      openapi: '3.0.3',
      info: { title: 'Auth', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      security: [{ keyAuth: [] }],
      paths: {
        '/a': { get: {} },
        '/b': { get: { security: [{ basicAuth: [] }] } },
      },
      components: {
        securitySchemes: {
          keyAuth: { type: 'apiKey', name: 'api_key', in: 'query' },
          basicAuth: { type: 'http', scheme: 'basic' },
        },
      },
    }
    const result = await importOpenApi(JSON.stringify(doc), { fetch: null })
    const [a, b] = result.endpoints
    expect(a!.request.auth).toEqual({
      kind: 'api-key',
      name: 'api_key',
      value: '{{keyAuth}}',
      in: 'query',
    })
    expect(b!.request.auth).toEqual({
      kind: 'basic',
      username: '{{basicAuthUser}}',
      password: '{{basicAuthPassword}}',
    })
  })
})
