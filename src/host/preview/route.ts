/**
 * Preview session service and its exact routes (T020).
 *
 * `preview.session.{start,stop,status}` are unary methods on the shared
 * authenticated transport. Frames use two exact routes: a multipart stream
 * (`/api/vibe/stream`) as the primary channel and a long-poll
 * (`/api/vibe/frame?wait=1&after=<seq>`) the client falls back to when the
 * stream breaks. Both read the same latest-frame buffer, so the two channels
 * cannot drift and only one JPEG is retained in Host memory.
 */
import type { StudioError } from '../../contracts/errors'
import { isStudioError, studioError } from '../../contracts/errors'
import type { TargetCapabilities, TargetSession } from '../../contracts/target'
import {
  DEFAULT_PREVIEW_FPS,
  DEFAULT_PREVIEW_QUALITY,
  FRAME_BOUNDARY,
  FRAME_PATH,
  MAX_FRAME_WAIT_MS,
  PREVIEW_CONSOLE_CLEAR_METHOD,
  PREVIEW_CONSOLE_LIST_METHOD,
  PREVIEW_INPUT_METHOD,
  PREVIEW_START_METHOD,
  PREVIEW_STATUS_METHOD,
  PREVIEW_STOP_METHOD,
  STREAM_CONTENT_TYPE,
  STREAM_PATH,
  isPreviewConsoleQuery,
  isPreviewInputEvent,
  isPreviewStartParams,
  type PreviewConsoleClearResult,
  type PreviewConsoleSnapshot,
  type PreviewFrameMeta,
  type PreviewInputAck,
  type PreviewSessionSnapshot,
  type PreviewSessionState,
  type PreviewStartParams,
} from '../../contracts/transport'
import type { TargetAdapter } from '../targets/types'
import { validateTargetConfig } from '../targets/validate'
import type { TargetAdapterRegistry } from '../targets/registry'
import {
  jsonResponse,
  type ConnectionFetchRouteLike,
  type TransportHostContext,
  type UnaryRegistry,
} from '../transport'
import {
  createPreviewConsoleCollector,
  type PreviewConsoleCollector,
} from './console'
import { createPreviewFrameBuffer, type PreviewFrame, type PreviewFrameBuffer } from './frame-buffer'
import {
  createPreviewInputDispatcher,
  type PreviewInputDispatcher,
} from './input'
import { createScreencastSource, type ScreencastSource } from './screencast'

const PREVIEW_TARGET_ID = 'preview'
const encoder = new TextEncoder()

export interface PreviewService {
  readonly buffer: PreviewFrameBuffer
  start(params: PreviewStartParams): Promise<PreviewSessionSnapshot>
  stop(): Promise<PreviewSessionSnapshot>
  status(): PreviewSessionSnapshot
  /** Validates and forwards one pointer/wheel/key event (T021). */
  input(event: unknown): Promise<PreviewInputAck>
  /** Bounded console history for the live preview (T023). */
  consoleList(query?: unknown): PreviewConsoleSnapshot
  /** Clears the Host console buffer; the panel clears its copy too. */
  consoleClear(): PreviewConsoleClearResult
  dispose(): Promise<void>
}

export interface PreviewServiceOptions {
  readonly targets: TargetAdapterRegistry
  readonly fps?: number
  readonly quality?: number
  /** Test seam: substitutes the CDP source. */
  readonly createSource?: (
    page: NonNullable<ReturnType<NonNullable<TargetAdapter['screencastPage']>>>,
    buffer: PreviewFrameBuffer,
  ) => ScreencastSource
  /** Test seam: substitutes the CDP input dispatcher. */
  readonly createInput?: (
    page: NonNullable<ReturnType<NonNullable<TargetAdapter['screencastPage']>>>,
  ) => PreviewInputDispatcher
  /** Test seam: substitutes the CDP console collector. */
  readonly createConsole?: (
    page: NonNullable<ReturnType<NonNullable<TargetAdapter['screencastPage']>>>,
  ) => PreviewConsoleCollector
}

function toPreviewError(error: unknown): StudioError {
  if (isStudioError(error)) return error
  const message = error instanceof Error ? error.message : typeof error
  return studioError('preview_failed', `vibe-studio: preview failed: ${message}`)
}

function frameMeta(frame: PreviewFrame | null): PreviewFrameMeta | null {
  if (frame === null) return null
  return { seq: frame.seq, ts: frame.ts, width: frame.width, height: frame.height }
}

