/**
 * Wire shapes shared by the S1 host, browser panel, and local benchmark.
 *
 * Pull is a plain JPEG response with seq/timestamp headers. Stream is a
 * multipart/x-mixed-replace response with one JPEG per part; Content-Length
 * per part keeps the browser parser simple and bounds memory.
 */

export const FRAME_BOUNDARY = 'vibe-frame'
export const STREAM_CONTENT_TYPE = `multipart/x-mixed-replace; boundary=${FRAME_BOUNDARY}`
export const PULL_PATH = '/api/vibe/frame'
export const STREAM_PATH = '/api/vibe/stream'
export const RPC_CHANNEL = '/vibe'

export interface FrameTick {
  /** Monotone frame counter; gaps mean the server or client skipped frames. */
  seq: number
  /** Host wall-clock time when this frame was produced. */
  ts: number
  frameIndex: number
  bytes: Uint8Array
  hostRss: number
}

export interface StreamFrame {
  seq: number
  ts: number
  frameIndex: number
  hostRss: number
  dropped: number
  bytes: Uint8Array
}

const CRLF = new Uint8Array([13, 10])
const CRLFCRLF = new Uint8Array([13, 10, 13, 10])
const TOKEN = ascii(`--${FRAME_BOUNDARY}`)

/** Encode ASCII without depending on TextEncoder availability in Node. */
export function ascii(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

/**
 * One multipart part header. `dropped` is the number of frames the host skipped
 * under backpressure since the previous delivered part.
 */
export function framePartHeader(frame: {
  seq: number
  ts: number
  frameIndex: number
  length: number
  hostRss: number
  dropped: number
}): Uint8Array {
  return ascii(
    `--${FRAME_BOUNDARY}\r\n` +
      `Content-Type: image/jpeg\r\n` +
      `Content-Length: ${frame.length}\r\n` +
      `X-Vibe-Seq: ${frame.seq}\r\n` +
      `X-Vibe-Ts: ${frame.ts}\r\n` +
      `X-Vibe-Frame: ${frame.frameIndex}\r\n` +
      `X-Vibe-Host-Rss: ${frame.hostRss}\r\n` +
      `X-Vibe-Dropped: ${frame.dropped}\r\n` +
      `\r\n`,
  )
}

export const PART_TRAILER = CRLF

/**
 * Incremental multipart parser. `push` may be called with arbitrary chunk
 * boundaries; complete frames are handed to the callback in arrival order.
 */
export class MultipartFrameParser {
  private buffer: Uint8Array = new Uint8Array(0)

  push(chunk: Uint8Array, onFrame: (frame: StreamFrame) => void): void {
    this.buffer = concat(this.buffer, chunk)
    for (;;) {
      const start = indexOf(this.buffer, TOKEN)
      if (start < 0) {
        // Keep only a tail that could still be a partial boundary.
        if (this.buffer.length > 4096) this.buffer = this.buffer.slice(-TOKEN.length)
        return
      }
      if (start > 0) this.buffer = this.buffer.slice(start)
      const headerEnd = indexOf(this.buffer, CRLFCRLF)
      if (headerEnd < 0) {
        if (this.buffer.length > 64 * 1024) this.buffer = new Uint8Array(0)
        return
      }
      const headers = parseHeaders(decodeAscii(this.buffer.subarray(0, headerEnd)))
      const length = Number(headers['content-length'])
      if (!Number.isFinite(length) || length <= 0) {
        this.buffer = this.buffer.slice(headerEnd + CRLFCRLF.length)
        continue
      }
      const dataStart = headerEnd + CRLFCRLF.length
      const dataEnd = dataStart + length
      if (this.buffer.length < dataEnd) return
      onFrame({
        seq: Number(headers['x-vibe-seq']),
        ts: Number(headers['x-vibe-ts']),
        frameIndex: Number(headers['x-vibe-frame']),
        hostRss: Number(headers['x-vibe-host-rss']),
        dropped: Number(headers['x-vibe-dropped']),
        bytes: this.buffer.slice(dataStart, dataEnd),
      })
      let next = dataEnd
      if (this.buffer[next] === 13 && this.buffer[next + 1] === 10) next += 2
      this.buffer = this.buffer.slice(next)
    }
  }
}

function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\r\n')) {
    if (!line.startsWith('--')) {
      const at = line.indexOf(':')
      if (at > 0) out[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
    }
  }
  return out
}

function decodeAscii(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return text
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  const last = haystack.length - needle.length
  outer: for (let i = 0; i <= last; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return -1
}
