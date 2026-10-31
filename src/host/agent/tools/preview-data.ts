/**
 * T048: shared reads over the preview/telemetry contracts.
 *
 * The tool schemas use a slightly different vocabulary from the panel
 * (`closed` instead of `idle`), and "failed request" means either a transport
 * error or an HTTP error status. Both are defined once here so `vibe_status`
 * and `vibe_observe` can never disagree.
 */
import type { ConsoleEntry, NetworkEntry } from '../../../contracts/telemetry'
import { isNetworkFailure } from '../../../contracts/telemetry'
import type { PreviewSessionState } from '../../../contracts/transport'

/** Re-exported so the tools keep one import path (definition in contracts). */
export { isNetworkFailure }

/** State value the tool schemas accept (see `PREVIEW_STATES`). */
export type ToolPreviewState = 'starting' | 'ready' | 'degraded' | 'failed' | 'closed'

/** `idle` is the panel's "no session"; to the model that is simply closed. */
export function toToolPreviewState(state: PreviewSessionState): ToolPreviewState {
  switch (state) {
    case 'ready':
      return 'ready'
    case 'failed':
      return 'failed'
    default:
      return 'closed'
  }
}

export function countConsoleErrors(entries: readonly ConsoleEntry[]): number {
  let errors = 0
  for (const entry of entries) if (entry.level === 'error') errors += 1
  return errors
}

export function countNetworkFailures(entries: readonly NetworkEntry[]): number {
  let failed = 0
  for (const entry of entries) if (isNetworkFailure(entry)) failed += 1
  return failed
}

/** Error text safe to put in a summary: one host-generated line, bounded. */
export function describePreviewError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown error'
  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate.code === 'string' ? candidate.code : 'internal'
  const message = typeof candidate.message === 'string' ? candidate.message : 'preview error'
  return `${code}: ${message.slice(0, 200)}`
}
