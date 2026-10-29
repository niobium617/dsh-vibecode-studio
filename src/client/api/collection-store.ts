/**
 * Collection tree store (T044).
 *
 * The Host owns `.vibe/api/collections`; this module only caches summaries for
 * the tree and one loaded document per expanded collection. Saving appends a
 * single request through `api.collection.add` — the whole collection never
 * crosses the 64 KiB unary envelope, so an imported collection stays editable.
 *
 * Module-level state (same style as the annotation history store) keeps the
 * tree alive across internal tab switches; tests inject a fake API and reset
 * between cases.
 */
import * as React from 'react'
import {
  API_COLLECTION_ADD_METHOD,
  API_COLLECTION_DUPLICATE_METHOD,
  API_COLLECTION_GET_METHOD,
  API_COLLECTION_LIST_METHOD,
  API_COLLECTION_REMOVE_METHOD,
  API_COLLECTION_RENAME_METHOD,
  API_NAME_CHARS_MAX,
  type ApiCollection,
  type ApiCollectionAddParams,
  type ApiCollectionAddResult,
  type ApiCollectionMutationResult,
  type ApiCollectionRemoveResult,
  type ApiCollectionSummaries,
  type ApiCollectionSummary,
  type HttpRequestSpec,
} from '../../contracts/api'
import { callUnary } from '../transport'

/** First save creates this collection; later saves append to it. */
export const DEFAULT_COLLECTION_ID = 'saved'

export interface ApiCollectionApi {
  list(): Promise<ApiCollectionSummaries>
  read(id: string): Promise<ApiCollection>
  add(params: ApiCollectionAddParams): Promise<ApiCollectionAddResult>
  remove(id: string): Promise<ApiCollectionRemoveResult>
  rename(id: string, name: string): Promise<ApiCollectionMutationResult>
  duplicate(id: string, name?: string): Promise<ApiCollectionMutationResult>
}

/** Default transport-backed implementation; tests inject a fake. */
export const hostApiCollectionApi: ApiCollectionApi = {
  list: () => callUnary<ApiCollectionSummaries>(API_COLLECTION_LIST_METHOD),
  read: (id) => callUnary<ApiCollection>(API_COLLECTION_GET_METHOD, { id }),
  add: (params) => callUnary<ApiCollectionAddResult>(API_COLLECTION_ADD_METHOD, params),
  remove: (id) => callUnary<ApiCollectionRemoveResult>(API_COLLECTION_REMOVE_METHOD, { id }),
  rename: (id, name) =>
    callUnary<ApiCollectionMutationResult>(API_COLLECTION_RENAME_METHOD, { id, name }),
  duplicate: (id, name) =>
    callUnary<ApiCollectionMutationResult>(API_COLLECTION_DUPLICATE_METHOD, {
      id,
      ...(name === undefined ? {} : { name }),
    }),
}

export type ApiCollectionStatus = 'idle' | 'loading' | 'ready' | 'error'
export type ApiCollectionDetailStatus = 'loading' | 'error'

export interface ApiCollectionState {
  readonly status: ApiCollectionStatus
  readonly summaries: readonly ApiCollectionSummary[]
  readonly skipped: number
  /** Raw transport/host message; components translate their own wording. */
  readonly error: string | null
  readonly expanded: readonly string[]
  readonly details: Readonly<Record<string, ApiCollection>>
  readonly detailStatus: Readonly<Record<string, ApiCollectionDetailStatus>>
}

const EMPTY_STATE: ApiCollectionState = {
  status: 'idle',
  summaries: [],
  skipped: 0,
  error: null,
  expanded: [],
  details: {},
  detailStatus: {},
}

let api: ApiCollectionApi = hostApiCollectionApi
let state: ApiCollectionState = EMPTY_STATE
let listSeq = 0
const detailSeq = new Map<string, number>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function apiCollectionSnapshot(): ApiCollectionState {
  return state
}

