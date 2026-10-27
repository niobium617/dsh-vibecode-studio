import { describe, expect, it } from 'vitest'
import { asSessionId, asTargetId } from '../../../src/contracts/ids'
import {
  PREVIEW_INPUT_METHOD,
  type PreviewInputEvent,
} from '../../../src/contracts/transport'
import {
  createPreviewService,
  registerPreviewMethods,
} from '../../../src/host/preview/route'
import { createTargetAdapterRegistry } from '../../../src/host/targets/registry'
import type {
  ScreencastSessionLike,
  TargetAdapter,
} from '../../../src/host/targets/types'
import { UnaryRegistry } from '../../../src/host/transport/unary'

interface Sent {
  readonly method: string
  readonly params?: Record<string, unknown>
}

interface FakeSession extends ScreencastSessionLike {
  readonly id: number
  readonly sent: Sent[]
  readonly detached: boolean
}

const capabilitiesBase = {
  screencast: true,
  input: true,
  pick: false,
  sourceMap: false,
  console: false,
  network: false,
  screenshot: true,
} as const

const pointerDown: PreviewInputEvent = {
  kind: 'pointer',
  action: 'down',
  x: 0.5,
  y: 0.5,
}

function createFakeAdapter(options: { input?: boolean } = {}) {
  let started = false
  let stopCount = 0
  const sessions: FakeSession[] = []
  const capabilities = { ...capabilitiesBase, input: options.input ?? true }
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
          async createCdpSession(): Promise<FakeSession> {
            const session: FakeSession = {
              id: sessions.length + 1,
              sent: [],
              detached: false,
              async send(method, params) {
                session.sent.push({ method, params })
                return {}
              },
              on() {},
              off() {},
              async detach() {
                Object.defineProperty(session, 'detached', { value: true, enumerable: true })
              },
            }
            sessions.push(session)
            return session
          },
        }
      : undefined

  return {
    adapter,
    sessions,
    get stopCount() {
      return stopCount
    },
  }
}

async function boot(options: { input?: boolean } = {}) {
  const fake = createFakeAdapter(options)
  const targets = createTargetAdapterRegistry()
  targets.register(fake.adapter)
  const service = createPreviewService({ targets })
  return { fake, service }
}

function inputCalls(sessions: FakeSession[]): { session: FakeSession; sent: Sent[] }[] {
  return sessions
    .filter((session) => session.sent.some((entry) => entry.method.startsWith('Input.')))
    .map((session) => ({
      session,
      sent: session.sent.filter((entry) => entry.method.startsWith('Input.')),
    }))
}

describe('preview service input', () => {
  it('rejects input before a target is running', async () => {
    const { service } = await boot()
    await expect(service.input(pointerDown)).rejects.toMatchObject({
      code: 'target_unavailable',
    })
    await service.dispose()
  })

  it('rejects malformed events before touching CDP', async () => {
    const { fake, service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })

    const invalid = [
      null,
      { kind: 'pointer', action: 'down', x: 2, y: 0 },
      { kind: 'pointer', action: 'down', x: 0.5, y: 0.5, extra: true },
      { kind: 'wheel', x: 0.5, y: 0.5, deltaX: 0, deltaY: 5000 },
      { kind: 'key', action: 'down', key: '', text: 'a' },
      { kind: 'key', action: 'down', key: 'A', text: 'x'.repeat(33) },
      { kind: 'key', action: 'down', key: 'A', code: 'bad code' },
      { kind: 'pointer', action: 'down', x: 0.5, y: 0.5, modifiers: { ctrl: 'yes' } },
    ]
    for (const event of invalid) {
      await expect(service.input(event)).rejects.toMatchObject({ code: 'invalid_input' })
    }
    expect(inputCalls(fake.sessions)).toHaveLength(0)
    await service.stop()
  })

  it('forwards a validated event to the live page', async () => {
    const { fake, service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })

    const ack = await service.input({
      kind: 'pointer',
      action: 'down',
      x: 0.5,
      y: 0.25,
      button: 'right',
      modifiers: { shift: true },
    })
    expect(ack).toMatchObject({
      viewport: { width: 800, height: 600 },
      point: { x: 400, y: 150 },
    })

    const calls = inputCalls(fake.sessions)
    expect(calls).toHaveLength(1)
    expect(calls[0].sent[0]).toEqual({
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mousePressed',
        x: 400,
        y: 150,
        button: 'right',
        clickCount: 1,
        buttons: 2,
        modifiers: 8,
      },
    })
    await service.stop()
  })

  it('reports unsupported when the adapter does not declare input', async () => {
    const { fake, service } = await boot({ input: false })
    await service.start({ url: 'http://127.0.0.1:4320/' })

    await expect(service.input(pointerDown)).rejects.toMatchObject({
      code: 'unsupported',
      details: { capability: 'input' },
    })
    expect(inputCalls(fake.sessions)).toHaveLength(0)
    await service.stop()
  })

  it('detaches the input session on stop', async () => {
    const { fake, service } = await boot()
    await service.start({ url: 'http://127.0.0.1:4320/' })
    await service.input(pointerDown)
    expect(fake.sessions).toHaveLength(2)

    await service.stop()
    expect(fake.sessions.every((session) => session.detached)).toBe(true)
    expect(fake.stopCount).toBe(1)
    await expect(service.input(pointerDown)).rejects.toMatchObject({
      code: 'target_unavailable',
    })
  })

  it('registers preview.input on the unary registry', async () => {
    const { fake, service } = await boot()
    const registry = new UnaryRegistry()
    const unregister = registerPreviewMethods(registry, service)
    const context = {
      request: new Request('http://127.0.0.1/api/vibe/request'),
      signal: new AbortController().signal,
    }

    const invalid = await registry.dispatch(PREVIEW_INPUT_METHOD, { kind: 'nope' }, context)
    expect(invalid.status).toBe(400)
    expect(invalid.body).toMatchObject({ ok: false, error: { code: 'invalid_input' } })

    await service.start({ url: 'http://127.0.0.1:4320/' })
    const ok = await registry.dispatch(PREVIEW_INPUT_METHOD, pointerDown, context)
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({
      ok: true,
      value: { viewport: { width: 800, height: 600 }, point: { x: 400, y: 300 } },
    })
    expect(inputCalls(fake.sessions)).toHaveLength(1)

    unregister()
    expect(registry.has(PREVIEW_INPUT_METHOD)).toBe(false)
    await service.stop()
  })
})
