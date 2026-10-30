/**
 * T049 screenshot path: `PreviewService.captureScreenshot` is capability-gated,
 * only reports what the browser produced, and maps every adapter failure to a
 * stable code. The bytes stay host-side; the tool turns them into an artifact.
 */
import { describe, expect, it } from 'vitest'
import { asSessionId } from '../../../src/contracts/ids'
import type { TargetCapabilities } from '../../../src/contracts/target'
import { createPreviewService, type PreviewServiceOptions } from '../../../src/host/preview/route'
import type { ScreencastSource } from '../../../src/host/preview/screencast'
import { createTargetAdapterRegistry } from '../../../src/host/targets/registry'
import type { TargetAdapter, ValidatedTargetConfig } from '../../../src/host/targets/types'

const URL = 'http://127.0.0.1:4320/'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CAPABILITIES: TargetCapabilities = Object.freeze({
  screencast: true,
  input: false,
  pick: false,
  sourceMap: false,
  console: false,
  network: false,
  screenshot: true,
})

function source(): ScreencastSource {
  return {
    async start() {},
    async stop() {},
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

interface AdapterOptions {
  readonly screenshot?: false
  readonly bytes?: Uint8Array
  readonly failWith?: string
}

function createScreenshotAdapter(options: AdapterOptions = {}): TargetAdapter {
  const capabilities: TargetCapabilities = {
    ...CAPABILITIES,
    screenshot: options.screenshot !== false,
  }
  return {
    id: 'shot',
    kind: 'web',
    capabilities,
    async start(config: ValidatedTargetConfig) {
      return {
        id: asSessionId('shot-1'),
        targetId: config.id,
        kind: 'web' as const,
        status: 'ready' as const,
        url: config.url ?? URL,
        capabilities,
        startedAt: new Date().toISOString(),
      }
    },
    async screenshot() {
      if (options.failWith) throw new Error(options.failWith)
      return options.bytes ?? PNG
    },
    screencastPage() {
      return {
        viewport: () => ({ width: 1280, height: 720 }),
        async createCdpSession() {
          return {
            async send() {
              return {}
            },
            on() {},
            off() {},
            async detach() {},
          }
        },
      }
    },
    async stop() {},
  }
}

function harness(options: AdapterOptions = {}) {
  const registry = createTargetAdapterRegistry()
  registry.register(createScreenshotAdapter(options))
  const serviceOptions: PreviewServiceOptions = { targets: registry, createSource: () => source() }
  return createPreviewService(serviceOptions)
}

describe('preview service captureScreenshot (T049)', () => {
  it('returns the captured PNG with the live viewport size', async () => {
    const service = harness()
    await service.start({ url: URL })

    const captured = await service.captureScreenshot()
    expect(captured.bytes).toEqual(PNG)
    expect(captured.width).toBe(1280)
    expect(captured.height).toBe(720)
    await service.stop()
  })

  it('refuses to capture while the preview is closed', async () => {
    const service = harness()
    await expect(service.captureScreenshot()).rejects.toMatchObject({
      code: 'target_unavailable',
    })
  })

  it('reports an adapter without the capability as unsupported', async () => {
    const service = harness({ screenshot: false })
    await service.start({ url: URL })
    await expect(service.captureScreenshot()).rejects.toMatchObject({
      code: 'unsupported',
      details: { capability: 'screenshot' },
    })
    await service.stop()
  })

  it('maps an adapter failure to preview_failed', async () => {
    const service = harness({ failWith: 'page crashed mid-capture' })
    await service.start({ url: URL })
    await expect(service.captureScreenshot()).rejects.toMatchObject({ code: 'preview_failed' })
    await service.stop()
  })

  it('treats an empty image as a failed capture', async () => {
    const service = harness({ bytes: new Uint8Array(0) })
    await service.start({ url: URL })
    await expect(service.captureScreenshot()).rejects.toMatchObject({ code: 'preview_failed' })
    await service.stop()
  })
})
