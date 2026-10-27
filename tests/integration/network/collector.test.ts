import { describe, expect, it } from 'vitest'
import {
  createPreviewNetworkCollector,
  normalizeNetworkHeaders,
} from '../../../src/host/preview/network'
import type { ScreencastPageLike, ScreencastSessionLike } from '../../../src/host/targets/types'

type Listener = (params: unknown) => void

const NOW = 1_700_000_000_000

function fakePage(options: { readonly failEnable?: boolean } = {}) {
  const listeners = new Map<string, Set<Listener>>()
  const sent: { method: string; params?: Record<string, unknown> }[] = []
  let detached = false
  let bodyResponse: unknown = { body: '', base64Encoded: false }
  let failBody = false

  const session: ScreencastSessionLike = {
    async send(method, params) {
      sent.push({ method, params })
      if (options.failEnable && method === 'Network.enable') throw new Error('denied')
      if (method === 'Network.getResponseBody') {
        if (failBody) throw new Error('No resource with given identifier found')
        return bodyResponse
      }
      return {}
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(event, set)
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener)
    },
    async detach() {
      detached = true
    },
  }

  const page: ScreencastPageLike = {
    viewport: () => null,
    async createCdpSession() {
      return session
    },
  }

  return {
    page,
    sent,
    emit(event: string, params: unknown) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(params)
    },
    listenerCount() {
      let count = 0
      for (const set of listeners.values()) count += set.size
      return count
    },
    setBody(value: unknown) {
      bodyResponse = value
    },
    setFailBody(value: boolean) {
      failBody = value
    },
    get detached() {
      return detached
    },
  }
}

function collector(
  fake: ReturnType<typeof fakePage>,
  options: { maxEntries?: number; maxBytes?: number; maxBodyBytes?: number } = {},
) {
  return createPreviewNetworkCollector({ page: fake.page, now: () => NOW, ...options })
}

function request(
  fake: ReturnType<typeof fakePage>,
  requestId: string,
  overrides: Record<string, unknown> = {},
): void {
  fake.emit('Network.requestWillBeSent', {
    requestId,
    timestamp: 100,
    wallTime: NOW / 1000,
    type: 'XHR',
    request: {
      url: 'http://127.0.0.1:4320/api/items?token=secret&q=1',
      method: 'post',
      headers: {
        Authorization: 'Bearer abc',
        'Content-Type': 'application/json',
      },
    },
    ...overrides,
  })
}

function response(
  fake: ReturnType<typeof fakePage>,
  requestId: string,
  status: number,
  overrides: Record<string, unknown> = {},
): void {
  fake.emit('Network.responseReceived', {
    requestId,
    timestamp: 100.1,
    type: 'XHR',
    response: {
      status,
      mimeType: 'application/json',
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'sid=abc',
      },
    },
    ...overrides,
  })
}

