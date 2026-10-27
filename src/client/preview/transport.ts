/**
 * Browser frame transport (T020).
 *
 * The multipart stream is the primary channel; when it fails or ends the
 * transport switches to `/api/vibe/frame?wait=1&after=<seq>` long-polling and
 * keeps probing the stream in the background. Both channels feed the same
 * monotone frame sequence, so a switch can never duplicate or rewind a frame.
 *
 * DOM-free on purpose: the Canvas owns rendering, and node tests can drive the
 * fallback with an injected fetch.
 */
import {
  FRAME_BOUNDARY,
  FRAME_PATH,
  MAX_PREVIEW_FRAME_BYTES,
  STREAM_CONTENT_TYPE,
  STREAM_PATH,
  appRoute,
} from '../../contracts/transport'

export type PreviewMode = 'idle' | 'stream' | 'pull'

export interface PreviewFrame {
  readonly seq: number
  readonly ts: number
  readonly width: number
  readonly height: number
  readonly bytes: Uint8Array
}

export interface PreviewTransportStats {
  readonly mode: PreviewMode
  readonly frames: number
  readonly lastSeq: number
  readonly streamConnects: number
  readonly pullRequests: number
  readonly failures: number
  readonly lastError: string | null
}

export interface PreviewTransportOptions {
  readonly onFrame: (frame: PreviewFrame) => void
  readonly fetchImpl?: typeof fetch
  /** How often to retry the stream while pulling. */
  readonly streamRetryMs?: number
  /** Backoff after a failed pull request. */
  readonly pullRetryMs?: number
}

