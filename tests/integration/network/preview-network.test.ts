import { describe, expect, it } from 'vitest'
import { asSessionId, asTargetId } from '../../../src/contracts/ids'
import type { NetworkEntry } from '../../../src/contracts/telemetry'
import {
  PREVIEW_NETWORK_BODY_METHOD,
  PREVIEW_NETWORK_CLEAR_METHOD,
  PREVIEW_NETWORK_LIST_METHOD,
  type PreviewNetworkBody,
  type PreviewNetworkBodyParams,
  type PreviewNetworkQuery,
} from '../../../src/contracts/transport'
import type { PreviewNetworkCollector } from '../../../src/host/preview/network'
import {
  createPreviewService,
  registerPreviewMethods,
} from '../../../src/host/preview/route'
import { createTargetAdapterRegistry } from '../../../src/host/targets/registry'
import type { TargetAdapter } from '../../../src/host/targets/types'
import { UnaryRegistry } from '../../../src/host/transport/unary'

const capabilitiesBase = {
  screencast: true,
  input: false,
  pick: false,
  sourceMap: false,
  console: false,
  network: true,
  screenshot: true,
} as const

const SAMPLE_ENTRY: NetworkEntry = {
  id: 'network-4',
  method: 'GET',
  url: 'http://127.0.0.1:4320/api/boom?token=REDACTED',
  status: 500,
  outcome: 'error',
  resourceType: 'Fetch',
  startedAt: '2026-10-27T00:00:00.000Z',
  durationMs: 12,
  requestHeaders: { Authorization: 'REDACTED' },
}

const SAMPLE_BODY: PreviewNetworkBody = {
  id: 'network-4',
  status: 500,
  mimeType: 'application/json',
  body: '{"error":true}',
  base64Encoded: false,
  truncated: false,
  bytes: 14,
}

/** `networkList`/`networkClear` are synchronous: capture the thrown StudioError. */
function studioFailure(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected a StudioError to be thrown')
}

function fakeCollector(options: { failStart?: boolean } = {}) {
  const listCalls: (PreviewNetworkQuery | undefined)[] = []
  const bodyCalls: PreviewNetworkBodyParams[] = []
  let clearCalls = 0
  let started = false
  let stopCalls = 0

  const collector: PreviewNetworkCollector = {
    async start() {
      if (options.failStart) throw new Error('network disabled')
      started = true
    },
    async stop() {
      stopCalls += 1
      started = false
    },
    snapshot(query) {
      listCalls.push(query)
      return { entries: [SAMPLE_ENTRY], lastSeq: 9, dropped: 1 }
    },
    clear() {
      clearCalls += 1
      return { cleared: 1, lastSeq: 9 }
    },
    async body(params) {
      bodyCalls.push(params)
      return SAMPLE_BODY
    },
    stats() {
      return {
        received: 1,
        stored: 1,
        dropped: 1,
        rejected: 0,
        lastSeq: 9,
        lastAt: 1_700_000_000_000,
      }
    },
    get active() {
      return started
    },
  }

  return {
    collector,
    listCalls,
    bodyCalls,
    get clearCalls() {
      return clearCalls
    },
    get stopCalls() {
      return stopCalls
    },
  }
}

function createFakeAdapter(options: { network?: boolean } = {}) {
  let started = false
  let stopCount = 0
  const capabilities = { ...capabilitiesBase, network: options.network ?? true }

  const adapter: TargetAdapter = {
    id: 'web',
    kind: 'web',
    capabilities,
    async start() {
      started = true
      return {
        id: asSessionId('preview-1'),
        targetId: asTargetId('preview'),
        kind: 'web',
        status: 'ready',
        url: 'http://127.0.0.1:4320/',
        capabilities,
        startedAt: '2026-10-27T00:00:00.000Z',
      }
    },
    async stop() {
      stopCount += 1
      started = false
    },
  }
  adapter.screencastPage = () =>
    started
      ? {
          viewport: () => ({ width: 800, height: 600 }),
          async createCdpSession() {
            return {
              async send() {
                return {}
              },
              on() {},
              off() {},
              async detach() {},
            }
          },
        }
      : undefined

  return {
    adapter,
    get stopCount() {
      return stopCount
    },
  }
}

async function boot(options: { network?: boolean; failStart?: boolean } = {}) {
  const fake = createFakeAdapter(options)
  const networkFake = fakeCollector({ failStart: options.failStart })
  const targets = createTargetAdapterRegistry()
  targets.register(fake.adapter)
  const service = createPreviewService({
    targets,
    createNetwork: () => networkFake.collector,
    createSource: () => ({
      start: async () => undefined,
      stop: async () => undefined,
      active: true,
      fps: 30,
      quality: 70,
      stats: () => ({ received: 0, published: 0, dropped: 0, rejected: 0, lastFrameAt: null }),
    }),
  })
  return { fake, networkFake, service }
}

