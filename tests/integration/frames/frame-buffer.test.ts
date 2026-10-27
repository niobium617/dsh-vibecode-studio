import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPreviewFrameBuffer } from '../../../src/host/preview/frame-buffer'

const frameBytes = (fill: number): Uint8Array =>
  Uint8Array.from([0xff, 0xd8, fill, 0xff, 0xd9])

function publish(buffer: ReturnType<typeof createPreviewFrameBuffer>, fill: number) {
  return buffer.publish({ ts: fill, width: 800, height: 600, bytes: frameBytes(fill) })
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PreviewFrameBuffer', () => {
  it('keeps only the newest frame and a monotone sequence', () => {
    const buffer = createPreviewFrameBuffer()
    const first = publish(buffer, 1)
    const second = publish(buffer, 2)

    expect(first.seq).toBe(1)
    expect(second.seq).toBe(2)
    expect(buffer.latest()?.seq).toBe(2)
    expect(buffer.latest()?.bytes).toEqual(frameBytes(2))
    expect(buffer.lastSeq).toBe(2)
  })

  it('resolves a waiter as soon as a newer frame arrives', async () => {
    const buffer = createPreviewFrameBuffer()
    publish(buffer, 1)

    const pending = buffer.nextAfter(1, new AbortController().signal, 5_000)
    publish(buffer, 2)
    const frame = await pending

    expect(frame?.seq).toBe(2)
    expect(buffer.waiterCount).toBe(0)
  })

  it('returns immediately when a newer frame already exists', async () => {
    const buffer = createPreviewFrameBuffer()
    publish(buffer, 1)
    publish(buffer, 2)

    const frame = await buffer.nextAfter(1, new AbortController().signal, 5_000)
    expect(frame?.seq).toBe(2)
  })

  it('resolves with the current frame (or null) on timeout', async () => {
    vi.useFakeTimers()
    const buffer = createPreviewFrameBuffer()
    const empty = buffer.nextAfter(0, new AbortController().signal, 50)
    await vi.advanceTimersByTimeAsync(60)
    expect(await empty).toBeNull()
    expect(buffer.waiterCount).toBe(0)

    publish(buffer, 1)
    const stale = buffer.nextAfter(1, new AbortController().signal, 50)
    await vi.advanceTimersByTimeAsync(60)
    expect((await stale)?.seq).toBe(1)
    expect(buffer.waiterCount).toBe(0)
  })

  it('resolves on abort and removes the waiter', async () => {
    const buffer = createPreviewFrameBuffer()
    const controller = new AbortController()
    const pending = buffer.nextAfter(0, controller.signal, 5_000)
    expect(buffer.waiterCount).toBe(1)

    controller.abort()
    expect(await pending).toBeNull()
    expect(buffer.waiterCount).toBe(0)
  })

  it('notifies subscribers, survives a throwing listener, and clears with null', () => {
    const buffer = createPreviewFrameBuffer()
    const seen: (number | null)[] = []
    const stopGood = buffer.subscribe((frame) => seen.push(frame?.seq ?? null))
    buffer.subscribe(() => {
      throw new Error('stalled panel')
    })

    publish(buffer, 1)
    expect(seen).toEqual([1])
    expect(buffer.subscriberCount).toBe(2)

    const waiter = buffer.nextAfter(1, new AbortController().signal, 5_000)
    buffer.clear()
    return waiter.then((frame) => {
      expect(frame).toBeNull()
      expect(seen).toEqual([1, null])
      expect(buffer.subscriberCount).toBe(0)
      expect(buffer.waiterCount).toBe(0)
      expect(buffer.latest()).toBeNull()

      // Sequence keeps climbing after a clear, so a reconnecting puller that
      // remembers its last seq is served as soon as a frame appears.
      const next = publish(buffer, 2)
      expect(next.seq).toBe(2)
      stopGood()
    })
  })
})