export function createPreviewService(options: PreviewServiceOptions): PreviewService {
  const fps = options.fps ?? DEFAULT_PREVIEW_FPS
  const quality = options.quality ?? DEFAULT_PREVIEW_QUALITY
  const buffer = createPreviewFrameBuffer()

  let state: PreviewSessionState = 'idle'
  let adapter: TargetAdapter | undefined
  let source: ScreencastSource | undefined
  let inputDispatcher: PreviewInputDispatcher | undefined
  let inputSupported = false
  let consoleCollector: PreviewConsoleCollector | undefined
  let targetId: string | null = null
  let url: string | null = null
  let capabilities: TargetCapabilities | null = null
  let lastError: StudioError | undefined
  let startPromise: Promise<PreviewSessionSnapshot> | undefined
  let stopPromise: Promise<PreviewSessionSnapshot> | undefined

  function snapshot(): PreviewSessionSnapshot {
    const base: PreviewSessionSnapshot = {
      status: state,
      targetId,
      url,
      capabilities,
      frame: frameMeta(buffer.latest()),
      fps: source?.fps ?? fps,
      quality: source?.quality ?? quality,
    }
    return lastError === undefined ? base : { ...base, lastError }
  }

  async function release(): Promise<void> {
    const activeSource = source
    source = undefined
    if (activeSource) await activeSource.stop().catch(() => undefined)
    buffer.clear()
    // Console and input own their own CDP sessions; stop them before the
    // adapter closes the page so a stopped preview leaves no handle behind.
    const activeConsole = consoleCollector
    consoleCollector = undefined
    if (activeConsole) await activeConsole.stop().catch(() => undefined)
    const activeInput = inputDispatcher
    inputDispatcher = undefined
    inputSupported = false
    if (activeInput) await activeInput.stop().catch(() => undefined)
    const activeAdapter = adapter
    adapter = undefined
    if (activeAdapter) await activeAdapter.stop().catch(() => undefined)
  }

  async function runStart(params: PreviewStartParams): Promise<PreviewSessionSnapshot> {
    let config
    try {
      config = validateTargetConfig({
        id: PREVIEW_TARGET_ID,
        name: 'Preview',
        kind: 'web',
        url: params.url,
        ...(params.viewport === undefined ? {} : { viewport: params.viewport }),
      })
    } catch (error) {
      // Normalized config errors are caller mistakes; keep the field hint.
      throw toPreviewError(error)
    }

    let selected: TargetAdapter
    try {
      selected = options.targets.get('web')
    } catch (error) {
      throw toPreviewError(error)
    }
    if (!selected.capabilities.screencast || typeof selected.screencastPage !== 'function') {
      throw studioError('unsupported', 'vibe-studio: the web target does not support screencast')
    }

    lastError = undefined
    adapter = selected
    let session: TargetSession
    try {
      session = await selected.start(config)
    } catch (error) {
      const mapped = toPreviewError(error)
      await release()
      state = 'failed'
      lastError = mapped
      throw mapped
    }

    const page = selected.screencastPage?.()
    if (!page) {
      const mapped = studioError(
        'target_unavailable',
        'vibe-studio: preview target has no live page for screencast',
      )
      await release()
      state = 'failed'
      lastError = mapped
      throw mapped
    }

    const createSource = options.createSource
    const created = createSource
      ? createSource(page, buffer)
      : createScreencastSource({ page, buffer, fps, quality })
    source = created
    try {
      await created.start()
    } catch (error) {
      const mapped = toPreviewError(error)
      await release()
      state = 'failed'
      lastError = mapped
      throw mapped
    }

    inputSupported = session.capabilities.input
    if (inputSupported) {
      inputDispatcher =
        options.createInput?.(page) ?? createPreviewInputDispatcher({ page })
    }

    // Console capture is auxiliary: if CDP refuses Runtime.enable the preview
    // still runs, but the snapshot stops advertising the capability.
    let consoleReady = false
    if (session.capabilities.console) {
      const createdConsole =
        options.createConsole?.(page) ?? createPreviewConsoleCollector({ page })
      try {
        await createdConsole.start()
        consoleCollector = createdConsole
        consoleReady = true
      } catch {
        await createdConsole.stop().catch(() => undefined)
      }
    }

    targetId = session.targetId
    url = session.url
    capabilities =
      session.capabilities.console && !consoleReady
        ? { ...session.capabilities, console: false }
        : session.capabilities
    state = 'ready'
    return snapshot()
  }

  async function input(event: unknown): Promise<PreviewInputAck> {
    if (!isPreviewInputEvent(event)) {
      throw studioError('invalid_input', 'vibe-studio: invalid preview input event', {
        field: 'event',
      })
    }
    if (state !== 'ready') {
      throw studioError('target_unavailable', 'vibe-studio: preview is not running')
    }
    if (!inputSupported || !inputDispatcher) {
      throw studioError('unsupported', 'vibe-studio: the target does not support input', {
        capability: 'input',
      })
    }
    return inputDispatcher.dispatch(event)
  }

  function requireConsole(): PreviewConsoleCollector {
    if (state !== 'ready') {
      throw studioError('target_unavailable', 'vibe-studio: preview is not running')
    }
    if (!consoleCollector) {
      throw studioError('unsupported', 'vibe-studio: console capture is unavailable', {
        capability: 'console',
      })
    }
    return consoleCollector
  }

  function consoleList(query?: unknown): PreviewConsoleSnapshot {
    if (query !== undefined && !isPreviewConsoleQuery(query)) {
      throw studioError('invalid_input', 'vibe-studio: invalid console query', {
        field: 'query',
      })
    }
    return requireConsole().snapshot(query)
  }

  function consoleClear(): PreviewConsoleClearResult {
    return requireConsole().clear()
  }

  async function start(params: PreviewStartParams): Promise<PreviewSessionSnapshot> {
    if (!isPreviewStartParams(params)) {
      throw studioError('invalid_input', 'vibe-studio: invalid preview start params', {
        field: 'params',
      })
    }
    if (state === 'ready') return snapshot()
    if (startPromise) return startPromise
    if (stopPromise) await stopPromise
    startPromise = runStart(params)
    try {
      return await startPromise
    } finally {
      startPromise = undefined
    }
  }

  async function runStop(): Promise<PreviewSessionSnapshot> {
    await release()
    state = 'idle'
    lastError = undefined
    targetId = null
    url = null
    capabilities = null
    return snapshot()
  }

  async function stop(): Promise<PreviewSessionSnapshot> {
    if (startPromise) await startPromise.catch(() => undefined)
    if (stopPromise) return stopPromise
    stopPromise = runStop()
    try {
      return await stopPromise
    } finally {
      stopPromise = undefined
    }
  }

  return {
    buffer,
    start,
    stop,
    status: snapshot,
    input,
    consoleList,
    consoleClear,
    async dispose() {
      await stop()
    },
  }
}

/** Registers the three unary methods; returns an idempotent unregister. */
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
  return () => {
    offStart()
    offStop()
    offStatus()
    offInput()
    offConsoleList()
    offConsoleClear()
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
