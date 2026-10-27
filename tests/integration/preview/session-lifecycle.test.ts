/**
 * T025 Host session lifecycle: toolbar mutations, crash detection and restart,
 * and the release order that keeps a stopped preview free of CDP handles.
 */
import { describe, expect, it } from 'vitest'
import { asSessionId, asTargetId } from '../../../src/contracts/ids'
import type { TargetAdapter } from '../../../src/host/targets/types'
import {
  createPreviewService,
  type PreviewServiceOptions,
} from '../../../src/host/preview/route'
import type { ScreencastSource } from '../../../src/host/preview/screencast'
import { createTargetAdapterRegistry } from '../../../src/host/targets/registry'
import { createFakeAdapter, type FakeTargetAdapter } from '../../helpers/fake-adapter'

const URL = 'http://127.0.0.1:4320/'
const NEXT_URL = 'http://127.0.0.1:4320/other'

function fakeSource(log: string[]): ScreencastSource {
  return {
    async start() {
      log.push('source.start')
    },
    async stop() {
      log.push('source.stop')
    },
    get active() {
      return false
    },
    fps: 15,
    quality: 60,
    stats: () => ({
      received: 0,
      published: 0,
      dropped: 0,
      rejected: 0,
      lastFrameAt: null,
    }),
  }
}

function harness(
  adapter: FakeTargetAdapter = createFakeAdapter(),
  onSource?: (log: string[]) => void,
) {
  const log: string[] = []
  const registry = createTargetAdapterRegistry()
  registry.register(adapter)
  const options: PreviewServiceOptions = {
    targets: registry,
    createSource: () => {
      onSource?.(log)
      return fakeSource(log)
    },
    createInput: () => ({
      dispatch: async () => ({ ts: 1, viewport: { width: 1280, height: 720 } }),
      async stop() {
        log.push('input.stop')
      },
      get active() {
        return false
      },
    }),
    createConsole: () => ({
      async start() {
        log.push('console.start')
      },
      async stop() {
        log.push('console.stop')
      },
      snapshot: () => ({ entries: [], lastSeq: 0, dropped: 0 }),
      clear: () => ({ cleared: 0, lastSeq: 0 }),
      stats: () => ({
        received: 0,
        stored: 0,
        dropped: 0,
        rejected: 0,
        lastSeq: 0,
        lastAt: null,
      }),
      get active() {
        return false
      },
    }),
    createNetwork: () => ({
      async start() {
        log.push('network.start')
      },
      async stop() {
        log.push('network.stop')
      },
      snapshot: () => ({ entries: [], lastSeq: 0, dropped: 0 }),
      clear: () => ({ cleared: 0, lastSeq: 0 }),
      body: async () => ({
        id: 'none',
        status: null,
        mimeType: null,
        body: '',
        base64Encoded: false,
        truncated: false,
        bytes: 0,
      }),
      stats: () => ({
        received: 0,
        stored: 0,
        dropped: 0,
        rejected: 0,
        lastSeq: 0,
        lastAt: null,
      }),
      get active() {
        return false
      },
    }),
  }
  return { service: createPreviewService(options), adapter, log }
}

