/**
 * T043 transport test: `api.replay.prepare` is registered next to
 * `api.http.send`, refuses unconfirmed non-idempotent methods at the wire
 * level, and never reaches the executor or `fetch`.
 */
import { describe, expect, it } from 'vitest'
import {
  API_HTTP_SEND_METHOD,
  API_REPLAY_PREPARE_METHOD,
  ApiService,
  UnaryRegistry,
  createApiSecretStore,
  createHttpExecutor,
  registerApiMethods,
  type CredentialProviderLike,
} from '../../../src/host'
import type { ApiReplayResult, HttpRequestSpec } from '../../../src/contracts/api'
import type { NetworkEntry } from '../../../src/contracts/telemetry'

interface FetchCall {
  readonly url: string
}

function fakeFetch(): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push({ url: String(url) })
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { fetchImpl, calls }
}

const credentials: CredentialProviderLike = {
  resolve: async () => undefined,
  describe: async () => ({ configured: true, writable: true, source: 'file' }),
  set: async () => undefined,
  unset: async () => undefined,
}

function setup() {
  const { fetchImpl, calls } = fakeFetch()
  const registry = new UnaryRegistry()
  const service = new ApiService({
    secrets: createApiSecretStore({ credentials }),
    executor: createHttpExecutor({ fetchImpl }),
  })
  const unregister = registerApiMethods(registry, service)
  return { registry, calls, unregister }
}

function context() {
  return { request: new Request('http://127.0.0.1/api/vibe/request'), signal: new AbortController().signal }
}

const GET_ENTRY: NetworkEntry = {
  id: 'network-1',
  method: 'GET',
  url: 'http://127.0.0.1:4320/api/items',
  status: 200,
  outcome: 'success',
  resourceType: 'XHR',
  startedAt: '2023-11-14T22:13:20.000Z',
  durationMs: 12,
}

const DELETE_ENTRY: NetworkEntry = { ...GET_ENTRY, method: 'DELETE' }

describe('api.replay.prepare', () => {
  it('is registered alongside api.http.send', () => {
    const { registry, unregister } = setup()

    expect(registry.has(API_HTTP_SEND_METHOD)).toBe(true)
    expect(registry.has(API_REPLAY_PREPARE_METHOD)).toBe(true)

    unregister()
    expect(registry.has(API_HTTP_SEND_METHOD)).toBe(false)
    expect(registry.has(API_REPLAY_PREPARE_METHOD)).toBe(false)
  })

  it('returns a draft for a read-only capture without sending anything', async () => {
    const { registry, calls } = setup()

    const result = await registry.dispatch(
      API_REPLAY_PREPARE_METHOD,
      { entry: GET_ENTRY },
      context(),
    )

    expect(result.status).toBe(200)
    if (!result.body.ok) throw new Error('unexpected failure')
    const value = result.body.value as ApiReplayResult
    expect(value.requiresConfirmation).toBe(false)
    expect(value.draft).toEqual<HttpRequestSpec>({
      method: 'GET',
      url: 'http://127.0.0.1:4320/api/items',
    })
    expect(calls).toEqual([])
  })

  it('refuses an unconfirmed DELETE at the transport level', async () => {
    const { registry, calls } = setup()

    const result = await registry.dispatch(
      API_REPLAY_PREPARE_METHOD,
      { entry: DELETE_ENTRY },
      context(),
    )

    expect(result.status).toBe(403)
    expect(result.body.ok).toBe(false)
    if (!result.body.ok) {
      expect(result.body.error.code).toBe('permission_denied')
      expect(result.body.error.details).toMatchObject({
        reason: 'confirmation_required',
        method: 'DELETE',
      })
    }
    expect(calls).toEqual([])
  })

  it('returns the draft once the caller confirms the DELETE', async () => {
    const { registry, calls } = setup()

    const result = await registry.dispatch(
      API_REPLAY_PREPARE_METHOD,
      { entry: DELETE_ENTRY, confirm: true },
      context(),
    )

    expect(result.status).toBe(200)
    if (!result.body.ok) throw new Error('unexpected failure')
    const value = result.body.value as ApiReplayResult
    expect(value.requiresConfirmation).toBe(true)
    expect(value.draft.method).toBe('DELETE')
    // Still only a draft: confirming a replay must not send the request.
    expect(calls).toEqual([])
  })

  it('treats any confirm value other than true as unconfirmed', async () => {
    const { registry } = setup()

    for (const confirm of [false, 'true', 1, null]) {
      const result = await registry.dispatch(
        API_REPLAY_PREPARE_METHOD,
        { entry: DELETE_ENTRY, confirm },
        context(),
      )
      expect(result.status).toBe(403)
    }
  })

  it('rejects malformed params', async () => {
    const { registry } = setup()

    const missing = await registry.dispatch(API_REPLAY_PREPARE_METHOD, {}, context())
    expect(missing.status).toBe(400)
    if (!missing.body.ok) {
      expect(missing.body.error.code).toBe('invalid_input')
      expect(missing.body.error.details).toMatchObject({ field: 'entry' })
    }

    const notObject = await registry.dispatch(API_REPLAY_PREPARE_METHOD, null, context())
    expect(notObject.status).toBe(400)
    if (!notObject.body.ok) {
      expect(notObject.body.error.code).toBe('invalid_input')
      expect(notObject.body.error.details).toMatchObject({ field: 'params' })
    }
  })
})
