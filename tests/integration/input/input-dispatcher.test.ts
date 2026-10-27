import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PreviewInputEvent } from '../../../src/contracts/transport'
import {
  createPreviewInputDispatcher,
  mapPoint,
  modifierMask,
} from '../../../src/host/preview/input'
import type { ScreencastSessionLike } from '../../../src/host/targets/types'

interface Sent {
  readonly method: string
  readonly params?: Record<string, unknown>
}

function fakePage(
  options: {
    readonly viewport?: { width: number; height: number } | null
    readonly createDelayMs?: number
    readonly sendDelayMs?: number
  } = {},
) {
  const sent: Sent[] = []
  let createCalls = 0
  let detachCalls = 0
  const delays = options.sendDelayMs ?? 0

  const session: ScreencastSessionLike = {
    async send(method, params) {
      if (delays > 0) await new Promise((resolve) => setTimeout(resolve, delays))
      sent.push({ method, params })
      return {}
    },
    on() {},
    off() {},
    async detach() {
      detachCalls += 1
    },
  }

  const page = {
    viewport: () =>
      options.viewport === undefined ? { width: 1280, height: 720 } : options.viewport,
    async createCdpSession() {
      createCalls += 1
      if (options.createDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.createDelayMs))
      }
      return session
    },
  }

  return {
    page,
    sent,
    get createCalls() {
      return createCalls
    },
    get detachCalls() {
      return detachCalls
    },
  }
}

const pointerDown: PreviewInputEvent = {
  kind: 'pointer',
  action: 'down',
  x: 0.25,
  y: 0.5,
}
const pointerUp: PreviewInputEvent = {
  kind: 'pointer',
  action: 'up',
  x: 0.25,
  y: 0.5,
}

afterEach(() => {
  vi.useRealTimers()
})

