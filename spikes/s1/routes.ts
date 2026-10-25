/**
 * Fetch-shaped handlers for the two transport modes. Kept independent of DSH
 * so `run.ts` can exercise the same code over plain node:http.
 */
import {
  FRAME_BOUNDARY,
  STREAM_CONTENT_TYPE,
  framePartHeader,
  PART_TRAILER,
  type FrameTick,
} from './protocol'
import type { FrameSource } from './source'
import { FRAME_HEIGHT, FRAME_QUALITY, FRAME_WIDTH } from './frames'

export interface RouteMeta {
  width: number
  height: number
  quality: number
  fps: number
  frameCount: number
}

export function routeMeta(source: FrameSource): RouteMeta {
  return {
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    quality: FRAME_QUALITY,
    fps: source.fps,
    frameCount: source.frameCount,
  }
}

function baseHeaders(tick: FrameTick, meta: RouteMeta): Record<string, string> {
  return {
    'content-type': 'image/jpeg',
    'content-length': String(tick.bytes.byteLength),
    'cache-control': 'no-store, no-transform',
    'x-vibe-seq': String(tick.seq),
    'x-vibe-ts': String(tick.ts),
    'x-vibe-frame': String(tick.frameIndex),
    'x-vibe-host-rss': String(tick.hostRss),
    'x-vibe-fps': String(meta.fps),
    'x-vibe-width': String(meta.width),
    'x-vibe-height': String(meta.height),
    'x-vibe-quality': String(meta.quality),
  }
}

/**
 * Pull handler: `?after=<seq>&wait=1` long-polls for a newer frame; without
 * `wait` it returns the latest frame immediately.
 */
export function createPullHandler(source: FrameSource, meta: RouteMeta): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    const wait = url.searchParams.get('wait') === '1'
    const after = Number(url.searchParams.get('after') ?? '-1')
    const tick = wait
      ? await source.nextAfter(Number.isFinite(after) ? after : -1, request.signal, 2000)
      : source.snapshot()
    if (tick === null) return new Response('frames not ready', { status: 503 })
    return new Response(tick.bytes.slice().buffer, {
      status: 200,
      headers: baseHeaders(tick, meta),
    })
  }
}

/**
 * Stream handler: multipart/x-mixed-replace. Frames are skipped (not queued)
 * when the response stream applies backpressure; skipped counts travel in the
 * next part header. All state is per-request so several viewers can stream at
 * the same time.
 */
export function createStreamHandler(source: FrameSource, meta: RouteMeta): (request: Request) => Promise<Response> {
  return (request: Request): Promise<Response> => {
    let closed = false
    let unsubscribe: (() => void) | null = null
    let onAbort: (() => void) | null = null
    let lastSent = -1
    let dropped = 0

    const stop = (closeController: boolean, controller: ReadableStreamDefaultController<Uint8Array> | null): void => {
      if (closed) return
      closed = true
      unsubscribe?.()
      unsubscribe = null
      if (onAbort !== null) {
        request.signal.removeEventListener('abort', onAbort)
        onAbort = null
      }
      if (closeController && controller !== null) {
        try {
          controller.close()
        } catch {
          // The consumer already cancelled.
        }
      }
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (tick: FrameTick): void => {
          if (closed) return
          if (tick.seq <= lastSent) return
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            dropped += 1
            return
          }
          lastSent = tick.seq
          controller.enqueue(framePartHeader({
            seq: tick.seq,
            ts: tick.ts,
            frameIndex: tick.frameIndex,
            length: tick.bytes.byteLength,
            hostRss: tick.hostRss,
            dropped,
          }))
          dropped = 0
          controller.enqueue(tick.bytes)
          controller.enqueue(PART_TRAILER)
        }
        const initial = source.snapshot()
        if (initial !== null) send(initial)
        unsubscribe = source.subscribe(send)
        if (request.signal.aborted) {
          stop(true, controller)
        } else {
          onAbort = () => stop(true, controller)
          request.signal.addEventListener('abort', onAbort, { once: true })
        }
      },
      cancel() {
        stop(false, null)
      },
    })

    return Promise.resolve(new Response(stream, {
      headers: {
        'content-type': STREAM_CONTENT_TYPE,
        'cache-control': 'no-store, no-transform',
        'x-vibe-boundary': FRAME_BOUNDARY,
        'x-vibe-fps': String(meta.fps),
        'x-vibe-width': String(meta.width),
        'x-vibe-height': String(meta.height),
        'x-vibe-quality': String(meta.quality),
      },
    }))
  }
}
