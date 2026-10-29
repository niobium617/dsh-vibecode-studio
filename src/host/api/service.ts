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
  API_COLLECTION_DUPLICATE_METHOD,
  API_COLLECTION_REMOVE_METHOD,
  API_COLLECTION_RENAME_METHOD,
  API_ENV_GET_METHOD,
  API_ENV_LIST_METHOD,
  API_ENV_REMOVE_METHOD,
  API_ENV_SAVE_METHOD,
  API_HISTORY_CLEAR_METHOD,
  API_HISTORY_LIST_METHOD,
  API_HTTP_SEND_METHOD,
  API_NAME_CHARS_MAX,
  API_OPENAPI_IMPORT_METHOD,
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
  type ApiCollectionMutationResult,
  type ApiCollectionRemoveResult,
  type ApiCollectionSummaries,
  type ApiCollectionSummary,
  type ApiEnvironment,
  type ApiEnvironmentDetail,
  type ApiEnvironmentRemoveResult,
  type ApiEnvironmentSummaries,
  type ApiHistoryClearResult,
  type ApiHistoryPage,
  type ApiHistoryQuery,
  type ApiOpenApiImportResult,
  type ApiReplayResult,
  type ApiSavedRequest,
  type HttpExecutionResult,
  type HttpRequestSpec,
  type UnresolvedVariable,
} from '../../contracts/api'
import { evaluateAssertions } from './assertions'
import { isStudioError, studioError } from '../../contracts/errors'
import { MAX_UNARY_BODY_BYTES } from '../../contracts/transport'
import type { ApiCollectionStore } from './collection-store'
import { describeEnvironment, parseApiEnvironment, resolveHttpRequest } from './environment'
import { summarizeEnvironment, type ApiEnvironmentStore } from './environment-store'
import { createHttpExecutor, type HttpExecutor } from './executor'
import type { ApiHistoryStore } from './history-store'
import { importOpenApi as importOpenApiDocument, type OpenApiImportResult } from './openapi/mapper'
import { OpenApiError } from './openapi/parser'
import { prepareReplay as prepareReplayDraft } from './replay'
import { redactExecutionResult } from './result-redaction'
import type { ApiSecretStore } from './secrets'
import { toApiStoreStudioError } from './store-files'
import type { UnaryRegistry } from '../transport'

