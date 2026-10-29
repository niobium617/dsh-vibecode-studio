/**
 * Send-log store for the API page (T044).
 *
 * `.vibe/api/history.json` is owned by the Host; search runs there so the panel
 * only ever holds one page (50 rows by default, 200 at most). The store keeps
 * the query, the page size and the last result across internal tab switches,
 * mirrors the annotation history store, and never sends anything — opening an
 * entry only refills the builder.
 */
import * as React from 'react'
import {
  API_HISTORY_CLEAR_METHOD,
  API_HISTORY_ENTRIES_MAX,
  API_HISTORY_LIMIT_DEFAULT,
  API_HISTORY_LIST_METHOD,
  API_HISTORY_QUERY_CHARS_MAX,
  type ApiHistoryClearResult,
  type ApiHistoryEntry,
  type ApiHistoryPage,
  type ApiHistoryQuery,
} from '../../contracts/api'
import { callUnary } from '../transport'

export interface ApiHistoryApi {
  list(query?: ApiHistoryQuery): Promise<ApiHistoryPage>
  clear(): Promise<ApiHistoryClearResult>
}

/** Default transport-backed implementation; tests inject a fake. */
export const hostApiHistoryApi: ApiHistoryApi = {
  list: (query) =>
    callUnary<ApiHistoryPage>(API_HISTORY_LIST_METHOD, query === undefined ? undefined : query),
  clear: () => callUnary<ApiHistoryClearResult>(API_HISTORY_CLEAR_METHOD),
}

export type ApiHistoryStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ApiHistoryState {
  readonly query: string
  /** Rows asked from the Host per page; 1..API_HISTORY_ENTRIES_MAX. */
  readonly limit: number
  readonly entries: readonly ApiHistoryEntry[]
  readonly total: number
  readonly skipped: number
  readonly status: ApiHistoryStatus
  /** Raw message; the component picks a translation. */
  readonly error: string | null
}

const EMPTY_STATE: ApiHistoryState = {
  query: '',
  limit: API_HISTORY_LIMIT_DEFAULT,
  entries: [],
  total: 0,
  skipped: 0,
  status: 'idle',
  error: null,
}

let api: ApiHistoryApi = hostApiHistoryApi
let state: ApiHistoryState = EMPTY_STATE
let requestSeq = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function apiHistorySnapshot(): ApiHistoryState {
  return state
}

export function subscribeApiHistory(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useApiHistory(): ApiHistoryState {
  return React.useSyncExternalStore(subscribeApiHistory, apiHistorySnapshot, apiHistorySnapshot)
}

/** Tests swap in a fake; the panel always uses the transport-backed API. */
export function setApiHistoryApi(next: ApiHistoryApi): void {
  api = next
}

/** Clears cached rows and the query; does not touch `.vibe`. */
export function resetApiHistoryStore(): void {
  requestSeq += 1
  api = hostApiHistoryApi
  state = EMPTY_STATE
  emit()
}

function queryOf(query: string, limit: number): ApiHistoryQuery {
  const trimmed = query.trim()
  return { ...(trimmed === '' ? {} : { query: trimmed }), limit }
}

/** Clamps a requested page size to what the Host accepts. */
function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return API_HISTORY_LIMIT_DEFAULT
  return Math.min(Math.max(Math.trunc(limit), 1), API_HISTORY_ENTRIES_MAX)
}

/** Loads the current query; the newest request wins. */
export async function loadApiHistory(): Promise<void> {
  const seq = (requestSeq += 1)
  state = { ...state, status: 'loading', error: null }
  emit()
  try {
    const result = await api.list(queryOf(state.query, state.limit))
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

export function searchApiHistory(query: string): void {
  const next = query.slice(0, API_HISTORY_QUERY_CHARS_MAX)
  if (next === state.query) return
  state = { ...state, query: next }
  emit()
  void loadApiHistory()
}

/** Changes how many rows one page holds and reloads it; the query is kept. */
export function setApiHistoryLimit(limit: number): void {
  const next = clampLimit(limit)
  if (next === state.limit) return
  state = { ...state, limit: next }
  emit()
  void loadApiHistory()
}

/** Deletes the whole send log; rejects so the dialog can report failure. */
export async function clearApiHistory(): Promise<boolean> {
  const result = await api.clear()
  state = { ...state, entries: [], total: 0, skipped: 0 }
  emit()
  await loadApiHistory()
  return result.cleared
}