export function subscribeApiCollections(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useApiCollections(): ApiCollectionState {
  return React.useSyncExternalStore(
    subscribeApiCollections,
    apiCollectionSnapshot,
    apiCollectionSnapshot,
  )
}

/** Tests swap in a fake; the panel always uses the transport-backed API. */
export function setApiCollectionApi(next: ApiCollectionApi): void {
  api = next
}

/** Clears cached rows and pending loads; does not touch `.vibe`. */
export function resetApiCollectionStore(): void {
  listSeq += 1
  detailSeq.clear()
  api = hostApiCollectionApi
  state = EMPTY_STATE
  emit()
}

/** Display name for a save: method plus the last URL segment. */
export function requestNameOf(spec: HttpRequestSpec): string {
  let leaf = ''
  try {
    const url = new URL(spec.url)
    leaf = url.pathname === '/' || url.pathname === '' ? url.host : url.pathname
  } catch {
    leaf = spec.url
  }
  return `${spec.method} ${leaf}`.slice(0, API_NAME_CHARS_MAX)
}

/** Refreshes the tree; the newest call wins so quick saves cannot regress it. */
export async function loadCollections(): Promise<void> {
  const seq = (listSeq += 1)
  state = { ...state, status: 'loading', error: null }
  emit()
  try {
    const result = await api.list()
    if (seq !== listSeq) return
    const known = new Set(result.collections.map((collection) => collection.id))
    state = {
      ...state,
      status: 'ready',
      summaries: result.collections,
      skipped: result.skipped,
      error: null,
      expanded: state.expanded.filter((id) => known.has(id)),
    }
    emit()
  } catch (error) {
    if (seq !== listSeq) return
    state = { ...state, status: 'error', error: errorMessage(error) }
    emit()
  }
}

/** Loads one collection document for the expanded tree. */
export async function loadCollectionDetail(id: string): Promise<void> {
  const seq = (detailSeq.get(id) ?? 0) + 1
  detailSeq.set(id, seq)
  state = {
    ...state,
    detailStatus: { ...state.detailStatus, [id]: 'loading' },
  }
  emit()
  try {
    const collection = await api.read(id)
    if (detailSeq.get(id) !== seq) return
    const { [id]: _loading, ...rest } = state.detailStatus
    state = {
      ...state,
      details: { ...state.details, [id]: collection },
      detailStatus: rest,
    }
    emit()
  } catch (error) {
    if (detailSeq.get(id) !== seq) return
    state = {
      ...state,
      detailStatus: { ...state.detailStatus, [id]: 'error' },
    }
    emit()
  }
}

/** Expands or collapses one collection; expanding loads it on demand. */
export function toggleCollection(id: string): void {
  if (state.expanded.includes(id)) {
    state = { ...state, expanded: state.expanded.filter((item) => item !== id) }
    emit()
    return
  }
  state = { ...state, expanded: [...state.expanded, id] }
  emit()
  if (state.details[id] === undefined) void loadCollectionDetail(id)
}

/**
 * Appends one request to the default collection, then refreshes and expands
 * it so the saved row is one click away. Rejects so the builder can report a
 * failed save instead of showing a silent success.
 */
export async function saveRequestToCollection(
  spec: HttpRequestSpec,
  collectionName: string,
): Promise<ApiCollectionAddResult> {
  const result = await api.add({
    collectionId: DEFAULT_COLLECTION_ID,
    collectionName: collectionName.slice(0, API_NAME_CHARS_MAX),
    name: requestNameOf(spec),
    request: spec,
  })
  await loadCollections()
  const { [result.collectionId]: _stale, ...details } = state.details
  state = {
    ...state,
    details,
    expanded: state.expanded.includes(result.collectionId)
      ? state.expanded
      : [...state.expanded, result.collectionId],
  }
  emit()
  await loadCollectionDetail(result.collectionId)
  return result
}

/**
 * Refreshes the tree and shows a collection that just appeared (an OpenAPI
 * import). Unlike `toggleCollection` it never collapses an open collection.
 */
export async function revealCollection(id: string): Promise<void> {
  await loadCollections()
  if (!state.expanded.includes(id)) {
    state = { ...state, expanded: [...state.expanded, id] }
    emit()
  }
  if (state.details[id] === undefined && state.detailStatus[id] === undefined) {
    await loadCollectionDetail(id)
  }
}

/**
 * Renames one collection in place (FR-API-05). The id is unchanged, so the
 * expanded row and its cached document stay put; only the row label changes.
 * Rejects so the tree can report a failed rename instead of a silent success.
 */
export async function renameCollection(
  id: string,
  name: string,
): Promise<ApiCollectionSummary> {
  const result = await api.rename(id, name)
  await loadCollections()
  return result.collection
}

/**
 * Copies one collection and reveals the copy (FR-API-05). The Host picks a
 * fresh id; `revealCollection` refreshes the tree and opens the new row.
 */
export async function duplicateCollection(
  id: string,
  name?: string,
): Promise<ApiCollectionMutationResult> {
  const result = await api.duplicate(id, name)
  await revealCollection(result.collection.id)
  return result
}

/** Deletes one collection and forgets its cached document. */
export async function removeCollection(id: string): Promise<boolean> {
  const result = await api.remove(id)
  const { [id]: _detail, ...details } = state.details
  state = {
    ...state,
    details,
    expanded: state.expanded.filter((item) => item !== id),
  }
  await loadCollections()
  return result.removed
}
