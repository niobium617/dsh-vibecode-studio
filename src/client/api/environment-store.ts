/**
 * Environment store (T046 R4, FR-API-04).
 *
 * Mirrors the collection store: the Host owns `.vibe/api/environments`, this
 * module caches the picker rows and the one selected document, and the panel
 * edits a draft. The selected environment id is what a send names, so the
 * resolved values never leave the Host.
 *
 * Module-level state keeps the selection alive across internal tab switches;
 * tests inject a fake API and reset between cases.
 */
import * as React from 'react'
import {
  API_ENV_GET_METHOD,
  API_ENV_LIST_METHOD,
  API_ENV_REMOVE_METHOD,
  API_ENV_SAVE_METHOD,
  type ApiEnvironment,
  type ApiEnvironmentDetail,
  type ApiEnvironmentRemoveResult,
  type ApiEnvironmentSummaries,
  type ApiEnvironmentSummary,
} from '../../contracts/api'
import { callUnary } from '../transport'

export interface ApiEnvironmentApi {
  list(): Promise<ApiEnvironmentSummaries>
  read(id: string): Promise<ApiEnvironmentDetail>
  save(environment: ApiEnvironment): Promise<ApiEnvironmentDetail>
  remove(id: string): Promise<ApiEnvironmentRemoveResult>
}

/** Default transport-backed implementation; tests inject a fake. */
export const hostApiEnvironmentApi: ApiEnvironmentApi = {
  list: () => callUnary<ApiEnvironmentSummaries>(API_ENV_LIST_METHOD),
  read: (id) => callUnary<ApiEnvironmentDetail>(API_ENV_GET_METHOD, { id }),
  save: (environment) => callUnary<ApiEnvironmentDetail>(API_ENV_SAVE_METHOD, { environment }),
  remove: (id) => callUnary<ApiEnvironmentRemoveResult>(API_ENV_REMOVE_METHOD, { id }),
}

export type ApiEnvironmentStatus = 'idle' | 'loading' | 'ready' | 'error'
export type ApiEnvironmentDetailStatus = 'idle' | 'loading' | 'error'

export interface ApiEnvironmentState {
  readonly status: ApiEnvironmentStatus
  readonly summaries: readonly ApiEnvironmentSummary[]
  readonly skipped: number
  /** Raw transport/host message; components translate their own wording. */
  readonly error: string | null
  /** The environment a send names; `null` means no `{{}}` expansion. */
  readonly activeId: string | null
  readonly active: ApiEnvironmentDetail | null
  readonly activeStatus: ApiEnvironmentDetailStatus
}

const EMPTY_STATE: ApiEnvironmentState = {
  status: 'idle',
  summaries: [],
  skipped: 0,
  error: null,
  activeId: null,
  active: null,
  activeStatus: 'idle',
}

let api: ApiEnvironmentApi = hostApiEnvironmentApi
let state: ApiEnvironmentState = EMPTY_STATE
let listSeq = 0
let detailSeq = 0
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function apiEnvironmentSnapshot(): ApiEnvironmentState {
  return state
}

export function subscribeApiEnvironments(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useApiEnvironments(): ApiEnvironmentState {
  return React.useSyncExternalStore(
    subscribeApiEnvironments,
    apiEnvironmentSnapshot,
    apiEnvironmentSnapshot,
  )
}

/** Tests swap in a fake; the panel always uses the transport-backed API. */
export function setApiEnvironmentApi(next: ApiEnvironmentApi): void {
  api = next
}

/** Clears cached rows and the selection; does not touch `.vibe`. */
export function resetApiEnvironmentStore(): void {
  listSeq += 1
  detailSeq += 1
  api = hostApiEnvironmentApi
  state = EMPTY_STATE
  emit()
}

/** Refreshes the picker; the newest call wins so quick saves cannot regress it. */
export async function loadEnvironments(): Promise<void> {
  const seq = (listSeq += 1)
  state = { ...state, status: 'loading', error: null }
  emit()
  try {
    const result = await api.list()
    if (seq !== listSeq) return
    state = {
      ...state,
      status: 'ready',
      summaries: result.environments,
      skipped: result.skipped,
      error: null,
    }
    emit()
  } catch (error) {
    if (seq !== listSeq) return
    state = { ...state, status: 'error', error: errorMessage(error) }
    emit()
  }
}

/**
 * Selects the environment a send names, or `null` for none. A selection loads
 * its document so the editor can show the references and their `configured`
 * state.
 */
export async function selectEnvironment(id: string | null): Promise<void> {
  const seq = (detailSeq += 1)
  if (id === null) {
    state = { ...state, activeId: null, active: null, activeStatus: 'idle' }
    emit()
    return
  }
  state = { ...state, activeId: id, active: null, activeStatus: 'loading' }
  emit()
  try {
    const detail = await api.read(id)
    if (seq !== detailSeq) return
    state = { ...state, active: detail, activeStatus: 'idle' }
    emit()
  } catch (error) {
    if (seq !== detailSeq) return
    state = { ...state, active: null, activeStatus: 'error', error: errorMessage(error) }
    emit()
  }
}

/**
 * Saves one environment (create or replace) and makes it active. The Host
 * returns the saved document plus its client-safe view; the picker is
 * refreshed so a new id appears immediately.
 */
export async function saveEnvironment(environment: ApiEnvironment): Promise<ApiEnvironmentDetail> {
  const detail = await api.save(environment)
  const id = detail.environment.id ?? null
  state = {
    ...state,
    activeId: id,
    active: detail,
    activeStatus: 'idle',
  }
  emit()
  await loadEnvironments()
  return detail
}

/** Deletes one environment and clears the selection when it was active. */
export async function removeEnvironment(id: string): Promise<boolean> {
  const result = await api.remove(id)
  if (state.activeId === id) {
    state = { ...state, activeId: null, active: null, activeStatus: 'idle' }
    emit()
  }
  await loadEnvironments()
  return result.removed
}
