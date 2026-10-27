/**
 * CDP screencast source (T020).
 *
 * `Page.startScreencast` emits frames as fast as the page paints (~98 fps in
 * S3), so the source acks every frame immediately (otherwise Chrome throttles)
 * but only decodes and publishes at the configured pace. When the panel cannot
 * keep up, the newest pending frame wins and the replaced one is counted as
 * dropped — Host memory stays at one pending JPEG.
 */
import { studioError, type StudioError } from '../../contracts/errors'
import {
  DEFAULT_PREVIEW_FPS,
  DEFAULT_PREVIEW_QUALITY,
  MAX_PREVIEW_FRAME_BYTES,
} from '../../contracts/transport'
import type { ScreencastPageLike, ScreencastSessionLike } from '../targets/types'
import type { PreviewFrameBuffer } from './frame-buffer'

const SCREENCAST_FRAME_EVENT = 'Page.screencastFrame'
const SCREENCAST_FRAME_ACK = 'Page.screencastFrameAck'
/** Poll granularity for the deadline scheduler; publishes are still paced by fps. */
const SCHEDULER_POLL_MS = 10

export interface ScreencastStats {
  readonly received: number
  readonly published: number
  readonly dropped: number
  readonly rejected: number
  readonly lastFrameAt: number | null
}

export interface ScreencastSource {
  /** Creates the CDP session and starts streaming; idempotent. */
  start(): Promise<void>
  /** Stops CDP streaming, detaches, clears the buffer; idempotent. */
  stop(): Promise<void>
  readonly active: boolean
  readonly fps: number
  readonly quality: number
  stats(): ScreencastStats
}

export interface ScreencastOptions {
  readonly page: ScreencastPageLike
  readonly buffer: PreviewFrameBuffer
  readonly fps?: number
  readonly quality?: number
  readonly now?: () => number
}

interface FrameEvent {
  readonly data?: unknown
  readonly sessionId?: unknown
  readonly metadata?: {
    readonly timestamp?: unknown
    readonly deviceWidth?: unknown
    readonly deviceHeight?: unknown
  }
}

interface PendingFrame {
  readonly bytes: Uint8Array
  readonly ts: number
  readonly width: number
  readonly height: number
}

function toPreviewError(error: unknown): StudioError {
  const message = error instanceof Error ? error.message : String(error)
  return studioError('preview_failed', `vibe-studio: screencast failed: ${message}`)
}

function decodeFrame(
  data: unknown,
  metadata: FrameEvent['metadata'],
  viewport: { readonly width: number; readonly height: number } | null,
): { bytes: Uint8Array; width: number; height: number } | null {
  if (typeof data !== 'string' || data.length === 0) return null
  // Reject before decoding: a 4 MiB JPEG is ~5.6 MiB of base64 text.
  if (data.length > Math.ceil((MAX_PREVIEW_FRAME_BYTES * 4) / 3) + 4) return null
  let decoded: Buffer
  try {
    decoded = Buffer.from(data, 'base64')
  } catch {
    return null
  }
  if (decoded.byteLength < 2 || decoded.byteLength > MAX_PREVIEW_FRAME_BYTES) return null
  // JPEG SOI marker; anything else is not a frame we can render.
  if (decoded[0] !== 0xff || decoded[1] !== 0xd8) return null

  const rawWidth = metadata?.deviceWidth
  const rawHeight = metadata?.deviceHeight
  const width =
    typeof rawWidth === 'number' && Number.isFinite(rawWidth) && rawWidth > 0
      ? Math.round(rawWidth)
      : viewport?.width
  const height =
    typeof rawHeight === 'number' && Number.isFinite(rawHeight) && rawHeight > 0
      ? Math.round(rawHeight)
      : viewport?.height
  if (!width || !height) return null

  return {
    bytes: new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength),
    width,
    height,
  }
}

