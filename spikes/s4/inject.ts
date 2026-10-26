/**
 * S4 picker overlay. Bundled to an IIFE and injected into the page.
 * Lives in an open Shadow DOM so fixture styles cannot affect it.
 * While active it intercepts pointer events in the capture phase, so the
 * page's own click/submit handlers never run.
 */

type SourceInfo = {
  framework: string
  via: string
  file: string
  line: number | null
  column: number | null
}

type PickResult = {
  selector: string
  unique: boolean
  tag: string
  id: string | null
  classes: string[]
  text: string
  role: string | null
  box: { x: number; y: number; width: number; height: number }
  html: string
  source: SourceInfo | null
}

type PickerApi = {
  start: () => void
  stop: () => void
  isActive: () => boolean
  getLastPick: () => PickResult | null
}

type VibeWindow = Window & {
  __vibePicker?: PickerApi
  __clicks?: number
  __lastClick?: string
}

const HOST_ID = '__vibe-picker-host'

let active = false
let host: HTMLDivElement | null = null
let boxEl: HTMLDivElement | null = null
let labelEl: HTMLDivElement | null = null
let lastPick: PickResult | null = null

function ensureOverlay(): void {
  if (host) return
  host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = [
    '.box{position:fixed;box-sizing:border-box;border:2px solid #3b82f6;background:rgba(59,130,246,.12);border-radius:2px;display:none}',
    '.label{position:fixed;box-sizing:border-box;max-width:420px;padding:2px 6px;border-radius:4px;background:#111827;color:#f9fafb;font:12px/1.4 system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:none}',
  ].join('')
  boxEl = document.createElement('div')
  boxEl.className = 'box'
  labelEl = document.createElement('div')
  labelEl.className = 'label'
  shadow.append(style, boxEl, labelEl)
  document.documentElement.appendChild(host)
}

function destroyOverlay(): void {
  host?.remove()
  host = null
  boxEl = null
  labelEl = null
}

function deepElementFromPoint(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y)
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y)
    if (!inner || inner === el) break
    el = inner
  }
  return el
}

