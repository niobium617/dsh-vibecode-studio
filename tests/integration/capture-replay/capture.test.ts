/**
 * T043 capture side: request bodies reach the stored entry (so replay can
 * reproduce them), are capped well below the 64 KiB unary envelope, and a
 * redirect chain keeps the body of the hop the row actually shows.
 */
import { describe, expect, it } from 'vitest'
import { utf8Bytes } from '../../../src/contracts/budget'
import { MAX_CAPTURED_REQUEST_BODY_BYTES } from '../../../src/contracts/telemetry'
import {
  createPreviewNetworkCollector,
  PreviewNetworkBuffer,
} from '../../../src/host/preview/network'
import type { ScreencastPageLike, ScreencastSessionLike } from '../../../src/host/targets/types'

type Listener = (params: unknown) => void

const NOW = 1_700_000_000_000

function fakePage() {
  const listeners = new Map<string, Set<Listener>>()

  const session: ScreencastSessionLike = {
    async send() {
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
      // Nothing to release in the fake.
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
    emit(event: string, params: unknown) {
      for (const listener of [...(listeners.get(event) ?? [])]) listener(params)
    },
  }
}

function request(
  fake: ReturnType<typeof fakePage>,
  requestId: string,
  requestBody: Record<string, unknown>,
): void {
  fake.emit('Network.requestWillBeSent', {
    requestId,
    timestamp: 100,
    wallTime: NOW / 1000,
    type: 'XHR',
    request: {
      url: 'http://127.0.0.1:4320/api/items',
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer abc' },
      ...requestBody,
    },
  })
}

async function started(fake: ReturnType<typeof fakePage>) {
  const capture = createPreviewNetworkCollector({ page: fake.page, now: () => NOW })
  await capture.start()
  return capture
}

describe('captured request bodies', () => {
  it('stores postData for replay while headers stay redacted', async () => {
    const fake = fakePage()
    const capture = await started(fake)

    request(fake, 'r1', { postData: '{"name":"book","price":12}', hasPostData: true })

    const [entry] = capture.snapshot().entries
    expect(entry).toMatchObject({
      method: 'POST',
      url: 'http://127.0.0.1:4320/api/items',
      requestHeaders: {
        'content-type': 'application/json',
        Authorization: 'REDACTED',
      },
      requestBody: '{"name":"book","price":12}',
    })
    expect(entry?.requestBodyTruncated).toBeUndefined()
    expect(entry?.requestBodyUnavailable).toBeUndefined()

    await capture.stop()
  })

  it('caps a large body at the replay budget and flags it', async () => {
    const fake = fakePage()
    const capture = await started(fake)

    request(fake, 'r1', {
      postData: 'x'.repeat(MAX_CAPTURED_REQUEST_BODY_BYTES + 500),
      hasPostData: true,
    })

    const [entry] = capture.snapshot().entries
    expect(entry?.requestBodyTruncated).toBe(true)
    expect(utf8Bytes(entry!.requestBody!)).toBeLessThanOrEqual(MAX_CAPTURED_REQUEST_BODY_BYTES)
    expect(entry?.requestBody?.endsWith('…')).toBe(true)

    await capture.stop()
  })

  it('marks a body CDP refused to hand over as unavailable', async () => {
    const fake = fakePage()
    const capture = await started(fake)

    request(fake, 'r1', { hasPostData: true })

    const [entry] = capture.snapshot().entries
    expect(entry?.requestBody).toBeUndefined()
    expect(entry?.requestBodyUnavailable).toBe(true)

    await capture.stop()
  })

  it('follows the final redirect hop: 307 keeps the body, 303 drops it', async () => {
    const fake = fakePage()
    const capture = await started(fake)

    request(fake, 'r1', { postData: '{"n":1}', hasPostData: true })
    fake.emit('Network.requestWillBeSent', {
      requestId: 'r1',
      timestamp: 100.1,
      wallTime: NOW / 1000,
      type: 'XHR',
      request: {
        url: 'http://127.0.0.1:4320/api/items/2',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        postData: '{"n":2}',
        hasPostData: true,
      },
    })

    let [entry] = capture.snapshot().entries
    expect(entry).toMatchObject({
      url: 'http://127.0.0.1:4320/api/items/2',
      method: 'POST',
      requestBody: '{"n":2}',
    })

    fake.emit('Network.requestWillBeSent', {
      requestId: 'r1',
      timestamp: 100.2,
      wallTime: NOW / 1000,
      type: 'XHR',
      request: {
        url: 'http://127.0.0.1:4320/api/items/3',
        method: 'GET',
        headers: {},
      },
    })

    ;[entry] = capture.snapshot().entries
    expect(entry?.method).toBe('GET')
    expect(entry?.requestBody).toBeUndefined()
    expect(entry?.requestBodyTruncated).toBeUndefined()
    expect(entry?.requestBodyUnavailable).toBeUndefined()

    await capture.stop()
  })
})

describe('network buffer accounting', () => {
  it('counts captured bodies so a large body cannot hide from eviction', () => {
    const buffer = new PreviewNetworkBuffer({ maxEntries: 10, maxBytes: 1024 })
    buffer.startRequest('a', {
      method: 'POST',
      url: 'http://127.0.0.1:4320/a',
      resourceType: 'XHR',
      requestBody: 'y'.repeat(2000),
      startedAt: NOW,
      startedMonoMs: 0,
    })
    buffer.startRequest('b', {
      method: 'GET',
      url: 'http://127.0.0.1:4320/b',
      resourceType: 'XHR',
      startedAt: NOW,
      startedMonoMs: 0,
    })

    expect(buffer.snapshot().entries.map((entry) => entry.id)).toEqual(['network-2'])
    expect(buffer.dropped).toBe(1)
  })
})
