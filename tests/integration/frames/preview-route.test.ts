import { afterEach, describe, expect, it, vi } from 'vitest'
import { asSessionId, asTargetId } from '../../../src/contracts/ids'
import {
  FRAME_PATH,
  STREAM_CONTENT_TYPE,
  STREAM_PATH,
} from '../../../src/contracts/transport'
import {
  createPreviewService,
  createPreviewFrameRoute,
  createPreviewStreamRoute,
} from '../../../src/host/preview/route'
import { createTargetAdapterRegistry } from '../../../src/host/targets/registry'
import type { TargetAdapter } from '../../../src/host/targets/types'
import { FrameStreamParser } from '../../../src/client/preview/transport'

const capabilities = {
  screencast: true,
  input: false,
  pick: false,
  sourceMap: false,
  console: false,
  network: false,
  screenshot: true,
} as const

const STREAM_URL = `http://127.0.0.1${STREAM_PATH}`
const FRAME_URL = `http://127.0.0.1${FRAME_PATH}`

interface FakeCdp {
  readonly sent: { method: string; params?: Record<string, unknown> }[]
  readonly detached: boolean
  emit(params: unknown): void
}

function jpeg(marker: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, marker, 0xff, 0xd9])
}

function createFakeAdapter(options: { screencast?: boolean } = {}) {
  let started = false
  let stopCount = 0
  const sent: { method: string; params?: Record<string, unknown> }[] = []
  let detached = false
  const listeners = new Map<string, Set<(params: unknown) => void>>()

  const cdp: FakeCdp = {
    sent,
    get detached() {
      return detached
    },
    emit(params) {
      for (const listener of [...(listeners.get('Page.screencastFrame') ?? [])]) listener(params)
    },
  }

  const adapter: TargetAdapter = {
    id: 'web',
    kind: 'web',
    capabilities: { ...capabilities, screencast: options.screencast ?? true },
    async start() {
      started = true
      return {
        id: asSessionId('preview-1'),
        targetId: asTargetId('preview'),
        kind: 'web',
        status: 'ready',
        url: 'http://127.0.0.1:4320/',
        capabilities: { ...capabilities, screencast: options.screencast ?? true },
        startedAt: '2026-10-27T00:00:00.000Z',
      }
    },
    async stop() {
      stopCount += 1
      started = false
    },
  }

  if (options.screencast !== false) {
    adapter.screencastPage = () =>
      started
        ? {
            viewport: () => ({ width: 800, height: 600 }),
            createCdpSession: async () => ({
              async send(method, params) {
                sent.push({ method, params })
                return {}
              },
              on(event, listener) {
                const set = listeners.get(event) ?? new Set()
                set.add(listener)
                listeners.set(event, set)
              },
              off(event, listener) {
                listeners.get(event)?.delete(listener)
              },
              async detach() {
                detached = true
              },
            }),
          }
        : undefined
  }

  return {
    adapter,
    cdp,
    get startCount() {
      return started ? 1 : 0
    },
    get stopCount() {
      return stopCount
    },
  }
}

