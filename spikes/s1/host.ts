/**
 * T001 S1 host half: two authenticated exact Fetch routes under `/api` plus a
 * unary RPC channel `/vibe`.
 *
 * The route path passed to `ctx.connection.fetch.register` must include the
 * `/api` prefix (connection validates it via endpointFromPath('/api', path)).
 * The browser calls the same absolute path; on DSH Web the page is same-origin.
 */
import { appendFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { generateFrames, type EncodedFrame } from './frames'
import { FrameSource } from './source'
import { createPullHandler, createStreamHandler, routeMeta } from './routes'
import { PULL_PATH, STREAM_PATH, RPC_CHANNEL } from './protocol'

export const name = 'dsh-vibe-s1-spike'
export const inject = ['connection']

interface HostContext {
  connection: {
    rpc: {
      handle(channel: string, handler: (
        endpoint: string,
        payload: unknown,
        signal: AbortSignal,
        peer: unknown,
      ) => Promise<unknown>): () => Promise<void>
    }
    fetch: {
      register(route: {
        path: string
        methods: readonly string[]
        requestBody: 'buffered' | 'streaming'
        fetch: (request: Request) => Promise<Response>
      }): () => Promise<void>
    }
  }
  effect?: (setup: () => void | (() => void | Promise<void>), label?: string) => void
}

const FPS = 30
const source = new FrameSource(FPS)
const startedAt = Date.now()
let framesPromise: Promise<EncodedFrame[]> | null = null

function ensureFrames(): Promise<EncodedFrame[]> {
  framesPromise ??= Promise.resolve().then(() => {
    const begin = Date.now()
    const frames = generateFrames()
    source.setFrames(frames)
    const bytes = frames.reduce((sum, frame) => sum + frame.bytes.byteLength, 0)
    console.log(`[vibe-s1] generated ${frames.length} frames in ${Date.now() - begin} ms (${(bytes / 1024).toFixed(1)} KiB total)`)
    return frames
  })
  return framesPromise
}

const metricsPath = fileURLToPath(new URL('../../metrics.jsonl', import.meta.url))

function hostSnapshot(): Record<string, unknown> {
  return {
    hostRss: process.memoryUsage().rss,
    hostHeapUsed: process.memoryUsage().heapUsed,
    uptimeMs: Date.now() - startedAt,
    node: process.version,
    platform: process.platform,
    pid: process.pid,
  }
}

export function apply(ctx: HostContext): void {
  const meta = routeMeta(source)
  const pull = createPullHandler(source, meta)
  const stream = createStreamHandler(source, meta)

  const effect = (setup: () => void | (() => void | Promise<void>), label: string): void => {
    if (typeof ctx.effect === 'function') ctx.effect(setup, label)
    else setup()
  }

  effect(() => {
    source.start()
    return () => source.stop()
  }, 'vibe-s1: frame clock')

  effect(() => ctx.connection.rpc.handle(RPC_CHANNEL, async (endpoint, payload) => {
    if (endpoint === 'health') {
      return {
        ok: true,
        value: {
          plugin: name,
          dshMode: 'host',
          fps: FPS,
          frameCount: source.frameCount,
          framesReady: source.ready,
          width: meta.width,
          height: meta.height,
          quality: meta.quality,
          metricsPath,
          ...hostSnapshot(),
        },
      }
    }
    if (endpoint === 'metrics') {
      let line: string
      try {
        line = JSON.stringify({
          receivedAt: new Date().toISOString(),
          ...hostSnapshot(),
          report: payload,
        })
      } catch {
        return { ok: false, error: { code: 'bad_payload', message: 'metrics payload is not JSON', details: {} } }
      }
      if (line.length > 200_000) {
        return { ok: false, error: { code: 'payload_too_large', message: 'metrics payload exceeds 200 KB', details: { length: line.length } } }
      }
      try {
        await appendFile(metricsPath, `${line}\n`, 'utf8')
        return { ok: true, value: { saved: true, path: metricsPath, bytes: line.length } }
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'write_failed',
            message: String(error),
            details: { path: metricsPath },
          },
        }
      }
    }
    return {
      ok: false,
      error: { code: 'unknown_endpoint', message: `unknown endpoint: ${endpoint}`, details: { endpoint } },
    }
  }), 'vibe-s1: rpc')

  effect(() => ctx.connection.fetch.register({
    path: PULL_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      await ensureFrames()
      return pull(request)
    },
  }), 'vibe-s1: pull route')

  effect(() => ctx.connection.fetch.register({
    path: STREAM_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      await ensureFrames()
      return stream(request)
    },
  }), 'vibe-s1: stream route')

  console.log(`[vibe-s1] host ready: ${PULL_PATH}, ${STREAM_PATH}, rpc ${RPC_CHANNEL}; metrics -> ${metricsPath}`)
}
