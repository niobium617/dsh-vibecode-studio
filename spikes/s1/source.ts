/**
 * Shared frame clock: one ticker produces a monotone seq at the configured
 * rate; pull long-polls wait for the next seq, stream subscribers receive each
 * tick. The same implementation runs in the DSH host and in the local
 * benchmark so both measure identical semantics.
 */
import type { EncodedFrame } from './frames'
import type { FrameTick } from './protocol'

export class FrameSource {
  readonly fps: number
  private frames: EncodedFrame[] | null = null
  private seq = 0
  private last: FrameTick | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private listeners = new Set<(tick: FrameTick) => void>()

  constructor(fps = 30) {
    this.fps = fps
  }

  setFrames(frames: EncodedFrame[]): void {
    this.frames = frames
    // Publish one frame immediately so the first request does not wait a tick.
    if (this.timer !== null) this.tick()
  }

  get ready(): boolean {
    return this.frames !== null
  }

  get frameCount(): number {
    return this.frames?.length ?? 0
  }

  start(): void {
    if (this.timer !== null) return
    this.running = true
    const period = 1000 / this.fps
    this.tick()
    let deadline = performance.now() + period
    // Windows coalesces timers to ~15.6 ms, so a 33 ms interval fires every
    // ~46 ms (about 21 fps). Poll faster and emit against an absolute
    // deadline instead: short and long ticks average out to the target rate.
    const timer = setInterval(() => {
      if (!this.running) return
      const now = performance.now()
      if (now + 3 >= deadline) {
        this.tick()
        deadline += period
        // After a long stall, resync rather than bursting to catch up.
        if (deadline < now - period) deadline = now + period
      }
    }, 10)
    // Never keep the DSH host process alive just for the spike clock.
    timer.unref?.()
    this.timer = timer
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  snapshot(): FrameTick | null {
    return this.last
  }

  /**
   * Resolve with the first tick newer than `after`, or the latest tick when the
   * timeout/abort fires. Null means frames were not ready at all.
   */
  async nextAfter(after: number, signal: AbortSignal, timeoutMs = 2000): Promise<FrameTick | null> {
    const current = this.last
    if (current !== null && current.seq > after) return current
    return await new Promise<FrameTick | null>((resolve) => {
      let settled = false
      const done = (tick: FrameTick | null): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(tick)
      }
      const onTick = (tick: FrameTick): void => {
        if (tick.seq > after) done(tick)
      }
      const onAbort = (): void => done(this.last)
      const timer = setTimeout(() => done(this.last), timeoutMs)
      const cleanup = (): void => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        this.listeners.delete(onTick)
      }
      this.listeners.add(onTick)
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  subscribe(listener: (tick: FrameTick) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private tick(): void {
    this.seq += 1
    const frames = this.frames
    if (frames === null) return
    const frame = frames[this.seq % frames.length]
    const tick: FrameTick = {
      seq: this.seq,
      ts: Date.now(),
      frameIndex: frame.index,
      bytes: frame.bytes,
      hostRss: process.memoryUsage().rss,
    }
    this.last = tick
    for (const listener of [...this.listeners]) {
      try {
        listener(tick)
      } catch {
        // One bad subscriber must not stop the clock.
      }
    }
  }
}
