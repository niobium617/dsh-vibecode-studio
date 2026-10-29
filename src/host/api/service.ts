/**
 * Unary surface for the API workbench (T038, extended in T044).
 *
 * The request builder sends through one method so every browser → Host call
 * reuses the same envelope, validation and error mapping as the rest of the
 * panel. The request arrives as untrusted JSON: it is expanded against the
 * caller's environment first (secrets resolve host-side only) and then handed
 * to the executor, which re-validates everything it touches.
 *
 * T044 adds the collection and history seams the workbench panel needs. Both
 * talk to the T037 stores; every stored request is redacted on the way in
 * (`redactHttpRequest`), so a panel save or a send log never holds a resolved
 * secret. Saving appends one request host-side rather than writing a whole
 * collection back, which keeps an imported 500-endpoint collection editable.
 */
import { randomUUID } from 'node:crypto'
import {
  API_ASSERTIONS_MAX,
  API_COLLECTION_ADD_METHOD,
  API_COLLECTION_GET_METHOD,
  API_COLLECTION_LIST_METHOD,
  API_COLLECTION_ITEMS_MAX,
  API_COLLECTION_REMOVE_METHOD,
  API_HISTORY_CLEAR_METHOD,
  API_HISTORY_LIST_METHOD,
  API_HTTP_SEND_METHOD,
  API_NAME_CHARS_MAX,
  API_REPLAY_PREPARE_METHOD,
  isApiAssertion,
  isApiHistoryQuery,
  isApiEnvironment,
  isApiStoreId,
  isHttpRequestSpec,
  type ApiAssertion,
  type ApiAssertionResult,
  type ApiCollection,
  type ApiCollectionAddParams,
  type ApiCollectionAddResult,
  type ApiCollectionRemoveResult,
  type ApiCollectionSummaries,
  type ApiCollectionSummary,
  type ApiHistoryClearResult,
  type ApiHistoryPage,
  type ApiHistoryQuery,
  type ApiReplayResult,
  type ApiSavedRequest,
  type HttpExecutionResult,
  type HttpRequestSpec,
  type UnresolvedVariable,
} from '../../contracts/api'
import { evaluateAssertions } from './assertions'
import { isStudioError, studioError } from '../../contracts/errors'
import type { ApiCollectionStore } from './collection-store'
import { resolveHttpRequest } from './environment'
import { createHttpExecutor, type HttpExecutor } from './executor'
import type { ApiHistoryStore } from './history-store'
import { prepareReplay as prepareReplayDraft } from './replay'
import { redactExecutionResult } from './result-redaction'
import type { ApiSecretStore } from './secrets'
import { toApiStoreStudioError } from './store-files'
import type { UnaryRegistry } from '../transport'

export {
  API_COLLECTION_ADD_METHOD,
  API_COLLECTION_GET_METHOD,
  API_COLLECTION_LIST_METHOD,
  API_COLLECTION_REMOVE_METHOD,
  API_HISTORY_CLEAR_METHOD,
  API_HISTORY_LIST_METHOD,
  API_HTTP_SEND_METHOD,
  API_REPLAY_PREPARE_METHOD,
}

export interface ApiServiceOptions {
  readonly secrets: ApiSecretStore
  /** Injected for tests; defaults to the real executor. */
  readonly executor?: HttpExecutor
  /** `.vibe/api/collections`; without it the collection methods report `internal`. */
  readonly collections?: ApiCollectionStore
  /** `.vibe/api/history.json`; without it sends are not logged. */
  readonly history?: ApiHistoryStore
}