describe('preview network collector', () => {
  it('maps requests and responses with redacted headers and URLs', async () => {
    const fake = fakePage()
    const capture = collector(fake)
    await capture.start()
    expect(fake.sent[0]).toMatchObject({
      method: 'Network.enable',
      params: { maxResourceBufferSize: 5 * 1024 * 1024 },
    })
    expect(capture.active).toBe(true)

    request(fake, 'r1')
    response(fake, 'r1', 201)
    fake.emit('Network.loadingFinished', { requestId: 'r1', timestamp: 100.5 })

    const snapshot = capture.snapshot()
    expect(snapshot.dropped).toBe(0)
    expect(snapshot.entries).toEqual([
      {
        id: 'network-1',
        method: 'POST',
        url: 'http://127.0.0.1:4320/api/items?token=REDACTED&q=1',
        status: 201,
        outcome: 'success',
        resourceType: 'XHR',
        startedAt: new Date(NOW).toISOString(),
        durationMs: 500,
        requestHeaders: {
          Authorization: 'REDACTED',
          'Content-Type': 'application/json',
        },
        responseHeaders: {
          'content-type': 'application/json',
          'set-cookie': 'REDACTED',
        },
      },
    ])
    expect(capture.stats()).toMatchObject({ received: 1, stored: 1, dropped: 0 })

    await capture.stop()
    expect(capture.active).toBe(false)
    expect(fake.listenerCount()).toBe(0)
    expect(fake.detached).toBe(true)
  })

  it('marks 4xx and 5xx responses as errors', async () => {
    const fake = fakePage()
    const capture = collector(fake)
    await capture.start()

    request(fake, 'r1')
    response(fake, 'r1', 404)
    request(fake, 'r2', { request: { url: 'http://127.0.0.1:4320/api/boom', method: 'GET' } })
    response(fake, 'r2', 503)

    const entries = capture.snapshot().entries
    expect(entries.map((entry) => [entry.id, entry.status, entry.outcome])).toEqual([
      ['network-1', 404, 'error'],
      ['network-2', 503, 'error'],
    ])
    await capture.stop()
  })

  it('maps loadingFailed to aborted or error with the failure text', async () => {
    const fake = fakePage()
    const capture = collector(fake)
    await capture.start()

    request(fake, 'r1')
    request(fake, 'r2', { request: { url: 'http://127.0.0.1:4320/api/slow', method: 'GET' } })
    fake.emit('Network.loadingFailed', {
      requestId: 'r1',
      timestamp: 100.2,
      canceled: true,
      errorText: 'net::ERR_ABORTED',
    })
    fake.emit('Network.loadingFailed', {
      requestId: 'r2',
      timestamp: 100.3,
      canceled: false,
      errorText: 'net::ERR_CONNECTION_REFUSED',
    })

    const entries = capture.snapshot().entries
    expect(entries[0]).toMatchObject({
      outcome: 'aborted',
      failure: 'net::ERR_ABORTED',
      durationMs: 200,
    })
    expect(entries[1]).toMatchObject({
      outcome: 'error',
      failure: 'net::ERR_CONNECTION_REFUSED',
      durationMs: 300,
    })
    await capture.stop()
  })

  it('re-sends revised rows and keeps ids monotonic across clears', async () => {
    const fake = fakePage()
    const capture = collector(fake, { maxEntries: 2 })
    await capture.start()

    request(fake, 'r1')
    request(fake, 'r2')
    request(fake, 'r3')

    let snapshot = capture.snapshot()
    expect(snapshot.entries.map((entry) => entry.id)).toEqual(['network-2', 'network-3'])
    expect(snapshot.dropped).toBe(1)
    expect(snapshot.lastSeq).toBe(3)
    expect(capture.snapshot({ after: 2 }).entries.map((entry) => entry.id)).toEqual([
      'network-3',
    ])

    // The pending row is sent again after it gains a status.
    response(fake, 'r2', 204)
    snapshot = capture.snapshot({ after: 3 })
    expect(snapshot.entries.map((entry) => [entry.id, entry.status])).toEqual([
      ['network-2', 204],
    ])
    expect(snapshot.lastSeq).toBe(4)
    // `limit` keeps the newest rows in insertion order; revision updates do not reorder.
    expect(capture.snapshot({ limit: 1 }).entries.map((entry) => entry.id)).toEqual([
      'network-3',
    ])

    expect(capture.clear()).toEqual({ cleared: 2, lastSeq: 4 })
    expect(capture.snapshot().entries).toEqual([])
    expect(capture.snapshot().lastSeq).toBe(4)

    request(fake, 'r4', { request: { url: 'http://127.0.0.1:4320/api/echo', method: 'GET' } })
    expect(capture.snapshot({ after: 4 }).entries.map((entry) => entry.id)).toEqual([
      'network-4',
    ])
    expect(capture.snapshot().lastSeq).toBe(5)
    await capture.stop()
  })

  it('ignores non-http requests and unknown response ids', async () => {
    const fake = fakePage()
    const capture = collector(fake)
    await capture.start()

    request(fake, 'data', {
      request: { url: 'data:text/plain,hi', method: 'GET' },
    })
    response(fake, 'missing', 200)
    fake.emit('Network.loadingFinished', { requestId: 'missing', timestamp: 101 })
    fake.emit('Network.requestWillBeSent', null)

    expect(capture.snapshot().entries).toEqual([])
    expect(capture.stats()).toMatchObject({ received: 0, stored: 0, rejected: 4 })
    await capture.stop()
  })

  it('fetches bodies on demand, caps them and decodes base64', async () => {
    const fake = fakePage()
    const capture = collector(fake, { maxBodyBytes: 8 })
    await capture.start()
    request(fake, 'r1')
    response(fake, 'r1', 200)

    fake.setBody({ body: 'hello', base64Encoded: false })
    await expect(capture.body({ id: 'network-1' })).resolves.toEqual({
      id: 'network-1',
      status: 200,
      mimeType: 'application/json',
      body: 'hello',
      base64Encoded: false,
      truncated: false,
      bytes: 5,
    })
    expect(fake.sent.at(-1)).toMatchObject({
      method: 'Network.getResponseBody',
      params: { requestId: 'r1' },
    })

    fake.setBody({ body: Buffer.from('hi').toString('base64'), base64Encoded: true })
    await expect(capture.body({ id: 'network-1' })).resolves.toMatchObject({
      body: Buffer.from('hi').toString('base64'),
      base64Encoded: true,
      truncated: false,
      bytes: 2,
    })

    // The body cap is clamped to 64 bytes so tiny tests cannot starve the payload.
    fake.setBody({ body: 'x'.repeat(128), base64Encoded: false })
    const capped = await capture.body({ id: 'network-1' })
    expect(capped.truncated).toBe(true)
    expect(capped.body.endsWith('…')).toBe(true)
    expect(Buffer.byteLength(capped.body, 'utf8')).toBeLessThanOrEqual(64)

    await expect(capture.body({ id: 'network-404' })).rejects.toMatchObject({
      code: 'not_found',
    })

    request(fake, 'r2')
    await expect(capture.body({ id: 'network-2' })).rejects.toMatchObject({
      code: 'not_found',
    })

    fake.setFailBody(true)
    await expect(capture.body({ id: 'network-1' })).rejects.toMatchObject({
      code: 'not_found',
    })

    await capture.stop()
    await expect(capture.body({ id: 'network-1' })).rejects.toMatchObject({
      code: 'target_unavailable',
    })
  })

  it('forgets bodies once their entries are evicted', async () => {
    const fake = fakePage()
    const capture = collector(fake, { maxEntries: 1 })
    await capture.start()
    request(fake, 'r1')
    response(fake, 'r1', 200)
    request(fake, 'r2', { request: { url: 'http://127.0.0.1:4320/api/echo', method: 'GET' } })

    await expect(capture.body({ id: 'network-1' })).rejects.toMatchObject({
      code: 'not_found',
    })
    await capture.stop()
  })

  it('detaches and removes listeners when Network.enable fails', async () => {
    const fake = fakePage({ failEnable: true })
    const capture = collector(fake)

    await expect(capture.start()).rejects.toMatchObject({ code: 'preview_failed' })
    expect(capture.active).toBe(false)
    expect(fake.listenerCount()).toBe(0)
    expect(fake.detached).toBe(true)
  })

  it('ignores events after stop', async () => {
    const fake = fakePage()
    const capture = collector(fake)
    await capture.start()
    await capture.stop()

    request(fake, 'r1')
    expect(capture.snapshot().entries).toEqual([])
    expect(fake.listenerCount()).toBe(0)
  })
})

describe('network header normalization', () => {
  it('caps header count and value length and redacts sensitive keys', () => {
    const headers: Record<string, string> = {
      Authorization: 'secret',
      'X-Long': '汉'.repeat(300),
    }
    for (let index = 0; index < 70; index += 1) headers[`x-${index}`] = 'v'
    const normalized = normalizeNetworkHeaders(headers)
    expect(normalized).toMatchObject({ Authorization: 'REDACTED' })
    expect(Object.keys(normalized ?? {})).toHaveLength(64)
    expect(Buffer.byteLength(normalized?.['X-Long'] ?? '', 'utf8')).toBeLessThanOrEqual(512)
    expect(normalizeNetworkHeaders(null)).toBeUndefined()
    expect(normalizeNetworkHeaders({ 'x-empty': 1 })).toBeUndefined()
  })
})
