/**
 * FR-API-05 through the service seam (T046 R5): rename keeps the id and every
 * nested id, duplicate copies under a fresh slug id (never overwriting an
 * existing collection) and leaves the source untouched. Stores run against a
 * real temp `.vibe/api`; no request is ever sent here.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  API_COLLECTION_ADD_METHOD,
  API_COLLECTION_DUPLICATE_METHOD,
  API_COLLECTION_GET_METHOD,
  API_COLLECTION_LIST_METHOD,
  API_COLLECTION_RENAME_METHOD,
  type ApiCollection,
  type ApiCollectionMutationResult,
  type ApiCollectionSummaries,
  type HttpRequestSpec,
} from '../../../src/contracts/api'
import type { StudioError } from '../../../src/contracts/errors'
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
  tempRoot = await mkdtemp(join(root, 'api-service-collections-'))
  projectDir = join(tempRoot, 'project')
  await mkdir(projectDir)
  collections = createApiCollectionStore(projectDir)
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function spec(overrides: Partial<HttpRequestSpec> = {}): HttpRequestSpec {
  return { method: 'GET', url: 'https://api.example.com/items', ...overrides }
}

function collection(overrides: Partial<ApiCollection> = {}): ApiCollection {
  return {
    id: 'weather',
    name: 'Weather',
    requests: [{ id: 'list-items', name: 'List items', request: spec() }],
    folders: [
      {
        id: 'write',
        name: 'Write',
        requests: [{ id: 'create-item', name: 'Create', request: spec({ method: 'POST' }) }],
      },
    ],
    ...overrides,
  }
}

function setup() {
  const registry = new UnaryRegistry()
  const service = new ApiService({
    secrets: createApiSecretStore({}),
    executor: createHttpExecutor({
      fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
    }),
    collections,
  })
  registerApiMethods(registry, service)
  return { registry, service }
}

function context(signal = new AbortController().signal) {
  return { request: new Request('http://127.0.0.1/api/vibe/request'), signal }
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

describe('api.collection.rename', () => {
  it('renames in place and returns the updated row', async () => {
    await collections.save(collection())
    const { registry } = setup()

    const result = valueOf<ApiCollectionMutationResult>(
      await registry.dispatch(
        API_COLLECTION_RENAME_METHOD,
        { id: 'weather', name: '  Forecast  ' },
        context(),
      ),
    )
    expect(result.collection).toEqual({
      id: 'weather',
      name: 'Forecast',
      requestCount: 2,
      folderCount: 1,
    })

    const stored = await collections.read('weather')
    expect(stored?.name).toBe('Forecast')
    expect(stored?.requests?.map((request) => request.id)).toEqual(['list-items'])
    expect(stored?.folders?.map((folder) => folder.id)).toEqual(['write'])
  })

  it('refuses a blank name and reports a missing collection', async () => {
    await collections.save(collection())
    const { service } = setup()

    const blank = await failureOf(service.renameCollection({ id: 'weather', name: '   ' }))
    expect(blank.code).toBe('invalid_input')
    expect(blank.details?.field).toBe('name')

    const missing = await failureOf(service.renameCollection({ id: 'nope', name: 'X' }))
    expect(missing.code).toBe('not_found')
    expect(missing.details?.reason).toBe('not_found')
    expect((await collections.read('weather'))?.name).toBe('Weather')
  })

  it('rejects an unusable id before touching storage', async () => {
    const { service } = setup()
    const error = await failureOf(service.renameCollection({ id: '../escape', name: 'X' }))
    expect(error.code).toBe('invalid_input')
    expect(error.details?.field).toBe('id')
  })
})

describe('api.collection.duplicate', () => {
  it('copies under a slug id, renames the copy and leaves the source intact', async () => {
    await collections.save(collection())
    const { registry } = setup()

    const result = valueOf<ApiCollectionMutationResult>(
      await registry.dispatch(API_COLLECTION_DUPLICATE_METHOD, { id: 'weather' }, context()),
    )
    expect(result.collection).toEqual({
      id: 'weather-copy',
      name: 'Weather copy',
      requestCount: 2,
      folderCount: 1,
    })

    const copy = await collections.read('weather-copy')
    expect(copy?.requests?.[0]?.id).not.toBe('list-items')
    expect(copy?.folders?.[0]?.id).not.toBe('write')
    expect((await collections.read('weather'))?.name).toBe('Weather')

    const listed = valueOf<ApiCollectionSummaries>(
      await registry.dispatch(API_COLLECTION_LIST_METHOD, undefined, context()),
    )
    expect(listed.collections.map((item) => item.id)).toEqual(['weather', 'weather-copy'])
  })

  it('uses an explicit name and never overwrites a taken slug', async () => {
    await collections.save(collection())
    await collections.save(collection({ id: 'forecast', name: 'Forecast' }))
    const { service } = setup()

    const first = await service.duplicateCollection({ id: 'weather', name: 'Forecast' })
    expect(first.collection.id).toBe('forecast-2')
    expect(first.collection.name).toBe('Forecast')

    const second = await service.duplicateCollection({ id: 'weather', name: 'Forecast' })
    expect(second.collection.id).toBe('forecast-3')
    expect((await collections.read('forecast'))?.requests).toHaveLength(1)
  })

  it('reports a missing source and rejects an unusable id', async () => {
    const { service } = setup()
    const missing = await failureOf(service.duplicateCollection({ id: 'nope' }))
    expect(missing.code).toBe('not_found')
    expect(missing.details?.reason).toBe('not_found')

    const bad = await failureOf(service.duplicateCollection({ id: 'bad id' }))
    expect(bad.code).toBe('invalid_input')
    expect(bad.details?.field).toBe('id')
  })
})

/** The add path still works after a rename (same file, same id). */
describe('rename then append', () => {
  it('appends to the renamed collection', async () => {
    await collections.save(collection())
    const { registry } = setup()
    await registry.dispatch(
      API_COLLECTION_RENAME_METHOD,
      { id: 'weather', name: 'Forecast' },
      context(),
    )
    const added = valueOf<{ collectionId: string; requestCount: number }>(
      await registry.dispatch(
        API_COLLECTION_ADD_METHOD,
        { collectionId: 'weather', name: 'Extra', request: spec() },
        context(),
      ),
    )
    expect(added).toMatchObject({ collectionId: 'weather', requestCount: 3 })

    const stored = valueOf<ApiCollection>(
      await registry.dispatch(API_COLLECTION_GET_METHOD, { id: 'weather' }, context()),
    )
    expect(stored.name).toBe('Forecast')
  })
})
