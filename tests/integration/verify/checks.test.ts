/**
 * T055 check rules: ready/idle/failed targets, page outline, console errors and
 * failed requests, evidence caps and the 4 KB result budget. Everything here
 * is pure — the live reads are covered in `service.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { utf8Bytes } from '../../../src/contracts/budget'
import type { ConsoleEntry } from '../../../src/contracts/telemetry'
import type {
  PreviewConsoleSnapshot,
  PreviewNetworkSnapshot,
} from '../../../src/contracts/transport'
import {
  evaluateVerify,
  fitVerifyResult,
  VERIFY_BUDGET_BYTES,
  VERIFY_EVIDENCE_MAX,
  type VerifyInput,
  type VerifyResult,
} from '../../../src/host/verify/checks'
import {
  consoleSnapshot,
  domSnapshot,
  failedSession,
  FIXTURE_URL,
  idleSession,
  networkSnapshot,
  readySession,
} from './helpers'

const RAN_AT = '2026-10-31T08:00:00.000Z'

function input(overrides: Partial<VerifyInput> = {}): VerifyInput {
  return {
    session: readySession(),
    dom: { ok: true, value: domSnapshot() },
    console: { ok: true, value: consoleSnapshot([{ level: 'info', text: 'mounted' }]) },
    network: { ok: true, value: networkSnapshot([{ id: 'ok', status: 200 }]) },
    ...overrides,
  }
}

function statuses(result: VerifyResult): Array<[string, string]> {
  return result.checks.map((check) => [check.id, check.status])
}

function bytes(result: VerifyResult): number {
  return utf8Bytes(JSON.stringify(result))
}

describe('evaluateVerify (T055)', () => {
  it('passes a ready page with a rendered DOM and clean logs', () => {
    const result = evaluateVerify(input(), { ranAt: RAN_AT, durationMs: 12 })

    expect(result).toMatchObject({
      ok: true,
      ranAt: RAN_AT,
      durationMs: 12,
      url: FIXTURE_URL,
      consoleErrors: 0,
      failedRequests: 0,
      truncated: false,
    })
    expect(statuses(result)).toEqual([
      ['target', 'pass'],
      ['page', 'pass'],
      ['console', 'pass'],
      ['network', 'pass'],
    ])
    expect(result.checks[1].message).toBe('Page loaded (4 DOM nodes).')
    expect(result.checks[2].message).toBe('No console errors.')
    expect(result.checks[3].message).toBe('No failed requests.')
    // The result is a plain JSON document, never a class instance.
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it('captures a console error and a 500 response with their evidence ids', () => {
    const result = evaluateVerify(
      input({
        console: {
          ok: true,
          value: consoleSnapshot([
            { level: 'info', text: 'boot' },
            { level: 'error', text: 'Uncaught TypeError: boom' },
          ]),
        },
        network: {
          ok: true,
          value: networkSnapshot([
            { id: 'ok', status: 200 },
            { id: 'boom', status: 500 },
          ]),
        },
      }),
      { ranAt: RAN_AT },
    )

    expect(result.ok).toBe(false)
    expect(result.consoleErrors).toBe(1)
    expect(result.failedRequests).toBe(1)
    expect(result.checks[2]).toMatchObject({
      id: 'console',
      status: 'fail',
      message: '1 console error buffered.',
      evidence: [
        {
          kind: 'console',
          id: 'console-2',
          level: 'error',
          text: 'Uncaught TypeError: boom',
        },
      ],
    })
    expect(result.checks[3]).toMatchObject({
      id: 'network',
      status: 'fail',
      message: '1 failed request buffered.',
      evidence: [
        {
          kind: 'network',
          id: 'network-2',
          method: 'GET',
          url: `${FIXTURE_URL}api/boom`,
          status: 500,
          outcome: 'error',
        },
      ],
    })
  })

  it('treats a transport failure as failed, but not pending or aborted requests', () => {
    const result = evaluateVerify(
      input({
        network: {
          ok: true,
          value: networkSnapshot([
            { id: 'pending' },
            { id: 'canceled', cancel: true },
            { id: 'fetch-failed', fail: true },
          ]),
        },
      }),
      { ranAt: RAN_AT },
    )

    expect(result.failedRequests).toBe(1)
    expect(result.checks[3].evidence?.[0]).toMatchObject({
      id: 'network-3',
      status: null,
      outcome: 'error',
    })
  })

  it('fails the target and skips the rest when the preview is closed', () => {
    const result = evaluateVerify(
      input({ session: idleSession(), dom: null, console: null, network: null }),
      { ranAt: RAN_AT },
    )

    expect(result.ok).toBe(false)
    expect(statuses(result)).toEqual([
      ['target', 'fail'],
      ['page', 'skipped'],
      ['console', 'skipped'],
      ['network', 'skipped'],
    ])
    expect(result.checks[0].message).toBe('Preview is not running.')
    expect(result.consoleErrors).toBeNull()
    expect(result.failedRequests).toBeNull()
    expect(result.url).toBeNull()
  })

  it('reports a crashed preview with its host error text', () => {
    const result = evaluateVerify(
      input({ session: failedSession('Target crashed'), dom: null, console: null, network: null }),
      { ranAt: RAN_AT },
    )

    expect(result.checks[0]).toMatchObject({
      status: 'fail',
      message: 'Preview failed: Target crashed.',
    })
  })

  it('fails the page on an empty outline or a failed DOM read', () => {
    const empty = evaluateVerify(input({ dom: { ok: true, value: domSnapshot(0) } }), {
      ranAt: RAN_AT,
    })
    expect(empty.checks[1]).toMatchObject({
      status: 'fail',
      message: 'Page returned an empty DOM outline.',
    })

    const failed = evaluateVerify(
      input({ dom: { ok: false, message: 'preview_failed: no live page' } }),
      { ranAt: RAN_AT },
    )
    expect(failed.checks[1]).toMatchObject({
      status: 'fail',
      message: 'Page did not load: preview_failed: no live page.',
    })
  })

  it('skips a check whose capture is unavailable instead of claiming it passed', () => {
    const result = evaluateVerify(
      input({
        console: { ok: false, message: 'unsupported: console capture is unavailable' },
        network: { ok: false, message: 'unsupported: network capture is unavailable' },
      }),
      { ranAt: RAN_AT },
    )

    expect(result.ok).toBe(false)
    expect(result.checks[2]).toMatchObject({
      status: 'skipped',
      message: 'Console history is unavailable: unsupported: console capture is unavailable.',
    })
    expect(result.checks[3].status).toBe('skipped')
    expect(result.consoleErrors).toBeNull()
    expect(result.failedRequests).toBeNull()
  })

  it('keeps the newest evidence rows and reports the true count', () => {
    const errors = Array.from({ length: 9 }, (_, index) => ({
      level: 'error' as const,
      text: `error ${index + 1}`,
    }))
    const result = evaluateVerify(
      input({ console: { ok: true, value: consoleSnapshot(errors) } }),
      { ranAt: RAN_AT },
    )

    const consoleCheck = result.checks[2]
    expect(consoleCheck.status).toBe('fail')
    expect(consoleCheck.evidence).toHaveLength(VERIFY_EVIDENCE_MAX)
    expect(consoleCheck.evidence?.[0]).toMatchObject({ id: 'console-5' })
    expect(consoleCheck.evidence?.at(-1)).toMatchObject({ id: 'console-9' })
    expect(result.consoleErrors).toBe(9)
    expect(result.truncated).toBe(true)
  })

  it('fits a worst-case result into 4 KB while staying parseable', () => {
    const longText = '错误'.repeat(500)
    const longUrl = `${FIXTURE_URL}api/${'a'.repeat(1000)}`
    const errors: ConsoleEntry[] = Array.from({ length: 20 }, (_, index) => ({
      id: `console-${index + 1}`,
      level: 'error',
      text: `${index + 1} ${longText}`,
      timestamp: '2026-10-31T08:00:00.000Z',
    }))
    const failures = Array.from({ length: 20 }, (_, index) => ({
      id: `network-${index + 1}`,
      method: 'GET',
      url: longUrl,
      status: 500,
      outcome: 'error' as const,
      resourceType: 'fetch',
      startedAt: '2026-10-31T08:00:00.000Z',
      durationMs: 5,
    }))
    const consoleRead: PreviewConsoleSnapshot = { entries: errors, lastSeq: 20, dropped: 0 }
    const networkRead: PreviewNetworkSnapshot = { entries: failures, lastSeq: 20, dropped: 0 }

    const result = evaluateVerify(
      input({
        console: { ok: true, value: consoleRead },
        network: { ok: true, value: networkRead },
      }),
      { ranAt: RAN_AT, durationMs: 20 },
    )

    expect(bytes(result)).toBeLessThanOrEqual(VERIFY_BUDGET_BYTES)
    expect(result.truncated).toBe(true)
    expect(result.consoleErrors).toBe(20)
    expect(result.failedRequests).toBe(20)
    expect(result.ok).toBe(false)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
    for (const check of result.checks) {
      expect(check.evidence?.length ?? 0).toBeLessThanOrEqual(VERIFY_EVIDENCE_MAX)
    }
  })

  it('fitVerifyResult drops evidence before messages under a tight budget', () => {
    const result = evaluateVerify(
      input({
        console: {
          ok: true,
          value: consoleSnapshot([
            { level: 'error', text: 'first failure' },
            { level: 'error', text: 'second failure' },
          ]),
        },
      }),
      { ranAt: RAN_AT },
    )

    const fitted = fitVerifyResult(result, 560)
    expect(bytes(fitted)).toBeLessThanOrEqual(560)
    expect(fitted.truncated).toBe(true)
    expect(fitted.consoleErrors).toBe(2)
    expect(fitted.checks.map((check) => check.id)).toEqual([
      'target',
      'page',
      'console',
      'network',
    ])
    expect(JSON.parse(JSON.stringify(fitted))).toEqual(fitted)
  })
})
