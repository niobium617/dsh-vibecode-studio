import {
  CONSOLE_ENTRY_BUDGET_BYTES,
  NETWORK_ENTRY_BUDGET_BYTES,
  truncateUtf8,
} from './budget'
import { redactUrl } from './redact'

/**
 * Console and network entries are compact projections. Headers are optional
 * and must be passed through redactHeaders before they leave the host.
 */

export const CONSOLE_LEVELS = ['debug', 'info', 'warn', 'error'] as const
export type ConsoleLevel = (typeof CONSOLE_LEVELS)[number]

export interface ConsoleSource {
  readonly url: string
  readonly line: number | null
  readonly column: number | null
}

export interface ConsoleEntry {
  readonly id: string
  readonly level: ConsoleLevel
  readonly text: string
  readonly timestamp: string
  readonly source?: ConsoleSource
}

export type NetworkOutcome = 'pending' | 'success' | 'error' | 'aborted'

/**
 * Request bodies are kept for replay (T043), which crosses the same 64 KiB
 * unary envelope as the rest of the panel. 16 KiB leaves room for headers
 * while still covering ordinary form and JSON payloads.
 */
export const MAX_CAPTURED_REQUEST_BODY_BYTES = 16 * 1024

export interface NetworkEntry {
  readonly id: string
  readonly method: string
  readonly url: string
  readonly status: number | null
  readonly outcome: NetworkOutcome
  readonly resourceType: string | null
  readonly startedAt: string
  readonly durationMs: number | null
  readonly requestHeaders?: Readonly<Record<string, string>>
  readonly responseHeaders?: Readonly<Record<string, string>>
  readonly failure?: string | null
  /**
   * UTF-8 request body as CDP reported it, capped at
   * `MAX_CAPTURED_REQUEST_BODY_BYTES`. Bodies are not redacted: replay has to
   * reproduce the original bytes, and the buffer stays in Host memory.
   */
  readonly requestBody?: string
  /** True when the captured body was cut at the cap above. */
  readonly requestBodyTruncated?: boolean
  /** CDP said a body exists but did not hand it over (too large or binary). */
  readonly requestBodyUnavailable?: boolean
}

/**
 * A failed request: either the transport reported an error or the page got a
 * 4xx/5xx response. `aborted` is not a failure — a navigation or a stop
 * cancels requests on purpose. Shared by the tools and the verifier so both
 * report the same count.
 */
export function isNetworkFailure(entry: NetworkEntry): boolean {
  if (entry.outcome === 'error') return true
  return entry.status !== null && entry.status >= 400
}

/** Render a one-line console summary; URLs are redacted before truncation. */
export function renderConsoleEntry(
  entry: ConsoleEntry,
  maxBytes = CONSOLE_ENTRY_BUDGET_BYTES,
): string {
  const source = entry.source
    ? ` (${redactUrl(entry.source.url)}:${entry.source.line ?? '?'}:${entry.source.column ?? '?'})`
    : ''
  return truncateUtf8(
    `[${entry.level}] ${entry.timestamp} ${entry.text}${source}`,
    maxBytes,
  )
}

/** Render a one-line network summary; query tokens and credentials are redacted. */
export function renderNetworkEntry(
  entry: NetworkEntry,
  maxBytes = NETWORK_ENTRY_BUDGET_BYTES,
): string {
  const status = entry.status === null ? entry.outcome : `${entry.status} ${entry.outcome}`
  const duration = entry.durationMs === null ? '' : ` ${Math.round(entry.durationMs)}ms`
  const failure = entry.failure ? ` error=${entry.failure}` : ''
  return truncateUtf8(
    `${entry.method.toUpperCase()} ${redactUrl(entry.url)} -> ${status}${duration}${failure}`,
    maxBytes,
  )
}
