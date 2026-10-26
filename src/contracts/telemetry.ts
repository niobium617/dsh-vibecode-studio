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
