/**
 * Preview routes (T020, toolbar methods T025).
 *
 * `preview.session.{start,stop,status,navigate,reload,viewport}` plus the
 * console/network methods are unary calls on the shared authenticated
 * transport; `preview.targets` feeds the toolbar's target select. Frames use
 * two exact routes: a multipart stream (`/api/vibe/stream`) as the primary
 * channel and a long-poll (`/api/vibe/frame?wait=1&after=<seq>`) the client
 * falls back to when the stream breaks. Both read the same latest-frame
 * buffer, so the two channels cannot drift and only one JPEG is retained in
 * Host memory.
 */
import { isStudioError, studioError, type StudioError } from '../../contracts/errors'
import {
  FRAME_BOUNDARY,
  FRAME_PATH,
  MAX_FRAME_WAIT_MS,
  PREVIEW_CONSOLE_CLEAR_METHOD,
  PREVIEW_CONSOLE_LIST_METHOD,
  PREVIEW_INPUT_METHOD,
  PREVIEW_NAVIGATE_METHOD,
  PREVIEW_NETWORK_BODY_METHOD,
  PREVIEW_NETWORK_CLEAR_METHOD,
  PREVIEW_NETWORK_LIST_METHOD,
  PREVIEW_RELOAD_METHOD,
  PREVIEW_START_METHOD,
  PREVIEW_STATUS_METHOD,
  PREVIEW_STOP_METHOD,
  PREVIEW_TARGETS_METHOD,
  PREVIEW_VIEWPORT_METHOD,
  STREAM_CONTENT_TYPE,
  STREAM_PATH,
  isPreviewStartParams,
} from '../../contracts/transport'
import { jsonResponse, type ConnectionFetchRouteLike, type TransportHostContext, type UnaryRegistry } from '../transport'
import type { PreviewFrame } from './frame-buffer'
import {
  createPreviewService,
  type PreviewService,
  type PreviewServiceOptions,
} from './session'

export { createPreviewService }
export type { PreviewService, PreviewServiceOptions }

const encoder = new TextEncoder()

/** Registers the unary methods; returns an idempotent unregister. */
export function registerPreviewMethods(
  registry: UnaryRegistry,
  service: PreviewService,
): () => void {
  const offStart = registry.register(PREVIEW_START_METHOD, async (params) => {
    if (!isPreviewStartParams(params)) {
      throw studioError('invalid_input', 'vibe-studio: invalid preview start params', {
        field: 'params',
      })
    }
    return service.start(params)
  })
  const offStop = registry.register(PREVIEW_STOP_METHOD, async () => service.stop())
  const offStatus = registry.register(PREVIEW_STATUS_METHOD, () => service.status())
  const offInput = registry.register(PREVIEW_INPUT_METHOD, async (params) =>
    service.input(params),
  )
  const offConsoleList = registry.register(PREVIEW_CONSOLE_LIST_METHOD, async (params) =>
    service.consoleList(params),
  )
  const offConsoleClear = registry.register(PREVIEW_CONSOLE_CLEAR_METHOD, async () =>
    service.consoleClear(),
  )
  const offNetworkList = registry.register(PREVIEW_NETWORK_LIST_METHOD, async (params) =>
    service.networkList(params),
  )
  const offNetworkClear = registry.register(PREVIEW_NETWORK_CLEAR_METHOD, async () =>
    service.networkClear(),
  )
  const offNetworkBody = registry.register(PREVIEW_NETWORK_BODY_METHOD, async (params) =>
    service.networkBody(params),
  )
  // T025 toolbar: target list plus the three session mutations. Each validates
  // inside the service so route and service cannot disagree about the shape.
  const offTargets = registry.register(PREVIEW_TARGETS_METHOD, async () =>
    service.listTargets(),
  )
  const offNavigate = registry.register(PREVIEW_NAVIGATE_METHOD, async (params) =>
    service.navigate(params),
  )
  const offReload = registry.register(PREVIEW_RELOAD_METHOD, async () => service.reload())
  const offViewport = registry.register(PREVIEW_VIEWPORT_METHOD, async (params) =>
    service.setViewport(params),
  )
  return () => {
    offStart()
    offStop()
    offStatus()
    offInput()
    offConsoleList()
    offConsoleClear()
    offNetworkList()
    offNetworkClear()
    offNetworkBody()
    offTargets()
    offNavigate()
    offReload()
    offViewport()
  }
}

function streamPart(frame: PreviewFrame, dropped: number): Uint8Array {
  const header =
    `--${FRAME_BOUNDARY}\r\n` +
    'Content-Type: image/jpeg\r\n' +
    `Content-Length: ${frame.bytes.byteLength}\r\n` +
    `X-Vibe-Seq: ${frame.seq}\r\n` +
    `X-Vibe-Ts: ${frame.ts}\r\n` +
    `X-Vibe-Width: ${frame.width}\r\n` +
    `X-Vibe-Height: ${frame.height}\r\n` +
    `X-Vibe-Dropped: ${dropped}\r\n` +
    '\r\n'
  const headerBytes = encoder.encode(header)
  const part = new Uint8Array(headerBytes.byteLength + frame.bytes.byteLength + 2)
  part.set(headerBytes, 0)
  part.set(frame.bytes, headerBytes.byteLength)
  part[part.byteLength - 2] = 0x0d
  part[part.byteLength - 1] = 0x0a
  return part
}