export interface ApiSendOutcome {
  readonly result: HttpExecutionResult
  /** Placeholders that stayed literal because nothing resolved them. */
  readonly unresolved: readonly UnresolvedVariable[]
  /** Present only when the caller submitted assertions (T045). */
  readonly assertions?: readonly ApiAssertionResult[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(message: string, field: string): never {
  throw studioError('invalid_input', message, { field })
}

/** Header rows may live outside folders; the count covers both. */
function requestCountOf(collection: ApiCollection): number {
  const folders = collection.folders ?? []
  return (
    (collection.requests?.length ?? 0) +
    folders.reduce((total, folder) => total + folder.requests.length, 0)
  )
}

export function summarizeCollection(collection: ApiCollection): ApiCollectionSummary {
  return {
    id: collection.id,
    name: collection.name,
    requestCount: requestCountOf(collection),
    folderCount: collection.folders?.length ?? 0,
  }
}

export class ApiService {
  private readonly executor: HttpExecutor
  private readonly secrets: ApiSecretStore
  private readonly collections: ApiCollectionStore | undefined
  private readonly history: ApiHistoryStore | undefined

  constructor(options: ApiServiceOptions) {
    this.executor = options.executor ?? createHttpExecutor()
    this.secrets = options.secrets
    this.collections = options.collections
    this.history = options.history
  }

  /**
   * Expands `{{variables}}` and executes one request. Resolves with the
   * response even for 4xx/5xx; validation, policy and transport failures
   * reject with a `StudioError` the client can read.
   *
   * Optional declarative assertions (T045) are validated with the rest of the
   * input — so a malformed list never reaches the wire — and evaluated against
   * the finished response. No user code is executed.
   *
   * The send is logged afterwards (T044). The log stores the *unexpanded*
   * request, so placeholders survive and no resolved secret is written; a log
   * failure never fails the send itself.
   *
   * The outcome is the last place a resolved secret could leave the host: the
   * final URL and every redirect hop are scrubbed before the client sees them
   * (G4 follow-up). Assertions are evaluated against the real response first.
   */
  async send(params: unknown, signal?: AbortSignal): Promise<ApiSendOutcome> {
    if (!isRecord(params)) invalid('api.http.send expects an object', 'params')
    const environment = params.environment
    if (environment !== undefined && !isApiEnvironment(environment)) {
      invalid('environment is not a valid environment document', 'environment')
    }
    const assertions = parseAssertions(params.assertions)
    const raw = params.request
    const resolved = await resolveHttpRequest(raw, {
      secrets: this.secrets,
      ...(environment === undefined ? {} : { environment }),
    })
    const spec = isHttpRequestSpec(raw) ? raw : null
    let result: HttpExecutionResult
    try {
      result = await this.executor.execute(resolved.request, {
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      if (spec !== null) await this.recordHistory(spec, {})
      throw error
    }
    if (spec !== null) {
      await this.recordHistory(spec, { status: result.status, elapsedMs: result.elapsedMs })
    }
    const evaluated = assertions === undefined ? undefined : evaluateAssertions(assertions, result)
    return {
      // Assertions see the real response; the client only sees URLs with every
      // resolved secret scrubbed (G4 follow-up). Bodies are target data.
      result: redactExecutionResult(result, resolved.secretValues),
      unresolved: resolved.unresolved,
      ...(evaluated === undefined ? {} : { assertions: evaluated }),
    }
  }

  /**
   * Turns a captured row into a draft (T043). No execution path exists here:
   * the answer is a spec the user still has to send from the panel.
   */
  prepareReplay(params: unknown): ApiReplayResult {
    if (!isRecord(params)) invalid('api.replay.prepare expects an object', 'params')
    return prepareReplayDraft(params.entry, { confirm: params.confirm === true })
  }

  /** Collection tree rows; bodies stay on disk until one is expanded. */
  async listCollections(): Promise<ApiCollectionSummaries> {
    const result = await this.withCollections((store) => store.list())
    return { collections: result.collections.map(summarizeCollection), skipped: result.skipped }
  }

  /** One collection for the expanded tree / reopening a saved request. */
  async readCollection(params: unknown): Promise<ApiCollection> {
    const id = collectionIdOf(params, 'api.collection.get')
    const found = await this.withCollections((store) => store.read(id))
    if (found === null) {
      throw studioError('not_found', 'vibe-studio: collection not found', { reason: 'not_found' })
    }
    return found
  }

  /**
   * Appends one saved request, creating the collection on first save. The store
   * re-redacts and re-validates, so the request landing on disk is safe even if
   * the panel sent plaintext values.
   */
  async addToCollection(params: unknown): Promise<ApiCollectionAddResult> {
    if (!isRecord(params)) invalid('api.collection.add expects an object', 'params')
    const collectionId = params.collectionId
    if (!isApiStoreId(collectionId)) invalid('collectionId is not a usable id', 'collectionId')
    const request = params.request
    if (!isHttpRequestSpec(request)) invalid('request is not a valid request spec', 'request')
    const requestedName = typeof params.name === 'string' ? params.name.trim() : ''
    if (requestedName === '' || requestedName.length > API_NAME_CHARS_MAX) {
      invalid('name is not usable', 'name')
    }
    const requestedCollectionName =
      typeof params.collectionName === 'string' ? params.collectionName.trim() : ''
    const input: ApiCollectionAddParams = {
      collectionId,
      ...(requestedCollectionName === ''
        ? {}
        : { collectionName: requestedCollectionName.slice(0, API_NAME_CHARS_MAX) }),
      name: requestedName,
      request,
    }

    return this.withCollections(async (store) => {
      const existing = await store.read(input.collectionId)
      if (existing !== null && requestCountOf(existing) >= API_COLLECTION_ITEMS_MAX) {
        throw studioError(
          'invalid_input',
          'vibe-studio: this collection already holds the maximum number of requests',
          { reason: 'collection_full', limit: API_COLLECTION_ITEMS_MAX },
        )
      }
      const saved: ApiSavedRequest = {
        id: randomUUID(),
        name: input.name,
        request: input.request,
      }
      const next: ApiCollection =
        existing === null
          ? {
              id: input.collectionId,
              name: input.collectionName ?? input.collectionId,
              requests: [saved],
            }
          : {
              ...existing,
              requests: [...(existing.requests ?? []), saved],
            }
      await store.save(next)
      return {
        collectionId: next.id,
        requestId: saved.id,
        requestCount: requestCountOf(next),
      }
    })
  }

  async removeCollection(params: unknown): Promise<ApiCollectionRemoveResult> {
    const id = collectionIdOf(params, 'api.collection.remove')
    const removed = await this.withCollections((store) => store.remove(id))
    return { removed }
  }

  /** Newest-first send log, filtered host-side so the panel gets one page. */
  async listHistory(params?: unknown): Promise<ApiHistoryPage> {
    let query: ApiHistoryQuery | undefined
    if (params !== undefined) {
      if (!isRecord(params) || !isApiHistoryQuery(params)) {
        invalid('api.history.list expects a valid query', 'params')
      }
      query = params
    }
    const result = await this.withHistory((store) => store.list(query))
    return { entries: result.entries, total: result.total, skipped: result.skipped }
  }

  async clearHistory(): Promise<ApiHistoryClearResult> {
    const cleared = await this.withHistory((store) => store.clear())
    return { cleared }
  }

  private async recordHistory(
    request: HttpRequestSpec,
    details: { readonly status?: number; readonly elapsedMs?: number },
  ): Promise<void> {
    const history = this.history
    if (history === undefined) return
    try {
      await history.append(request, details)
    } catch {
      // History is a convenience; losing one row must never fail a send.
    }
  }

  private collectionStore(): ApiCollectionStore {
    if (this.collections === undefined) {
      throw studioError('internal', 'vibe-studio: collection storage is not available', {
        reason: 'unavailable',
      })
    }
    return this.collections
  }

  private historyStore(): ApiHistoryStore {
    if (this.history === undefined) {
      throw studioError('internal', 'vibe-studio: request history is not available', {
        reason: 'unavailable',
      })
    }
    return this.history
  }

  /**
   * Store failures become stable, path-free StudioErrors. An error the service
   * raised itself (`collection_full`) is already stable and passes through:
   * otherwise the generic mapping would flatten it to `internal`.
   */
  private async withCollections<T>(operation: (store: ApiCollectionStore) => Promise<T>): Promise<T> {
    const store = this.collectionStore()
    try {
      return await operation(store)
    } catch (error) {
      if (isStudioError(error)) throw error
      throw toApiStoreStudioError(error)
    }
  }

  private async withHistory<T>(operation: (store: ApiHistoryStore) => Promise<T>): Promise<T> {
    const store = this.historyStore()
    try {
      return await operation(store)
    } catch (error) {
      if (isStudioError(error)) throw error
      throw toApiStoreStudioError(error)
    }
  }
}

/** Absent means "no checks"; anything else must be a short list of known shapes. */
function parseAssertions(value: unknown): readonly ApiAssertion[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > API_ASSERTIONS_MAX) {
    invalid(`assertions must be a list of at most ${API_ASSERTIONS_MAX} entries`, 'assertions')
  }
  if (!value.every(isApiAssertion)) invalid('assertions contains an unusable entry', 'assertions')
  return value
}

function collectionIdOf(params: unknown, method: string): string {
  if (!isRecord(params)) invalid(`${method} expects an object`, 'params')
  const id = params.id
  if (!isApiStoreId(id)) invalid('id is not a usable collection id', 'id')
  return id
}

/** Registers the workbench methods; returns one idempotent unregister function. */
export function registerApiMethods(registry: UnaryRegistry, service: ApiService): () => void {
  const unregister = [
    registry.register(API_HTTP_SEND_METHOD, (params, context) =>
      service.send(params, context.signal),
    ),
    registry.register(API_REPLAY_PREPARE_METHOD, (params) => service.prepareReplay(params)),
    registry.register(API_COLLECTION_LIST_METHOD, () => service.listCollections()),
    registry.register(API_COLLECTION_GET_METHOD, (params) => service.readCollection(params)),
    registry.register(API_COLLECTION_ADD_METHOD, (params) => service.addToCollection(params)),
    registry.register(API_COLLECTION_REMOVE_METHOD, (params) => service.removeCollection(params)),
    registry.register(API_HISTORY_LIST_METHOD, (params) => service.listHistory(params)),
    registry.register(API_HISTORY_CLEAR_METHOD, () => service.clearHistory()),
  ]
  return () => {
    for (const dispose of unregister) dispose()
  }
}
