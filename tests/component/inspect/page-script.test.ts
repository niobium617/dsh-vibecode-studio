// @vitest-environment jsdom
/**
 * The injected page script (T027), evaluated exactly as the Host evaluates it:
 * overlay lifecycle, hover label, click without leaking the page's own handler,
 * Alt+Click while pick mode is off, Esc cancel and the subframe guard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildPickerScript,
  PICK_BINDING_NAME,
  PICK_OVERLAY_ID,
} from '../../../src/host/inspect/inject'

type PickerWindow = Window & {
  __vibePicker?: { version: number; start(): void; stop(): void; isActive(): boolean }
  [PICK_BINDING_NAME]?: (payload: string) => void
}

const pickWindow = window as unknown as PickerWindow
const RECT = {
  left: 10,
  top: 20,
  width: 100,
  height: 30,
  right: 110,
  bottom: 50,
  x: 10,
  y: 20,
  toJSON: () => ({}),
} as DOMRect

let sent: Record<string, unknown>[]

function evaluate(): boolean {
  const source = buildPickerScript({ binding: PICK_BINDING_NAME, overlayId: PICK_OVERLAY_ID })
  return new Function(`return ${source}`)() as boolean
}

function shadowParts(): { host: HTMLElement; box: HTMLElement; label: HTMLElement } {
  const host = document.getElementById(PICK_OVERLAY_ID)
  if (!host || !host.shadowRoot) throw new Error('picker overlay host is missing')
  const box = host.shadowRoot.querySelector<HTMLElement>('.box')
  const label = host.shadowRoot.querySelector<HTMLElement>('.label')
  if (!box || !label) throw new Error('picker overlay parts are missing')
  return { host, box, label }
}

beforeEach(() => {
  sent = []
  document.body.innerHTML = ''
  pickWindow[PICK_BINDING_NAME] = (payload: string) => {
    sent.push(JSON.parse(payload) as Record<string, unknown>)
  }
  delete pickWindow.__vibePicker
})

afterEach(() => {
  pickWindow.__vibePicker?.stop()
  delete pickWindow.__vibePicker
  delete pickWindow[PICK_BINDING_NAME]
  Reflect.deleteProperty(document, 'elementFromPoint')
  vi.restoreAllMocks()
})

function buttonFixture(): HTMLButtonElement {
  document.body.innerHTML = '<button data-testid="save" class="primary">Save</button>'
  const button = document.querySelector('button')!
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(RECT)
  // jsdom has no layout engine, so hit testing is stubbed for the overlay.
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => button,
  })
  return button
}

describe('installVibePicker', () => {
  it('installs inactive and only draws the overlay while active', () => {
    const button = buttonFixture()
    expect(evaluate()).toBe(true)
    expect(pickWindow.__vibePicker?.version).toBe(1)
    expect(pickWindow.__vibePicker?.isActive()).toBe(false)
    expect(document.getElementById(PICK_OVERLAY_ID)).toBeNull()

    pickWindow.__vibePicker!.start()
    const { box, label } = shadowParts()
    expect(pickWindow.__vibePicker!.isActive()).toBe(true)
    // The hidden default comes from the shadow stylesheet; jsdom does not
    // compute it, but drawing always sets the inline style explicitly.
    expect(box.style.display).toBe('')

    document.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 20, clientY: 30 }))
    expect(box.style.display).toBe('block')
    expect(box.style.left).toBe('10px')
    expect(box.style.top).toBe('20px')
    expect(box.style.width).toBe('100px')
    expect(label.style.display).toBe('block')
    expect(label.textContent).toBe('button.primary')
    expect(button).toBeTruthy()
  })

  it('reports a pick and never reaches the page click handler', () => {
    const button = buttonFixture()
    evaluate()
    const pageClick = vi.fn()
    button.addEventListener('click', pageClick)
    pickWindow.__vibePicker!.start()

    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }))

    expect(pageClick).not.toHaveBeenCalled()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual({
      kind: 'pick',
      alt: false,
      selector: '[data-testid="save"]',
      unique: true,
      tag: 'button',
      id: null,
      classes: ['primary'],
      box: { x: 10, y: 20, width: 100, height: 30 },
      html: '<button data-testid="save" class="primary">Save</button>',
      text: 'Save',
      visible: true,
      role: 'button',
      name: 'Save',
      source: null,
    })
  })

  it('extracts framework source through the composed adapters', () => {
    // The adapters are serialized into the same script; React's dev-server
    // attributes are the primary path and must reach the payload.
    document.body.innerHTML =
      '<div data-inspector-relative-path="src/App.jsx" data-inspector-line="9" data-inspector-column="2">' +
      '<button data-testid="save">Save</button></div>'
    evaluate()
    pickWindow.__vibePicker!.start()
    document
      .querySelector('button')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      kind: 'pick',
      source: {
        framework: 'react',
        via: 'data-inspector',
        file: 'src/App.jsx',
        line: 9,
        column: 2,
      },
    })
  })

  it('generates class-based selectors inside the page without module helpers', () => {
    // A standalone function serialized into the page cannot see module
    // constants; this element forces the class tier of the selector.
    document.body.innerHTML = '<div id="wrap"><button class="solo">S</button></div>'
    evaluate()
    const button = document.querySelector('button')!
    pickWindow.__vibePicker!.start()
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(sent[0]).toMatchObject({ kind: 'pick', selector: 'button.solo', unique: true })
  })

  it('lets normal clicks through when pick mode is off', () => {
    const button = buttonFixture()
    evaluate()
    const pageClick = vi.fn()
    button.addEventListener('click', pageClick)

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(pageClick).toHaveBeenCalledTimes(1)
    expect(sent).toHaveLength(0)
  })

  it('picks on Alt+Click even while pick mode is off, and still swallows it', () => {
    const button = buttonFixture()
    evaluate()
    const pageClick = vi.fn()
    const pageDown = vi.fn()
    button.addEventListener('click', pageClick)
    button.addEventListener('pointerdown', pageDown)

    button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, altKey: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }))

    expect(pageDown).not.toHaveBeenCalled()
    expect(pageClick).not.toHaveBeenCalled()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ kind: 'pick', alt: true, selector: '[data-testid="save"]' })
    expect(pickWindow.__vibePicker!.isActive()).toBe(false)
  })

  it('cancels on Esc, reports a reason and removes the overlay', () => {
    buttonFixture()
    evaluate()
    pickWindow.__vibePicker!.start()
    shadowParts()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(sent).toEqual([{ kind: 'cancel' }])
    expect(pickWindow.__vibePicker!.isActive()).toBe(false)
    expect(document.getElementById(PICK_OVERLAY_ID)).toBeNull()
  })

  it('replaces a previous instance instead of stacking overlays', () => {
    buttonFixture()
    evaluate()
    pickWindow.__vibePicker!.start()
    expect(document.querySelectorAll(`#${PICK_OVERLAY_ID}`)).toHaveLength(1)

    evaluate()
    expect(document.getElementById(PICK_OVERLAY_ID)).toBeNull()
    expect(pickWindow.__vibePicker!.isActive()).toBe(false)
    pickWindow.__vibePicker!.start()
    expect(document.querySelectorAll(`#${PICK_OVERLAY_ID}`)).toHaveLength(1)
  })

  it('refuses to install itself in a subframe', () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const child = frame.contentWindow as unknown as {
      eval: (source: string) => unknown
      document: Document
    }
    const source = buildPickerScript({ binding: PICK_BINDING_NAME, overlayId: PICK_OVERLAY_ID })
    if (typeof child.eval !== 'function') return
    expect(child.eval(source)).toBe(false)
    expect(child.document.getElementById(PICK_OVERLAY_ID)).toBeNull()
  })
})