function emitFrame(cdp: FakeCdp, marker: number, sessionId = 1): void {
  cdp.emit({
    sessionId,
    data: Buffer.from(jpeg(marker)).toString('base64'),
    metadata: { timestamp: Date.now() / 1000, deviceWidth: 800, deviceHeight: 600 },
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function boot(options: { screencast?: boolean } = {}) {
  const fake = createFakeAdapter(options)
  const targets = createTargetAdapterRegistry()
  targets.register(fake.adapter)
  const service = createPreviewService({ targets })
  return { fake, service }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('preview service lifecycle', () => {
  it('starts a session, exposes status and stops all resources', async () => {
    const { fake, service } = await boot()
    expect(service.status()).toMatchObject({
      status: 'idle',
      targetId: null,
      frame: null,
      fps: 30,
      quality: 70,
    })

    const snapshot = await service.start({ url: 'http://127.0.0.1:4320/' })
    expect(snapshot).toMatchObject({
      status: 'ready',
      targetId: 'preview',
      url: 'http://127.0.0.1:4320/',
      fps: 30,
      quality: 70,
    })
    expect(fake.cdp.sent[0]?.method).toBe('Page.startScreencast')

    emitFrame(fake.cdp, 0x11)
    expect(service.status().frame).toEqual(
      expect.objectContaining({ seq: 1, width: 800, height: 600 }),
    )

    await service.stop()
    expect(service.status()).toMatchObject({ status: 'idle', targetId: null, frame: null })
    expect(fake.cdp.sent.map((call) => call.method)).toContain('Page.stopScreencast')
    expect(fake.cdp.detached).toBe(true)
    expect(fake.stopCount).toBe(1)
    expect(service.buffer.latest()).toBeNull()
  })

  it('rejects malformed start params before touching the adapter', async () => {
    const { fake, service } = await boot()

    await expect(service.start({ url: '' })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(
      service.start({ url: 'http://127.0.0.1:4320/', viewport: { width: 1, height: 2 } }),
    ).rejects.toMatchObject({ code: 'invalid_config' })

    expect(fake.cdp.sent).toHaveLength(0)
    expect(service.status().status).toBe('idle')
  })

  it('reports unsupported when the adapter cannot screencast', async () => {
    const { fake, service } = await boot({ screencast: false })

    await expect(service.start({ url: 'http://127.0.0.1:4320/' })).rejects.toMatchObject({
      code: 'unsupported',
    })
    expect(fake.stopCount).toBe(0)
    expect(service.status().status).toBe('idle')
  })
})

describe('multipart stream route', () => {
  it('serves the latest frame immediately and cleans up on cancel', async () => {
    const { fake, service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })
    emitFrame(fake.cdp, 0x21)

    const response = await createPreviewStreamRoute(service)(
      new Request(STREAM_URL),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(STREAM_CONTENT_TYPE)
    expect(response.headers.get('cache-control')).toBe('no-store')

    const reader = response.body!.getReader()
    const parser = new FrameStreamParser()
    const frames = []
    for (let reads = 0; reads < 10 && frames.length === 0; reads += 1) {
      const { done, value } = await reader.read()
      if (done) break
      frames.push(...parser.push(value))
    }
    expect(frames[0]).toMatchObject({ seq: 1, width: 800, height: 600 })
    expect(frames[0]?.bytes).toEqual(jpeg(0x21))
    expect(service.buffer.subscriberCount).toBe(1)

    await reader.cancel()
    await sleep(0)
    expect(service.buffer.subscriberCount).toBe(0)
    await service.stop()
  })

  it('closes the stream with a final boundary when the session stops', async () => {
    const { fake, service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })

    const response = await createPreviewStreamRoute(service)(new Request(STREAM_URL))
    const reader = response.body!.getReader()
    const pending = reader.read()

    await service.stop()
    const first = await pending
    expect(first.done).toBe(false)
    expect(new TextDecoder().decode(first.value)).toContain('--vibe-frame--')
    expect((await reader.read()).done).toBe(true)
    expect(fake.cdp.detached).toBe(true)
  })

  it('rejects other methods and sessions that are not ready', async () => {
    const { service } = await boot()
    const host = createPreviewStreamRoute(service)

    expect((await host(new Request(STREAM_URL, { method: 'POST' }))).status).toBe(405)
    const unavailable = await host(new Request(STREAM_URL))
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toMatchObject({
      ok: false,
      error: { code: 'target_unavailable' },
    })
  })
})

describe('long-poll frame route', () => {
  it('returns 204 while no frame exists, then the newest JPEG', async () => {
    const { fake, service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })
    const handler = createPreviewFrameRoute(service)

    const empty = await handler(new Request(FRAME_URL))
    expect(empty.status).toBe(204)
    expect(empty.headers.get('x-vibe-seq')).toBe('0')

    emitFrame(fake.cdp, 0x31)
    const response = await handler(new Request(FRAME_URL))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('x-vibe-seq')).toBe('1')
    expect(response.headers.get('x-vibe-width')).toBe('800')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg(0x31))

    await service.stop()
  })

  it('waits for a frame newer than "after"', async () => {
    const { fake, service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })
    emitFrame(fake.cdp, 0x41)
    await sleep(40) // let the 30 fps deadline pass

    const pending = createPreviewFrameRoute(service)(
      new Request(`${FRAME_URL}?wait=1&after=1`),
    )
    await sleep(5)
    emitFrame(fake.cdp, 0x42)
    const response = await pending

    expect(response.status).toBe(200)
    expect(response.headers.get('x-vibe-seq')).toBe('2')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpeg(0x42))
    await service.stop()
  })

  it('resolves a long poll on abort', async () => {
    const { fake, service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })
    emitFrame(fake.cdp, 0x51)

    const controller = new AbortController()
    const pending = createPreviewFrameRoute(service)(
      new Request(`${FRAME_URL}?wait=1&after=1`, { signal: controller.signal }),
    )
    controller.abort()
    const response = await pending
    expect(response.status).toBe(204)
    await service.stop()
  })

  it('rejects unknown or malformed query parameters', async () => {
    const { service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })
    const handler = createPreviewFrameRoute(service)

    for (const query of ['?wait=2', '?after=-1', '?after=1.5', '?foo=1']) {
      const response = await handler(new Request(`${FRAME_URL}${query}`))
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: 'invalid_input' },
      })
    }
    expect((await handler(new Request(FRAME_URL, { method: 'POST' }))).status).toBe(405)
    await service.stop()
  })
})