export {
  API_COLLECTION_ADD_METHOD,
  API_COLLECTION_DUPLICATE_METHOD,
  API_COLLECTION_GET_METHOD,
  API_COLLECTION_LIST_METHOD,
  API_COLLECTION_REMOVE_METHOD,
  API_COLLECTION_RENAME_METHOD,
  API_ENV_GET_METHOD,
  API_ENV_LIST_METHOD,
  API_ENV_REMOVE_METHOD,
  API_ENV_SAVE_METHOD,
  API_HISTORY_CLEAR_METHOD,
  API_HISTORY_LIST_METHOD,
  API_HTTP_SEND_METHOD,
  API_OPENAPI_IMPORT_METHOD,
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
  /** `.vibe/api/environments`; without it the environment methods report `internal`. */
  readonly environments?: ApiEnvironmentStore
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
  private readonly environments: ApiEnvironmentStore | undefined

  constructor(options: ApiServiceOptions) {
    this.executor = options.executor ?? createHttpExecutor()
    this.secrets = options.secrets
    this.collections = options.collections
    this.history = options.history
    this.environments = options.environments
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
    const environmentId = params.environmentId
    if (environmentId !== undefined) {
      if (!isApiStoreId(environmentId)) invalid('environmentId is not a usable id', 'environmentId')
      if (environment !== undefined) {
        invalid('send either environment or environmentId, not both', 'environmentId')
      }
    }
    const assertions = parseAssertions(params.assertions)
    const raw = params.request
    // A saved environment is loaded host-side; the panel only names it, so the
    // document (and its credential references) never has to round-trip.
    const activeEnvironment =
      environmentId === undefined ? environment : await this.loadEnvironment(environmentId)
    const resolved = await resolveHttpRequest(raw, {
      secrets: this.secrets,
      ...(activeEnvironment === undefined ? {} : { environment: activeEnvironment }),
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

  /**
   * Renames one collection in place (FR-API-05). The id stays, so the expanded
   * row, the loaded draft and any history entry that names it keep working;
   * only the display name changes. The Host trims and caps; a blank name is
   * refused before the store is touched.
   */
  async renameCollection(params: unknown): Promise<ApiCollectionMutationResult> {
    const id = collectionIdOf(params, 'api.collection.rename')
    const name = collectionNameOf(params, 'api.collection.rename')
    const renamed = await this.withCollections(async (store) => {
      if ((await store.read(id)) === null) throw collectionNotFound()
      return store.rename(id, name)
    })
    return { collection: summarizeCollection(renamed) }
  }

  /**
   * Copies one collection under a new slug id (FR-API-05). Everything nested
   * gets a new id, the source stays untouched, and a taken slug becomes `-2`,
   * `-3`, … instead of overwriting. The default name is `<source> copy`.
   */
  async duplicateCollection(params: unknown): Promise<ApiCollectionMutationResult> {
    const id = collectionIdOf(params, 'api.collection.duplicate')
    const requested = collectionNameOf(params, 'api.collection.duplicate', true)
    const copy = await this.withCollections(async (store) => {
      const source = await store.read(id)
      if (source === null) throw collectionNotFound()
      const name = (requested ?? `${source.name} copy`).slice(0, API_NAME_CHARS_MAX)
      const copyId = await freeCollectionId(store, collectionIdFrom(name))
      return store.duplicate(id, { id: copyId, name })
    })
    return { collection: summarizeCollection(copy) }
  }

  /**
   * Environment picker rows (FR-API-04). Only counts cross the wire here;
   * `readEnvironment` sends the document with a client-safe view attached.
   */
  async listEnvironments(): Promise<ApiEnvironmentSummaries> {
    const result = await this.withEnvironments((store) => store.list())
    return {
      environments: result.environments.map(summarizeEnvironment),
      skipped: result.skipped,
    }
  }

  /** One stored environment plus its `describe`-based view. */
  async readEnvironment(params: unknown): Promise<ApiEnvironmentDetail> {
    const id = environmentIdOf(params, 'api.env.get')
    return this.describeStoredEnvironment(id)
  }

  /**
   * Creates or replaces one environment. The document is validated host-side
   * (`parseApiEnvironment`), including "a secret names a credential rather
   * than holding a value"; a new environment gets a slug id, with `-2`, `-3`…
   * when the slug is taken. The response carries the saved document and its
   * view so the panel can show `configured` without a second round trip.
   */
  async saveEnvironment(params: unknown): Promise<ApiEnvironmentDetail> {
    if (!isRecord(params)) invalid('api.env.save expects an object', 'params')
    if (!isApiEnvironment(params.environment)) {
      invalid('environment is not a valid environment document', 'environment')
    }
    const parsed = parseApiEnvironment(params.environment)
    const name = parsed.name?.trim() ?? ''
    if (name === '' || name.length > API_NAME_CHARS_MAX) invalid('name is not usable', 'name')
    if (parsed.id !== undefined && !isApiStoreId(parsed.id)) {
      invalid('environment id is not usable', 'environment.id')
    }

    return this.withEnvironments(async (store) => {
      const id =
        parsed.id ?? (await freeEnvironmentId(store, environmentIdFrom(name)))
      const saved: ApiEnvironment = { id, name, variables: parsed.variables }
      await store.save(saved)
      return { environment: saved, view: await describeEnvironment(saved, this.secrets) }
    })
  }

  async removeEnvironment(params: unknown): Promise<ApiEnvironmentRemoveResult> {
    const id = environmentIdOf(params, 'api.env.remove')
    const removed = await this.withEnvironments((store) => store.remove(id))
    return { removed }
  }

  /**
   * Parses an OpenAPI 3.x / Swagger 2.0 document into a collection (FR-API-08).
   *
   * Everything that touches the document runs host-side: the panel sends text,
   * never a path and never a URL. The default remote policy allows no origin,
   * so a document's `$ref`s cannot make the Host fetch anything; only when a
   * caller explicitly allows an origin can `remoteDocumentCount` be non-zero.
   * Saving goes through `ApiCollectionStore.save`, which re-validates and
   * redacts every stored request.
   *
   * An import never overwrites an existing collection: if the document slug is
   * taken, a `-2`, `-3`, … suffix is allocated, so re-importing a document does
   * not discard edits made to the previous collection.
   */
  async importOpenApi(params: unknown): Promise<ApiOpenApiImportResult> {
    if (!isRecord(params)) invalid('api.openapi.import expects an object', 'params')
    const text = params.text
    if (typeof text !== 'string' || text.trim() === '') {
      invalid('text must be the document JSON', 'text')
    }
    if (Buffer.byteLength(text, 'utf8') >= MAX_UNARY_BODY_BYTES) {
      throw studioError('invalid_input', 'the document is too large for one import call', {
        reason: 'document_too_large',
        limitBytes: MAX_UNARY_BODY_BYTES,
      })
    }
    const requestedName = typeof params.name === 'string' ? params.name.trim() : ''
    if (requestedName.length > API_NAME_CHARS_MAX) invalid('name is not usable', 'name')

    let imported: OpenApiImportResult
    try {
      imported = await importOpenApiDocument(text, requestedName === '' ? {} : { name: requestedName })
    } catch (error) {
      throw toOpenApiImportError(error)
    }

    return this.withCollections(async (store) => {
      const savedId = await freeCollectionId(store, imported.collection.id)
      const collection: ApiCollection =
        savedId === imported.collection.id ? imported.collection : { ...imported.collection, id: savedId }
      await store.save(collection)
      return {
        collection: summarizeCollection(collection),
        version: imported.version,
        title: imported.title,
        endpointCount: imported.endpoints.length,
        groupCount: imported.groups.length,
        skipped: imported.skipped,
        warnings: summarizeImportWarnings(imported.warnings),
        remoteDocumentCount: imported.remoteDocuments.length,
      }
    })
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

  private environmentStore(): ApiEnvironmentStore {
    if (this.environments === undefined) {
      throw studioError('internal', 'vibe-studio: environment storage is not available', {
        reason: 'unavailable',
      })
    }
    return this.environments
  }

  /** Reads one stored environment or fails with a stable `not_found`. */
  private async loadEnvironment(id: string): Promise<ApiEnvironment> {
    const found = await this.withEnvironments((store) => store.read(id))
    if (found === null) {
      throw studioError('not_found', 'vibe-studio: environment not found', {
        reason: 'not_found',
      })
    }
    return found
  }

  private async describeStoredEnvironment(id: string): Promise<ApiEnvironmentDetail> {
    const environment = await this.loadEnvironment(id)
    return { environment, view: await describeEnvironment(environment, this.secrets) }
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

  private async withEnvironments<T>(
    operation: (store: ApiEnvironmentStore) => Promise<T>,
  ): Promise<T> {
    const store = this.environmentStore()
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

function collectionNotFound(): never {
  throw studioError('not_found', 'vibe-studio: collection not found', { reason: 'not_found' })
}

/**
 * Display name for rename / duplicate. Trimmed, non-empty and capped like a
 * save; `optional` lets a bare duplicate fall back to `<source> copy`.
 */
function collectionNameOf(
  params: unknown,
  method: string,
  optional?: false,
): string
function collectionNameOf(
  params: unknown,
  method: string,
  optional: true,
): string | undefined
function collectionNameOf(
  params: unknown,
  method: string,
  optional = false,
): string | undefined {
  if (!isRecord(params)) invalid(`${method} expects an object`, 'params')
  const raw = params.name
  if (raw === undefined && optional) return undefined
  if (typeof raw !== 'string') invalid('name is not usable', 'name')
  const name = raw.trim()
  if (name === '' || name.length > API_NAME_CHARS_MAX) invalid('name is not usable', 'name')
  return name
}

/** Collection ids come from the title; a CJK-only title falls back to `collection`. */
function collectionIdFrom(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[-.]+$/, '')
    .slice(0, 64)
  return isApiStoreId(slug) ? slug : 'collection'
}

function environmentIdOf(params: unknown, method: string): string {
  if (!isRecord(params)) invalid(`${method} expects an object`, 'params')
  const id = params.id
  if (!isApiStoreId(id)) invalid('id is not a usable environment id', 'id')
  return id
}

/**
 * New-environment ids come from the display name; a name with no usable
 * characters (for example all CJK) falls back to `env`. The id pattern caps
 * the stem at 64 characters.
 */
function environmentIdFrom(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[-.]+$/, '')
    .slice(0, 64)
  return isApiStoreId(slug) ? slug : 'env'
}

/** Same never-overwrite policy as collections: `env`, `env-2`, `env-3`, … */
async function freeEnvironmentId(store: ApiEnvironmentStore, base: string): Promise<string> {
  if ((await store.read(base)) === null) return base
  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const marker = `-${suffix}`
    const candidate = `${base.slice(0, 64 - marker.length)}${marker}`
    if ((await store.read(candidate)) === null) return candidate
  }
  throw studioError('invalid_input', 'too many environments share this name; rename or remove some first', {
    reason: 'environment_exists',
  })
}

/**
 * `pets` taken → `pets-2`, `pets-3`, … The id pattern caps the stem at 64
 * characters, so the suffix is carved out of the base rather than appended
 * blindly. Refusing after 99 attempts keeps a runaway loop from hammering the
 * disk; at that point the user has ~100 collections with the same title.
 */
async function freeCollectionId(store: ApiCollectionStore, base: string): Promise<string> {
  if ((await store.read(base)) === null) return base
  for (let suffix = 2; suffix <= 99; suffix += 1) {
    const marker = `-${suffix}`
    const candidate = `${base.slice(0, 64 - marker.length)}${marker}`
    if ((await store.read(candidate)) === null) return candidate
  }
  throw studioError('invalid_input', 'too many collections share this title; rename or remove some first', {
    reason: 'collection_exists',
  })
}

/** Import failures are typed by the parser; the client localises known reasons. */
function toOpenApiImportError(error: unknown): never {
  if (error instanceof OpenApiError) {
    const blocked = error.code === 'remote_ref_blocked' || error.code === 'remote_ref_redirect'
    throw studioError(blocked ? 'permission_denied' : 'invalid_input', error.message, {
      reason: error.code,
      ...(error.pointer === undefined ? {} : { pointer: error.pointer }),
    })
  }
  throw error
}

const IMPORT_WARNINGS_MAX = 20
const IMPORT_WARNING_CHARS_MAX = 200

/** Warnings are code-shaped, but the list still gets a cheap bound. */
function summarizeImportWarnings(warnings: readonly string[]): readonly string[] {
  const kept: string[] = []
  const seen = new Set<string>()
  for (const warning of warnings) {
    const text = warning.replace(/[\r\n]+/g, ' ').trim().slice(0, IMPORT_WARNING_CHARS_MAX)
    if (text === '' || seen.has(text)) continue
    seen.add(text)
    kept.push(text)
    if (kept.length >= IMPORT_WARNINGS_MAX) break
  }
  return kept
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
    registry.register(API_COLLECTION_RENAME_METHOD, (params) => service.renameCollection(params)),
    registry.register(API_COLLECTION_DUPLICATE_METHOD, (params) =>
      service.duplicateCollection(params),
    ),
    registry.register(API_HISTORY_LIST_METHOD, (params) => service.listHistory(params)),
    registry.register(API_HISTORY_CLEAR_METHOD, () => service.clearHistory()),
    registry.register(API_OPENAPI_IMPORT_METHOD, (params) => service.importOpenApi(params)),
    registry.register(API_ENV_LIST_METHOD, () => service.listEnvironments()),
    registry.register(API_ENV_GET_METHOD, (params) => service.readEnvironment(params)),
    registry.register(API_ENV_SAVE_METHOD, (params) => service.saveEnvironment(params)),
    registry.register(API_ENV_REMOVE_METHOD, (params) => service.removeEnvironment(params)),
  ]
  return () => {
    for (const dispose of unregister) dispose()
  }
}
