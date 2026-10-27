import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FRAME_BOUNDARY,
  STREAM_CONTENT_TYPE,
} from '../../../src/contracts/transport'
import {
  FrameStreamParser,
  PreviewTransport,
  type PreviewFrame,
} from '../../../src/client/preview/transport'

const encoder = new TextEncoder()

function jpeg(marker: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, marker, 0xff, 0xd9])
}

function part(bytes: Uint8Array, seq: number): Uint8Array {
  const header = encoder.encode(
    `--${FRAME_BOUNDARY}\r\n` +
      'Content-Type: image/jpeg\r\n' +
      `Content-Length: ${bytes.byteLength}\r\n` +
      `X-Vibe-Seq: ${seq}\r\n` +
      'X-Vibe-Ts: 1000\r\n' +
      'X-Vibe-Width: 800\r\n' +
      'X-Vibe-Height: 600\r\n' +
      '\r\n',
  )
  const merged = new Uint8Array(header.byteLength + bytes.byteLength + 2)
  merged.set(header, 0)
  merged.set(bytes, header.byteLength)
  merged[merged.byteLength - 2] = 0x0d
  merged[merged.byteLength - 1] = 0x0a
  return merged
}

function streamBody(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
    },
  })
}

/** Delivers one chunk, then errors on the next read (a mid-stream reset). */
function breakingBody(chunk: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(chunk)
    },
    pull(controller) {
      controller.error(new Error('reset'))
    },
  })
}

function frameResponse(frame: PreviewFrame): Response {
  return new Response(frame.bytes.slice().buffer, {
    status: 200,
    headers: {
      'content-type': 'image/jpeg',
      'x-vibe-seq': String(frame.seq),
      'x-vibe-ts': String(frame.ts),
      'x-vibe-width': String(frame.width),
      'x-vibe-height': String(frame.height),
    },
  })
}

function pending204(): Response {
  return new Response(null, { status: 204 })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('FrameStreamParser', () => {
  it('parses frames split across arbitrary chunk boundaries', () => {
    const parser = new FrameStreamParser()
    const wire = new Uint8Array(part(jpeg(0x11), 1).byteLength + part(jpeg(0x12), 2).byteLength)
    wire.set(part(jpeg(0x11), 1), 0)
    wire.set(part(jpeg(0x12), 2), part(jpeg(0x11), 1).byteLength)

    const collected: PreviewFrame[] = []
    for (let offset = 0; offset < wire.byteLength; offset += 7) {
      collected.push(...parser.push(wire.subarray(offset, Math.min(offset + 7, wire.byteLength))))
    }

    expect(collected.map((frame) => frame.seq)).toEqual([1, 2])
    expect(collected[1]?.bytes).toEqual(jpeg(0x12))
  })

  it('ignores preamble and stops at the closing boundary', () => {
    const parser = new FrameStreamParser()
    const preamble = encoder.encode('preamble\r\n')
    expect(parser.push(preamble)).toEqual([])

    const frames = parser.push(part(jpeg(0x21), 3))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ seq: 3, width: 800, height: 600 })

    parser.push(encoder.encode(`--${FRAME_BOUNDARY}--\r\n`))
    expect(parser.isClosed).toBe(true)
    expect(parser.push(part(jpeg(0x22), 4))).toEqual([])
  })

  it('rejects frames that are not JPEGs', () => {
    const parser = new FrameStreamParser()
    expect(() => parser.push(part(Uint8Array.from([0, 0, 0]), 1))).toThrow(/not a JPEG/)
  })
})

