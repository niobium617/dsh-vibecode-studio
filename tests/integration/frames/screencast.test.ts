import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPreviewFrameBuffer } from '../../../src/host/preview/frame-buffer'
import { createScreencastSource } from '../../../src/host/preview/screencast'
import type {
  ScreencastPageLike,
  ScreencastSessionLike,
} from '../../../src/host/targets/types'

interface SentCall {
  readonly method: string
  readonly params?: Record<string, unknown>
}

interface FakeSession extends ScreencastSessionLike {
  readonly sent: SentCall[]
  readonly detached: boolean
  readonly listeners: Map<string, Set<(params: unknown) => void>>
  emit(event: string, params: unknown): void
  failStart(): void
}

function createFakeSession(): FakeSession {
  const listeners = new Map<string, Set<(params: unknown) => void>>()
  const sent: SentCall[] = []
  let detached = false
  let startFailure: Error | undefined
  return {
    sent,
    get detached() {
      return detached
    },
    listeners,
    async send(method, params) {
      sent.push({ method, params })
      if (method === 'Page.startScreencast' && startFailure) throw startFailure
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
    emit(event, params) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(params)
    },
    failStart() {
      startFailure = new Error('CDP refused startScreencast')
    },
  }
}

function createFakePage(session: FakeSession): ScreencastPageLike {
  return {
    viewport: () => ({ width: 800, height: 600 }),
    createCdpSession: async () => session,
  }
}

function jpeg(marker: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, marker, 0xff, 0xd9])
}

function frameEvent(bytes: Uint8Array, sessionId = 7) {
  return {
    sessionId,
    data: Buffer.from(bytes).toString('base64'),
    metadata: { timestamp: 123.4, deviceWidth: 800, deviceHeight: 600 },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('CDP screencast source', () => {
  it('publishes the first frame immediately and acks every frame', async () => {
    const buffer = createPreviewFrameBuffer()
    const session = createFakeSession()
    const source = createScreencastSource({
      page: createFakePage(session),
      buffer,
      now: () => 0,
    })

    await source.start()
    expect(session.sent[0]).toEqual({
      method: 'Page.startScreencast',
      params: {
        format: 'jpeg',
        quality: 70,
        maxWidth: 800,
        maxHeight: 600,
        everyNthFrame: 1,
      },
    })
    expect(source.active).toBe(true)

    session.emit('Page.screencastFrame', frameEvent(jpeg(0x11)))
    expect(buffer.latest()?.seq).toBe(1)
    expect(buffer.latest()?.width).toBe(800)
    expect(session.sent).toContainEqual({
      method: 'Page.screencastFrameAck',
      params: { sessionId: 7 },
    })

    await source.stop()
    expect(session.sent.map((call) => call.method)).toEqual([
      'Page.startScreencast',
      'Page.screencastFrameAck',
      'Page.stopScreencast',
    ])
    expect(session.detached).toBe(true)
    expect(buffer.latest()).toBeNull()
    expect(source.active).toBe(false)
  })

  it('paces publishes and keeps only the newest pending frame', async () => {
    vi.useFakeTimers()
    let clock = 0
    const buffer = createPreviewFrameBuffer()
    const session = createFakeSession()
    const source = createScreencastSource({
      page: createFakePage(session),
      buffer,
      now: () => clock,
    })

    await source.start()
    session.emit('Page.screencastFrame', frameEvent(jpeg(0x21)))
    expect(buffer.latest()?.seq).toBe(1)

    // Two frames arrive inside the same 33 ms slot: the first is replaced.
    clock = 5
    session.emit('Page.screencastFrame', frameEvent(jpeg(0x22)))
    clock = 10
    session.emit('Page.screencastFrame', frameEvent(jpeg(0x23)))
    expect(buffer.lastSeq).toBe(1)
    expect(source.stats().dropped).toBe(1)

    clock = 34
    await vi.advanceTimersByTimeAsync(10)
    expect(buffer.lastSeq).toBe(2)
    expect(buffer.latest()?.bytes).toEqual(jpeg(0x23))
    expect(source.stats()).toMatchObject({ received: 3, published: 2, dropped: 1 })

    await source.stop()
  })

  it('rejects non-JPEG or oversized frames without stopping the stream', async () => {
    const buffer = createPreviewFrameBuffer()
    const session = createFakeSession()
    const source = createScreencastSource({
      page: createFakePage(session),
      buffer,
      now: () => 0,
    })
    await source.start()

    session.emit('Page.screencastFrame', {
      sessionId: 1,
      data: Buffer.from('not a jpeg').toString('base64'),
      metadata: { deviceWidth: 800, deviceHeight: 600 },
    })
    session.emit('Page.screencastFrame', {
      sessionId: 2,
      data: 'x'.repeat(6 * 1024 * 1024),
      metadata: { deviceWidth: 800, deviceHeight: 600 },
    })
    session.emit('Page.screencastFrame', { sessionId: 3, data: 42 })

    expect(source.stats().rejected).toBe(3)
    expect(buffer.latest()).toBeNull()
    expect(source.active).toBe(true)

    session.emit('Page.screencastFrame', frameEvent(jpeg(0x31)))
    expect(buffer.latest()?.seq).toBe(1)
    await source.stop()
  })

  it('maps a failed start to preview_failed and detaches the CDP session', async () => {
    const buffer = createPreviewFrameBuffer()
    const session = createFakeSession()
    session.failStart()
    const source = createScreencastSource({
      page: createFakePage(session),
      buffer,
      now: () => 0,
    })

    await expect(source.start()).rejects.toMatchObject({ code: 'preview_failed' })
    expect(source.active).toBe(false)
    expect(session.detached).toBe(true)
    expect(session.listeners.get('Page.screencastFrame')?.size ?? 0).toBe(0)
  })
})
