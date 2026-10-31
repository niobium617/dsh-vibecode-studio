/**
 * Verification result wire shape (evaluation T055, panel T056).
 *
 * The Host evaluates the checks (`src/host/verify/checks.ts`) and the panel
 * only renders them, so the shape lives in contracts: the client imports it
 * without reaching into `src/host`, and both sides cannot drift.
 *
 * Every string below was copied from the page (console text, request URL) or
 * from a Host error; the panel renders them as text nodes and treats them as
 * untrusted.
 */

export type VerifyCheckId = 'target' | 'page' | 'console' | 'network'

export type VerifyCheckStatus = 'pass' | 'fail' | 'skipped'

export interface VerifyConsoleEvidence {
  readonly kind: 'console'
  /** Buffer id, stable across polls; the Console drawer keys rows by it. */
  readonly id: string
  readonly level: string
  readonly text: string
}

export interface VerifyNetworkEvidence {
  readonly kind: 'network'
  /** Buffer id, stable across polls; the Network drawer keys rows by it. */
  readonly id: string
  readonly method: string
  readonly url: string
  readonly status: number | null
  readonly outcome: string
}

export type VerifyEvidence = VerifyConsoleEvidence | VerifyNetworkEvidence

export interface VerifyCheck {
  readonly id: VerifyCheckId
  readonly status: VerifyCheckStatus
  readonly message: string
  readonly evidence?: readonly VerifyEvidence[]
}

export interface VerifyResult {
  /** True only when every check ran and passed. */
  readonly ok: boolean
  /** Host wall-clock time when the run finished, ISO 8601. */
  readonly ranAt: string
  readonly durationMs: number
  readonly url: string | null
  readonly checks: readonly VerifyCheck[]
  /** Null when console capture was unavailable, so the count is unknown. */
  readonly consoleErrors: number | null
  /** Null when network capture was unavailable, so the count is unknown. */
  readonly failedRequests: number | null
  /** Evidence was trimmed to satisfy the byte budget or the per-check cap. */
  readonly truncated: boolean
}