export function createScreencastSource(options: ScreencastOptions): ScreencastSource {
  const { page, buffer } = options
  const fps = options.fps ?? DEFAULT_PREVIEW_FPS
  const quality = options.quality ?? DEFAULT_PREVIEW_QUALITY
  const now = options.now ?? (() => Date.now())
  const frameIntervalMs = 1000 / fps

  let session: ScreencastSessionLike | undefined
  let starting: Promise<void> | undefined
  let running = false
  let stopping = false
  let pending: PendingFrame | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let nextDue = 0
  /** Bumped by `stop()` so an in-flight `start()` cannot revive the source. */
  let epoch = 0

  let received = 0
  let published = 0
  let dropped = 0
  let rejected = 0
  let lastFrameAt: number | null = null

  function publish(frame: PendingFrame): void {
    published += 1
    lastFrameAt = frame.ts
    buffer.publish(frame)
  }

  function clearTimer(): void {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }

  function tick(): void {
    if (!running || pending === null) {
      clearTimer()
      return
    }
    const at = now()
    if (at < nextDue) return
    const frame = pending
    pending = null
    publish(frame)
    nextDue = at + frameIntervalMs
    clearTimer()
  }

  function ensureTimer(): void {
    if (timer === undefined && running) {
      timer = setInterval(tick, SCHEDULER_POLL_MS)
      // Do not keep the Host process alive just for frame pacing.
      if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
        ;(timer as { unref: () => void }).unref()
      }
    }
  }

  function onFrame(raw: unknown, listenerSession: ScreencastSessionLike): void {
    if (!running) return
    const event = (raw ?? {}) as FrameEvent
    received += 1

    // Ack first: Chrome stops sending until the previous frame is acknowledged.
    if (event.sessionId !== undefined) {
      void listenerSession
        .send(SCREENCAST_FRAME_ACK, { sessionId: event.sessionId })
        .catch(() => undefined)
    }

    const decoded = decodeFrame(event.data, event.metadata, page.viewport())
    if (decoded === null) {
      rejected += 1
      return
    }
    const frame: PendingFrame = { ...decoded, ts: now() }

    // Publish immediately when the pace allows, so the first frame is not
    // delayed by a scheduler tick.
    if (now() >= nextDue) {
      pending = null
      publish(frame)
      nextDue = now() + frameIntervalMs
      return
    }
    if (pending !== null) dropped += 1
    pending = frame
    ensureTimer()
  }

  async function start(): Promise<void> {
    if (running) return
    if (starting) return starting
    const startedEpoch = epoch
    starting = (async () => {
      stopping = false
      let created: ScreencastSessionLike
      try {
        created = await page.createCdpSession()
      } catch (error) {
        throw toPreviewError(error)
      }
      if (startedEpoch !== epoch) {
        // `stop()` ran while the CDP session was being created.
        await created.detach().catch(() => undefined)
        return
      }
      session = created
      const viewport = page.viewport()
      const listener = (raw: unknown): void => onFrame(raw, created)
      created.on(SCREENCAST_FRAME_EVENT, listener)
      running = true
      try {
        await created.send('Page.startScreencast', {
          format: 'jpeg',
          quality,
          maxWidth: viewport?.width,
          maxHeight: viewport?.height,
          everyNthFrame: 1,
        })
      } catch (error) {
        running = false
        created.off?.(SCREENCAST_FRAME_EVENT, listener)
        await created.detach().catch(() => undefined)
        session = undefined
        throw toPreviewError(error)
      }
      if (startedEpoch !== epoch) {
        running = false
        created.off?.(SCREENCAST_FRAME_EVENT, listener)
        await created.send('Page.stopScreencast').catch(() => undefined)
        await created.detach().catch(() => undefined)
        session = undefined
        return
      }
      nextDue = 0
    })()
    try {
      await starting
    } finally {
      starting = undefined
    }
  }

  async function stop(): Promise<void> {
    if (stopping) return
    epoch += 1
    stopping = true
    running = false
    clearTimer()
    pending = null
    const active = session
    session = undefined
    if (active) {
      await active.send('Page.stopScreencast').catch(() => undefined)
      await active.detach().catch(() => undefined)
    }
    buffer.clear()
    stopping = false
  }

  return {
    start,
    stop,
    get active() {
      return running
    },
    fps,
    quality,
    stats() {
      return { received, published, dropped, rejected, lastFrameAt }
    },
  }
}
