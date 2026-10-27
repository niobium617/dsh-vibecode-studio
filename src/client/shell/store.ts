/**
 * Shell UI state lives outside React so an internal tab survives remounts as
 * well as sidebar tab switches. DSH's `keepMounted` keeps the pane alive;
 * this store keeps the selected page across a forced unmount (tests, reload
 * of the pane) within the same client session.
 */
import { useSyncExternalStore } from 'react'
import { DEFAULT_TAB, isStudioTab, type StudioTabId } from './tabs'

export interface ShellState {
  readonly activeTab: StudioTabId
}

let state: ShellState = { activeTab: DEFAULT_TAB }
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getShellState(): ShellState {
  return state
}

export function subscribeShell(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setActiveTab(tab: StudioTabId): void {
  if (!isStudioTab(tab) || state.activeTab === tab) return
  state = { activeTab: tab }
  emit()
}

/** Test helper: restore the default page and drop subscribers. */
export function resetShellStore(): void {
  state = { activeTab: DEFAULT_TAB }
  listeners.clear()
  emit()
}

export function useShellState(): ShellState {
  return useSyncExternalStore(subscribeShell, getShellState, getShellState)
}
