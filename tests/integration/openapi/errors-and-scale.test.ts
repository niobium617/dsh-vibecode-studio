/**
 * T042 failure paths and scale: stable error codes, the 1000-operation cap,
 * 500 endpoints under the 5 s budget and a result that survives the real
 * collection store (save → read → equal).
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isApiCollection, isHttpRequestSpec } from '../../../src/contracts'
import { createApiCollectionStore } from '../../../src/host/api/collection-store'
import { importOpenApi } from '../../../src/host/api/openapi/mapper'
import { OpenApiError } from '../../../src/host/api/openapi/parser'

function doc(paths: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Errors', version: '1' },
    servers: [{ url: 'https://api.example.com' }],
    paths,
    ...extra,
  })
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(OpenApiError)
  await expect(promise).rejects.toMatchObject({ code })
}

describe('importOpenApi errors', () => {
  it('reports invalid JSON', async () => {
    await expectCode(importOpenApi('{not json', { fetch: null }), 'invalid_json')
  })

  it('rejects a non-object document and unsupported versions', async () => {
    await expectCode(importOpenApi('[]', { fetch: null }), 'invalid_document')
    await expectCode(
      importOpenApi(JSON.stringify({ openapi: '4.0.0', info: {}, paths: {} }), { fetch: null }),
      'invalid_document',
    )
    await expectCode(
      importOpenApi(JSON.stringify({ swagger: '1.2', info: {}, paths: {} }), { fetch: null }),
      'invalid_document',
    )
  })

  it('rejects a document without info, paths or operations', async () => {
    await expectCode(
      importOpenApi(JSON.stringify({ openapi: '3.0.3', paths: {} }), { fetch: null }),
      'invalid_document',
    )
    await expectCode(
      importOpenApi(JSON.stringify({ openapi: '3.0.3', info: {}, paths: {} }), { fetch: null }),
      'invalid_document',
    )
    await expectCode(importOpenApi(doc({}), { fetch: null }), 'invalid_document')
  })

  it('rejects a document over the operation cap', async () => {
    const paths: Record<string, unknown> = {}
    for (let index = 0; index < 1_001; index += 1) paths[`/p${index}`] = { get: {} }
    await expectCode(importOpenApi(doc(paths), { fetch: null }), 'too_many_operations')
  })

  it('validates options before reading the document', async () => {
    await expectCode(
      importOpenApi('{}', { allowedOrigins: ['ftp://example.com'], fetch: null }),
      'invalid_options',
    )
    await expectCode(importOpenApi('{}', { maxBytes: 0, fetch: null }), 'invalid_options')
  })

  it('reports an unresolved local ref during parsing', async () => {
    const text = doc({
      '/a': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/nope' } } } } } },
    })
    await expectCode(importOpenApi(text, { fetch: null }), 'ref_unresolved')
  })
})

function scalableDocument(pathCount: number): string {
  const paths: Record<string, unknown> = {}
  for (let index = 0; index < pathCount; index += 1) {
    const tag = `group${index % 10}`
    const template = `/resource${index}/{id}`
    paths[template] = {
      get: {
        tags: [tag],
        operationId: `getResource${index}`,
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1 } },
        ],
      },
      post: {
        tags: [tag],
        operationId: `createResource${index}`,
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string' }, active: { type: 'boolean' } },
              },
            },
          },
        },
        security: [{ token: [] }],
      },
      put: { tags: [tag], operationId: `putResource${index}` },
      delete: { tags: [tag], operationId: `deleteResource${index}` },
      patch: {
        tags: [tag],
        operationId: `patchResource${index}`,
        requestBody: { content: { 'text/plain': { example: 'hello' } } },
      },
    }
  }
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Big API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths,
    components: {
      securitySchemes: { token: { type: 'http', scheme: 'bearer' } },
    },
  })
}

describe('importOpenApi scale', () => {
  let tempRoot = ''
  let store: ReturnType<typeof createApiCollectionStore>

  beforeEach(async () => {
    const root = join(process.cwd(), '.tmp')
    await mkdir(root, { recursive: true })
    tempRoot = await mkdtemp(join(root, 'openapi-import-'))
    const projectDir = join(tempRoot, 'project')
    await mkdir(projectDir)
    store = createApiCollectionStore(projectDir)
  })

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('maps 500 endpoints under the budget and saves the result', async () => {
    const text = scalableDocument(100)
    const started = performance.now()
    const result = await importOpenApi(text, { fetch: null })
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(5_000)
    expect(result.endpoints).toHaveLength(500)
    expect(result.endpoints.every((endpoint) => isHttpRequestSpec(endpoint.request))).toBe(true)
    expect(isApiCollection(result.collection)).toBe(true)
    expect(result.collection.id).toBe('big-api')
    expect(result.skipped).toBe(0)
    expect(result.groups).toHaveLength(10)

    await store.save(result.collection)
    expect(await store.read(result.collection.id)).toEqual(result.collection)
  })

  it('splits a tag with more than 200 requests into numbered folders', async () => {
    const paths: Record<string, unknown> = {}
    for (let index = 0; index < 250; index += 1) {
      paths[`/single${index}`] = { get: { tags: ['one'], operationId: `single${index}` } }
    }
    const text = JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'One tag', version: '1' },
      servers: [{ url: 'https://api.example.com' }],
      paths,
    })
    const result = await importOpenApi(text, { fetch: null })
    const folders = result.collection.folders ?? []
    expect(folders).toHaveLength(2)
    expect(folders[0]!.requests).toHaveLength(200)
    expect(folders[1]!.requests).toHaveLength(50)
    expect(folders[1]!.name).toBe('one (2)')
    expect(isApiCollection(result.collection)).toBe(true)
    await store.save(result.collection)
  })
})
