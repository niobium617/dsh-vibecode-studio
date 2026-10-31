/**
 * T055 service orchestration: which reads run for which session state, how a
 * failed read degrades one check without hiding the others, and the timing
 * fields. The live preview is replaced by a narrow fake; the buffers and
 * entries are the real shapes from `helpers.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { utf8Bytes } from '../../../src/contracts/budget'
import { studioError } from '../../../src/contracts/errors'
import type { ConsoleEntry } from '../../../src/contracts/telemetry'
import { VERIFY_BUDGET_BYTES } from '../../../src/host/verify/checks'
import {
  createVerifyService,
  type VerifyPreviewSource,
} from '../../../src/host/verify/service'
import {
  consoleSnapshot,
  domSnapshot,
  failedSession,
  FIXTURE_URL,
  idleSession,
  networkSnapshot,
  readySession,
} from './helpers'

function source(overrides: Partial<VerifyPreviewSource> = {}): VerifyPreviewSource {
  return {
    status: () => readySession(),
    domSnapshot: async () => domSnapshot(),
    consoleList: () => consoleSnapshot([{ level: 'info', text: 'mounted' }]),
    networkList: () => networkSnapshot([{ id: 'ok', status: 200 }]),
    ...overrides,
  }
}

function clock(start: number, end: number): () => number {
  const values = [start, end]
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]
}

describe('createVerifyService (T055)', () => {
  it('reads the live preview with the smallest DOM outline and full buffers', async () => {
    const dom = vi.fn(source().domSnapshot)
    const consoleList = vi.fn(source().consoleList)
    const networkList = vi.fn(source().networkList)
    const service = createVerifyService({
      preview: source({ domSnapshot: dom, consoleList, networkList }),
      now: clock(1_700_000_000_000, 1_700_000_000_012),
    })

    const result = await service.run()

    expect(dom).toHaveBeenCalledTimes(1)
    expect(dom).toHaveBeenCalledWith({ maxBytes: 512 })
    expect(consoleList).toHaveBeenCalledWith({ limit: 500 })
    expect(networkList).toHaveBeenCalledWith({ limit: 300 })
    expect(result).toMatchObject({
      ok: true,
      ranAt: '2023-11-14T22:13:20.012Z',
      durationMs: 12,
      url: FIXTURE_URL,
      consoleErrors: 0,
      failedRequests: 0,
    })
  })

  it('captures a fixture console error and a 500 response from real buffers', async () => {
    const service = createVerifyService({
      preview: source({
        consoleList: () =>
          consoleSnapshot([
            { level: 'info', text: 'boot' },
            { level: 'error', text: 'Uncaught Error: fixture boom' },
          ]),
        networkList: () =>
          networkSnapshot([
            { id: 'ok', status: 200 },
            { id: 'boom', status: 500 },
          ]),
      }),
      now: clock(1_700_000_000_000, 1_700_000_000_030),
    })

    const result = await service.run()

    expect(result.ok).toBe(false)
    expect(result.durationMs).toBe(30)
    expect(result.consoleErrors).toBe(1)
    expect(result.failedRequests).toBe(1)
    expect(result.checks[2].evidence?.[0]).toMatchObject({
      kind: 'console',
      id: 'console-2',
      text: 'Uncaught Error: fixture boom',
    })
    expect(result.checks[3].evidence?.[0]).toMatchObject({
      kind: 'network',
      id: 'network-2',
      status: 500,
    })
    expect(utf8Bytes(JSON.stringify(result))).toBeLessThanOrEqual(VERIFY_BUDGET_BYTES)
  })

  it('does not touch the page or logs when the preview is closed', async () => {
    const dom = vi.fn(async () => domSnapshot())
    const consoleList = vi.fn(() => consoleSnapshot([]))
    const networkList = vi.fn(() => networkSnapshot([]))
    const service = createVerifyService({
      preview: source({
        status: () => idleSession(),
        domSnapshot: dom,
        consoleList,
        networkList,
      }),
      now: clock(1_700_000_000_000, 1_700_000_000_005),
    })

    const result = await service.run()

    expect(dom).not.toHaveBeenCalled()
    expect(consoleList).not.toHaveBeenCalled()
    expect(networkList).not.toHaveBeenCalled()
    expect(result.checks.map((check) => check.status)).toEqual([
      'fail',
      'skipped',
      'skipped',
      'skipped',
    ])
    expect(result.consoleErrors).toBeNull()
    expect(result.failedRequests).toBeNull()
    expect(result.durationMs).toBe(5)
  })

  it('reports a crashed preview and skips the unreadable page', async () => {
    const service = createVerifyService({
      preview: source({ status: () => failedSession('Target crashed') }),
      now: clock(1_700_000_000_000, 1_700_000_000_003),
    })

    const result = await service.run()

    expect(result.checks[0]).toMatchObject({
      status: 'fail',
      message: 'Preview failed: Target crashed.',
    })
    expect(result.checks[1].status).toBe('skipped')
  })

  it('keeps console/network results when the DOM read fails', async () => {
    const service = createVerifyService({
      preview: source({
        domSnapshot: async () => {
          throw studioError('preview_failed', 'no live page')
        },
        consoleList: () => consoleSnapshot([{ level: 'error', text: 'still captured' }]),
      }),
      now: clock(1_700_000_000_000, 1_700_000_000_008),
    })

    const result = await service.run()

    expect(result.ok).toBe(false)
    expect(result.checks[1]).toMatchObject({
      status: 'fail',
      message: 'Page did not load: no live page.',
    })
    expect(result.checks[2].status).toBe('fail')
    expect(result.consoleErrors).toBe(1)
  })

  it('degrades one unavailable buffer without failing the run', async () => {
    const service = createVerifyService({
      preview: source({
        consoleList: () => {
          throw studioError('unsupported', 'console capture is unavailable')
        },
      }),
      now: clock(1_700_000_000_000, 1_700_000_000_004),
    })

    const result = await service.run()

    expect(result.checks[2]).toMatchObject({
      status: 'skipped',
      message: 'Console history is unavailable: console capture is unavailable.',
    })
    expect(result.consoleErrors).toBeNull()
    expect(result.checks[3].status).toBe('pass')
  })

  it('never throws when every read fails', async () => {
    const service = createVerifyService({
      preview: source({
        domSnapshot: async () => {
          throw new Error('cdp detached')
        },
        consoleList: () => {
          throw new Error('cdp detached')
        },
        networkList: () => {
          throw new Error('cdp detached')
        },
      }),
      now: clock(1_700_000_000_000, 1_700_000_000_009),
    })

    const result = await service.run()

    expect(result.ok).toBe(false)
    expect(result.checks[1]).toMatchObject({
      status: 'fail',
      message: 'Page did not load: cdp detached.',
    })
    expect(result.checks[2].status).toBe('skipped')
    expect(result.checks[3].status).toBe('skipped')
  })

  it('fits a worst-case buffer into 4 KB before returning it', async () => {
    const longText = '超长错误'.repeat(800)
    const longUrl = `${FIXTURE_URL}api/${'z'.repeat(900)}`
    const errors: ConsoleEntry[] = Array.from({ length: 30 }, (_, index) => ({
      id: `console-${index + 1}`,
      level: 'error',
      text: longText,
      timestamp: '2026-10-31T08:00:00.000Z',
    }))
    const failures = Array.from({ length: 30 }, (_, index) => ({
      id: `network-${index + 1}`,
      method: 'GET',
      url: longUrl,
      status: 500,
      outcome: 'error' as const,
      resourceType: 'fetch',
      startedAt: '2026-10-31T08:00:00.000Z',
      durationMs: 3,
    }))
    const service = createVerifyService({
      preview: source({
        consoleList: () => ({ entries: errors, lastSeq: 30, dropped: 0 }),
        networkList: () => ({ entries: failures, lastSeq: 30, dropped: 0 }),
      }),
      now: clock(1_700_000_000_000, 1_700_000_000_015),
    })

    const result = await service.run()

    expect(utf8Bytes(JSON.stringify(result))).toBeLessThanOrEqual(VERIFY_BUDGET_BYTES)
    expect(result.truncated).toBe(true)
    expect(result.consoleErrors).toBe(30)
    expect(result.failedRequests).toBe(30)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})