describe('preview session toolbar (T025)', () => {
  it('lists registered targets and reports the started kind and viewport', async () => {
    const { service, adapter } = harness()
    expect(service.listTargets()).toEqual({
      targets: [{ id: adapter.id, kind: 'web' }],
    })

    const started = await service.start({ url: URL })
    expect(started.status).toBe('ready')
    expect(started.kind).toBe('web')
    expect(started.viewport).toEqual({ width: 1280, height: 720, deviceScaleFactor: 1 })
  })

  it('navigates, reloads and resizes through the adapter', async () => {
    const { service, adapter } = harness()
    await service.start({ url: URL })

    const navigated = await service.navigate({ url: NEXT_URL })
    expect(adapter.navigations).toEqual([NEXT_URL])
    expect(navigated.url).toBe(NEXT_URL)

    await service.reload()
    expect(adapter.logs).toContain('reload')

    const resized = await service.setViewport({ viewport: { width: 800, height: 600 } })
    expect(adapter.lastViewport).toEqual({
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
    })
    expect(resized.viewport).toEqual({
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
    })
  })

  it('rejects malformed params and actions on an idle session', async () => {
    const { service } = harness()
    await expect(service.start({ url: 42 } as never)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(service.navigate({})).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(service.navigate({ url: URL })).rejects.toMatchObject({
      code: 'target_unavailable',
    })
    await expect(service.setViewport({ viewport: { width: 10, height: 10 } })).rejects.toMatchObject(
      { code: 'target_unavailable' },
    )

    await service.start({ url: URL })
    await expect(
      service.setViewport({ viewport: { width: 10, height: 10 } }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await service.stop()
    await expect(service.start({ url: URL, kind: 'desktop' })).rejects.toMatchObject({
      code: 'unsupported',
    })
    // Resolution fails before any handle is taken, so the session stays idle.
    expect(service.status().status).toBe('idle')
  })

  it('surfaces a crash as failed without restarting on its own, then restarts once', async () => {
    const { service, adapter } = harness()
    await service.start({ url: URL })
    expect(adapter.sessions).toHaveLength(1)

    adapter.crash()
    const crashed = service.status()
    expect(crashed.status).toBe('failed')
    expect(crashed.lastError).toMatchObject({ code: 'target_unavailable' })

    // Polling status must not reconnect; only an explicit start does.
    expect(service.status().status).toBe('failed')
    expect(adapter.sessions).toHaveLength(1)

    const restarted = await service.start({ url: URL })
    expect(restarted.status).toBe('ready')
    expect(restarted.lastError).toBeUndefined()
    expect(adapter.sessions).toHaveLength(2)
    expect(adapter.logs).toContain('stop')
  })

  it('releases source, collectors, input and adapter in dependency order', async () => {
    const { service, adapter, log } = harness()
    await service.start({ url: URL })
    expect(log).toEqual(['source.start', 'console.start', 'network.start'])

    await service.stop()
    expect(log).toEqual([
      'source.start',
      'console.start',
      'network.start',
      'source.stop',
      'console.stop',
      'network.stop',
      'input.stop',
    ])
    // The adapter is the last handle released.
    expect(adapter.logs).toEqual(['start', 'stop'])
    expect(service.status().status).toBe('idle')
  })

  it('falls back to navigate when an adapter has no reload', async () => {
    const navigations: string[] = []
    const adapter: TargetAdapter = {
      id: 'web',
      kind: 'web',
      capabilities: {
        screencast: true,
        input: false,
        pick: false,
        sourceMap: false,
        console: false,
        network: false,
        screenshot: false,
      },
      async start() {
        return {
          id: asSessionId('preview-1'),
          targetId: asTargetId('preview'),
          kind: 'web',
          status: 'ready',
          url: URL,
          capabilities: {
            screencast: true,
            input: false,
            pick: false,
            sourceMap: false,
            console: false,
            network: false,
            screenshot: false,
          },
          startedAt: '2026-10-28T00:00:00.000Z',
        }
      },
      async navigate(url) {
        navigations.push(url)
      },
      screencastPage: () => ({
        viewport: () => ({ width: 1280, height: 720 }),
        createCdpSession: async () => ({
          async send() {
            return {}
          },
          on() {
            // No events in this fake.
          },
          off() {
            // No events in this fake.
          },
          async detach() {
            // Nothing to detach.
          },
        }),
      }),
      async stop() {
        // Nothing to release.
      },
    }
    const registry = createTargetAdapterRegistry()
    registry.register(adapter)
    const service = createPreviewService({
      targets: registry,
      createSource: () => fakeSource([]),
    })

    await service.start({ url: URL })
    await service.reload()
    expect(navigations).toEqual([URL])
  })
})
