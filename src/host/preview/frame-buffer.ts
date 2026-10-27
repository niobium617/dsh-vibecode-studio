/**
 * Latest-frame buffer shared by the stream and pull routes (T020).
 *
 * Screencast frames arrive much faster than the panel can use them, so only
 * the newest frame is retained: memory stays at one JPEG regardless of page
 * activity. `seq` keeps increasing across `clear()` calls, which lets a pull
 * client that reconnects after a restart continue from its last `after` value
 * without waiting for the sequence to climb back up.
 */
import type { PreviewFrameMeta } from '../../contracts/transport'

export interface PreviewFrame extends PreviewFrameMeta {
  readonly bytes: Uint8Array
}

/** A listener receives `null` when the buffer is cleared (session stopped). */
export type FrameListener = (frame: PreviewFrame | null) => void

interface Waiter {
  readonly after: number
  readonly resolve: (frame: PreviewFrame | null) => void
}

export class PreviewFrameBuffer {
  private seq = 0
  private last: PreviewFrame | null = null
  private readonly listeners = new Set<FrameListener>()
  private readonly waiters = new Set<Waiter>()

  /** Stores a frame and returns its new sequence number. */
  publish(input: {
    readonly ts: number
    readonly width: number
    readonly height: number
    readonly bytes: Uint8Array
  }): PreviewFrame {
    this.seq += 1
    const frame: PreviewFrame = {
      seq: this.seq,
      ts: input.ts,
      width: input.width,
      height: input.height,
      bytes: input.bytes,
    }
    this.last = frame

    for (const waiter of [...this.waiters]) {
      if (waiter.after >= frame.seq) continue
      this.waiters.delete(waiter)
      waiter.resolve(frame)
    }
    for (const listener of [...this.listeners]) {
      try {
        listener(frame)
      } catch {
        // One stalled stream must not stop the screencast.
      }
    }
    return frame
  }

  latest(): PreviewFrame | null {
    return this.last
  }

  /**
   * Resolves with the first frame newer than `after`, or with the current
   * frame (possibly the same one) when the wait times out or is aborted. `null`
   * means no frame exists or the session was cleared.
   */
  nextAfter(after: number, signal: AbortSignal, timeoutMs: number): Promise<PreviewFrame | null> {
    const current = this.last
    if (current !== null && current.seq > after) return Promise.resolve(current)

    return new Promise<PreviewFrame | null>((resolve) => {
      let settled = false
      const finish = (frame: PreviewFrame | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        this.waiters.delete(waiter)
        resolve(frame)
      }
      const onAbort = (): void => finish(this.last)
      const waiter: Waiter = { after, resolve: finish }
      const timer = setTimeout(() => finish(this.last), Math.max(0, timeoutMs))
      this.waiters.add(waiter)
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  subscribe(listener: FrameListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Drops the retained JPEG and releases every waiter and stream listener with
   * `null`. Used on stop so a disconnected panel does not hold bytes or timers.
   */
  clear(): void {
    this.last = null
    const listeners = [...this.listeners]
    const waiters = [...this.waiters]
    this.listeners.clear()
    this.waiters.clear()
    for (const waiter of waiters) waiter.resolve(null)
    for (const listener of listeners) {
      try {
        listener(null)
      } catch {
        // Closed streams ignore late notifications.
      }
    }
  }

  get lastSeq(): number {
    return this.seq
  }

  get subscriberCount(): number {
    return this.listeners.size
  }

  get waiterCount(): number {
    return this.waiters.size
  }
}

export function createPreviewFrameBuffer(): PreviewFrameBuffer {
  return new PreviewFrameBuffer()
}