function selectorFor(el: Element): { selector: string; unique: boolean } {
  const parts: string[] = []
  let node: Element | null = el
  while (node && node !== document.documentElement) {
    const tag = node.tagName.toLowerCase()
    const id = node.id
    if (id) {
      const idSelector = `#${CSS.escape(id)}`
      let idUnique = false
      try {
        idUnique = document.querySelectorAll(idSelector).length === 1
      } catch {
        idUnique = false
      }
      if (idUnique) {
        parts.unshift(idSelector)
        break
      }
    }
    let part = tag
    const parent = node.parentElement
    if (parent) {
      const siblings = Array.from(parent.children).filter((child) => child.tagName === node?.tagName)
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`
    }
    parts.unshift(part)
    node = node.parentElement
  }
  const selector = parts.join(' > ')
  let unique = false
  try {
    unique = selector.length > 0 && document.querySelectorAll(selector).length === 1
  } catch {
    unique = false
  }
  return { selector, unique }
}

/**
 * Build-time attributes (`data-inspector-*`) added by the React Babel plugin.
 * React 19 no longer records `_debugSource`, so this is the primary React path.
 */
function attrSource(el: Element): SourceInfo | null {
  const holder = el.closest('[data-inspector-relative-path]')
  const file = holder?.getAttribute('data-inspector-relative-path')
  const line = Number(holder?.getAttribute('data-inspector-line'))
  const column = Number(holder?.getAttribute('data-inspector-column'))
  if (!file || !Number.isFinite(line)) return null
  return {
    framework: 'react',
    via: 'data-inspector',
    file,
    line,
    column: Number.isFinite(column) ? column : null,
  }
}

function reactSource(el: Element): SourceInfo | null {
  const key = Object.keys(el).find((name) => name.startsWith('__reactFiber$'))
  let fiber = key ? (el as unknown as Record<string, unknown>)[key] : null
  const seen = new Set<unknown>()
  while (fiber && typeof fiber === 'object' && !seen.has(fiber)) {
    seen.add(fiber)
    const record = fiber as { _debugSource?: { fileName?: string; lineNumber?: number; columnNumber?: number }; return?: unknown }
    const source = record._debugSource
    if (source?.fileName) {
      return {
        framework: 'react',
        via: 'fiber._debugSource',
        file: source.fileName,
        line: source.lineNumber ?? null,
        column: source.columnNumber ?? null,
      }
    }
    fiber = record.return ?? null
  }
  return null
}

type VueVNode = {
  props?: Record<string, unknown>
  parent?: VueVNode | null
}

type VueInspectorStore = {
  vnodeToPos?: WeakMap<object, [string, number, number]>
}

function parsePos(raw: string): [string, number, number] | null {
  const match = raw.match(/^(.*):(\d+):(\d+)$/)
  if (!match) return null
  return [match[1] ?? raw, Number(match[2]), Number(match[3])]
}

/**
 * vite-plugin-vue-inspector records positions on the vnode props and deletes
 * the DOM attribute at runtime, so read the vnode (and its global store) first.
 */
function vuePos(el: Element): [string, number, number] | null {
  const store = (window as unknown as { __vue_inspector_store__?: VueInspectorStore }).__vue_inspector_store__
  let vnode = (el as unknown as { __vnode?: VueVNode }).__vnode ?? null
  while (vnode) {
    const props = vnode.props
    if (props) {
      const stored = store?.vnodeToPos?.get(props)
      if (stored) return stored
      const hidden = props.__v_inspector
      if (typeof hidden === 'string') {
        const parsed = parsePos(hidden)
        if (parsed) return parsed
      }
    }
    vnode = vnode.parent ?? null
  }
  return null
}

function vueSource(el: Element): SourceInfo | null {
  const pos = vuePos(el)
  if (pos) {
    return { framework: 'vue', via: '__v_inspector', file: pos[0], line: pos[1], column: pos[2] }
  }
  const holder = el.closest('[data-v-inspector]')
  const parsed = parsePos(holder?.getAttribute('data-v-inspector') ?? '')
  if (parsed) {
    return { framework: 'vue', via: 'data-v-inspector', file: parsed[0], line: parsed[1], column: parsed[2] }
  }
  const component = (el as unknown as { __vueParentComponent?: { type?: { __file?: string } } }).__vueParentComponent
  if (component?.type?.__file) {
    return { framework: 'vue', via: '__file', file: component.type.__file, line: null, column: null }
  }
  return null
}

function svelteSource(el: Element): SourceInfo | null {
  let node: Element | null = el
  while (node) {
    const meta = (node as unknown as { __svelte_meta?: { loc?: { file?: string; line?: number; column?: number } } }).__svelte_meta
    if (meta?.loc?.file) {
      return {
        framework: 'svelte',
        via: '__svelte_meta',
        file: meta.loc.file,
        line: meta.loc.line ?? null,
        column: meta.loc.column ?? null,
      }
    }
    node = node.parentElement
  }
  return null
}

function sourceFor(el: Element): SourceInfo | null {
  return attrSource(el) ?? reactSource(el) ?? vueSource(el) ?? svelteSource(el)
}

function collect(el: Element): PickResult {
  const rect = el.getBoundingClientRect()
  const { selector, unique } = selectorFor(el)
  const rawText =
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? el.value
      : '') ||
    (el as HTMLElement).innerText ||
    el.getAttribute('aria-label') ||
    ''
  return {
    selector,
    unique,
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: Array.from(el.classList).slice(0, 6),
    text: rawText.trim().replace(/\s+/g, ' ').slice(0, 120),
    role: el.getAttribute('role'),
    box: {
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 240),
    source: sourceFor(el),
  }
}

function describe(el: Element): string {
  const source = sourceFor(el)
  const name = el.id ? `#${el.id}` : el.tagName.toLowerCase()
  if (!source) return `${name} · no source`
  const file = source.file.split(/[\\/]/).pop() ?? source.file
  return `${name} · ${file}:${source.line ?? '?'}`
}

function draw(el: Element): void {
  if (!boxEl || !labelEl) return
  const rect = el.getBoundingClientRect()
  boxEl.style.display = 'block'
  boxEl.style.left = `${rect.left}px`
  boxEl.style.top = `${rect.top}px`
  boxEl.style.width = `${rect.width}px`
  boxEl.style.height = `${rect.height}px`
  labelEl.textContent = describe(el)
  labelEl.style.display = 'block'
  const labelTop = rect.top > 22 ? rect.top - 22 : rect.bottom + 4
  labelEl.style.left = `${Math.max(4, rect.left)}px`
  labelEl.style.top = `${labelTop}px`
}

function onPointerMove(event: PointerEvent): void {
  if (!active) return
  const el = deepElementFromPoint(event.clientX, event.clientY)
  if (el && el !== document.documentElement) draw(el)
}

function swallow(event: Event): void {
  if (!active) return
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

function onClick(event: MouseEvent): void {
  if (!active) return
  swallow(event)
  const path = event.composedPath()
  const target = (path[0] instanceof Element ? path[0] : null) ?? deepElementFromPoint(event.clientX, event.clientY)
  if (!target || target === document.documentElement) return
  lastPick = collect(target)
  window.dispatchEvent(new CustomEvent('vibe-pick', { detail: lastPick }))
}

function onKeyDown(event: KeyboardEvent): void {
  if (!active) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    api.stop()
  }
}

const SWALLOWED_EVENTS: Array<keyof WindowEventMap> = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'dblclick',
  'auxclick',
  'contextmenu',
  'submit',
]

function addListeners(): void {
  window.addEventListener('pointermove', onPointerMove, true)
  window.addEventListener('keydown', onKeyDown, true)
  for (const name of SWALLOWED_EVENTS) window.addEventListener(name, swallow, true)
  window.addEventListener('click', onClick, true)
}

function removeListeners(): void {
  window.removeEventListener('pointermove', onPointerMove, true)
  window.removeEventListener('keydown', onKeyDown, true)
  for (const name of SWALLOWED_EVENTS) window.removeEventListener(name, swallow, true)
  window.removeEventListener('click', onClick, true)
}

const api: PickerApi = {
  start(): void {
    if (active) return
    active = true
    lastPick = null
    ensureOverlay()
    addListeners()
  },
  stop(): void {
    if (!active) return
    active = false
    removeListeners()
    destroyOverlay()
  },
  isActive(): boolean {
    return active
  },
  getLastPick(): PickResult | null {
    return lastPick
  },
}

;(window as VibeWindow).__vibePicker = api
