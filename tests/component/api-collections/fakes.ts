/**
 * Fakes for the T044 collection tree and send log. They mirror the Host
 * contract (summaries, one collection per read, appended requests, one history
 * page) so the panel tests never touch `.vibe/api` or the transport.
 */
import { vi } from 'vitest'
import { API_HISTORY_LIMIT_DEFAULT } from '../../../src/contracts/api'
import type {
  ApiCollection,
  ApiCollectionAddParams,
  ApiCollectionAddResult,
  ApiCollectionMutationResult,
  ApiCollectionRemoveResult,
  ApiCollectionSummaries,
  ApiHistoryClearResult,
  ApiHistoryEntry,
  ApiHistoryPage,
  ApiHistoryQuery,
  HttpRequestSpec,
} from '../../../src/contracts/api'
import type { ApiCollectionApi } from '../../../src/client/api/collection-store'
import type { ApiHistoryApi } from '../../../src/client/api/history-store'

/** Same counting rule as the Host summary: root rows plus folder rows. */
function requestCountOf(collection: ApiCollection): number {
  return (
    (collection.requests?.length ?? 0) +
    (collection.folders ?? []).reduce((total, folder) => total + folder.requests.length, 0)
  )
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export interface FakeCollectionOptions {
  skipped?: number
  failList?: boolean
  failRemove?: boolean
  failRename?: boolean
  failDuplicate?: boolean
}

export interface FakeCollections {
  readonly api: ApiCollectionApi
  readonly documents: Map<string, ApiCollection>
  readonly list: ReturnType<typeof vi.fn>
  readonly read: ReturnType<typeof vi.fn>
  readonly add: ReturnType<typeof vi.fn>
  readonly remove: ReturnType<typeof vi.fn>
  readonly rename: ReturnType<typeof vi.fn>
  readonly duplicate: ReturnType<typeof vi.fn>
  readonly options: FakeCollectionOptions
}

function summaryOf(collection: ApiCollection) {
  return {
    id: collection.id,
    name: collection.name,
    requestCount: requestCountOf(collection),
    folderCount: collection.folders?.length ?? 0,
  }
}

export function createFakeCollections(
  initial: readonly ApiCollection[] = [],
  options: FakeCollectionOptions = {},
): FakeCollections {
  const documents = new Map(initial.map((collection) => [collection.id, clone(collection)]))
  let nextRequest = 0

  const list = vi.fn(async (): Promise<ApiCollectionSummaries> => {
    if (options.failList) throw new Error('vibe-studio: cannot list collections')
    return {
      collections: [...documents.values()].map(summaryOf),
      skipped: options.skipped ?? 0,
    }
  })

  const read = vi.fn(async (id: string): Promise<ApiCollection> => {
    const found = documents.get(id)
    if (found === undefined) throw new Error('vibe-studio: collection not found')
    return clone(found)
  })

  const add = vi.fn(async (params: ApiCollectionAddParams): Promise<ApiCollectionAddResult> => {
    const existing = documents.get(params.collectionId)
    const saved = { id: `req-${++nextRequest}`, name: params.name, request: clone(params.request) }
    const next: ApiCollection =
      existing === undefined
        ? {
            id: params.collectionId,
            name: params.collectionName ?? params.collectionId,
            requests: [saved],
          }
        : { ...existing, requests: [...(existing.requests ?? []), saved] }
    documents.set(next.id, next)
    return {
      collectionId: next.id,
      requestId: saved.id,
      requestCount: requestCountOf(next),
    }
  })

  const remove = vi.fn(async (id: string): Promise<ApiCollectionRemoveResult> => {
    if (options.failRemove) throw new Error('vibe-studio: cannot remove collection')
    return { removed: documents.delete(id) }
  })

  const rename = vi.fn(
    async (id: string, name: string): Promise<ApiCollectionMutationResult> => {
      if (options.failRename) throw new Error('vibe-studio: cannot rename collection')
      const found = documents.get(id)
      if (found === undefined) throw new Error('vibe-studio: collection not found')
      const next = { ...found, name }
      documents.set(id, next)
      return { collection: summaryOf(next) }
    },
  )

  const duplicate = vi.fn(
    async (id: string, name?: string): Promise<ApiCollectionMutationResult> => {
      if (options.failDuplicate) throw new Error('vibe-studio: cannot copy collection')
      const found = documents.get(id)
      if (found === undefined) throw new Error('vibe-studio: collection not found')
      let copyId = `${id}-copy`
      for (let suffix = 2; documents.has(copyId); suffix += 1) copyId = `${id}-copy-${suffix}`
      const copy: ApiCollection = {
        ...clone(found),
        id: copyId,
        name: name ?? `${found.name} copy`,
      }
      documents.set(copyId, copy)
      return { collection: summaryOf(copy) }
    },
  )

  return {
    api: { list, read, add, remove, rename, duplicate },
    documents,
    list,
    read,
    add,
    remove,
    rename,
    duplicate,
    options,
  }
}

export interface FakeHistoryOptions {
  skipped?: number
  failList?: boolean
  failClear?: boolean
  pageLimit?: number
}

export interface FakeHistory {
  readonly api: ApiHistoryApi
  readonly entries: ApiHistoryEntry[]
  readonly list: ReturnType<typeof vi.fn>
  readonly clear: ReturnType<typeof vi.fn>
  readonly options: FakeHistoryOptions
}

export function createFakeHistory(
  entries: readonly ApiHistoryEntry[] = [],
  options: FakeHistoryOptions = {},
): FakeHistory {
  const state = entries.map(clone)

  const list = vi.fn(async (query?: ApiHistoryQuery): Promise<ApiHistoryPage> => {
    if (options.failList) throw new Error('vibe-studio: cannot read history')
    const needle = (query?.query ?? '').trim().toLowerCase()
    const matched = state.filter(
      (entry) =>
        needle === '' ||
        `${entry.method} ${entry.url} ${entry.status ?? ''}`.toLowerCase().includes(needle),
    )
    // The Host honors `limit`; `pageLimit` still wins so a test can force a short page.
    const limit = Math.min(
      options.pageLimit ?? Number.POSITIVE_INFINITY,
      query?.limit ?? API_HISTORY_LIMIT_DEFAULT,
    )
    return { entries: matched.slice(0, limit), total: matched.length, skipped: options.skipped ?? 0 }
  })

  const clear = vi.fn(async (): Promise<ApiHistoryClearResult> => {
    if (options.failClear) throw new Error('vibe-studio: cannot clear history')
    const cleared = state.length > 0
    state.length = 0
    return { cleared }
  })

  return { api: { list, clear }, entries: state, list, clear, options }
}

export function spec(overrides: Partial<HttpRequestSpec> = {}): HttpRequestSpec {
  return { method: 'GET', url: 'https://api.example.com/items', ...overrides }
}

export function historyEntry(overrides: Partial<ApiHistoryEntry> = {}): ApiHistoryEntry {
  return {
    id: 'entry-1',
    at: '2026-10-29T10:00:00.000Z',
    method: 'GET',
    url: 'https://api.example.com/items',
    status: 200,
    elapsedMs: 12,
    request: spec(),
    ...overrides,
  }
}