describe('preview service network', () => {
  it('rejects network reads before a target is running', async () => {
    const { service } = await boot()
    expect(studioFailure(() => service.networkList({}))).toMatchObject({
      code: 'target_unavailable',
    })
    expect(studioFailure(() => service.networkClear())).toMatchObject({
      code: 'target_unavailable',
    })
    await expect(service.networkBody({ id: 'network-1' })).rejects.toMatchObject({
      code: 'target_unavailable',
    })
    await service.dispose()
  })

  it('validates queries and body ids before touching the collector', async () => {
    const { networkFake, service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })

    for (const query of [
      null,
      { after: -1 },
      { after: 1.5 },
      { limit: 0 },
      { limit: 301 },
      { after: 1, extra: true },
    ]) {
      expect(studioFailure(() => service.networkList(query))).toMatchObject({
        code: 'invalid_input',
        details: { field: 'query' },
      })
    }
    for (const params of [null, {}, { id: 'x' }, { id: 'network-1', extra: 1 }]) {
      await expect(service.networkBody(params)).rejects.toMatchObject({
        code: 'invalid_input',
        details: { field: 'params' },
      })
    }
    expect(networkFake.listCalls).toHaveLength(0)
    expect(networkFake.bodyCalls).toHaveLength(0)
    await service.stop()
  })

  it('serves snapshots, clear results and bodies', async () => {
    const { networkFake, service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })

    expect(service.networkList()).toEqual({
      entries: [SAMPLE_ENTRY],
      lastSeq: 9,
      dropped: 1,
    })
    expect(service.networkList({ after: 4, limit: 1 })).toMatchObject({ lastSeq: 9 })
    expect(networkFake.listCalls).toEqual([undefined, { after: 4, limit: 1 }])
    expect(service.networkClear()).toEqual({ cleared: 1, lastSeq: 9 })
    expect(networkFake.clearCalls).toBe(1)
    await expect(service.networkBody({ id: 'network-4' })).resolves.toEqual(SAMPLE_BODY)
    expect(networkFake.bodyCalls).toEqual([{ id: 'network-4' }])

    await service.stop()
    expect(networkFake.stopCalls).toBe(1)
  })

  it('reports unsupported when the adapter does not declare network', async () => {
    const { networkFake, service } = await boot({ network: false })
    const snapshot = await service.start({ url: 'http://127.0.0.1:4320/' })

    expect(snapshot.capabilities?.network).toBe(false)
    expect(studioFailure(() => service.networkList())).toMatchObject({
      code: 'unsupported',
      details: { capability: 'network' },
    })
    expect(networkFake.listCalls).toHaveLength(0)
    await service.stop()
  })

  it('keeps the preview running when network capture fails to start', async () => {
    const { networkFake, service } = await boot({ failStart: true })
    const snapshot = await service.start({ url: 'http://127.0.0.1:4320/' })

    expect(snapshot.status).toBe('ready')
    expect(snapshot.capabilities?.network).toBe(false)
    expect(networkFake.stopCalls).toBe(1)
    expect(studioFailure(() => service.networkList())).toMatchObject({ code: 'unsupported' })
    await service.stop()
  })

  it('drops network state when the preview stops', async () => {
    const { networkFake, service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })
    await service.stop()

    expect(networkFake.stopCalls).toBe(1)
    expect(studioFailure(() => service.networkList())).toMatchObject({
      code: 'target_unavailable',
    })
    await expect(service.networkBody({ id: 'network-4' })).rejects.toMatchObject({
      code: 'target_unavailable',
    })
  })

  it('registers preview.network.list, clear and body', async () => {
    const { service } = await boot()
    const registry = new UnaryRegistry()
    const unregister = registerPreviewMethods(registry, service)
    const context = {
      request: new Request('http://127.0.0.1/api/vibe/request'),
      signal: new AbortController().signal,
    }

    await service.start({ url: 'http://127.0.0.1:4320/' })

    const list = await registry.dispatch(PREVIEW_NETWORK_LIST_METHOD, { after: 1 }, context)
    expect(list.status).toBe(200)
    expect(list.body).toMatchObject({
      ok: true,
      value: { entries: [SAMPLE_ENTRY], lastSeq: 9, dropped: 1 },
    })

    const badQuery = await registry.dispatch(PREVIEW_NETWORK_LIST_METHOD, { limit: 0 }, context)
    expect(badQuery.status).toBe(400)
    expect(badQuery.body).toMatchObject({ ok: false, error: { code: 'invalid_input' } })

    const body = await registry.dispatch(
      PREVIEW_NETWORK_BODY_METHOD,
      { id: 'network-4' },
      context,
    )
    expect(body.status).toBe(200)
    expect(body.body).toMatchObject({ ok: true, value: SAMPLE_BODY })

    const badBody = await registry.dispatch(PREVIEW_NETWORK_BODY_METHOD, { id: 'x' }, context)
    expect(badBody.status).toBe(400)
    expect(badBody.body).toMatchObject({ ok: false, error: { code: 'invalid_input' } })

    const clear = await registry.dispatch(PREVIEW_NETWORK_CLEAR_METHOD, undefined, context)
    expect(clear.status).toBe(200)
    expect(clear.body).toMatchObject({ ok: true, value: { cleared: 1, lastSeq: 9 } })

    unregister()
    expect(registry.has(PREVIEW_NETWORK_LIST_METHOD)).toBe(false)
    expect(registry.has(PREVIEW_NETWORK_CLEAR_METHOD)).toBe(false)
    expect(registry.has(PREVIEW_NETWORK_BODY_METHOD)).toBe(false)
    await service.stop()
  })
})
