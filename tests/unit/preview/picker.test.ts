/**
 * Host picker (T027): the CDP handshake, payload validation and teardown order.
 * The page-side behaviour (overlay, hover, click, Esc) is covered by the jsdom
 * page-script test and the real-Edge integration test.
 */
import { describe, expect, it } from 'vitest'
import { utf8Bytes } from '../../../src/contracts/budget'
import {
  buildPickerScript,
  createPreviewPicker,
  normalizePickedElement,
  PICK_BINDING_NAME,
} from '../../../src/host/inspect/inject'
import type { ScreencastPageLike } from '../../../src/host/targets/types'

interface Sent {
  readonly method: string
  readonly params?: Record<string, unknown>
}

function fakePage(options: { evaluateValue?: unknown; failOn?: string } = {}) {
  const listeners = new Map<string, Set<(params: unknown) => void>>()
  const sent: Sent[] = []
  let detached = false
  let evaluateValue: unknown = options.evaluateValue ?? true

  const session = {
    async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
      sent.push({ method, params })
      if (options.failOn === method) throw new Error(`cdp refused ${method}`)
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'script-1' }
      if (method === 'Runtime.evaluate') return { result: { value: evaluateValue } }
      return {}
    },
    on(event: string, listener: (params: unknown) => void): void {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
    },
    off(event: string, listener: (params: unknown) => void): void {
      listeners.get(event)?.delete(listener)
    },
    async detach(): Promise<void> {
      detached = true
    },
  }

  const page: ScreencastPageLike = {
    viewport: () => ({ width: 800, height: 600 }),
    async createCdpSession() {
      return session
    },
  }

  return {
    page,
    sent,
    methods: () => sent.map((entry) => entry.method),
    get detached() {
      return detached
    },
    listenerCount: () => listeners.get('Runtime.bindingCalled')?.size ?? 0,
    emit(payload: unknown): void {
      const params = { name: PICK_BINDING_NAME, payload }
      for (const listener of listeners.get('Runtime.bindingCalled') ?? []) listener(params)
    },
    setEvaluateValue(value: unknown): void {
      evaluateValue = value
    },
  }
}

function pickPayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    kind: 'pick',
    selector: '#save',
    unique: true,
    tag: 'BUTTON',
    id: 'save',
    classes: ['primary', 'large'],
    box: { x: 10, y: 20, width: 100, height: 32 },
    ...overrides,
  })
}

describe('buildPickerScript', () => {
  it('composes both functions so the page has no module references', () => {
    const script = buildPickerScript({ binding: '__vibePick', overlayId: '__vibe-picker-host' })
    expect(script).toContain('function buildSelector')
    expect(script).toContain('function extractDomContext')
    expect(script).toContain('function describeAccessibility')
    expect(script).toContain('function installVibePicker')
    expect(script).toContain('__vibeDom')
    expect(script).toContain('__vibeAccess')
    expect(script).toContain('"binding":"__vibePick"')
    expect(script).not.toContain('__name(')
    expect(script).not.toMatch(/\bimport\b/)
  })
})

describe('normalizePickedElement', () => {
  it('fills absent context fields with safe defaults', () => {
    const element = normalizePickedElement(JSON.parse(pickPayload()))
    expect(element).toEqual({
      selector: '#save',
      unique: true,
      tag: 'button',
      id: 'save',
      classes: ['primary', 'large'],
      role: null,
      name: '',
      text: '',
      html: '',
      visible: false,
      box: { x: 10, y: 20, width: 100, height: 32 },
      source: null,
    })
  })

  it('keeps the T028 context fields the page extracted', () => {
    const element = normalizePickedElement(
      JSON.parse(
        pickPayload({
          role: 'button',
          name: 'Save',
          text: 'Save',
          html: '<button>Save</button>',
          visible: true,
        }),
      ),
    )
    expect(element).toMatchObject({
      role: 'button',
      name: 'Save',
      text: 'Save',
      html: '<button>Save</button>',
      visible: true,
    })
  })

  it('rejects payloads without a selector or tag and bounds the rest', () => {
    expect(normalizePickedElement({ tag: 'div' })).toBeNull()
    expect(normalizePickedElement({ selector: '#a' })).toBeNull()
    expect(normalizePickedElement({ selector: '  ', tag: 'div' })).toBeNull()

    const bounded = normalizePickedElement({
      selector: 'a'.repeat(900),
      tag: 'DIV',
      id: 7,
      classes: ['ok', 42, 'x'.repeat(200), ...Array.from({ length: 12 }, (_, i) => `c${i}`)],
      unique: 'yes',
      box: { x: Number.NaN, y: 1e9, width: -5, height: '2' },
      role: 'BUTTON primary',
      name: '  Save   changes  ',
      text: 'S'.repeat(400),
      html: '<div>'.repeat(1000),
      visible: 'yes',
    })
    expect(bounded).not.toBeNull()
    expect(bounded!.selector).toHaveLength(512)
    expect(bounded!.unique).toBe(false)
    expect(bounded!.id).toBeNull()
    expect(bounded!.classes).toHaveLength(8)
    expect(bounded!.classes[1]).toBe('x'.repeat(64))
    expect(bounded!.box).toEqual({ x: 0, y: 1_000_000, width: 0, height: 0 })
    expect(bounded!.role).toBe('button')
    expect(bounded!.name).toBe('Save changes')
    expect(Array.from(bounded!.text)).toHaveLength(200)
    expect(utf8Bytes(bounded!.html)).toBeLessThanOrEqual(2048)
    expect(bounded!.visible).toBe(false)
  })
})

