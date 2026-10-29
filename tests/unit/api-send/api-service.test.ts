/**
 * T038 `api.http.send`: expansion happens host-side, secrets never appear in
 * the outcome, policy errors stay stable, and an aborted call is cancelled
 * rather than reported as a network failure.
 */
import { describe, expect, it } from 'vitest'
import {
  API_HTTP_SEND_METHOD,
  ApiService,
  UnaryRegistry,
  createApiSecretStore,
  createHttpExecutor,
  registerApiMethods,
  type CredentialProviderLike,
  type UnaryDispatchResult,
} from '../../../src/host'
import type { ApiEnvironment, HttpRequestSpec } from '../../../src/contracts/api'

interface FetchCall {
  readonly url: string
  readonly init: RequestInit | undefined
}

function fakeFetch(): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { fetchImpl, calls }
}

const credentials: CredentialProviderLike = {
  resolve: async (ref) => (ref === 'API_TOKEN' ? { value: 's3cret-token', source: 'file' } : undefined),
  describe: async () => ({ configured: true, writable: true, source: 'file' }),
  set: async () => undefined,
  unset: async () => undefined,
}

function setup(fetchImpl: typeof fetch) {
  const registry = new UnaryRegistry()
  const service = new ApiService({
    secrets: createApiSecretStore({ credentials }),
    executor: createHttpExecutor({ fetchImpl }),
  })
  registerApiMethods(registry, service)
  return { registry, service }
}

function context(signal = new AbortController().signal) {
  return { request: new Request('http://127.0.0.1/api/vibe/request'), signal }
}

function valueOf<T>(result: UnaryDispatchResult): T {
  if (!result.body.ok) throw new Error(`unexpected failure: ${result.body.error.code}`)
  return result.body.value as T
}

const ENVIRONMENT: ApiEnvironment = {
  name: 'Local',
  variables: [
    { name: 'path', value: 'items' },
    { name: 'token', value: 'API_TOKEN', secret: true },
  ],
}

describe('api.http.send', () => {
  it('expands environment variables and sends resolved secrets from the host', async () => {
    const { fetchImpl, calls } = fakeFetch()
    const { registry } = setup(fetchImpl)
    const request: HttpRequestSpec = {
      method: 'POST',
      url: 'https://api.example.com/{{path}}',
      headers: [{ name: 'authorization', value: 'Bearer {{token}}' }],
      body: { kind: 'json', text: '{"hello":"world"}' },
    }

    const result = await registry.dispatch(
      API_HTTP_SEND_METHOD,
      { request, environment: ENVIRONMENT },
      context(),
    )
    const value = valueOf<{ result: { status: number }; unresolved: unknown[] }>(result)

    expect(value.result.status).toBe(200)
    expect(value.unresolved).toEqual([])
    const call = calls[0]!
    expect(call.url).toBe('https://api.example.com/items')
    const sent = new Headers(call.init?.headers)
    expect(sent.get('authorization')).toBe('Bearer s3cret-token')
    expect(sent.get('content-type')).toBe('application/json')
    expect(call.init?.method).toBe('POST')
  })

  it('reports placeholders nothing could resolve and still sends them literally', async () => {
    const { fetchImpl, calls } = fakeFetch()
    const { registry } = setup(fetchImpl)
    const request: HttpRequestSpec = {
      method: 'GET',
      url: 'https://api.example.com/{{missing}}',
    }

    const result = await registry.dispatch(API_HTTP_SEND_METHOD, { request }, context())
    const value = valueOf<{ unresolved: Array<{ name: string; where: string; reason: string }> }>(
      result,
    )

    expect(value.unresolved).toEqual([{ name: 'missing', where: 'url', reason: 'missing' }])
    // The literal placeholder survives; the URL parser percent-encodes braces.
    expect(decodeURIComponent(calls[0]!.url)).toBe('https://api.example.com/{{missing}}')
  })

  it('rejects a malformed params object and a malformed environment', async () => {
    const { fetchImpl } = fakeFetch()
    const { service } = setup(fetchImpl)
    const request: HttpRequestSpec = { method: 'GET', url: 'https://api.example.com/' }

    await expect(service.send(null)).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'params' },
    })
    await expect(
      service.send({ request, environment: { name: 'broken' } }),
    ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'environment' } })
  })

  it('keeps blocked targets a permission_denied failure', async () => {
    const { fetchImpl } = fakeFetch()
    const { registry } = setup(fetchImpl)

    const result = await registry.dispatch(
      API_HTTP_SEND_METHOD,
      { request: { method: 'GET', url: 'http://169.254.169.254/latest/meta-data' } },
      context(),
    )

    expect(result.status).toBe(403)
    expect(result.body.ok).toBe(false)
    if (!result.body.ok) {
      expect(result.body.error.code).toBe('permission_denied')
      expect(result.body.error.details).toMatchObject({ reason: 'blocked_host' })
    }
  })

  it('maps an aborted call to a cancelled network error', async () => {
    const { fetchImpl } = fakeFetch()
    const { service } = setup(fetchImpl)
    const controller = new AbortController()
    controller.abort()

    await expect(
      service.send(
        { request: { method: 'GET', url: 'https://api.example.com/' } },
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: 'network_error', details: { reason: 'cancelled' } })
  })
})
