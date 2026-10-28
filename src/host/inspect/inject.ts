/**
 * Preview picker injection (T027).
 *
 * The picker lives in the target page, not in the panel: a small script is
 * installed through CDP (`Page.addScriptToEvaluateOnNewDocument` for future
 * documents plus `Runtime.evaluate` for the current one), draws an open
 * Shadow DOM overlay, and reports picks back through a `Runtime.addBinding`
 * binding. The panel never holds a page DOM reference.
 *
 * The script is serialized with `Function.prototype.toString()`, so every
 * function it is built from must stay self-contained (no imports, no module
 * helpers). `buildPickerScript` refuses a build where esbuild's `keepNames`
 * helper leaked into the source, because that would throw inside the page.
 */
import { studioError } from '../../contracts/errors'
import type { ElementBox, ElementContext } from '../../contracts/inspect'
import type { PickSnapshot } from '../../contracts/transport'
import type { ScreencastPageLike, ScreencastSessionLike } from '../targets/types'
import { ARIA_ROLES, describeAccessibility, normalizeAccessibility } from './accessibility'
import {
  extractDomContext,
  normalizeDomSnippet,
  normalizeElementText,
  normalizeVisibility,
} from './dom'
import { buildSelector } from './selector'

export const PICK_BINDING_NAME = '__vibePick'
export const PICK_OVERLAY_ID = '__vibe-picker-host'
/** A page can call the binding itself; bound what the Host will parse. */
const MAX_BINDING_PAYLOAD_BYTES = 8 * 1024
const MAX_SELECTOR_CHARS = 512
const MAX_ID_CHARS = 256
const MAX_TAG_CHARS = 64
const MAX_CLASSES = 8
const MAX_CLASS_CHARS = 64
const MAX_BOX_COORDINATE = 1_000_000

export interface PickerPageConfig {
  readonly binding: string
  readonly overlayId: string
}

type PageSelect = (element: Element) => { selector: string; unique: boolean }
type PageDom = (element: Element) => { html: string; text: string; visible: boolean }
type PageAccess = (element: Element) => { role: string | null; name: string }

/**
 * Runs inside the target page. Must stay self-contained: it is serialized and
 * evaluated there, and it only sees `config` plus the three extractors the
 * Host passes in (selector, DOM context, accessibility).
 */
