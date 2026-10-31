/**
 * T055: pure evaluation of the basic verification checks.
 *
 * Four checks answer the questions a beginner asks after a change: is the
 * preview still alive, did the page render anything, and is the page's console
 * or network log showing a problem? The service (`service.ts`) reads the live
 * preview; this module only turns already-read snapshots into a result, so the
 * rules stay testable without a browser.
 *
 * The result is a bounded wire shape (≤ 4 KB). Console text and URLs come from
 * the page, so evidence is clipped to one short line each and the whole result
 * is fitted by dropping evidence before it is ever handed to the panel.
 */
import { truncateChars, utf8Bytes } from '../../contracts/budget'
import type { ConsoleEntry, NetworkEntry } from '../../contracts/telemetry'
import { isNetworkFailure } from '../../contracts/telemetry'
import type {
  PreviewConsoleSnapshot,
  PreviewNetworkSnapshot,
  PreviewSessionSnapshot,
} from '../../contracts/transport'
import type { DomSnapshot } from '../preview/dom'
import type {
  VerifyCheck,
  VerifyCheckId,
  VerifyConsoleEvidence,
  VerifyNetworkEvidence,
  VerifyResult,
} from '../../contracts/verify'

/** Hard cap for one serialized verification result (SPEC budget). */
export const VERIFY_BUDGET_BYTES = 4 * 1024
/** Evidence rows kept per failing check; the count fields keep the total. */
export const VERIFY_EVIDENCE_MAX = 5
export const VERIFY_MESSAGE_CHARS = 240
export const VERIFY_EVIDENCE_TEXT_CHARS = 200
export const VERIFY_EVIDENCE_URL_CHARS = 200

// The wire shape lives in contracts so the panel can import it (T056); this
// module re-exports it to keep the T055 public surface unchanged.
export type {
  VerifyCheck,
  VerifyCheckId,
  VerifyCheckStatus,
  VerifyConsoleEvidence,
  VerifyEvidence,
  VerifyNetworkEvidence,
  VerifyResult,
} from '../../contracts/verify'

/**
 * One snapshot read. `null` means the check did not run at all (preview not
 * ready); `{ ok: false }` means the read was attempted and failed.
 */
export type VerifyRead<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string }
  | null

export interface VerifyInput {
  readonly session: PreviewSessionSnapshot
  readonly dom: VerifyRead<DomSnapshot>
  readonly console: VerifyRead<PreviewConsoleSnapshot>
  readonly network: VerifyRead<PreviewNetworkSnapshot>
}

export interface EvaluateVerifyOptions {
  /** Host wall-clock time for the run; defaults to now. */
  readonly ranAt?: string
  readonly durationMs?: number
}

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g

