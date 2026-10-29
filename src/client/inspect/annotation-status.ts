/**
 * Per-annotation status notices (U02).
 *
 * The queue and the history render the same annotation id in two different
 * lists, so a notice belongs to the annotation rather than to a list footer:
 * sending from the queue updates the history card next to its "Delete" button,
 * and removing the queued draft clears that same notice. Keeping the map at
 * module level also means it survives internal tab switches, like the queue.
 */
import * as React from 'react'

export interface AnnotationStatus {
  readonly kind: 'success' | 'error'
  readonly message: string
}

let statuses: ReadonlyMap<string, AnnotationStatus> = new Map()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/** Stable until the next mutation, as `useSyncExternalStore` requires. */
export function annotationStatusSnapshot(): ReadonlyMap<string, AnnotationStatus> {
  return statuses
}

export function subscribeAnnotationStatus(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useAnnotationStatuses(): ReadonlyMap<string, AnnotationStatus> {
  return React.useSyncExternalStore(
    subscribeAnnotationStatus,
    annotationStatusSnapshot,
    annotationStatusSnapshot,
  )
}

export function getAnnotationStatus(id: string): AnnotationStatus | null {
  return statuses.get(id) ?? null
}

export function setAnnotationStatus(id: string, status: AnnotationStatus): void {
  const current = statuses.get(id)
  if (current?.kind === status.kind && current.message === status.message) return
  const next = new Map(statuses)
  next.set(id, status)
  statuses = next
  emit()
}

/** Used when the queued draft is removed: the history notice no longer applies. */
export function clearAnnotationStatus(id: string): void {
  if (!statuses.has(id)) return
  const next = new Map(statuses)
  next.delete(id)
  statuses = next
  emit()
}

export function clearAllAnnotationStatuses(): void {
  if (statuses.size === 0) return
  statuses = new Map()
  emit()
}