describe('createPreviewPicker', () => {
  it('installs the binding and script once, in order', async () => {
    const fake = fakePage()
    const picker = createPreviewPicker({ page: fake.page })

    await picker.install()
    await picker.install()

    expect(fake.methods()).toEqual([
      'Runtime.enable',
      'Runtime.addBinding',
      'Page.addScriptToEvaluateOnNewDocument',
      'Runtime.evaluate',
    ])
    expect(fake.sent[0]!.params).toBeUndefined()
    expect(fake.sent[1]!.params).toEqual({ name: PICK_BINDING_NAME })
    const script = String(fake.sent[2]!.params!.source)
    expect(script).toContain('__vibeInstall')
    expect(script).toContain('__vibe-picker-host')
    expect(fake.listenerCount()).toBe(1)
  })

  it('rejects install when the page cannot host the script, and detaches', async () => {
    const fake = fakePage({ evaluateValue: false })
    const picker = createPreviewPicker({ page: fake.page })
    await expect(picker.install()).rejects.toMatchObject({ code: 'unsupported' })
    expect(fake.detached).toBe(true)
    expect(fake.listenerCount()).toBe(0)
    // A second install retries instead of reporting a broken success.
    await expect(picker.install()).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('separates a repeated pick from no new event with seq', async () => {
    let clock = 100
    const fake = fakePage()
    const picker = createPreviewPicker({ page: fake.page, now: () => clock })
    await picker.install()

    fake.emit(pickPayload())
    const first = picker.snapshot()
    expect(first).toMatchObject({ active: false, seq: 1, ts: 100 })
    expect(first.pick?.selector).toBe('#save')

    clock = 200
    fake.emit(pickPayload())
    const second = picker.snapshot()
    expect(second.seq).toBe(2)
    expect(second.ts).toBe(200)
    expect(second.pick).toEqual(first.pick)
  })

  it('ignores anything the page could forge', async () => {
    const fake = fakePage()
    const picker = createPreviewPicker({ page: fake.page })
    await picker.install()

    fake.emit('not json')
    fake.emit('[]')
    fake.emit(JSON.stringify({ kind: 'hover' }))
    fake.emit(JSON.stringify({ kind: 'pick', selector: '#x' }))
    fake.emit('z'.repeat(9000))
    expect(picker.snapshot()).toMatchObject({ seq: 0, pick: null, ts: null })

    fake.emit(pickPayload())
    expect(picker.snapshot().seq).toBe(1)
  })

  it('treats cancel as a state change without dropping the last pick', async () => {
    const fake = fakePage()
    const picker = createPreviewPicker({ page: fake.page })
    await picker.install()
    await picker.activate()
    expect(picker.active).toBe(true)

    fake.emit(pickPayload())
    fake.emit(JSON.stringify({ kind: 'cancel' }))

    const state = picker.snapshot()
    expect(state).toMatchObject({ active: false, seq: 2 })
    expect(state.pick?.selector).toBe('#save')
  })

  it('wraps Esc cancel and navigation reset around the page overlay', async () => {
    const fake = fakePage()
    const picker = createPreviewPicker({ page: fake.page })
    await picker.install()
    await picker.activate()

    // The page reports esc itself; reset() covers a document swap.
    picker.reset()
    expect(picker.active).toBe(false)

    await picker.deactivate()
    const evaluations = fake.sent.filter((entry) => entry.method === 'Runtime.evaluate')
    expect(String(evaluations.at(-1)!.params!.expression)).toContain('p.stop()')
  })

  it('disposes in reverse order and stays idempotent', async () => {
    const fake = fakePage()
    const picker = createPreviewPicker({ page: fake.page })
    await picker.install()
    await picker.activate()

    await picker.dispose()
    expect(fake.methods().slice(-3)).toEqual([
      'Runtime.evaluate',
      'Page.removeScriptToEvaluateOnNewDocument',
      'Runtime.removeBinding',
    ])
    expect(String(fake.sent.at(-2)!.params!.identifier)).toBe('script-1')
    expect(fake.detached).toBe(true)
    expect(fake.listenerCount()).toBe(0)

    const before = fake.sent.length
    await picker.dispose()
    expect(fake.sent).toHaveLength(before)
  })

  it('rejects activation before a successful install', async () => {
    const fake = fakePage()
    const picker = createPreviewPicker({ page: fake.page })
    await expect(picker.activate()).rejects.toMatchObject({ code: 'unsupported' })
    await picker.deactivate()
  })
})
