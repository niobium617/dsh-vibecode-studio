/**
 * FR-API-08 through the service seam (T046 R3): a document becomes a saved
 * collection, a second import never overwrites the first, and every failure
 * keeps a stable reason for the panel. Stores run against a real temp
 * `.vibe/api`; the default remote policy is never bypassed.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  API_OPENAPI_IMPORT_METHOD,
  type ApiOpenApiImportResult,
} from '../../../src/contracts/api'
import type { StudioError } from '../../../src/contracts/errors'
import { MAX_UNARY_BODY_BYTES } from '../../../src/contracts/transport'
import {
  ApiService,
  UnaryRegistry,
  createApiCollectionStore,
  createApiSecretStore,
  createHttpExecutor,
  registerApiMethods,
  type ApiCollectionStore,
  type UnaryDispatchResult,
} from '../../../src/host'

let tempRoot: string
let projectDir: string
let collections: ApiCollectionStore

beforeEach(async () => {
  const root = join(process.cwd(), '.tmp')
  await mkdir(root, { recursive: true })
  tempRoot = await mkdtemp(join(root, 'api-service-openapi-'))
  projectDir = join(tempRoot, 'project')
  await mkdir(projectDir)
  collections = createApiCollectionStore(projectDir)
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function document(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Pet Store', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com/v1' }],
    paths: {
      '/pets': {
        get: { tags: ['pets'], summary: 'List pets', operationId: 'listPets' },
        post: {
          tags: ['pets'],
          summary: 'Create pet',
          operationId: 'createPet',
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object' },
                example: { name: 'Rex' },
              },
            },
          },
        },
      },
    },
    ...overrides,
  })
}

function setup(options: { readonly collections?: ApiCollectionStore | null } = {}) {
  const registry = new UnaryRegistry()
  const store = options.collections === undefined ? collections : options.collections
  const service = new ApiService({
    secrets: createApiSecretStore({}),
    executor: createHttpExecutor({
      fetchImpl: (async () => {
        throw new TypeError('the import must not send requests')
      }) as unknown as typeof fetch,
    }),
    ...(store === null ? {} : { collections: store }),
  })
  registerApiMethods(registry, service)
  return { registry, service }
}

function valueOf<T>(result: UnaryDispatchResult): T {
  if (!result.body.ok) throw new Error(`unexpected failure: ${result.body.error.code}`)
  return result.body.value as T
}

async function failureOf(promise: Promise<unknown>): Promise<StudioError> {
  try {
    await promise
  } catch (error) {
    return error as StudioError
  }
  throw new Error('expected the call to fail')
}

describe('api.openapi.import', () => {
  it('saves the document as a collection and reports the summary', async () => {
    const { registry } = setup()
    const result = valueOf<ApiOpenApiImportResult>(
      await registry.dispatch(API_OPENAPI_IMPORT_METHOD, { text: document() }, context()),
    )

    expect(result.version).toBe('3')
    expect(result.title).toBe('Pet Store')
    expect(result.endpointCount).toBe(2)
    expect(result.groupCount).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.remoteDocumentCount).toBe(0)
    expect(result.collection).toMatchObject({
      id: 'pet-store',
      name: 'Pet Store',
      requestCount: 2,
      folderCount: 1,
    })

    const saved = await collections.read(result.collection.id)
    expect(saved).not.toBeNull()
    expect(saved?.folders?.[0]?.name).toBe('pets')
    expect(saved?.folders?.[0]?.requests).toHaveLength(2)
    // The example became the request body; no value was expanded or sent.
    const create = saved?.folders?.[0]?.requests.find((row) => row.name.includes('Create'))
    expect(create?.request.body).toMatchObject({ kind: 'json', text: '{"name":"Rex"}' })
  })

  it('never overwrites: a second import gets a suffixed id', async () => {
    const { registry } = setup()
    const first = valueOf<ApiOpenApiImportResult>(
      await registry.dispatch(API_OPENAPI_IMPORT_METHOD, { text: document() }, context()),
    )
    const second = valueOf<ApiOpenApiImportResult>(
      await registry.dispatch(API_OPENAPI_IMPORT_METHOD, { text: document() }, context()),
    )

    expect(first.collection.id).toBe('pet-store')
    expect(second.collection.id).toBe('pet-store-2')
    expect((await collections.read('pet-store'))?.id).toBe('pet-store')
    expect((await collections.read('pet-store-2'))?.id).toBe('pet-store-2')
  })

  it('keeps the id usable when the slug already fills the 64-char limit', async () => {
    const longTitle = 'a'.repeat(80)
    const { registry } = setup()
    const first = valueOf<ApiOpenApiImportResult>(
      await registry.dispatch(
        API_OPENAPI_IMPORT_METHOD,
        { text: document({ info: { title: longTitle, version: '1.0.0' } }) },
        context(),
      ),
    )
    const second = valueOf<ApiOpenApiImportResult>(
      await registry.dispatch(
        API_OPENAPI_IMPORT_METHOD,
        { text: document({ info: { title: longTitle, version: '1.0.0' } }) },
        context(),
      ),
    )

    expect(first.collection.id).toHaveLength(64)
    expect(second.collection.id).toHaveLength(64)
    expect(second.collection.id.endsWith('-2')).toBe(true)
    expect(second.collection.id).not.toBe(first.collection.id)
  })

  it('keeps tag grouping and the document warnings', async () => {
    const { registry } = setup()
    const result = valueOf<ApiOpenApiImportResult>(
      await registry.dispatch(
        API_OPENAPI_IMPORT_METHOD,
        {
          text: document({
            servers: [
              { url: 'https://api.example.com/v1' },
              { url: 'https://api.example.com/v2' },
            ],
          }),
        },
        context(),
      ),
    )

    expect(result.warnings).toContain('multiple_servers')
  })

  it('maps a broken document to a stable reason and writes nothing', async () => {
    const { service } = setup()
    const error = await failureOf(service.importOpenApi({ text: '{not json' }))

    expect(error.code).toBe('invalid_input')
    expect(error.details?.reason).toBe('invalid_json')
    expect((await collections.list()).collections).toHaveLength(0)
  })

  it('blocks remote $refs without fetching them', async () => {
    const { service } = setup()
    const error = await failureOf(
      service.importOpenApi({
        text: document({
          paths: {
            '/pets': {
              get: {
                responses: {
                  200: {
                    description: 'ok',
                    content: {
                      'application/json': { schema: { $ref: 'https://elsewhere.test/schema.json' } },
                    },
                  },
                },
              },
            },
          },
        }),
      }),
    )

    expect(error.code).toBe('permission_denied')
    expect(error.details?.reason).toBe('remote_ref_blocked')
    expect((await collections.list()).collections).toHaveLength(0)
  })

  it('refuses an over-limit document before parsing it', async () => {
    const { service } = setup()
    const error = await failureOf(service.importOpenApi({ text: 'x'.repeat(MAX_UNARY_BODY_BYTES) }))

    expect(error.code).toBe('invalid_input')
    expect(error.details).toMatchObject({
      reason: 'document_too_large',
      limitBytes: MAX_UNARY_BODY_BYTES,
    })
  })

  it('refuses unusable params', async () => {
    const { service } = setup()
    for (const params of [undefined, {}, { text: 42 }, { text: '   ' }]) {
      const error = await failureOf(service.importOpenApi(params))
      expect(error.code).toBe('invalid_input')
    }
  })

  it('reports internal when collection storage is unavailable', async () => {
    const { service } = setup({ collections: null })
    const error = await failureOf(service.importOpenApi({ text: document() }))

    expect(error.code).toBe('internal')
  })
})

function context(signal = new AbortController().signal) {
  return { request: new Request('http://127.0.0.1/api/vibe/request'), signal }
}
