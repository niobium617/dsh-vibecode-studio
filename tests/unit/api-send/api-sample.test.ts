/**
 * U04 loopback sample endpoint: the first Send needs no URL and no internet.
 * The listener binds 127.0.0.1 only, answers a fixed JSON document on `/sample`
 * and refuses everything else.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  API_SAMPLE_INFO_METHOD,
  ApiService,
  UnaryRegistry,
  createApiSecretStore,
  createApiSampleServer,
  registerApiMethods,
} from '../../../src/host'
import { isApiSampleInfo, type ApiSampleInfo } from '../../../src/contracts/api'

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (disposers.length > 0) await disposers.pop()!()
})

describe('api sample server', () => {
  it('serves a JSON sample on loopback only', async () => {
    const server = createApiSampleServer()
    disposers.push(() => server.dispose())

    const info = await server.info()
    expect(isApiSampleInfo(info)).toBe(true)
    const url = new URL(info.url)
    expect(url.protocol).toBe('http:')
    expect(url.hostname).toBe('127.0.0.1')
    expect(url.pathname).toBe('/sample')

    const response = await fetch(info.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    const body = (await response.json()) as Record<string, unknown>
    expect(body.ok).toBe(true)
    expect(body.method).toBe('GET')
    expect(Array.isArray(body.items)).toBe(true)
  })

  it('reuses one listener and refuses to start again after dispose', async () => {
    const server = createApiSampleServer()
    const first = await server.info()
    const second = await server.info()
    expect(second.url).toBe(first.url)

    await server.dispose()
    await expect(server.info()).rejects.toMatchObject({
      code: 'internal',
      details: { reason: 'disposed' },
    })
    await server.dispose()
  })

  it('answers 404 for other paths and 405 for writes', async () => {
    const server = createApiSampleServer()
    disposers.push(() => server.dispose())
    const info = await server.info()

    const missing = await fetch(new URL('/nope', info.url))
    expect(missing.status).toBe(404)

    const write = await fetch(info.url, { method: 'POST' })
    expect(write.status).toBe(405)
    expect(write.headers.get('allow')).toBe('GET, HEAD')
  })
})

describe('ApiService.sampleInfo', () => {
  it('returns the injected endpoint and rejects an unusable one', async () => {
    const good: ApiSampleInfo = { url: 'http://127.0.0.1:9/sample', method: 'GET' }
    const service = new ApiService({
      secrets: createApiSecretStore({}),
      sample: async () => good,
    })
    expect(await service.sampleInfo()).toEqual(good)

    const missing = new ApiService({ secrets: createApiSecretStore({}) })
    await expect(missing.sampleInfo()).rejects.toMatchObject({
      code: 'internal',
      details: { reason: 'unavailable' },
    })

    const bad = new ApiService({
      secrets: createApiSecretStore({}),
      sample: async () => ({ url: 'https://example.com/sample', method: 'GET' }),
    })
    await expect(bad.sampleInfo()).rejects.toMatchObject({
      code: 'internal',
      details: { reason: 'invalid' },
    })
  })

  it('is reachable through the unary registry', async () => {
    const registry = new UnaryRegistry()
    const service = new ApiService({
      secrets: createApiSecretStore({}),
      sample: async () => ({ url: 'http://127.0.0.1:9/sample', method: 'GET' }),
    })
    const dispose = registerApiMethods(registry, service)
    try {
      expect(registry.has(API_SAMPLE_INFO_METHOD)).toBe(true)
      const result = await registry.dispatch(API_SAMPLE_INFO_METHOD, undefined, {
        request: new Request('http://127.0.0.1/api/vibe/request', { method: 'POST' }),
        signal: new AbortController().signal,
      })
      expect(result.status).toBe(200)
      expect(result.body).toMatchObject({
        ok: true,
        value: { url: 'http://127.0.0.1:9/sample', method: 'GET' },
      })
    } finally {
      dispose()
    }
  })
})