export function installVibePicker(
  config: PickerPageConfig,
  select: PageSelect,
  domOf: PageDom,
  accessOf: PageAccess,
): boolean {
  // Only the main frame drives the overlay. Without this guard the script
  // (installed in every frame by addScriptToEvaluateOnNewDocument) would also
  // answer Alt+Click inside iframes with iframe-relative boxes.
  if (window.top && window.top !== window) return false

  const win = window as unknown as Record<string, unknown>
  const previous = win.__vibePicker as { dispose?: () => void; stop?: () => void } | undefined
  if (previous) {
    try {
      // Remove the old listeners too; otherwise Alt+Click would be reported
      // twice after a re-install in the same document.
      if (typeof previous.dispose === 'function') previous.dispose()
      else if (typeof previous.stop === 'function') previous.stop()
    } catch {
      // A half-torn-down picker must not block a fresh install.
    }
  }

  let active = false
  let host: HTMLDivElement | null = null
  let boxEl: HTMLDivElement | null = null
  let labelEl: HTMLDivElement | null = null

  function report(payload: Record<string, unknown>): void {
    const send = win[config.binding]
    if (typeof send !== 'function') return
    try {
      ;(send as (text: string) => void)(JSON.stringify(payload))
    } catch {
      // The binding is gone (navigation or detachment); the Host re-arms on
      // the next document through addScriptToEvaluateOnNewDocument.
    }
  }

  function ensureOverlay(): void {
    if (host) return
    const created = document.createElement('div')
    created.id = config.overlayId
    // `all: initial` plus an inline z-index keeps page CSS from moving it.
    created.style.cssText =
      'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;'
    const shadow = created.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = [
      '.box{position:fixed;box-sizing:border-box;border:2px solid #3b82f6;',
      'background:rgba(59,130,246,.12);border-radius:2px;display:none}',
      '.label{position:fixed;box-sizing:border-box;max-width:360px;padding:2px 6px;',
      'border-radius:4px;background:#111827;color:#f9fafb;',
      'font:12px/1.4 system-ui,sans-serif;white-space:nowrap;overflow:hidden;',
      'text-overflow:ellipsis;display:none}',
    ].join('')
    const box = document.createElement('div')
    box.className = 'box'
    const label = document.createElement('div')
    label.className = 'label'
    shadow.append(style, box, label)
    document.documentElement.appendChild(created)
    host = created
    boxEl = box
    labelEl = label
  }

  function hideOverlay(): void {
    if (boxEl) boxEl.style.display = 'none'
    if (labelEl) labelEl.style.display = 'none'
  }

  function destroyOverlay(): void {
    if (host && host.parentNode) host.parentNode.removeChild(host)
    host = null
    boxEl = null
    labelEl = null
  }

  function deepElementFromPoint(x: number, y: number): Element | null {
    let found = document.elementFromPoint(x, y)
    while (found && found.shadowRoot) {
      const inner = found.shadowRoot.elementFromPoint(x, y)
      if (!inner || inner === found) break
      found = inner
    }
    return found
  }

  function boxOf(element: Element): ElementBox {
    const rect = element.getBoundingClientRect()
    return {
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }
  }

  function describe(element: Element): string {
    const tag = element.tagName.toLowerCase()
    if (element.id) return `${tag}#${element.id}`.slice(0, 80)
    const firstClass = element.classList.length > 0 ? `.${element.classList[0]}` : ''
    return `${tag}${firstClass}`.slice(0, 80)
  }

  function draw(element: Element): void {
    if (!boxEl || !labelEl) return
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 && rect.height <= 0) {
      hideOverlay()
      return
    }
    boxEl.style.display = 'block'
    boxEl.style.left = `${rect.left}px`
    boxEl.style.top = `${rect.top}px`
    boxEl.style.width = `${rect.width}px`
    boxEl.style.height = `${rect.height}px`
    labelEl.textContent = describe(element)
    labelEl.style.display = 'block'
    const labelTop = rect.top > 22 ? rect.top - 22 : rect.bottom + 4
    labelEl.style.left = `${Math.max(4, rect.left)}px`
    labelEl.style.top = `${labelTop}px`
  }

  function swallow(event: Event): void {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
  }

  function onPointerMove(event: PointerEvent): void {
    if (!active) return
    const found = deepElementFromPoint(event.clientX, event.clientY)
    if (!found || found === document.documentElement) {
      hideOverlay()
      return
    }
    draw(found)
  }

  /** Press events are swallowed whenever the picker or the Alt shortcut owns them. */
  function onPress(event: Event): void {
    const alt = (event as MouseEvent).altKey === true
    if (!active && !alt) return
    swallow(event)
  }

  function onClick(event: MouseEvent): void {
    if (!active && !event.altKey) return
    swallow(event)
    if (host && event.composedPath().indexOf(host) >= 0) return
    let target: Element | null = null
    const path = event.composedPath()
    for (const entry of path) {
      if (entry instanceof Element) {
        target = entry
        break
      }
    }
    if (!target) target = deepElementFromPoint(event.clientX, event.clientY)
    if (!target || target === document.documentElement) return
    const result = select(target)
    const classes: string[] = []
    for (const className of Array.from(target.classList)) {
      if (classes.length >= 8) break
      classes.push(className)
    }
    // Extraction is best-effort: a page object that throws on innerText or
    // getComputedStyle must still produce a pick with the selector and box.
    let html = ''
    let text = ''
    let visible = false
    let role: string | null = null
    let name = ''
    try {
      const dom = domOf(target)
      html = dom.html
      text = dom.text
      visible = dom.visible === true
    } catch {
      // Keep the empty defaults.
    }
    try {
      const access = accessOf(target)
      role = access.role
      name = access.name
    } catch {
      // Keep the empty defaults.
    }
    report({
      kind: 'pick',
      alt: event.altKey === true,
      selector: result.selector,
      unique: result.unique === true,
      tag: target.tagName.toLowerCase(),
      id: target.id || null,
      classes,
      box: boxOf(target),
      html: typeof html === 'string' ? html : '',
      text: typeof text === 'string' ? text : '',
      visible,
      role: typeof role === 'string' ? role : null,
      name: typeof name === 'string' ? name : '',
    })
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!active || event.key !== 'Escape') return
    swallow(event)
    api.stop()
    report({ kind: 'cancel' })
  }

  const PRESS_EVENTS = [
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'dblclick',
    'auxclick',
    'contextmenu',
  ]

  for (const name of PRESS_EVENTS) window.addEventListener(name, onPress, true)
  window.addEventListener('click', onClick, true)
  window.addEventListener('pointermove', onPointerMove, true)
  window.addEventListener('keydown', onKeyDown, true)

  function dispose(): void {
    active = false
    for (const name of PRESS_EVENTS) window.removeEventListener(name, onPress, true)
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('pointermove', onPointerMove, true)
    window.removeEventListener('keydown', onKeyDown, true)
    destroyOverlay()
  }

  const api = {
    version: 1,
    start(): void {
      if (active) return
      active = true
      ensureOverlay()
    },
    stop(): void {
      active = false
      destroyOverlay()
    },
    isActive(): boolean {
      return active
    },
    dispose,
  }
  win.__vibePicker = api
  return true
}

