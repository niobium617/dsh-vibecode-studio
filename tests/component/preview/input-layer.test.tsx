// @vitest-environment jsdom
import { createRef, useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { PreviewInputEvent } from '../../../src/contracts/transport'
import {
  InputForwarder,
  InputLayer,
  normalizePoint,
  normalizeWheelDelta,
  textForKey,
  type InputSender,
} from '../../../src/client/preview/InputLayer'

function Harness({ send }: { send: InputSender }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  return (
    <div>
      <canvas ref={canvasRef} width={1280} height={720} />
      <InputLayer canvasRef={canvasRef} send={send} />
    </div>
  )
}

const RECT = {
  left: 100,
  top: 50,
  width: 1280,
  height: 720,
  right: 1380,
  bottom: 770,
  x: 100,
  y: 50,
  toJSON: () => ({}),
} as DOMRect

function setup() {
  const send = vi.fn(async (_event: PreviewInputEvent) => ({}))
  const view = render(<Harness send={send as InputSender} />)
  const canvas = view.container.querySelector('canvas')
  const layer = view.container.querySelector('[data-vibe-input="1"]')
  if (!canvas || !layer) throw new Error('input layer did not render')
  const textarea = layer.querySelector('textarea[data-vibe-ime="1"]')
  if (!textarea) throw new Error('composition textarea did not render')
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(RECT)
  return { send, layer: layer as HTMLElement, textarea: textarea as HTMLTextAreaElement }
}

function sentEvents(send: ReturnType<typeof vi.fn>): PreviewInputEvent[] {
  return send.mock.calls.map((call) => call[0] as PreviewInputEvent)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('InputLayer', () => {
  it('maps clicks through the canvas rect and forwards press/release', async () => {
    const { send, layer } = setup()

    fireEvent.pointerDown(layer, { clientX: 740, clientY: 410, button: 0, pointerId: 1 })
    fireEvent.pointerUp(layer, { clientX: 740, clientY: 410, button: 0, pointerId: 1 })

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    const [down, up] = sentEvents(send)
    expect(down).toMatchObject({
      kind: 'pointer',
      action: 'down',
      x: 0.5,
      y: 0.5,
      button: 'left',
    })
    expect(up).toMatchObject({ kind: 'pointer', action: 'up', x: 0.5, y: 0.5 })
  })

  it('forwards wheel events with pixel deltas and prevents panel scroll', async () => {
    const { send, layer } = setup()

    const wheel = new WheelEvent('wheel', {
      clientX: 740,
      clientY: 410,
      deltaX: 0,
      deltaY: 120,
      deltaMode: 0,
      bubbles: true,
      cancelable: true,
    })
    layer.dispatchEvent(wheel)

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(wheel.defaultPrevented).toBe(true)
    expect(sentEvents(send)[0]).toMatchObject({
      kind: 'wheel',
      x: 0.5,
      y: 0.5,
      deltaX: 0,
      deltaY: 120,
    })
  })

  it('forwards printable keys with text and named keys without', async () => {
    const { send, layer } = setup()

    fireEvent.keyDown(layer, { key: 'a', code: 'KeyA' })
    fireEvent.keyUp(layer, { key: 'a', code: 'KeyA' })
    fireEvent.keyDown(layer, { key: 'Enter', code: 'Enter' })

    await waitFor(() => expect(send).toHaveBeenCalledTimes(3))
    const [down, up, enter] = sentEvents(send)
    expect(down).toMatchObject({ kind: 'key', action: 'down', key: 'a', code: 'KeyA', text: 'a' })
    expect(up).toMatchObject({ kind: 'key', action: 'up', key: 'a' })
    expect(up).not.toHaveProperty('text')
    expect(enter).toMatchObject({ kind: 'key', action: 'down', key: 'Enter' })
    expect(enter).not.toHaveProperty('text')
  })

  it('does not forward keys produced by IME composition', async () => {
    const { send, layer } = setup()

    fireEvent.keyDown(layer, { key: 'Enter', code: 'Enter', isComposing: true })
    await Promise.resolve()
    expect(send).not.toHaveBeenCalled()
  })

  it('focuses the composition box on click and forwards composed text', async () => {
    const { send, layer, textarea } = setup()

    fireEvent.pointerDown(layer, { clientX: 740, clientY: 410, button: 0, pointerId: 1 })
    expect(document.activeElement).toBe(textarea)

    fireEvent.compositionStart(textarea)
    fireEvent.compositionUpdate(textarea, { data: '你好' })
    fireEvent.compositionEnd(textarea, { data: '你好，世界' })

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    expect(sentEvents(send).map((event) => event.kind)).toEqual(['pointer', 'text'])
    expect(sentEvents(send)[1]).toEqual({ kind: 'text', text: '你好，世界' })
  })

  it('lets the composition box handle paste instead of forwarding Ctrl+V', async () => {
    const { send, textarea } = setup()

    const notPrevented = fireEvent.keyDown(textarea, { key: 'v', ctrlKey: true })
    expect(notPrevented).toBe(true)
    expect(send).not.toHaveBeenCalled()

    fireEvent.paste(textarea, { clipboardData: { getData: () => '你好' } })
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  })

  it('shows the IME limitation hint when composed text cannot be sent', async () => {
    const send = vi.fn(async (event: PreviewInputEvent) => {
      if (event.kind === 'text') throw new Error('rejected')
      return {}
    })
    const canvasRef = createRef<HTMLCanvasElement>()
    const view = render(
      <div>
        <canvas ref={canvasRef} />
        <InputLayer canvasRef={canvasRef} send={send as InputSender} />
      </div>,
    )
    const textarea = view.container.querySelector(
      'textarea[data-vibe-ime="1"]',
    ) as HTMLTextAreaElement

    fireEvent.compositionStart(textarea)
    fireEvent.compositionEnd(textarea, { data: '你好，世界' })

    const notice = await waitFor(() => {
      const node = view.container.querySelector('[data-vibe-ime-notice="1"]')
      if (!node) throw new Error('no notice yet')
      return node
    })
    expect(notice.textContent).toContain('input method text did not reach the target')
    expect(view.container.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('InputForwarder', () => {
  it('keeps order and coalesces queued pointer moves', async () => {
    const sent: PreviewInputEvent[] = []
    const resolvers: (() => void)[] = []
    const forwarder = new InputForwarder(
      (event) =>
        new Promise<void>((resolve) => {
          sent.push(event)
          resolvers.push(resolve)
        }),
    )

    forwarder.push({ kind: 'pointer', action: 'move', x: 0.1, y: 0.1 })
    forwarder.push({ kind: 'pointer', action: 'move', x: 0.2, y: 0.2 })
    forwarder.push({ kind: 'pointer', action: 'move', x: 0.3, y: 0.3 })
    forwarder.push({ kind: 'pointer', action: 'down', x: 0.3, y: 0.3 })

    for (let step = 0; step < 10; step += 1) {
      await Promise.resolve()
      resolvers.shift()?.()
    }

    expect(sent).toHaveLength(3)
    expect(sent.map((event) => (event.kind === 'pointer' ? event.x : null))).toEqual([
      0.1, 0.3, 0.3,
    ])
    expect(sent[2].kind === 'pointer' ? sent[2].action : null).toBe('down')
    forwarder.dispose()
    forwarder.push({ kind: 'key', action: 'down', key: 'a' })
    expect(sent).toHaveLength(3)
  })

  it('reports send failures without dropping later events', async () => {
    const errors: unknown[] = []
    const sent: PreviewInputEvent[] = []
    const forwarder = new InputForwarder(
      async (event) => {
        sent.push(event)
        if (event.kind === 'key') throw new Error('offline')
      },
      (error) => errors.push(error),
    )

    forwarder.push({ kind: 'key', action: 'down', key: 'a' })
    forwarder.push({ kind: 'pointer', action: 'down', x: 0.5, y: 0.5 })
    for (let step = 0; step < 10; step += 1) await Promise.resolve()

    expect(sent.map((event) => event.kind)).toEqual(['key', 'pointer'])
    expect(errors).toHaveLength(1)
    forwarder.dispose()
  })
})

describe('input normalization helpers', () => {
  it('maps and clamps points against the canvas rect', () => {
    expect(normalizePoint(100, 50, RECT)).toEqual({ x: 0, y: 0 })
    expect(normalizePoint(740, 410, RECT)).toEqual({ x: 0.5, y: 0.5 })
    expect(normalizePoint(0, 0, RECT)).toEqual({ x: 0, y: 0 })
    expect(normalizePoint(2000, 2000, RECT)).toEqual({ x: 1, y: 1 })
    expect(normalizePoint(10, 10, { ...RECT, width: 0 })).toBeNull()
  })

  it('converts line/page wheel deltas to bounded pixels', () => {
    expect(normalizeWheelDelta(120, 0, 720)).toBe(120)
    expect(normalizeWheelDelta(3, 1, 720)).toBe(48)
    expect(normalizeWheelDelta(1, 2, 720)).toBe(720)
    expect(normalizeWheelDelta(5000, 0, 720)).toBe(2000)
    expect(normalizeWheelDelta(Number.NaN, 0, 720)).toBe(0)
  })

  it('only treats plain printable keys as text', () => {
    expect(textForKey({ key: 'a', ctrlKey: false, metaKey: false })).toBe('a')
    expect(textForKey({ key: 'a', ctrlKey: true, metaKey: false })).toBeUndefined()
    expect(textForKey({ key: 'a', ctrlKey: false, metaKey: true })).toBeUndefined()
    expect(textForKey({ key: 'Enter', ctrlKey: false, metaKey: false })).toBeUndefined()
  })
})
