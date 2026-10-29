import { afterEach, describe, expect, it, vi } from 'vitest'
import { studioError } from '../../../src/contracts/errors'
import {
  FRAME_PATH,
  HEALTH_PATH,
  MAX_UNARY_BODY_BYTES,
  PREVIEW_START_METHOD,
  PREVIEW_STATUS_METHOD,
  PREVIEW_STOP_METHOD,
  REQUEST_PATH,
  STREAM_PATH,
  TRANSPORT_VERSION,
  type UnaryResponse,
} from '../../../src/contracts/transport'
import {
  apply,
  Config,
  type VibeStudioService,
} from '../../../src/host/index'
import type { ConnectionFetchRouteLike } from '../../../src/host/transport'
import { createFakeHost, type FakeHost } from '../../helpers/fake-host'

function route(host: FakeHost, path: string): ConnectionFetchRouteLike {
  const found = host.routes.get(path)
  if (!found) throw new Error(`missing route ${path}`)
  return found
}

function unaryRequest(
  payload: unknown,
  headers: Record<string, string> = { 'content-type': 'application/json' },
): Request {
  return new Request(`http://127.0.0.1${REQUEST_PATH}`, {
    method: 'POST',
    headers,
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

async function envelope(response: Response): Promise<UnaryResponse> {
  return (await response.json()) as UnaryResponse
}

function boot(config = Config({})): FakeHost {
  const host = createFakeHost()
  apply(host.ctx, config)
  return host
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('host transport registration', () => {
  it('registers only the exact /api/vibe routes', () => {
    const host = boot()

    expect([...host.routes.keys()].sort()).toEqual(
      [HEALTH_PATH, REQUEST_PATH, STREAM_PATH, FRAME_PATH].sort(),
    )
    expect(route(host, HEALTH_PATH).methods).toEqual(['GET'])
    expect(route(host, HEALTH_PATH).requestBody).toBe('buffered')
    expect(route(host, REQUEST_PATH).methods).toEqual(['POST'])
    expect(route(host, REQUEST_PATH).requestBody).toBe('buffered')
    expect(route(host, STREAM_PATH).methods).toEqual(['GET'])
    expect(route(host, FRAME_PATH).methods).toEqual(['GET'])
    expect(host.effectLabels).toEqual([
      `vibe-studio: ${HEALTH_PATH}`,
      `vibe-studio: ${REQUEST_PATH}`,
      'vibe-studio: settings methods',
      'vibe-studio: annotation history methods',
      'vibe-studio: preview methods',
      `vibe-studio: ${STREAM_PATH}`,
      `vibe-studio: ${FRAME_PATH}`,
      'vibe-studio: api methods',
    ])
  })

  it('registers, provides the service, and removes routes when disposed', async () => {
    const host = boot(Config({ logLevel: 'debug', retentionDays: 14 }))
    const service = host.provided.get('vibeStudio') as VibeStudioService

    expect(service.config.logLevel).toBe('debug')
    expect(service.transport.has('studio.ping')).toBe(true)
    expect(service.transport.has('studio.settings.get')).toBe(true)
    expect(service.transport.has('studio.settings.update')).toBe(true)
    expect(service.transport.has(PREVIEW_START_METHOD)).toBe(true)
    expect(service.transport.has(PREVIEW_STOP_METHOD)).toBe(true)
    expect(service.transport.has(PREVIEW_STATUS_METHOD)).toBe(true)
    expect(service.transport.has('api.http.send')).toBe(true)
    expect(service.settings).toBeDefined()
    expect(service.preview.status().status).toBe('idle')

    await host.dispose()
    expect(host.routes.size).toBe(0)
    expect(service.transport.has('studio.settings.get')).toBe(false)
  })
})

describe('health route', () => {
  it('returns the transport version, uptime and safe config projection', async () => {
    const host = boot(Config({ allowedOrigins: ['http://localhost:5173'] }))
    const response = await route(host, HEALTH_PATH).fetch(
      new Request(`http://127.0.0.1${HEALTH_PATH}`),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = (await response.json()) as {
      ok: true
      value: {
        plugin: string
        transportVersion: number
        serverTime: string
        uptimeMs: number
        config: Record<string, unknown>
      }
    }
    expect(body.ok).toBe(true)
    expect(body.value.plugin).toBe('dsh-vibecode-studio')
    expect(body.value.transportVersion).toBe(TRANSPORT_VERSION)
    expect(Number.isFinite(Date.parse(body.value.serverTime))).toBe(true)
    expect(body.value.uptimeMs).toBeGreaterThanOrEqual(0)
    expect(body.value.config).toEqual({
      logLevel: 'info',
      allowedOrigins: ['http://localhost:5173'],
      retentionDays: 7,
      contextBudgetBytes: 8192,
      screenshotEnabled: true,
    })
  })

  it('rejects non-GET methods with an envelope', async () => {
    const host = boot()
    const response = await route(host, HEALTH_PATH).fetch(
      new Request(`http://127.0.0.1${HEALTH_PATH}`, { method: 'POST' }),
    )

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET')
    expect(await envelope(response)).toMatchObject({
      ok: false,
      error: { code: 'unsupported' },
    })
  })
})

describe('unary route', () => {
  it('runs studio.ping and echoes validated params', async () => {
    const host = boot()
    const response = await route(host, REQUEST_PATH).fetch(
      unaryRequest({ id: 'req-1', method: 'studio.ping', params: { hello: '世界' } }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await envelope(response)).toEqual({
      ok: true,
      id: 'req-1',
      value: {
        pong: true,
        serverTime: expect.any(String),
        transportVersion: TRANSPORT_VERSION,
        echo: { hello: '世界' },
      },
    })
  })

  it('dispatches methods registered on the provided registry', async () => {
    const host = boot()
    const service = host.provided.get('vibeStudio') as VibeStudioService
    service.transport.register('test.add', (params) => {
      const { a, b } = params as { a: number; b: number }
      return { sum: a + b }
    })

    const response = await route(host, REQUEST_PATH).fetch(
      unaryRequest({ method: 'test.add', params: { a: 2, b: 3 } }),
    )

    expect(await envelope(response)).toEqual({ ok: true, value: { sum: 5 } })
  })

  it('returns 404 for an unknown method', async () => {
    const host = boot()
    const response = await route(host, REQUEST_PATH).fetch(
      unaryRequest({ method: 'test.missing' }),
    )

    expect(response.status).toBe(404)
    expect(await envelope(response)).toMatchObject({
      ok: false,
      error: { code: 'not_found', message: 'unknown method "test.missing"' },
    })
  })

  it('maps a thrown StudioError onto its status and code', async () => {
    const host = boot()
    const service = host.provided.get('vibeStudio') as VibeStudioService
    service.transport.register('test.denied', () => {
      throw studioError('permission_denied', 'not allowed')
    })

    const response = await route(host, REQUEST_PATH).fetch(
      unaryRequest({ method: 'test.denied' }),
    )

    expect(response.status).toBe(403)
    expect(await envelope(response)).toMatchObject({
      ok: false,
      error: { code: 'permission_denied', message: 'not allowed' },
    })
  })

  it('hides unexpected handler errors behind internal', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
    const host = boot()
    const service = host.provided.get('vibeStudio') as VibeStudioService
    service.transport.register('test.boom', () => {
      throw new Error('secret implementation detail')
    })

    const response = await route(host, REQUEST_PATH).fetch(
      unaryRequest({ method: 'test.boom' }),
    )

    expect(response.status).toBe(500)
    expect(await envelope(response)).toEqual({
      ok: false,
      error: { code: 'internal', message: 'request handler failed' },
    })
    expect(errorLog).toHaveBeenCalled()
  })

  it('turns a non-serializable handler result into internal', async () => {
    const host = boot()
    const service = host.provided.get('vibeStudio') as VibeStudioService
    service.transport.register('test.bigint', () => ({ value: 1n }))

    const response = await route(host, REQUEST_PATH).fetch(
      unaryRequest({ method: 'test.bigint' }),
    )

    expect(response.status).toBe(500)
    expect(await envelope(response)).toEqual({
      ok: false,
      error: { code: 'internal', message: 'response is not serializable' },
    })
  })

  it('rejects wrong methods, content types and malformed bodies', async () => {
    const host = boot()
    const handler = route(host, REQUEST_PATH).fetch

    const wrongMethod = await handler(
      new Request(`http://127.0.0.1${REQUEST_PATH}`, { method: 'GET' }),
    )
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('POST')

    const wrongType = await handler(
      unaryRequest({ method: 'studio.ping' }, { 'content-type': 'text/plain' }),
    )
    expect(wrongType.status).toBe(415)

    const badJson = await handler(unaryRequest('{"method":'))
    expect(badJson.status).toBe(400)
    expect(await envelope(badJson)).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    })

    const notObject = await handler(unaryRequest('[]'))
    expect(notObject.status).toBe(400)

    const unknownKey = await handler(unaryRequest({ method: 'studio.ping', extra: true }))
    expect(unknownKey.status).toBe(400)
    expect(await envelope(unknownKey)).toMatchObject({
      ok: false,
      error: { message: 'request contains unknown keys' },
    })

    const badMethod = await handler(unaryRequest({ method: '../escape' }))
    expect(badMethod.status).toBe(400)

    const badId = await handler(unaryRequest({ id: 'has space', method: 'studio.ping' }))
    expect(badId.status).toBe(400)
  })

  it('rejects an oversized body before dispatch', async () => {
    const host = boot()
    const response = await route(host, REQUEST_PATH).fetch(
      unaryRequest({ method: 'studio.ping', params: 'x'.repeat(MAX_UNARY_BODY_BYTES + 16) }),
    )

    expect(response.status).toBe(413)
    expect(await envelope(response)).toMatchObject({
      ok: false,
      error: { code: 'invalid_input', message: 'request body is too large' },
    })
  })
})

describe('unary registry', () => {
  it('rejects duplicate and malformed method names', () => {
    const host = boot()
    const service = host.provided.get('vibeStudio') as VibeStudioService

    expect(() => service.transport.register('Bad Method', () => null)).toThrow(/invalid unary method/)
    expect(() => service.transport.register('studio.ping', () => null)).toThrow(/already registered/)
  })

  it('unregisters only the handler it registered', async () => {
    const host = boot()
    const service = host.provided.get('vibeStudio') as VibeStudioService
    const unregister = service.transport.register('test.temp', () => 'first')
    expect(service.transport.has('test.temp')).toBe(true)

    unregister()
    expect(service.transport.has('test.temp')).toBe(false)

    const response = await route(host, REQUEST_PATH).fetch(
      unaryRequest({ method: 'test.temp' }),
    )
    expect(response.status).toBe(404)
  })
})