describe('PreviewTransport', () => {
  it('renders frames from the multipart stream', async () => {
    const frames: PreviewFrame[] = []
    let frameRequests = 0
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api/vibe/stream')) {
        return new Response(streamBody([part(jpeg(0x31), 1)]), {
          status: 200,
          headers: { 'content-type': STREAM_CONTENT_TYPE },
        })
      }
      frameRequests += 1
      return pending204()
    }) as typeof fetch

    const transport = new PreviewTransport({
      onFrame: (frame) => frames.push(frame),
      fetchImpl: fakeFetch,
    })
    transport.start()

    await vi.waitFor(() => expect(frames).toHaveLength(1))
    expect(transport.stats()).toMatchObject({
      mode: 'stream',
      frames: 1,
      lastSeq: 1,
      streamConnects: 1,
      failures: 0,
    })
    expect(frameRequests).toBe(0)
    transport.stop()
    expect(transport.stats().mode).toBe('idle')
  })

  it('falls back to long polling when the stream cannot be opened', async () => {
    const frames: PreviewFrame[] = []
    let streamAttempts = 0
    let frameRequests = 0
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api/vibe/stream')) {
        streamAttempts += 1
        throw new TypeError('connection refused')
      }
      frameRequests += 1
      if (frameRequests === 1) {
        return frameResponse({ seq: 1, ts: 1000, width: 800, height: 600, bytes: jpeg(0x41) })
      }
      await sleep(20)
      return pending204()
    }) as typeof fetch

    const transport = new PreviewTransport({
      onFrame: (frame) => frames.push(frame),
      fetchImpl: fakeFetch,
      streamRetryMs: 10_000,
      pullRetryMs: 10,
    })
    transport.start()

    await vi.waitFor(() => expect(frames).toHaveLength(1))
    expect(frames[0]?.bytes).toEqual(jpeg(0x41))
    expect(transport.stats()).toMatchObject({
      mode: 'pull',
      frames: 1,
      lastSeq: 1,
      streamConnects: 0,
    })
    expect(transport.stats().pullRequests).toBeGreaterThanOrEqual(1)
    expect(transport.stats().failures).toBeGreaterThanOrEqual(1)
    expect(streamAttempts).toBe(1)
    transport.stop()
  })

  it('switches to polling when the stream breaks mid-frame', async () => {
    const frames: PreviewFrame[] = []
    let frameRequests = 0
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api/vibe/stream')) {
        return new Response(breakingBody(part(jpeg(0x51), 1)), {
          status: 200,
          headers: { 'content-type': STREAM_CONTENT_TYPE },
        })
      }
      frameRequests += 1
      if (frameRequests === 1) {
        return frameResponse({ seq: 2, ts: 1001, width: 800, height: 600, bytes: jpeg(0x52) })
      }
      await sleep(20)
      return pending204()
    }) as typeof fetch

    const transport = new PreviewTransport({
      onFrame: (frame) => frames.push(frame),
      fetchImpl: fakeFetch,
      streamRetryMs: 10_000,
      pullRetryMs: 10,
    })
    transport.start()

    await vi.waitFor(() => expect(frames).toHaveLength(2))
    expect(frames.map((frame) => frame.seq)).toEqual([1, 2])
    expect(transport.stats().mode).toBe('pull')
    expect(transport.stats().lastError).toBeNull()
    transport.stop()
  })

  it('returns to the stream when a retry succeeds while polling', async () => {
    const frames: PreviewFrame[] = []
    let streamAttempts = 0
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api/vibe/stream')) {
        streamAttempts += 1
        if (streamAttempts === 1) throw new TypeError('connection refused')
        return new Response(streamBody([part(jpeg(0x61), 5)]), {
          status: 200,
          headers: { 'content-type': STREAM_CONTENT_TYPE },
        })
      }
      await sleep(5)
      return pending204()
    }) as typeof fetch

    const transport = new PreviewTransport({
      onFrame: (frame) => frames.push(frame),
      fetchImpl: fakeFetch,
      streamRetryMs: 25,
      pullRetryMs: 5,
    })
    transport.start()

    await vi.waitFor(() => expect(transport.mode).toBe('stream'))
    expect(frames.map((frame) => frame.seq)).toEqual([5])
    expect(streamAttempts).toBeGreaterThanOrEqual(2)
    transport.stop()
  })

  it('drops duplicate or older sequence numbers', async () => {
    const frames: PreviewFrame[] = []
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('api/vibe/stream')) {
        return new Response(streamBody([part(jpeg(0x71), 2), part(jpeg(0x72), 1)]), {
          status: 200,
          headers: { 'content-type': STREAM_CONTENT_TYPE },
        })
      }
      return pending204()
    }) as typeof fetch

    const transport = new PreviewTransport({
      onFrame: (frame) => frames.push(frame),
      fetchImpl: fakeFetch,
    })
    transport.start()

    await vi.waitFor(() => expect(frames).toHaveLength(1))
    expect(transport.stats().lastSeq).toBe(2)
    transport.stop()
  })
})
