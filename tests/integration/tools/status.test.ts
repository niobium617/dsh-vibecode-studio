/**
 * T048 `vibe_status`: host-owned counts only, honest numbers when the preview
 * is closed, and one stable error prefix through the registered definition.
 */
import { describe, expect, it } from 'vitest'
import { studioError, type StudioError } from '../../../src/contracts/errors'
import type { ConsoleEntry, NetworkEntry } from '../../../src/contracts/telemetry'
import type {
  PreviewConsoleSnapshot,
  PreviewNetworkSnapshot,
  PreviewSessionSnapshot,
} from '../../../src/contracts/transport'
import { createStatusHandler, type StatusToolDeps } from '../../../src/host/agent/tools/status'
import { createVibeToolDefinitions } from '../../../src/host/agent/tools/register'

function consoleEntry(id: string, level: ConsoleEntry['level'], text = 'msg'): ConsoleEntry {
  return { id, level, text, timestamp: '2026-10-30T10:00:00.000Z' }
}

function networkEntry(id: string, status: number | null, outcome: NetworkEntry['outcome']): NetworkEntry {
  return {
    id,
    method: 'GET',
    url: `http://127.0.0.1:4320/api/${id}`,
    status,
    outcome,
    resourceType: 'fetch',
    startedAt: '2026-10-30T10:00:00.000Z',
    durationMs: 12,
  }
}

interface Options {
  readonly session?: PreviewSessionSnapshot
  readonly console?: PreviewConsoleSnapshot | StudioError
  readonly network?: PreviewNetworkSnapshot | StudioError
  readonly saved?: number | Error
}

function harness(options: Options = {}) {
  const calls = { console: 0, network: 0 }
  const session: PreviewSessionSnapshot =
    options.session ??
    ({
      status: 'ready',
      targetId: 'fixture',
      kind: 'web',
      url: 'http://127.0.0.1:4320/',
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      capabilities: null,
      frame: null,
      fps: 15,
      quality: 60,
    } satisfies PreviewSessionSnapshot)

  const deps: StatusToolDeps = {
    preview: {
      status: () => session,
      consoleList: () => {
        calls.console += 1
        const value =
          options.console ??
          ({
            entries: [consoleEntry('c1', 'error'), consoleEntry('c2', 'error'), consoleEntry('c3', 'info')],
            lastSeq: 3,
            dropped: 0,
          } satisfies PreviewConsoleSnapshot)
        if (!('entries' in value)) throw value
        return value
      },
      networkList: () => {
        calls.network += 1
        const value =
          options.network ??
          ({
            entries: [
              networkEntry('n1', 200, 'success'),
              networkEntry('n2', 500, 'success'),
              networkEntry('n3', null, 'error'),
              networkEntry('n4', 302, 'success'),
            ],
            lastSeq: 4,
            dropped: 0,
          } satisfies PreviewNetworkSnapshot)
        if (!('entries' in value)) throw value
        return value
      },
    },
    annotations: {
      list: async () => {
        if (options.saved instanceof Error) throw options.saved
        return { total: options.saved ?? 2 }
      },
    },
  }
  return { deps, calls }
}

describe('vibe_status (T048)', () => {
  it('reports target, preview state and bounded buffer counts', async () => {
    const { deps } = harness()
    const output = await createStatusHandler(deps)({}, {})

    expect(output).toMatchObject({
      target: { id: 'fixture', name: 'fixture', kind: 'web', url: 'http://127.0.0.1:4320/' },
      preview: { state: 'ready', fps: 15 },
      consoleErrors: 2,
      networkFailures: 2,
      annotations: { queued: 0, saved: 2 },
    })
    expect(output.summary).toContain('Preview is ready at http://127.0.0.1:4320/.')
    expect(output.summary).toContain('2 console errors and 2 failed requests buffered.')
    expect(output.summary).toContain('2 saved annotations.')
    expect(output.stale).toBeUndefined()
  })

  it('reports a closed preview without touching the buffers', async () => {
    const { deps, calls } = harness({
      session: {
        status: 'idle',
        targetId: null,
        kind: null,
        url: null,
        viewport: null,
        capabilities: null,
        frame: null,
        fps: 15,
        quality: 60,
      },
    })
    const output = await createStatusHandler(deps)({}, {})

    expect(output.target).toBeUndefined()
    expect(output.preview.state).toBe('closed')
    expect(output.consoleErrors).toBe(0)
    expect(output.networkFailures).toBe(0)
    expect(calls).toEqual({ console: 0, network: 0 })
    expect(output.summary).toContain('Preview is closed.')
    expect(output.summary).toContain('Start a preview before reading the page with vibe_observe.')
  })

  it('surfaces a failed session with its stable error message', async () => {
    const { deps } = harness({
      session: {
        status: 'failed',
        targetId: 'fixture',
        kind: 'web',
        url: null,
        viewport: null,
        capabilities: null,
        frame: null,
        fps: 15,
        quality: 60,
        lastError: studioError('target_unavailable', 'vibe-studio: preview target disconnected'),
      },
    })
    const output = await createStatusHandler(deps)({}, {})
    expect(output.preview.state).toBe('failed')
    expect(output.summary).toContain('Preview failed: vibe-studio: preview target disconnected.')
  })

  it('keeps counting network failures when console capture is unavailable', async () => {
    const { deps } = harness({
      console: studioError('unsupported', 'vibe-studio: console capture is unavailable'),
    })
    const output = await createStatusHandler(deps)({}, {})
    expect(output.consoleErrors).toBe(0)
    expect(output.networkFailures).toBe(2)
    expect(output.summary).toContain(
      'Console history is unavailable (unsupported: vibe-studio: console capture is unavailable).',
    )
  })

  it('still reports when the annotation store cannot be read', async () => {
    const { deps } = harness({ saved: new Error('disk gone') })
    const output = await createStatusHandler(deps)({}, {})
    expect(output.annotations.saved).toBe(0)
  })

  it('exposes counts through the registered definition and validates args', async () => {
    const { deps } = harness()
    const definitions = createVibeToolDefinitions({ vibe_status: createStatusHandler(deps) })
    const status = definitions.find((entry) => entry.name === 'vibe_status')
    expect(status).toBeDefined()
    if (!status) return

    const value = await status.execute({}, {})
    const content = status.output.render({}, value)
    expect(content).toHaveLength(1)
    const text = content[0].text
    expect(JSON.parse(text)).toMatchObject({ consoleErrors: 2, networkFailures: 2 })

    await expect(status.execute({ extra: true }, {})).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})
