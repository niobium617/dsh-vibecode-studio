import { describe, expect, it } from 'vitest'
import { asSessionId, asTargetId } from '../../../src/contracts/ids'
import type { ConsoleEntry } from '../../../src/contracts/telemetry'
import {
  PREVIEW_CONSOLE_CLEAR_METHOD,
  PREVIEW_CONSOLE_LIST_METHOD,
  type PreviewConsoleQuery,
} from '../../../src/contracts/transport'
import type { PreviewConsoleCollector } from '../../../src/host/preview/console'
import {
  createPreviewService,
  registerPreviewMethods,
} from '../../../src/host/preview/route'
import { createTargetAdapterRegistry } from '../../../src/host/targets/registry'
import type { ScreencastSessionLike, TargetAdapter } from '../../../src/host/targets/types'
import { UnaryRegistry } from '../../../src/host/transport/unary'

const capabilitiesBase = {
  screencast: true,
  input: true,
  pick: false,
  sourceMap: false,
  console: true,
  network: false,
  screenshot: true,
} as const


/** `consoleList`/`consoleClear` are synchronous: capture the thrown StudioError. */
function studioFailure(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected a StudioError to be thrown')
}

const SAMPLE_ENTRY: ConsoleEntry = {
  id: 'console-4',
  level: 'error',
  text: 'boom',
  timestamp: '2026-10-27T00:00:00.000Z',
}

function fakeCollector(options: { failStart?: boolean } = {}) {
  const listCalls: (PreviewConsoleQuery | undefined)[] = []
  let clearCalls = 0
  let started = false
  let stopCalls = 0

  const collector: PreviewConsoleCollector = {
    async start() {
      if (options.failStart) throw new Error('runtime disabled')
      started = true
    },
    async stop() {
      stopCalls += 1
      started = false
    },
    snapshot(query) {
      listCalls.push(query)
      return { entries: [SAMPLE_ENTRY], lastSeq: 4, dropped: 1 }
    },
    clear() {
      clearCalls += 1
      return { cleared: 1, lastSeq: 4 }
    },
    stats() {
      return {
        received: 1,
        stored: 1,
        dropped: 1,
        rejected: 0,
        lastSeq: 4,
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
    get clearCalls() {
      return clearCalls
    },
    get stopCalls() {
      return stopCalls
    },
  }
}

function createFakeAdapter(options: { console?: boolean } = {}) {
  let started = false
  let stopCount = 0
  const sessions: ScreencastSessionLike[] = []
  const capabilities = { ...capabilitiesBase, console: options.console ?? true }

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
            const session: ScreencastSessionLike = {
              async send() {
                return {}
              },
              on() {},
              off() {},
              async detach() {},
            }
            sessions.push(session)
            return session
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

async function boot(options: { console?: boolean; failStart?: boolean } = {}) {
  const fake = createFakeAdapter(options)
  const consoleFake = fakeCollector({ failStart: options.failStart })
  const targets = createTargetAdapterRegistry()
  targets.register(fake.adapter)
  const service = createPreviewService({
    targets,
    createConsole: () => consoleFake.collector,
    createSource: () => ({
      start: async () => undefined,
      stop: async () => undefined,
      active: true,
      fps: 30,
      quality: 70,
      stats: () => ({ received: 0, published: 0, dropped: 0, rejected: 0, lastFrameAt: null }),
    }),
  })
  return { fake, consoleFake, service }
}

describe('preview service console', () => {
  it('rejects console reads before a target is running', async () => {
    const { service } = await boot()
    expect(studioFailure(() => service.consoleList({}))).toMatchObject({
      code: 'target_unavailable',
    })
    expect(studioFailure(() => service.consoleClear())).toMatchObject({
      code: 'target_unavailable',
    })
    await service.dispose()
  })

  it('validates queries before reading the buffer', async () => {
    const { consoleFake, service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })

    for (const query of [
      null,
      { after: -1 },
      { after: 1.5 },
      { limit: 0 },
      { limit: 501 },
      { after: 1, extra: true },
    ]) {
      expect(studioFailure(() => service.consoleList(query))).toMatchObject({
        code: 'invalid_input',
        details: { field: 'query' },
      })
    }
    expect(consoleFake.listCalls).toHaveLength(0)
    await service.stop()
  })

  it('serves snapshots and clear results from the collector', async () => {
    const { consoleFake, service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })

    expect(service.consoleList()).toEqual({
      entries: [SAMPLE_ENTRY],
      lastSeq: 4,
      dropped: 1,
    })
    expect(service.consoleList({ after: 2, limit: 1 })).toMatchObject({ lastSeq: 4 })
    expect(consoleFake.listCalls).toEqual([undefined, { after: 2, limit: 1 }])
    expect(service.consoleClear()).toEqual({ cleared: 1, lastSeq: 4 })
    expect(consoleFake.clearCalls).toBe(1)

    await service.stop()
    expect(consoleFake.stopCalls).toBe(1)
  })

  it('reports unsupported when the adapter does not declare console', async () => {
    const { consoleFake, service } = await boot({ console: false })
    const snapshot = await service.start({ url: 'http://127.0.0.1:4320/' })

    expect(snapshot.capabilities?.console).toBe(false)
    expect(studioFailure(() => service.consoleList())).toMatchObject({
      code: 'unsupported',
      details: { capability: 'console' },
    })
    expect(consoleFake.listCalls).toHaveLength(0)
    await service.stop()
  })

  it('keeps the preview running when console capture fails to start', async () => {
    const { consoleFake, service } = await boot({ failStart: true })
    const snapshot = await service.start({ url: 'http://127.0.0.1:4320/' })

    expect(snapshot.status).toBe('ready')
    expect(snapshot.capabilities?.console).toBe(false)
    expect(consoleFake.stopCalls).toBe(1)
    expect(studioFailure(() => service.consoleList())).toMatchObject({ code: 'unsupported' })
    await service.stop()
  })

  it('drops console state when the preview stops', async () => {
    const { consoleFake, service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })
    await service.stop()

    expect(consoleFake.stopCalls).toBe(1)
    expect(studioFailure(() => service.consoleList())).toMatchObject({
      code: 'target_unavailable',
    })
  })

  it('registers preview.console.list and preview.console.clear', async () => {
    const { service } = await boot()
    const registry = new UnaryRegistry()
    const unregister = registerPreviewMethods(registry, service)
    const context = {
      request: new Request('http://127.0.0.1/api/vibe/request'),
      signal: new AbortController().signal,
    }

    await service.start({ url: 'http://127.0.0.1:4320/' })

    const list = await registry.dispatch(PREVIEW_CONSOLE_LIST_METHOD, { after: 1 }, context)
    expect(list.status).toBe(200)
    expect(list.body).toMatchObject({
      ok: true,
      value: { entries: [SAMPLE_ENTRY], lastSeq: 4, dropped: 1 },
    })

    const badQuery = await registry.dispatch(PREVIEW_CONSOLE_LIST_METHOD, { limit: 0 }, context)
    expect(badQuery.status).toBe(400)
    expect(badQuery.body).toMatchObject({ ok: false, error: { code: 'invalid_input' } })

    const clear = await registry.dispatch(PREVIEW_CONSOLE_CLEAR_METHOD, undefined, context)
    expect(clear.status).toBe(200)
    expect(clear.body).toMatchObject({ ok: true, value: { cleared: 1, lastSeq: 4 } })

    unregister()
    expect(registry.has(PREVIEW_CONSOLE_LIST_METHOD)).toBe(false)
    expect(registry.has(PREVIEW_CONSOLE_CLEAR_METHOD)).toBe(false)
    await service.stop()
  })
})
