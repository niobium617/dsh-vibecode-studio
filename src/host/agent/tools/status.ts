/**
 * T048: `vibe_status` — one cheap call answering "is the preview running and is
 * anything broken?".
 *
 * Everything here is host-owned state (session snapshot, bounded console and
 * network buffers, annotation file count), so the result is small by
 * construction and never needs a page evaluation. No page content is included:
 * counts only, which keeps the untrusted boundary out of the status path.
 */
import type {
  PreviewConsoleSnapshot,
  PreviewNetworkSnapshot,
  PreviewSessionSnapshot,
} from '../../../contracts/transport'
import { isStudioError } from '../../../contracts/errors'
import { redactUrl } from '../../../contracts/redact'
import {
  countConsoleErrors,
  countNetworkFailures,
  describePreviewError,
  toToolPreviewState,
  type ToolPreviewState,
} from './preview-data'
import type { VibeToolRunContext } from './register'

/** Bounded buffers are read at their caps so counts cover the whole buffer. */
const CONSOLE_SCAN_LIMIT = 500
const NETWORK_SCAN_LIMIT = 300

export interface StatusPreviewSource {
  status(): PreviewSessionSnapshot
  consoleList(query?: unknown): PreviewConsoleSnapshot
  networkList(query?: unknown): PreviewNetworkSnapshot
}

export interface StatusAnnotationSource {
  list(params?: unknown): Promise<{ readonly total: number }>
}

export interface StatusToolDeps {
  readonly preview: StatusPreviewSource
  readonly annotations: StatusAnnotationSource
}

export interface StatusToolOutput {
  target?: {
    readonly id: string
    readonly name: string
    readonly kind: string
    readonly url?: string
  }
  preview: { readonly state: ToolPreviewState; readonly fps: number }
  consoleErrors: number
  networkFailures: number
  annotations: { readonly queued: number; readonly saved: number }
  /** T053: files changed after the page loaded; reload to see the latest code. */
  stale?: boolean
  summary: string
}

interface BufferCounts {
  readonly errors: number
  readonly failures: number
  readonly notes: readonly string[]
}

function readBuffers(preview: StatusPreviewSource, ready: boolean): BufferCounts {
  if (!ready) return { errors: 0, failures: 0, notes: [] }
  const notes: string[] = []
  let errors = 0
  let failures = 0
  try {
    errors = countConsoleErrors(preview.consoleList({ limit: CONSOLE_SCAN_LIMIT }).entries)
  } catch (error) {
    notes.push(`Console history is unavailable (${describePreviewError(error)}).`)
  }
  try {
    failures = countNetworkFailures(preview.networkList({ limit: NETWORK_SCAN_LIMIT }).entries)
  } catch (error) {
    notes.push(`Network history is unavailable (${describePreviewError(error)}).`)
  }
  return { errors, failures, notes }
}

function summarize(
  state: ToolPreviewState,
  url: string | null,
  counts: BufferCounts,
  saved: number,
  lastError: string | undefined,
  stale: boolean,
): string {
  const sentences: string[] = []
  if (state === 'ready') {
    sentences.push(url ? `Preview is ready at ${url}.` : 'Preview is ready.')
  } else if (state === 'failed') {
    sentences.push(
      lastError ? `Preview failed: ${lastError}.` : 'Preview failed; restart it from the panel.',
    )
  } else {
    sentences.push('Preview is closed.')
  }

  const problem: string[] = []
  if (counts.errors > 0) problem.push(`${counts.errors} console error${counts.errors === 1 ? '' : 's'}`)
  if (counts.failures > 0) {
    problem.push(`${counts.failures} failed request${counts.failures === 1 ? '' : 's'}`)
  }
  if (problem.length > 0) sentences.push(`${problem.join(' and ')} buffered.`)
  else if (state === 'ready') sentences.push('No console errors or failed requests buffered.')

  if (stale) {
    sentences.push('Files changed since this page loaded; reload the preview to see the latest code.')
  }

  sentences.push(`${saved} saved annotation${saved === 1 ? '' : 's'}.`)
  if (state !== 'ready') {
    sentences.push('Start a preview before reading the page with vibe_observe.')
  }
  for (const note of counts.notes) sentences.push(note)
  return sentences.join(' ')
}

/**
 * `queued` is always 0: the annotation compose queue lives in the panel and is
 * never sent to the host before the user saves. Reporting the host's view
 * without inventing a number keeps the field honest.
 */
/** Typed view of the handler; assignable to `VibeToolHandler` for registration. */
export type StatusHandler = (
  args: Readonly<Record<string, unknown>>,
  exec: VibeToolRunContext,
) => Promise<StatusToolOutput>

export function createStatusHandler(deps: StatusToolDeps): StatusHandler {
  return async (): Promise<StatusToolOutput> => {
    const snapshot = deps.preview.status()
    const state = toToolPreviewState(snapshot.status)
    const counts = readBuffers(deps.preview, snapshot.status === 'ready')
    // The flag is only meaningful on a live page; a closed preview will load
    // fresh files the next time it starts.
    const stale = state === 'ready' && snapshot.stale === true
    let saved = 0
    try {
      saved = (await deps.annotations.list({ limit: 1 })).total
    } catch (error) {
      if (isStudioError(error) && error.code !== 'internal') throw error
      saved = 0
    }

    // A page URL can carry a token in its query (dev servers and DSH itself
    // use `?token=`). Tool output reaches the model, so it is redacted here,
    // exactly like console/network sources; the panel keeps the raw URL.
    const safeUrl = snapshot.url === null ? null : redactUrl(snapshot.url)

    // The host does not retain the configured display name yet; the target id
    // is the honest identifier until preview targets carry a name.
    const target =
      snapshot.targetId !== null && snapshot.kind !== null
        ? {
            id: snapshot.targetId,
            name: snapshot.targetId,
            kind: snapshot.kind,
            ...(safeUrl === null ? {} : { url: safeUrl }),
          }
        : undefined

    return {
      ...(target ? { target } : {}),
      preview: { state, fps: snapshot.fps },
      consoleErrors: counts.errors,
      networkFailures: counts.failures,
      annotations: { queued: 0, saved },
      ...(stale ? { stale: true } : {}),
      summary: summarize(state, safeUrl, counts, saved, snapshot.lastError?.message, stale),
    }
  }
}