/**
 * The exact expression evaluated in the page. Both functions are composed by
 * source so the selector logic has one implementation for unit tests and the
 * page.
 */
export function buildPickerScript(config: PickerPageConfig): string {
  const selectSource = buildSelector.toString()
  const domSource = extractDomContext.toString()
  const accessSource = describeAccessibility.toString()
  const installSource = installVibePicker.toString()
  const combined = `${selectSource}\n${domSource}\n${accessSource}\n${installSource}`
  // esbuild's keepNames helper is not defined in the page; fail loudly here
  // instead of throwing inside the target.
  if (/(?:^|[^.\w$])__name\s*\(/.test(combined)) {
    throw studioError('preview_failed', 'vibe-studio: the picker script was built with keepNames')
  }
  return [
    '(function(){',
    `var __vibeSelect = ${selectSource};`,
    `var __vibeDom = ${domSource};`,
    `var __vibeAccess = ${accessSource};`,
    `var __vibeRoles = ${JSON.stringify(ARIA_ROLES)};`,
    'var __vibeAccessFor = function (element) { return __vibeAccess(element, __vibeRoles); };',
    `var __vibeInstall = ${installSource};`,
    `return __vibeInstall(${JSON.stringify(config)}, __vibeSelect, __vibeDom, __vibeAccessFor);`,
    '})()',
  ].join('\n')
}

export interface PreviewPicker {
  /** Creates the CDP session, binding and script; idempotent. */
  install(): Promise<void>
  /** Turns the overlay on; rejects when the page refused the script. */
  activate(): Promise<void>
  deactivate(): Promise<void>
  /** Forgets the active flag after a navigation installed a fresh, idle script. */
  reset(): void
  snapshot(): PickSnapshot
  /** Removes the script/binding, detaches the session; idempotent. */
  dispose(): Promise<void>
  readonly active: boolean
}

export interface PreviewPickerOptions {
  readonly page: ScreencastPageLike
  readonly bindingName?: string
  readonly overlayId?: string
  readonly now?: () => number
  readonly maxPayloadBytes?: number
}

interface EvaluateResult {
  readonly result?: { readonly value?: unknown }
  readonly exceptionDetails?: unknown
}

const START_EXPRESSION =
  '(function(){var p=window.__vibePicker;' +
  'if(!p||typeof p.start!=="function")return false;' +
  'p.start();return p.isActive()===true})()'

const STOP_EXPRESSION =
  '(function(){var p=window.__vibePicker;' +
  'if(p&&typeof p.stop==="function")p.stop();return true})()'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function clampCoordinate(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.round(Math.min(MAX_BOX_COORDINATE, Math.max(-MAX_BOX_COORDINATE, value)))
}

function shortString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed.slice(0, max)
}

/**
 * The page is untrusted: even our own binding can be called by page script, so
 * every field is re-validated and bounded here. `source` is a placeholder until
 * T029 fills it.
 */
export function normalizePickedElement(value: Record<string, unknown>): ElementContext | null {
  const selector = shortString(value.selector, MAX_SELECTOR_CHARS)
  const tag = shortString(value.tag, MAX_TAG_CHARS)
  if (!selector || !tag) return null
  const id = shortString(value.id, MAX_ID_CHARS)
  const classes: string[] = []
  if (Array.isArray(value.classes)) {
    for (const entry of value.classes) {
      if (classes.length >= MAX_CLASSES) break
      const className = shortString(entry, MAX_CLASS_CHARS)
      if (className) classes.push(className)
    }
  }
  const rawBox = isRecord(value.box) ? value.box : {}
  const box: ElementBox = {
    x: clampCoordinate(rawBox.x),
    y: clampCoordinate(rawBox.y),
    width: Math.max(0, clampCoordinate(rawBox.width)),
    height: Math.max(0, clampCoordinate(rawBox.height)),
  }
  const accessibility = normalizeAccessibility(value)
  return {
    selector,
    unique: value.unique === true,
    tag: tag.toLowerCase(),
    id,
    classes,
    role: accessibility.role,
    name: accessibility.name,
    text: normalizeElementText(value.text),
    html: normalizeDomSnippet(value.html),
    visible: normalizeVisibility(value.visible),
    box,
    source: null,
  }
}

