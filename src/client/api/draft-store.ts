/**
 * Draft hand-off between the API page panels (T044).
 *
 * Four places load a request into the builder without sending it: capture
 * replay (preview drawer), the collection tree, the history list and a pasted
 * cURL command (T046 R2). The T043
 * store was consumed only on builder mount, which was enough for a tab switch
 * from the preview page but could never reach a builder that is already on
 * screen — the tree and the builder share the API tab and stay mounted.
 *
 * So a draft is either delivered straight to the registered builder or parked
 * until one mounts. Only one draft is ever pending; a later hand-off replaces
 * an earlier unconsumed one instead of queuing stale requests.
 */
import type { ApiReplayResult, HttpRequestSpec } from '../../contracts/api'

export type DraftSource = 'replay' | 'collection' | 'history' | 'curl'

/** Replay keeps the T043 banner: capture warnings and confirmation context. */
export interface PendingReplay {
  readonly entryId: string
  readonly method: string
  readonly url: string
  readonly result: ApiReplayResult
}

export interface PendingDraft {
  readonly spec: HttpRequestSpec
  readonly source: DraftSource
  /** Present for `source === 'replay'`. */
  readonly replay?: PendingReplay
}

export type DraftTarget = (draft: PendingDraft) => void

let pending: PendingDraft | null = null
let target: DraftTarget | null = null

/** Hands a draft to the builder, or parks it until one mounts. */
export function openDraftInBuilder(draft: PendingDraft): void {
  if (target !== null) {
    target(draft)
    return
  }
  pending = draft
}

/**
 * Called by the builder while mounted. A draft that arrived earlier is
 * delivered immediately, so the caller must be ready to render it.
 */
export function registerDraftTarget(next: DraftTarget): () => void {
  target = next
  if (pending !== null) {
    const draft = pending
    pending = null
    next(draft)
  }
  return () => {
    if (target === next) target = null
  }
}

/** Test helper between cases. */
export function resetDraftStore(): void {
  pending = null
  target = null
}