describe('preview input dispatcher', () => {
  it('maps viewport fractions and tracks the pressed button', async () => {
    const fake = fakePage()
    const dispatcher = createPreviewInputDispatcher({ page: fake.page })

    const ack = await dispatcher.dispatch({
      ...pointerDown,
      modifiers: { shift: true, ctrl: true },
    })
    expect(ack).toMatchObject({
      viewport: { width: 1280, height: 720 },
      point: { x: 320, y: 360 },
    })
    expect(fake.sent[0]).toEqual({
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mousePressed',
        x: 320,
        y: 360,
        button: 'left',
        clickCount: 1,
        buttons: 1,
        modifiers: 2 | 8,
      },
    })

    await dispatcher.dispatch({ kind: 'pointer', action: 'move', x: 0.5, y: 0.5 })
    expect(fake.sent[1].params).toMatchObject({
      type: 'mouseMoved',
      x: 640,
      y: 360,
      button: 'none',
      buttons: 1,
    })

    await dispatcher.dispatch(pointerUp)
    expect(fake.sent[2].params).toMatchObject({
      type: 'mouseReleased',
      x: 320,
      y: 360,
      button: 'left',
      buttons: 0,
    })
    expect(fake.createCalls).toBe(1)
    await dispatcher.stop()
  })

  it('dispatches wheel deltas at the pointer position', async () => {
    const fake = fakePage({ viewport: { width: 800, height: 600 } })
    const dispatcher = createPreviewInputDispatcher({ page: fake.page })

    await dispatcher.dispatch({
      kind: 'wheel',
      x: 0.5,
      y: 0.25,
      deltaX: 0,
      deltaY: 120,
      modifiers: { alt: true },
    })
    expect(fake.sent[0]).toEqual({
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseWheel',
        x: 400,
        y: 150,
        deltaX: 0,
        deltaY: 120,
        button: 'none',
        buttons: 0,
        modifiers: 1,
      },
    })
    await dispatcher.stop()
  })

  it('sends printable keys as text and named keys with virtual-key codes', async () => {
    const fake = fakePage()
    const dispatcher = createPreviewInputDispatcher({ page: fake.page })

    await dispatcher.dispatch({
      kind: 'key',
      action: 'down',
      key: 'a',
      code: 'KeyA',
      text: 'a',
    })
    expect(fake.sent[0].params).toMatchObject({
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      text: 'a',
      unmodifiedText: 'a',
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 65,
      modifiers: 0,
    })

    await dispatcher.dispatch({ kind: 'key', action: 'up', key: 'a', code: 'KeyA' })
    expect(fake.sent[1].params).toMatchObject({ type: 'keyUp', key: 'a' })
    expect(fake.sent[1].params?.text).toBeUndefined()

    await dispatcher.dispatch({ kind: 'key', action: 'down', key: 'Enter' })
    expect(fake.sent[2].params).toMatchObject({ type: 'keyDown', key: 'Enter', text: '\r' })
    expect(fake.sent[2].params?.windowsVirtualKeyCode).toBe(13)

    await dispatcher.dispatch({ kind: 'key', action: 'down', key: 'Tab' })
    expect(fake.sent[3].params).toMatchObject({ type: 'keyDown', key: 'Tab' })
    expect(fake.sent[3].params?.windowsVirtualKeyCode).toBe(9)
    expect(fake.sent[3].params?.text).toBeUndefined()

    await dispatcher.dispatch({ kind: 'key', action: 'down', key: 'ArrowDown' })
    expect(fake.sent[4].params?.windowsVirtualKeyCode).toBe(40)
    await dispatcher.stop()
  })

  it('serializes concurrent dispatches behind one session', async () => {
    const fake = fakePage({ createDelayMs: 10 })
    const dispatcher = createPreviewInputDispatcher({ page: fake.page })

    await Promise.all([dispatcher.dispatch(pointerDown), dispatcher.dispatch(pointerUp)])

    expect(fake.createCalls).toBe(1)
    expect(fake.sent.map((entry) => entry.params?.type)).toEqual([
      'mousePressed',
      'mouseReleased',
    ])
    await dispatcher.stop()
    expect(fake.detachCalls).toBe(1)
  })

  it('detaches its CDP session on stop and rejects later input', async () => {
    const fake = fakePage()
    const dispatcher = createPreviewInputDispatcher({ page: fake.page })

    await dispatcher.dispatch(pointerDown)
    expect(dispatcher.active).toBe(true)

    await dispatcher.stop()
    expect(dispatcher.active).toBe(false)
    expect(fake.detachCalls).toBe(1)

    await expect(dispatcher.dispatch(pointerUp)).rejects.toMatchObject({
      code: 'target_unavailable',
      details: { reason: 'stopped' },
    })
    await dispatcher.stop()
    expect(fake.detachCalls).toBe(1)
  })

  it('reports target_unavailable when the page has no viewport', async () => {
    const fake = fakePage({ viewport: null })
    const dispatcher = createPreviewInputDispatcher({ page: fake.page })

    await expect(dispatcher.dispatch(pointerDown)).rejects.toMatchObject({
      code: 'target_unavailable',
      details: { reason: 'no_viewport' },
    })
    expect(fake.createCalls).toBe(0)
    await dispatcher.stop()
  })
})

describe('input mapping helpers', () => {
  it('clamps fractions to the viewport', () => {
    expect(mapPoint(0, 0, { width: 1280, height: 720 })).toEqual({ x: 0, y: 0 })
    expect(mapPoint(1, 1, { width: 1280, height: 720 })).toEqual({ x: 1279, y: 719 })
    expect(mapPoint(-1, 2, { width: 1280, height: 720 })).toEqual({ x: 0, y: 719 })
    expect(mapPoint(Number.NaN, 0.5, { width: 1280, height: 720 })).toEqual({ x: 0, y: 360 })
  })

  it('builds the CDP modifier bitmask', () => {
    expect(modifierMask()).toBe(0)
    expect(modifierMask({ alt: true })).toBe(1)
    expect(modifierMask({ ctrl: true })).toBe(2)
    expect(modifierMask({ meta: true })).toBe(4)
    expect(modifierMask({ shift: true })).toBe(8)
    expect(modifierMask({ alt: true, ctrl: true, meta: true, shift: true })).toBe(15)
  })
})