export function createPreviewPicker(options: PreviewPickerOptions): PreviewPicker {
  const bindingName = options.bindingName ?? PICK_BINDING_NAME
  const overlayId = options.overlayId ?? PICK_OVERLAY_ID
  const now = options.now ?? (() => Date.now())
  const maxPayloadBytes = options.maxPayloadBytes ?? MAX_BINDING_PAYLOAD_BYTES
  const script = buildPickerScript({ binding: bindingName, overlayId })

  let session: ScreencastSessionLike | undefined
  let scriptIdentifier: string | undefined
  let bound = false
  let installed = false
  let activeNow = false
  let seq = 0
  let pick: ElementContext | null = null
  let ts: number | null = null

  function onBinding(event: unknown): void {
    if (!installed || !isRecord(event)) return
    if (event.name !== bindingName || typeof event.payload !== 'string') return
    if (event.payload.length === 0 || event.payload.length > maxPayloadBytes) return
    let parsed: unknown
    try {
      parsed = JSON.parse(event.payload)
    } catch {
      return
    }
    if (!isRecord(parsed)) return
    if (parsed.kind === 'cancel') {
      activeNow = false
      seq += 1
      ts = now()
      return
    }
    if (parsed.kind !== 'pick') return
    const next = normalizePickedElement(parsed)
    if (!next) return
    pick = next
    seq += 1
    ts = now()
  }

  async function evaluate(expression: string): Promise<boolean> {
    if (!session) return false
    try {
      const result = (await session.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: false,
      })) as EvaluateResult
      if (result && result.exceptionDetails) return false
      return result?.result?.value === true
    } catch {
      return false
    }
  }

  async function teardown(): Promise<void> {
    const current = session
    const wasBound = bound
    const identifier = scriptIdentifier
    session = undefined
    scriptIdentifier = undefined
    bound = false
    installed = false
    activeNow = false
    if (!current) return
    try {
      await current.send('Runtime.evaluate', {
        expression: STOP_EXPRESSION,
        returnByValue: true,
        awaitPromise: false,
      })
    } catch {
      // The page is already gone.
    }
    if (identifier !== undefined) {
      try {
        await current.send('Page.removeScriptToEvaluateOnNewDocument', { identifier })
      } catch {
        // The page or browser is already gone.
      }
    }
    if (wasBound) {
      try {
        await current.send('Runtime.removeBinding', { name: bindingName })
      } catch {
        // The runtime is already gone.
      }
    }
    try {
      current.off?.('Runtime.bindingCalled', onBinding)
    } catch {
      // Already removed with the session.
    }
    try {
      await current.detach()
    } catch {
      // Already detached.
    }
  }

  async function install(): Promise<void> {
    if (installed) return
    const created = await options.page.createCdpSession()
    session = created
    try {
      // bindings are delivered as `Runtime.bindingCalled` events, and CDP only
      // forwards domain events to sessions that enabled the domain.
      await created.send('Runtime.enable')
      await created.send('Runtime.addBinding', { name: bindingName })
      bound = true
      created.on('Runtime.bindingCalled', onBinding)
      const added = (await created.send('Page.addScriptToEvaluateOnNewDocument', {
        source: script,
      })) as { identifier?: unknown } | undefined
      if (added && typeof added.identifier === 'string') scriptIdentifier = added.identifier
      const result = (await created.send('Runtime.evaluate', {
        expression: script,
        returnByValue: true,
        awaitPromise: false,
      })) as EvaluateResult
      if (result && result.exceptionDetails) {
        throw studioError('preview_failed', 'vibe-studio: the picker script failed to install')
      }
      if (result?.result?.value !== true) {
        throw studioError('unsupported', 'vibe-studio: element picking is unavailable on this page', {
          capability: 'pick',
        })
      }
      installed = true
    } catch (error) {
      await teardown()
      throw error
    }
  }

  async function activate(): Promise<void> {
    if (!installed) {
      throw studioError('unsupported', 'vibe-studio: element picking is unavailable', {
        capability: 'pick',
      })
    }
    if (await evaluate(START_EXPRESSION)) {
      activeNow = true
      return
    }
    throw studioError('unsupported', 'vibe-studio: element picking is unavailable on this page', {
      capability: 'pick',
    })
  }

  async function deactivate(): Promise<void> {
    activeNow = false
    if (!installed) return
    await evaluate(STOP_EXPRESSION)
  }

  return {
    install,
    activate,
    deactivate,
    reset() {
      activeNow = false
    },
    snapshot(): PickSnapshot {
      return { active: activeNow, seq, pick, ts }
    },
    dispose: teardown,
    get active() {
      return activeNow
    },
  }
}
