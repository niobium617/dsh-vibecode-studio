import { describe, expect, it, vi } from 'vitest'
import {
  TRANSPORT_VERSION,
  type TransportHealth,
} from '../../../src/contracts/transport'
import {
  TransportError,
  callUnary,
  fetchHealth,
  toStudioError,
} from '../../../src/client/transport'

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function fakeFetch(handler: FetchHandler): { impl: typeof fetch; calls: unknown[][] } {
  const calls: unknown[][] = []
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push([input, init])
    return handler(input, init)
  })
  return { impl: spy as unknown as typeof fetch, calls }
}

const HEALTH: TransportHealth = {
  plugin: 'dsh-vibecode-studio',
  transportVersion: TRANSPORT_VERSION,
  serverTime: '2026-10-26T00:00:00.000Z',
  uptimeMs: 42,
  config: {
    logLevel: 'info',
    allowedOrigins: ['http://localhost'],
    retentionDays: 7,
    contextBudgetBytes: 8192,
    screenshotEnabled: true,
  },
}

function jsonBody(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('client health', () => {
  it('uses the document-relative route and same-origin credentials', async () => {
    const { impl, calls } = fakeFetch(async () => jsonBody({ ok: true, value: HEALTH }))

    await expect(fetchHealth({ fetchImpl: impl })).resolves.toEqual(HEALTH)

    expect(calls).toHaveLength(1)
    const [url, init] = calls[0] as [string, RequestInit]
    expect(url).toBe('api/vibe/health')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
    expect(init.cache).toBe('no-store')
  })

  it('maps an authentication rejection from DSH Connection', async () => {
    const { impl } = fakeFetch(async () => new Response('unauthorized', { status: 401 }))

    await expect(fetchHealth({ fetchImpl: impl })).rejects.toMatchObject({
      code: 'permission_denied',
      status: 401,
    })
  })

  it('rejects a malformed health payload', async () => {
    const { impl } = fakeFetch(async () => jsonBody({ ok: true, value: { plugin: 'x' } }))

    await expect(fetchHealth({ fetchImpl: impl })).rejects.toMatchObject({
      code: 'internal',
      message: 'invalid health response',
    })
  })
})

describe('client unary', () => {
  it('posts JSON to the document-relative route and returns the value', async () => {
    const { impl, calls } = fakeFetch(async () =>
      jsonBody({ ok: true, value: { pong: true, echo: { n: 1 } } }),
    )

    await expect(callUnary('studio.ping', { n: 1 }, { fetchImpl: impl })).resolves.toEqual({
      pong: true,
      echo: { n: 1 },
    })

    const [url, init] = calls[0] as [string, RequestInit]
    expect(url).toBe('api/vibe/request')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({ method: 'studio.ping', params: { n: 1 } })
  })

  it('throws the host StudioError from a failure envelope', async () => {
    const { impl } = fakeFetch(async () =>
      jsonBody({ ok: false, error: { code: 'not_found', message: 'unknown method "x.y"' } }, 404),
    )

    const error = await callUnary('x.y', undefined, { fetchImpl: impl }).catch((err) => err)
    expect(error).toBeInstanceOf(TransportError)
    expect(error).toMatchObject({
      code: 'not_found',
      message: 'unknown method "x.y"',
      status: 404,
    })
  })

  it('maps an HTTP error without an envelope', async () => {
    const { impl } = fakeFetch(async () => new Response('', { status: 503 }))

    await expect(callUnary('studio.ping', undefined, { fetchImpl: impl })).rejects.toMatchObject({
      code: 'target_unavailable',
      status: 503,
    })
  })

  it('rejects an invalid method and non-JSON params before fetching', async () => {
    const { impl } = fakeFetch(async () => jsonBody({ ok: true, value: null }))

    await expect(callUnary('Bad Method', undefined, { fetchImpl: impl })).rejects.toMatchObject({
      code: 'invalid_input',
    })

    const circular: Record<string, unknown> = {}
    circular.self = circular
    await expect(callUnary('studio.ping', circular, { fetchImpl: impl })).rejects.toMatchObject({
      code: 'invalid_input',
    })

    await expect(
      callUnary('studio.ping', { data: 'x'.repeat(70 * 1024) }, { fetchImpl: impl }),
    ).rejects.toMatchObject({ code: 'invalid_input' })

    expect(impl).not.toHaveBeenCalled()
  })

  it('rejects a malformed success envelope', async () => {
    const { impl } = fakeFetch(async () => new Response('not json', { status: 200 }))

    await expect(callUnary('studio.ping', undefined, { fetchImpl: impl })).rejects.toMatchObject({
      code: 'internal',
      message: 'invalid unary response',
    })
  })
})

describe('client request guards', () => {
  it('reports a timeout distinctly', async () => {
    const { impl } = fakeFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )

    await expect(fetchHealth({ fetchImpl: impl, timeoutMs: 5 })).rejects.toMatchObject({
      code: 'timeout',
    })
  })

  it('reports a caller abort without masking it as a timeout', async () => {
    const controller = new AbortController()
    controller.abort()
    const { impl } = fakeFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'))
            return
          }
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )

    await expect(
      fetchHealth({ fetchImpl: impl, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'network_error', message: 'request aborted' })
  })

  it('wraps transport failures as network_error', async () => {
    const { impl } = fakeFetch(async () => {
      throw new TypeError('fetch failed')
    })

    await expect(fetchHealth({ fetchImpl: impl })).rejects.toMatchObject({
      code: 'network_error',
      message: 'request failed: fetch failed',
    })
  })

  it('exposes the stable StudioError shape', () => {
    const error = new TransportError('not_found', 'missing', { details: { id: 'x' } })

    expect(toStudioError(error)).toEqual({
      code: 'not_found',
      message: 'missing',
      details: { id: 'x' },
    })
    expect(toStudioError(new Error('boom'))).toEqual({ code: 'internal', message: 'boom' })
  })
})
