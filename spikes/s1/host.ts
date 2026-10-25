/**
 * T001 S1 host half: four authenticated exact Fetch routes under `/api`.
 *
 * Route paths passed to `ctx.connection.fetch.register` must include the
 * `/api` prefix (connection validates them via endpointFromPath('/api', path)).
 * The browser calls the document-relative form of the same path; on DSH Web
 * and Desktop the page base resolves it to the active Host.
 *
 * We deliberately do not use `ctx.connection.rpc.handle` for this spike:
 * DSH 0.2.1-rc.2 binds that registration to the Connection service's own
 * fiber, which does not inject `webServer`, so a custom channel fails with
 * `cannot get property "webServer" without inject`. Exact Fetch routes use
 * only `ctx.connection.fetch`, are owned by this plugin's fiber, and are the
 * same registry the built-in session routes use. This is recorded as an
 * assumption correction in spikes/s1/REPORT.md.
 */
import { appendFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { generateFrames, type EncodedFrame } from './frames'
import { FrameSource } from './source'
import { createPullHandler, createStreamHandler, routeMeta } from './routes'
import { HEALTH_PATH, METRICS_PATH, METRICS_REPORT_KIND, PULL_PATH, STREAM_PATH } from './protocol'

export const name = 'dsh-vibe-s1-spike'
export const inject = ['connection']

interface HostContext {
  connection: {
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

/** Repo-relative label; never write machine paths into reports or responses. */
const METRICS_LABEL = 'spikes/s1/metrics.jsonl'
const metricsPath = fileURLToPath(new URL('../../metrics.jsonl', import.meta.url))

function hostSnapshot(): Record<string, unknown> {
  return {
    hostRss: process.memoryUsage().rss,
    hostHeapUsed: process.memoryUsage().heapUsed,
    uptimeMs: Date.now() - startedAt,
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
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

  effect(() => ctx.connection.fetch.register({
    path: HEALTH_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      return json({
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
          metricsPath: METRICS_LABEL,
          ...hostSnapshot(),
        },
      })
    },
  }), 'vibe-s1: health route')

  effect(() => ctx.connection.fetch.register({
    path: METRICS_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let text: string
      try {
        text = await request.text()
      } catch (error) {
        return json({ ok: false, error: { code: 'read_failed', message: String(error) } }, 400)
      }
      if (text.length > 200_000) {
        return json({
          ok: false,
          error: { code: 'payload_too_large', message: 'metrics payload exceeds 200 KB', details: { length: text.length } },
        }, 413)
      }
      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch {
        return json({ ok: false, error: { code: 'bad_payload', message: 'metrics payload is not JSON' } }, 400)
      }
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return json({ ok: false, error: { code: 'bad_payload', message: 'metrics payload must be an object' } }, 400)
      }
      const reportKind = (payload as { kind?: unknown }).kind
      if (reportKind !== METRICS_REPORT_KIND) {
        return json({ ok: false, error: { code: 'bad_payload', message: 'unexpected metrics report kind' } }, 400)
      }
      let line: string
      try {
        line = JSON.stringify({ receivedAt: new Date().toISOString(), ...hostSnapshot(), report: payload })
      } catch {
        return json({ ok: false, error: { code: 'bad_payload', message: 'metrics payload is not serializable' } }, 400)
      }
      try {
        await appendFile(metricsPath, `${line}\n`, 'utf8')
        return json({ ok: true, value: { saved: true, path: METRICS_LABEL, bytes: line.length } })
      } catch (error) {
        return json({ ok: false, error: { code: 'write_failed', message: String(error), details: { path: METRICS_LABEL } } }, 500)
      }
    },
  }), 'vibe-s1: metrics route')

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

  console.log(`[vibe-s1] host ready: ${HEALTH_PATH}, ${METRICS_PATH}, ${PULL_PATH}, ${STREAM_PATH}; metrics -> ${METRICS_LABEL}`)
}
