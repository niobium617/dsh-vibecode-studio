/**
 * Annotation history store (T033), in the same module-level style as the T031
 * queue: the list and its search box survive internal tab switches, and the
 * preview page can persist a fresh annotation without mounting the panel.
 *
 * The Host owns `.vibe/annotations`; this module never touches the filesystem
 * and never sends anything to the chat. Saving is local history only, opening
 * an entry puts it back in the queue for an explicit send.
 */
import {
  ANNOTATION_HISTORY_QUERY_MAX_CHARS,
  type Annotation,
  type AnnotationHistoryQuery,
  type AnnotationHistoryRemoveResult,
  type AnnotationHistoryResult,
  type AnnotationHistorySaveResult,
} from '../../contracts/annotation'
import * as React from 'react'
import {
  ANNOTATION_HISTORY_GET_METHOD,
  ANNOTATION_HISTORY_LIST_METHOD,
  ANNOTATION_HISTORY_REMOVE_METHOD,
  ANNOTATION_HISTORY_SAVE_METHOD,
} from '../../contracts/transport'
import { callUnary } from '../transport/client'
import { addAnnotationToQueue } from './AnnotationQueue'

export interface AnnotationHistoryApi {
  list(query?: AnnotationHistoryQuery): Promise<AnnotationHistoryResult>
  read(id: string): Promise<Annotation>
  save(annotation: Annotation): Promise<AnnotationHistorySaveResult>
  remove(id: string): Promise<AnnotationHistoryRemoveResult>
}

/** Default transport-backed implementation; tests inject a fake. */
export const hostAnnotationHistoryApi: AnnotationHistoryApi = {
  list: (query) =>
    callUnary<AnnotationHistoryResult>(
      ANNOTATION_HISTORY_LIST_METHOD,
      query === undefined ? undefined : query,
    ),
  read: (id) => callUnary<Annotation>(ANNOTATION_HISTORY_GET_METHOD, { id }),
  save: (annotation) =>
    callUnary<AnnotationHistorySaveResult>(ANNOTATION_HISTORY_SAVE_METHOD, annotation),
  remove: (id) =>
    callUnary<AnnotationHistoryRemoveResult>(ANNOTATION_HISTORY_REMOVE_METHOD, { id }),
}

export type AnnotationHistoryStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface AnnotationHistoryState {
  readonly query: string
  readonly entries: AnnotationHistoryResult['entries']
  readonly total: number
  readonly skipped: number
  readonly status: AnnotationHistoryStatus
  /** Translated by the component; raw host/transport message is kept here. */
  readonly error: string | null
}

const EMPTY_STATE: AnnotationHistoryState = {
  query: '',
  entries: [],
  total: 0,
  skipped: 0,
  status: 'idle',
  error: null,
}

let api: AnnotationHistoryApi = hostAnnotationHistoryApi
let state: AnnotationHistoryState = EMPTY_STATE
let requestSeq = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/** Stable until the next mutation, as `useSyncExternalStore` requires. */
export function annotationHistorySnapshot(): AnnotationHistoryState {
  return state
}

export function subscribeAnnotationHistory(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAnnotationHistory(): AnnotationHistoryState {
  return React.useSyncExternalStore(
    subscribeAnnotationHistory,
    annotationHistorySnapshot,
    annotationHistorySnapshot,
  )
}

/** Tests swap in a fake; the panel always uses the transport-backed API. */
export function setAnnotationHistoryApi(next: AnnotationHistoryApi): void {
  api = next
}

/** Clears cached entries and pending loads; does not touch `.vibe`. */
export function resetAnnotationHistoryStore(): void {
  requestSeq += 1
  api = hostAnnotationHistoryApi
  state = EMPTY_STATE
  emit()
}

function requestQuery(query: string): AnnotationHistoryQuery | undefined {
  const trimmed = query.trim()
  return trimmed === '' ? undefined : { query: trimmed }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Loads the current query from the Host. `requestSeq` makes the newest request
 * win so fast typing cannot leave an older result on screen.
 */
export async function loadAnnotationHistory(): Promise<void> {
  const seq = (requestSeq += 1)
  state = { ...state, status: 'loading', error: null }
  emit()
  try {
    const result = await api.list(requestQuery(state.query))
    if (seq !== requestSeq) return
    state = {
      ...state,
      entries: result.entries,
      total: result.total,
      skipped: result.skipped,
      status: 'ready',
      error: null,
    }
    emit()
  } catch (error) {
    if (seq !== requestSeq) return
    state = { ...state, status: 'error', error: errorMessage(error) }
    emit()
  }
}

export function searchAnnotationHistory(query: string): void {
  const next = query.slice(0, ANNOTATION_HISTORY_QUERY_MAX_CHARS)
  if (next === state.query) return
  state = { ...state, query: next }
  emit()
  void loadAnnotationHistory()
}

/**
 * Persists one annotation (new or edited) and refreshes the cached list.
 * Returns `false` instead of throwing so the preview bubble can warn without
 * losing the queued draft.
 */
export async function persistAnnotation(annotation: Annotation): Promise<boolean> {
  try {
    await api.save(annotation)
  } catch {
    return false
  }
  void loadAnnotationHistory()
  return true
}

/** Opens one entry back into the queue for editing or an explicit send. */
export async function reopenAnnotationFromHistory(id: string): Promise<Annotation> {
  const annotation = await api.read(id)
  if (!addAnnotationToQueue(annotation)) {
    throw new Error('vibe-studio: the stored annotation is not usable')
  }
  return annotation
}

/** Deletes one file and refreshes the list; throws so the panel can report it. */
export async function removeHistoryAnnotation(id: string): Promise<boolean> {
  const result = await api.remove(id)
  await loadAnnotationHistory()
  return result.removed
}