/** Host-generated messages must stay one clean line even if an error echoes data. */
function cleanMessage(value: string, maxChars = VERIFY_MESSAGE_CHARS): string {
  return truncateChars(value.replace(/[\u000d\u000a]/g, ' ').replace(CONTROL_CHARS, ' '), maxChars)
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function consoleEvidence(errors: readonly ConsoleEntry[]): VerifyConsoleEvidence[] {
  return errors.slice(-VERIFY_EVIDENCE_MAX).map((entry) => ({
    kind: 'console',
    id: entry.id,
    level: entry.level,
    text: truncateChars(entry.text, VERIFY_EVIDENCE_TEXT_CHARS),
  }))
}

function networkEvidence(failures: readonly NetworkEntry[]): VerifyNetworkEvidence[] {
  return failures.slice(-VERIFY_EVIDENCE_MAX).map((entry) => ({
    kind: 'network',
    id: entry.id,
    method: truncateChars(entry.method, 16),
    url: truncateChars(entry.url, VERIFY_EVIDENCE_URL_CHARS),
    status: entry.status,
    outcome: entry.outcome,
  }))
}

function targetCheck(session: PreviewSessionSnapshot): VerifyCheck {
  if (session.status === 'ready') {
    return {
      id: 'target',
      status: 'pass',
      message: session.url ? `Preview is running at ${cleanMessage(session.url, 240)}.` : 'Preview is running.',
    }
  }
  if (session.status === 'failed') {
    const reason = session.lastError?.message
    return {
      id: 'target',
      status: 'fail',
      message: reason
        ? `Preview failed: ${cleanMessage(reason)}.`
        : 'Preview failed; restart it from the panel.',
    }
  }
  return { id: 'target', status: 'fail', message: 'Preview is not running.' }
}

interface CheckOutcome {
  readonly check: VerifyCheck
  readonly count: number | null
}

function skipped(id: VerifyCheckId, message: string): VerifyCheck {
  return { id, status: 'skipped', message }
}

function readFailure(id: VerifyCheckId, label: string, message: string): CheckOutcome {
  return {
    check: { id, status: 'skipped', message: `${label} is unavailable: ${cleanMessage(message)}.` },
    count: null,
  }
}

function pageCheck(read: VerifyRead<DomSnapshot>): VerifyCheck {
  if (read === null) {
    return skipped('page', 'Preview is not running; the page was not checked.')
  }
  if (!read.ok) {
    return { id: 'page', status: 'fail', message: `Page did not load: ${cleanMessage(read.message)}.` }
  }
  const nodes = read.value.nodeCount
  if (nodes < 1) {
    return { id: 'page', status: 'fail', message: 'Page returned an empty DOM outline.' }
  }
  return { id: 'page', status: 'pass', message: `Page loaded (${plural(nodes, 'DOM node', 'DOM nodes')}).` }
}

function consoleCheck(read: VerifyRead<PreviewConsoleSnapshot>): CheckOutcome {
  if (read === null) {
    return {
      check: skipped('console', 'Preview is not running; console history was not checked.'),
      count: null,
    }
  }
  if (!read.ok) return readFailure('console', 'Console history', read.message)
  const errors = read.value.entries.filter((entry) => entry.level === 'error')
  if (errors.length === 0) {
    return { check: { id: 'console', status: 'pass', message: 'No console errors.' }, count: 0 }
  }
  return {
    check: {
      id: 'console',
      status: 'fail',
      message: `${plural(errors.length, 'console error', 'console errors')} buffered.`,
      evidence: consoleEvidence(errors),
    },
    count: errors.length,
  }
}

function networkCheck(read: VerifyRead<PreviewNetworkSnapshot>): CheckOutcome {
  if (read === null) {
    return {
      check: skipped('network', 'Preview is not running; requests were not checked.'),
      count: null,
    }
  }
  if (!read.ok) return readFailure('network', 'Network history', read.message)
  const failures = read.value.entries.filter(isNetworkFailure)
  if (failures.length === 0) {
    return { check: { id: 'network', status: 'pass', message: 'No failed requests.' }, count: 0 }
  }
  return {
    check: {
      id: 'network',
      status: 'fail',
      message: `${plural(failures.length, 'failed request', 'failed requests')} buffered.`,
      evidence: networkEvidence(failures),
    },
    count: failures.length,
  }
}

function measure(result: VerifyResult): number {
  return utf8Bytes(JSON.stringify(result))
}

/** Remove the last evidence row, scanning checks from the end. */
function dropLastEvidence(result: VerifyResult): VerifyResult | null {
  for (let index = result.checks.length - 1; index >= 0; index -= 1) {
    const check = result.checks[index]
    if (!check.evidence || check.evidence.length === 0) continue
    const evidence = check.evidence.slice(0, -1)
    const checks = result.checks.slice()
    checks[index] = evidence.length === 0
      ? { id: check.id, status: check.status, message: check.message }
      : { ...check, evidence }
    return { ...result, checks, truncated: true }
  }
  return null
}

function shrinkMessages(result: VerifyResult, maxChars: number): VerifyResult {
  return {
    ...result,
    checks: result.checks.map((check) => ({
      id: check.id,
      status: check.status,
      message: truncateChars(check.message, maxChars),
      ...(check.evidence === undefined ? {} : { evidence: check.evidence }),
    })),
  }
}

/**
 * Enforce the byte budget without ever emitting invalid JSON. Evidence goes
 * first (newest rows are kept longest), then messages are shortened; counts
 * and check statuses always survive.
 */
export function fitVerifyResult(
  result: VerifyResult,
  budget = VERIFY_BUDGET_BYTES,
): VerifyResult {
  if (measure(result) <= budget) return result
  let current: VerifyResult = { ...result, truncated: true }
  for (;;) {
    const next = dropLastEvidence(current)
    if (next === null) break
    current = next
    if (measure(current) <= budget) return current
  }
  for (const cap of [120, 60, 24]) {
    current = shrinkMessages(current, cap)
    if (measure(current) <= budget) return current
  }
  return {
    ...current,
    checks: current.checks.map((check) => ({ ...check, message: '' })),
  }
}

/**
 * Pure evaluation: the target check drives everything. A preview that is not
 * ready cannot be asked about the page or its logs, so the other three checks
 * report `skipped` rather than a misleading pass.
 */
export function evaluateVerify(
  input: VerifyInput,
  options: EvaluateVerifyOptions = {},
): VerifyResult {
  const target = targetCheck(input.session)
  const ready = target.status === 'pass'

  const domRead = ready ? input.dom : null
  const consoleRead = ready ? input.console : null
  const networkRead = ready ? input.network : null

  const consoleOutcome = consoleCheck(consoleRead)
  const networkOutcome = networkCheck(networkRead)
  const consoleErrors = ready ? consoleOutcome.count : null
  const failedRequests = ready ? networkOutcome.count : null

  const checks: VerifyCheck[] = [
    target,
    pageCheck(domRead),
    consoleOutcome.check,
    networkOutcome.check,
  ]

  const evidenceTrimmed =
    (consoleErrors !== null && consoleErrors > VERIFY_EVIDENCE_MAX) ||
    (failedRequests !== null && failedRequests > VERIFY_EVIDENCE_MAX)

  const duration = options.durationMs ?? 0
  const result: VerifyResult = {
    ok: checks.every((check) => check.status === 'pass'),
    ranAt: options.ranAt ?? new Date().toISOString(),
    durationMs:
      Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0,
    url: input.session.url,
    checks,
    consoleErrors,
    failedRequests,
    truncated: evidenceTrimmed,
  }
  return fitVerifyResult(result)
}