const DEFAULT_STREAM_RETRY_MS = 5_000
const DEFAULT_PULL_RETRY_MS = 2_000
const MAX_PENDING_BYTES = MAX_PREVIEW_FRAME_BYTES + 64 * 1024
const MAX_HEADER_BYTES = 8 * 1024

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const BOUNDARY_MARKER = encoder.encode(`--${FRAME_BOUNDARY}`)
const HEADER_END = encoder.encode('\r\n\r\n')

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right
  const merged = new Uint8Array(left.byteLength + right.byteLength)
  merged.set(left, 0)
  merged.set(right, left.byteLength)
  return merged
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  const limit = haystack.byteLength - needle.byteLength
  outer: for (let i = Math.max(0, from); i <= limit; i += 1) {
    for (let j = 0; j < needle.byteLength; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}

/** Incremental `multipart/x-mixed-replace` parser; one buffer, no timers. */
export class FrameStreamParser {
  private pending: Uint8Array = new Uint8Array(0)
  private closed = false

  get isClosed(): boolean {
    return this.closed
  }

  push(chunk: Uint8Array): PreviewFrame[] {
    if (this.closed) return []
    this.pending = concat(this.pending, chunk)
    if (this.pending.byteLength > MAX_PENDING_BYTES) {
      this.pending = new Uint8Array(0)
      throw new Error('multipart stream exceeded the frame buffer limit')
    }
    const frames: PreviewFrame[] = []

    for (;;) {
      const marker = indexOfBytes(this.pending, BOUNDARY_MARKER)
      if (marker < 0) {
        // Keep the tail so a boundary split across chunks still matches.
        const keep = Math.min(this.pending.byteLength, BOUNDARY_MARKER.byteLength + 4)
        if (this.pending.byteLength > MAX_PREVIEW_FRAME_BYTES + keep) {
          this.pending = this.pending.subarray(this.pending.byteLength - keep)
        }
        break
      }
      // Preamble before the first boundary is ignored.
      if (marker > 0) this.pending = this.pending.subarray(marker)

      const afterMarker = BOUNDARY_MARKER.byteLength
      if (this.pending.byteLength < afterMarker + 2) break
      if (this.pending[afterMarker] === 0x2d && this.pending[afterMarker + 1] === 0x2d) {
        this.closed = true
        this.pending = new Uint8Array(0)
        break
      }
      // Boundary line: `--vibe-frame\r\n`.
      if (this.pending[afterMarker] !== 0x0d || this.pending[afterMarker + 1] !== 0x0a) {
        throw new Error('malformed multipart boundary')
      }
      const headerStart = afterMarker + 2
      const headerEnd = indexOfBytes(this.pending, HEADER_END, headerStart)
      if (headerEnd < 0) {
        if (this.pending.byteLength - headerStart > MAX_HEADER_BYTES) {
          throw new Error('multipart headers are too large')
        }
        break
      }
      const headerText = decoder.decode(this.pending.subarray(headerStart, headerEnd))
      const headers = new Map<string, string>()
      for (const line of headerText.split('\r\n')) {
        const colon = line.indexOf(':')
        if (colon <= 0) continue
        headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
      }
      const declared = Number(headers.get('content-length'))
      if (!Number.isInteger(declared) || declared < 0 || declared > MAX_PREVIEW_FRAME_BYTES) {
        throw new Error('multipart frame has an invalid Content-Length')
      }
      const bodyStart = headerEnd + HEADER_END.byteLength
      const bodyEnd = bodyStart + declared
      if (this.pending.byteLength < bodyEnd) break

      const bytes = this.pending.slice(bodyStart, bodyEnd)
      const seq = Number(headers.get('x-vibe-seq'))
      const ts = Number(headers.get('x-vibe-ts'))
      const width = Number(headers.get('x-vibe-width'))
      const height = Number(headers.get('x-vibe-height'))
      if (
        !Number.isInteger(seq) ||
        seq <= 0 ||
        !Number.isFinite(ts) ||
        !Number.isInteger(width) ||
        width <= 0 ||
        !Number.isInteger(height) ||
        height <= 0
      ) {
        throw new Error('multipart frame metadata is invalid')
      }
      // JPEG SOI: never hand the canvas arbitrary bytes from the wire.
      if (bytes.byteLength < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        throw new Error('multipart frame is not a JPEG')
      }
      frames.push({ seq, ts, width, height, bytes })

      let consumed = bodyEnd
      if (
        consumed + 1 < this.pending.byteLength &&
        this.pending[consumed] === 0x0d &&
        this.pending[consumed + 1] === 0x0a
      ) {
        consumed += 2
      }
      this.pending = this.pending.subarray(consumed)
    }

    return frames
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(finish, ms)
    const onAbort = (): void => finish()
    function finish(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export class PreviewTransport {
  private readonly onFrame: (frame: PreviewFrame) => void
  private readonly fetchImpl: typeof fetch
  private readonly streamRetryMs: number
  private readonly pullRetryMs: number
  private readonly lifecycle = new AbortController()

  private streamController: AbortController | undefined
  private pullController: AbortController | undefined
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  private retryTimer: ReturnType<typeof setInterval> | undefined
  private started = false
  private stopped = false
  private streamConnecting = false
  private modeValue: PreviewMode = 'idle'

  private frames = 0
  private lastSeq = 0
  private streamConnects = 0
  private pullRequests = 0
  private failures = 0
  private lastError: string | null = null

  constructor(options: PreviewTransportOptions) {
    this.onFrame = options.onFrame
    // `fetch` is a window operation: calling a detached reference can throw
    // "Illegal invocation" in Chromium, so keep the global receiver.
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.streamRetryMs = options.streamRetryMs ?? DEFAULT_STREAM_RETRY_MS
    this.pullRetryMs = options.pullRetryMs ?? DEFAULT_PULL_RETRY_MS
  }

  get mode(): PreviewMode {
    return this.modeValue
  }

  start(): void {
    if (this.started || this.stopped) return
    this.started = true
    void this.connectStream()
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.started = false
    this.modeValue = 'idle'
    this.lifecycle.abort()
    this.streamController?.abort()
    this.pullController?.abort()
    this.streamController = undefined
    this.pullController = undefined
    this.clearRetryTimer()
    const reader = this.reader
    this.reader = undefined
    void reader?.cancel().catch(() => undefined)
  }

  stats(): PreviewTransportStats {
    return {
      mode: this.modeValue,
      frames: this.frames,
      lastSeq: this.lastSeq,
      streamConnects: this.streamConnects,
      pullRequests: this.pullRequests,
      failures: this.failures,
      lastError: this.lastError,
    }
  }

  private emit(frame: PreviewFrame): void {
    if (frame.seq <= this.lastSeq) return
    this.lastSeq = frame.seq
    this.frames += 1
    this.onFrame(frame)
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== undefined) {
      clearInterval(this.retryTimer)
      this.retryTimer = undefined
    }
  }

  private stopPull(): void {
    this.clearRetryTimer()
    const controller = this.pullController
    this.pullController = undefined
    controller?.abort()
    if (this.modeValue === 'pull') this.modeValue = 'idle'
  }

  private scheduleStreamRetry(): void {
    if (this.retryTimer !== undefined || this.stopped) return
    this.retryTimer = setInterval(() => {
      void this.connectStream()
    }, this.streamRetryMs)
  }

  private canUseLifecycle(signal: AbortSignal): boolean {
    return !this.stopped && !signal.aborted
  }

  private async connectStream(): Promise<void> {
    if (this.stopped || this.streamConnecting || this.modeValue === 'stream') return
    this.streamConnecting = true
    const controller = new AbortController()
    this.streamController = controller
    const relayAbort = (): void => controller.abort()
    this.lifecycle.signal.addEventListener('abort', relayAbort, { once: true })

    try {
      const response = await this.fetchImpl(appRoute(STREAM_PATH), {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { accept: STREAM_CONTENT_TYPE },
        signal: controller.signal,
      })
      if (!this.canUseLifecycle(controller.signal)) return
      const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
      if (!response.ok || !response.body || !contentType.startsWith('multipart/x-mixed-replace')) {
        throw new Error(`stream unavailable (HTTP ${response.status})`)
      }

      this.stopPull()
      this.modeValue = 'stream'
      this.streamConnects += 1
      this.lastError = null

      const reader = response.body.getReader()
      this.reader = reader
      const parser = new FrameStreamParser()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        for (const frame of parser.push(value)) this.emit(frame)
      }
      void reader.cancel().catch(() => undefined)
      if (this.reader === reader) this.reader = undefined
      if (this.stopped || this.modeValue !== 'stream') return
      this.failures += 1
      this.lastError = parser.isClosed ? 'stream closed by host' : 'stream ended'
      this.modeValue = 'idle'
      this.startPull()
    } catch (error) {
      if (this.stopped) return
      if (this.streamController !== controller) return
      this.failures += 1
      this.lastError = errorMessage(error)
      if (this.modeValue !== 'pull') this.modeValue = 'idle'
      this.startPull()
    } finally {
      this.streamConnecting = false
      this.lifecycle.signal.removeEventListener('abort', relayAbort)
      if (this.streamController === controller) this.streamController = undefined
    }
  }

  private startPull(): void {
    if (this.stopped || this.modeValue === 'stream' || this.pullController) return
    this.modeValue = 'pull'
    const controller = new AbortController()
    this.pullController = controller
    this.scheduleStreamRetry()
    void this.pullLoop(controller)
  }

  private async pullLoop(controller: AbortController): Promise<void> {
    while (!this.stopped && this.pullController === controller) {
      try {
        const response = await this.fetchImpl(
          `${appRoute(FRAME_PATH)}?wait=1&after=${this.lastSeq}`,
          {
            method: 'GET',
            cache: 'no-store',
            credentials: 'same-origin',
            headers: { accept: 'image/jpeg' },
            signal: controller.signal,
          },
        )
        if (this.stopped || this.pullController !== controller) return
        this.pullRequests += 1
        if (response.status === 204) continue
        if (!response.ok) throw new Error(`frame request failed (HTTP ${response.status})`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (this.stopped || this.pullController !== controller) return
        const seq = Number(response.headers.get('x-vibe-seq'))
        const ts = Number(response.headers.get('x-vibe-ts'))
        const width = Number(response.headers.get('x-vibe-width'))
        const height = Number(response.headers.get('x-vibe-height'))
        if (
          !Number.isInteger(seq) ||
          seq <= this.lastSeq ||
          !Number.isFinite(ts) ||
          !Number.isInteger(width) ||
          width <= 0 ||
          !Number.isInteger(height) ||
          height <= 0 ||
          bytes.byteLength < 2 ||
          bytes[0] !== 0xff ||
          bytes[1] !== 0xd8
        ) {
          throw new Error('frame response is invalid')
        }
        this.lastError = null
        this.emit({ seq, ts, width, height, bytes })
      } catch (error) {
        if (this.stopped || this.pullController !== controller) return
        this.failures += 1
        this.lastError = errorMessage(error)
        await delay(this.pullRetryMs, controller.signal)
      }
    }
  }
}

export function createPreviewTransport(options: PreviewTransportOptions): PreviewTransport {
  return new PreviewTransport(options)
}
