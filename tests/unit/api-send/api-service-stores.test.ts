/**
 * T044 API service seams: sends are logged with redaction (placeholders kept),
 * collections are listed as summaries and appended one request at a time, and
 * history is searched host-side. Stores run against a real temp `.vibe/api`;
 * only `fetch` is faked.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  API_COLLECTION_ITEMS_MAX,
  API_COLLECTION_LIST_METHOD,
  API_HISTORY_LIST_METHOD,
  API_HISTORY_QUERY_CHARS_MAX,
  type HttpRequestSpec,
} from '../../../src/contracts/api'
import { REDACTED } from '../../../src/contracts/redact'
import type { StudioError } from '../../../src/contracts/errors'
import {
  ApiService,
  UnaryRegistry,
  createApiCollectionStore,
  createApiHistoryStore,
  createApiSecretStore,
  createHttpExecutor,
  registerApiMethods,
  type ApiCollectionStore,
  type ApiHistoryStore,
  type UnaryDispatchResult,
} from '../../../src/host'

let tempRoot: string
let projectDir: string
let collections: ApiCollectionStore
let history: ApiHistoryStore
let idSeq = 0

beforeEach(async () => {
  const root = join(process.cwd(), '.tmp')
  await mkdir(root, { recursive: true })
  tempRoot = await mkdtemp(join(root, 'api-service-stores-'))
  projectDir = join(tempRoot, 'project')
  await mkdir(projectDir)
  collections = createApiCollectionStore(projectDir)
  idSeq = 0
  history = createApiHistoryStore(projectDir, {
    now: () => new Date('2026-10-29T10:00:00.000Z'),
    nextId: () => `entry-${++idSeq}`,
  })
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function spec(overrides: Partial<HttpRequestSpec> = {}): HttpRequestSpec {
  return { method: 'GET', url: 'https://api.example.com/items', ...overrides }
}

function okFetch(): typeof fetch {
  return (async () =>
    new Response('{"ok":true}', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch
}

function brokenFetch(): typeof fetch {
  return (async () => {
    throw new TypeError('fetch failed')
  }) as unknown as typeof fetch
}

function setup(
  options: {
    readonly fetchImpl?: typeof fetch
    readonly history?: ApiHistoryStore
    readonly collections?: ApiCollectionStore
  } = {},
) {
  const registry = new UnaryRegistry()
  const service = new ApiService({
    secrets: createApiSecretStore({}),
    executor: createHttpExecutor({ fetchImpl: options.fetchImpl ?? okFetch() }),
    collections: options.collections ?? collections,
    history: options.history ?? history,
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

async function rejectionOf(promise: Promise<unknown>): Promise<StudioError> {
  try {
    await promise
  } catch (error) {
    return error as StudioError
  }
  throw new Error('expected the call to reject')
}

describe('send history', () => {
  it('logs a send with sensitive values redacted and placeholders kept', async () => {
    const { service } = setup()
    const request = spec({
      method: 'POST',
      headers: [
        { name: 'authorization', value: 'Bearer plain-token' },
        { name: 'x-api-key', value: '{{apiKey}}' },
        { name: 'x-trace', value: 'abc' },
      ],
    })

    await service.send({ request })
    const page = await service.listHistory()

    expect(page.total).toBe(1)
    const entry = page.entries[0]!
    expect(entry.method).toBe('POST')
    expect(entry.url).toBe('https://api.example.com/items')
    expect(entry.status).toBe(200)
    expect(typeof entry.elapsedMs).toBe('number')
    const headers = entry.request.headers ?? []
    expect(headers[0]).toEqual({ name: 'authorization', value: REDACTED })
    // A value that is only a placeholder carries no secret and survives.
    expect(headers[1]).toEqual({ name: 'x-api-key', value: '{{apiKey}}' })
    expect(headers[2]).toEqual({ name: 'x-trace', value: 'abc' })
  })

  it('logs a failed send without a status', async () => {
    const { service } = setup({ fetchImpl: brokenFetch() })

    const error = await rejectionOf(service.send({ request: spec() }))
    expect(error.code).toBe('network_error')

    const page = await service.listHistory()
    expect(page.total).toBe(1)
    expect(page.entries[0]!.status).toBeUndefined()
    expect(page.entries[0]!.elapsedMs).toBeUndefined()
  })

  it('never fails a send because the log could not be written', async () => {
    const brokenHistory = {
      append: async () => {
        throw new Error('disk full')
      },
    } as unknown as ApiHistoryStore
    const { service } = setup({ history: brokenHistory })

    await expect(service.send({ request: spec() })).resolves.toMatchObject({
      result: { status: 200 },
    })
  })
})

describe('collections', () => {
  it('lists summaries with counts across root and folders', async () => {
    await collections.save({
      id: 'weather',
      name: 'Weather',
      requests: [{ id: 'r1', name: 'List', request: spec() }],
      folders: [
        { id: 'write', name: 'Write', requests: [{ id: 'r2', name: 'Create', request: spec() }] },
      ],
    })
    const { registry } = setup()

    const result = await registry.dispatch(API_COLLECTION_LIST_METHOD, undefined, context())
    const value = valueOf<{ collections: Array<Record<string, unknown>>; skipped: number }>(result)

    expect(value.skipped).toBe(0)
    expect(value.collections).toEqual([
      { id: 'weather', name: 'Weather', requestCount: 2, folderCount: 1 },
    ])
  })

  it('creates the collection on first save and appends after that', async () => {
    const { service } = setup()

    const first = await service.addToCollection({
      collectionId: 'saved',
      collectionName: 'Saved requests',
      name: 'GET /items',
      request: spec(),
    })
    expect(first.collectionId).toBe('saved')
    expect(typeof first.requestId).toBe('string')
    expect(first.requestCount).toBe(1)

    const second = await service.addToCollection({
      collectionId: 'saved',
      collectionName: 'A different name',
      name: 'POST /users',
      request: spec({ method: 'POST', url: 'https://api.example.com/users' }),
    })
    expect(second.requestCount).toBe(2)

    const stored = await collections.read('saved')
    expect(stored?.name).toBe('Saved requests')
    expect(stored?.requests?.map((row) => row.name)).toEqual(['GET /items', 'POST /users'])
    expect(stored?.requests?.[1]?.id).toBe(second.requestId)
  })

  it('refuses to append past the collection item cap', async () => {
    const requests = Array.from({ length: API_COLLECTION_ITEMS_MAX }, (_, index) => ({
      id: `r${index}`,
      name: `Request ${index}`,
      request: spec(),
    }))
    await collections.save({ id: 'full', name: 'Full', requests })
    const { service } = setup()

    const error = await rejectionOf(
      service.addToCollection({ collectionId: 'full', name: 'One more', request: spec() }),
    )
    expect(error.code).toBe('invalid_input')
    expect(error.details).toMatchObject({
      reason: 'collection_full',
      limit: API_COLLECTION_ITEMS_MAX,
    })
  })

  it('reads one collection and reports a missing one as not_found', async () => {
    const { service } = setup()
    await service.addToCollection({ collectionId: 'saved', name: 'GET /items', request: spec() })

    const stored = await service.readCollection({ id: 'saved' })
    expect(stored.requests?.[0]?.name).toBe('GET /items')

    const error = await rejectionOf(service.readCollection({ id: 'missing' }))
    expect(error.code).toBe('not_found')
  })

  it('removes a collection once and then reports nothing removed', async () => {
    const { service } = setup()
    await service.addToCollection({ collectionId: 'saved', name: 'GET /items', request: spec() })

    expect(await service.removeCollection({ id: 'saved' })).toEqual({ removed: true })
    expect(await collections.read('saved')).toBeNull()
    expect(await service.removeCollection({ id: 'saved' })).toEqual({ removed: false })
  })
})

describe('history', () => {
  it('lists newest first, filters host-side and clears', async () => {
    const { registry } = setup()
    await history.append(spec(), { status: 200, elapsedMs: 5 })
    await history.append(spec({ method: 'POST', url: 'https://api.example.com/users' }), {
      status: 201,
      elapsedMs: 9,
    })

    const all = valueOf<{ entries: Array<{ url: string }>; total: number }>(
      await registry.dispatch(API_HISTORY_LIST_METHOD, undefined, context()),
    )
    expect(all.total).toBe(2)
    expect(all.entries[0]!.url).toBe('https://api.example.com/users')

    const filtered = valueOf<{ entries: Array<{ method: string }>; total: number }>(
      await registry.dispatch(API_HISTORY_LIST_METHOD, { query: 'users' }, context()),
    )
    expect(filtered.total).toBe(1)
    expect(filtered.entries[0]!.method).toBe('POST')

    const { service } = setup()
    expect(await service.clearHistory()).toEqual({ cleared: true })
    expect((await service.listHistory()).total).toBe(0)
    expect(await service.clearHistory()).toEqual({ cleared: false })
  })
})

describe('input validation', () => {
  it('rejects unusable ids, names, requests and queries', async () => {
    const { service } = setup()

    const badId = await rejectionOf(
      service.addToCollection({ collectionId: 'not an id', name: 'x', request: spec() }),
    )
    expect(badId.code).toBe('invalid_input')
    expect(badId.details).toMatchObject({ field: 'collectionId' })

    const badName = await rejectionOf(
      service.addToCollection({ collectionId: 'saved', name: '   ', request: spec() }),
    )
    expect(badName.details).toMatchObject({ field: 'name' })

    const badRequest = await rejectionOf(
      service.addToCollection({ collectionId: 'saved', name: 'x', request: { method: 'GET' } }),
    )
    expect(badRequest.details).toMatchObject({ field: 'request' })

    const badRead = await rejectionOf(service.readCollection({ id: '../escape' }))
    expect(badRead.details).toMatchObject({ field: 'id' })

    const longQuery = await rejectionOf(
      service.listHistory({ query: 'x'.repeat(API_HISTORY_QUERY_CHARS_MAX + 1) }),
    )
    expect(longQuery.code).toBe('invalid_input')
    expect(longQuery.details).toMatchObject({ field: 'params' })
  })
})
