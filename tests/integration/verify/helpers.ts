/**
 * Shared fixtures for the T055 verification tests. Console/network snapshots
 * are produced by the real bounded buffers, so the checks see exactly the
 * shapes the collectors emit for a page that logged an error or got a 500.
 */
import { studioError } from '../../../src/contracts/errors'
import type { ConsoleEntry } from '../../../src/contracts/telemetry'
import type {
  PreviewConsoleSnapshot,
  PreviewNetworkSnapshot,
  PreviewSessionSnapshot,
} from '../../../src/contracts/transport'
import { PreviewConsoleBuffer } from '../../../src/host/preview/console'
import { PreviewNetworkBuffer } from '../../../src/host/preview/network'
import type { DomSnapshot } from '../../../src/host/preview/dom'

export const FIXTURE_URL = 'http://127.0.0.1:4320/'

export function readySession(
  overrides: Partial<PreviewSessionSnapshot> = {},
): PreviewSessionSnapshot {
  return {
    status: 'ready',
    targetId: 'preview',
    kind: 'web',
    url: FIXTURE_URL,
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    capabilities: null,
    frame: null,
    fps: 15,
    quality: 60,
    ...overrides,
  }
}

export function idleSession(): PreviewSessionSnapshot {
  return {
    status: 'idle',
    targetId: null,
    kind: null,
    url: null,
    viewport: null,
    capabilities: null,
    frame: null,
    fps: 15,
    quality: 60,
  }
}

export function failedSession(message: string): PreviewSessionSnapshot {
  return readySession({
    status: 'failed',
    lastError: studioError('target_unavailable', message),
  })
}

export function domSnapshot(nodeCount = 4): DomSnapshot {
  return {
    selector: null,
    nodeCount,
    outline: 'body\n  main#app\n    h1 "Vibe fixture"',
    truncated: false,
  }
}

/** Push records through the real console buffer and read it back. */
export function consoleSnapshot(
  records: ReadonlyArray<{ readonly level: ConsoleEntry['level']; readonly text: string }>,
): PreviewConsoleSnapshot {
  const buffer = new PreviewConsoleBuffer()
  for (const record of records) {
    buffer.push({ level: record.level, text: record.text, timestamp: 1_700_000_000_000 })
  }
  return buffer.snapshot()
}

export interface NetworkFixture {
  readonly id: string
  readonly status?: number
  /** Transport failure (`net::ERR_*`). */
  readonly fail?: boolean
  /** Canceled request (`aborted`), which is not a failure. */
  readonly cancel?: boolean
  readonly url?: string
}

/** Start each request, then finish it with a status or a transport failure. */
export function networkSnapshot(requests: readonly NetworkFixture[]): PreviewNetworkSnapshot {
  const buffer = new PreviewNetworkBuffer()
  for (const request of requests) {
    buffer.startRequest(request.id, {
      method: 'GET',
      url: request.url ?? `${FIXTURE_URL}api/${request.id}`,
      resourceType: 'fetch',
      startedAt: 1_700_000_000_000,
      startedMonoMs: 100,
    })
    if (request.fail === true) {
      buffer.fail(request.id, false, 'net::ERR_FAILED', 140)
    } else if (request.cancel === true) {
      buffer.fail(request.id, true, 'net::ERR_ABORTED', 140)
    } else if (request.status !== undefined) {
      buffer.setResponse(request.id, {
        status: request.status,
        resourceType: 'fetch',
        mimeType: 'application/json',
        atMonoMs: 140,
      })
    }
  }
  return buffer.snapshot()
}