const STREAM_HEADERS: Readonly<Record<string, string>> = {
  'content-type': STREAM_CONTENT_TYPE,
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

function methodNotAllowed(allow: string): Response {
  return jsonResponse(
    { ok: false, error: studioError('unsupported', `preview route accepts ${allow} only`) },
    405,
    { allow },
  )
}

function unavailable(): Response {
  return jsonResponse(
    { ok: false, error: studioError('target_unavailable', 'vibe-studio: preview is not running') },
    503,
  )
}

export function createPreviewStreamRoute(
  service: PreviewService,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET') return methodNotAllowed('GET')
    if (service.status().status !== 'ready') return unavailable()

    const buffer = service.buffer
    let dispose = (): void => undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false
        let dropped = 0

        const close = (): void => {
          if (closed) return
          closed = true
          dispose()
          try {
            controller.enqueue(encoder.encode(`--${FRAME_BOUNDARY}--\r\n`))
          } catch {
            // Already cancelled.
          }
          try {
            controller.close()
          } catch {
            // Already cancelled.
          }
        }
        const send = (frame: PreviewFrame | null): void => {
          if (closed) return
          if (frame === null) {
            close()
            return
          }
          // The panel is slower than the stream: skip this frame, count it,
          // and let the next publish try again.
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            dropped += 1
            return
          }
          try {
            controller.enqueue(streamPart(frame, dropped))
          } catch {
            close()
          }
        }
        const onAbort = (): void => close()
        const unsubscribe = buffer.subscribe(send)
        dispose = () => {
          closed = true
          unsubscribe()
          request.signal.removeEventListener('abort', onAbort)
        }

        request.signal.addEventListener('abort', onAbort, { once: true })
        if (request.signal.aborted) {
          close()
          return
        }
        // Do not wait up to one frame interval for the first paint.
        const current = buffer.latest()
        if (current !== null) send(current)
      },
      cancel() {
        dispose()
      },
    })

    return new Response(stream, { status: 200, headers: STREAM_HEADERS })
  }
}

function frameHeaders(frame: PreviewFrame): Record<string, string> {
  return {
    'content-type': 'image/jpeg',
    'content-length': String(frame.bytes.byteLength),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-vibe-seq': String(frame.seq),
    'x-vibe-ts': String(frame.ts),
    'x-vibe-width': String(frame.width),
    'x-vibe-height': String(frame.height),
  }
}

const FRAME_QUERY_KEYS = new Set(['wait', 'after'])

function parseFrameQuery(url: URL): { wait: boolean; after: number } | StudioError {
  for (const key of url.searchParams.keys()) {
    if (!FRAME_QUERY_KEYS.has(key)) {
      return studioError('invalid_input', `unknown query parameter "${key}"`, { field: key })
    }
  }
  const waitRaw = url.searchParams.get('wait')
  if (waitRaw !== null && waitRaw !== '0' && waitRaw !== '1') {
    return studioError('invalid_input', '"wait" must be 0 or 1', { field: 'wait' })
  }
  const afterRaw = url.searchParams.get('after')
  let after = 0
  if (afterRaw !== null) {
    if (!/^\d{1,15}$/.test(afterRaw)) {
      return studioError('invalid_input', '"after" must be a non-negative integer', {
        field: 'after',
      })
    }
    after = Number(afterRaw)
  }
  return { wait: waitRaw === '1', after }
}

export function createPreviewFrameRoute(
  service: PreviewService,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET') return methodNotAllowed('GET')

    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return jsonResponse(
        { ok: false, error: studioError('invalid_input', 'request URL is invalid') },
        400,
      )
    }
    const parsed = parseFrameQuery(url)
    if (isStudioError(parsed)) {
      return jsonResponse({ ok: false, error: parsed }, 400)
    }
    if (service.status().status !== 'ready') return unavailable()

    const buffer = service.buffer
    let frame: PreviewFrame | null
    if (parsed.wait) {
      frame = await buffer.nextAfter(parsed.after, request.signal, MAX_FRAME_WAIT_MS)
    } else {
      frame = buffer.latest()
    }
    if (frame === null || frame.seq <= parsed.after) {
      return new Response(null, {
        status: 204,
        headers: {
          'cache-control': 'no-store',
          'x-vibe-seq': String(buffer.lastSeq),
        },
      })
    }
    // `slice()` gives an ArrayBuffer-backed view, which `BodyInit` accepts.
    return new Response(frame.bytes.slice().buffer, {
      status: 200,
      headers: frameHeaders(frame),
    })
  }
}

/**
 * Registers `/api/vibe/stream` and `/api/vibe/frame` under effects so a plugin
 * reload unregisters them with the Host fiber.
 */
export function registerPreviewRoutes(
  ctx: TransportHostContext,
  service: PreviewService,
): void {
  const routes: ConnectionFetchRouteLike[] = [
    {
      path: STREAM_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: createPreviewStreamRoute(service),
    },
    {
      path: FRAME_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: createPreviewFrameRoute(service),
    },
  ]
  for (const route of routes) {
    const setup = () => ctx.connection.fetch.register(route)
    if (typeof ctx.effect === 'function') {
      ctx.effect(setup, `vibe-studio: ${route.path}`)
    } else {
      void setup()
    }
  }
}
