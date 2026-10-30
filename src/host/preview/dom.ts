/**
 * Bounded DOM outline for `vibe_observe` (T048).
 *
 * `collectDomOutline` runs inside the target page exactly like the picker's
 * `extractDomContext`: it is serialized with `Function.prototype.toString()`
 * into a `Runtime.evaluate` expression, so it must stay self-contained (no
 * imports, no module-level helpers). Node, depth, text and byte caps are
 * applied in the page so a huge app never ships megabytes back to the host.
 *
 * The page is untrusted. Whatever arrives is re-normalized by
 * `parseDomOutlineResult` before it reaches a tool result, and the caller wraps
 * the outline as untrusted page content.
 */
import { truncateUtf8, utf8Bytes } from '../../contracts/budget'
import { studioError } from '../../contracts/errors'

/** Default page-side byte cap; the observe tool narrows it per detail level. */
export const DOM_OUTLINE_MAX_BYTES = 4096
export const DOM_OUTLINE_MIN_BYTES = 512
export const DOM_OUTLINE_MAX_NODES = 400
export const DOM_OUTLINE_MAX_DEPTH = 14
export const DOM_OUTLINE_TEXT_CHARS = 80
export const DOM_SELECTOR_MAX_CHARS = 200

export interface DomSnapshotParams {
  /** CSS selector limiting the outline to one element and its descendants. */
  readonly selector?: string
  /** Page-side byte cap for the outline text. */
  readonly maxBytes?: number
}

export interface DomSnapshot {
  /** Selector the outline was limited to; null for the whole body. */
  readonly selector: string | null
  readonly nodeCount: number
  readonly outline: string
  /** True when a node/depth/byte cap cut the outline. */
  readonly truncated: boolean
}

interface DomOutlinePageOptions {
  readonly selector: string | null
  readonly maxNodes: number
  readonly maxDepth: number
  readonly maxTextChars: number
  readonly maxBytes: number
}

interface DomOutlinePageResult {
  readonly found: boolean
  readonly invalidSelector: boolean
  readonly nodeCount: number
  readonly outline: string
  readonly truncated: boolean
}

/**
 * Runs inside the target page. Hidden and `aria-hidden` subtrees are skipped;
 * `script`/`style`/`head` content is never interesting to the model. Text is
 * only attached to leaf elements so a wrapper never repeats its subtree.
 */
export function collectDomOutline(options: DomOutlinePageOptions): DomOutlinePageResult {
  // Kept inside the function because this source is serialized into the page.
  const SKIPPED_TAGS = ['script', 'style', 'noscript', 'template', 'meta', 'link', 'head']
  const encoder = new TextEncoder()
  const empty: DomOutlinePageResult = {
    found: false,
    invalidSelector: false,
    nodeCount: 0,
    outline: '',
    truncated: false,
  }

  let root: Element | null = null
  if (options.selector !== null) {
    try {
      root = document.querySelector(options.selector)
    } catch {
      return { ...empty, invalidSelector: true }
    }
  } else {
    root = document.body ?? document.documentElement
  }
  if (!root) return empty

  const lines: string[] = []
  let bytes = 0
  let count = 0
  let truncated = false

  const normalize = (value: string): string =>
    value
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const describe = (element: Element): string => {
    const tag = element.tagName.toLowerCase()
    let label = tag
    const id = element.getAttribute('id')
    if (id) label += `#${normalize(id).slice(0, 60)}`
    const classAttr = element.getAttribute('class')
    if (classAttr) {
      const classes = classAttr.split(/\s+/).filter(Boolean).slice(0, 2)
      for (const name of classes) label += `.${normalize(name).slice(0, 60)}`
    }
    const role = element.getAttribute('role')
    if (role) label += `[role=${normalize(role).slice(0, 40)}]`
    const ariaLabel = element.getAttribute('aria-label')
    if (ariaLabel) label += `[aria-label=${normalize(ariaLabel).slice(0, 40)}]`
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const name = element.getAttribute('name')
      if (name) label += `[name=${normalize(name).slice(0, 60)}]`
    }
    if (element.children.length === 0) {
      const text = normalize(element.textContent ?? '').slice(0, options.maxTextChars)
      if (text) label += ` "${text}"`
    }
    return label
  }

  const walk = (element: Element, depth: number): void => {
    if (truncated) return
    const tag = element.tagName.toLowerCase()
    if (SKIPPED_TAGS.includes(tag)) return
    if (element.hasAttribute('hidden') || element.getAttribute('aria-hidden') === 'true') return
    if (count >= options.maxNodes) {
      truncated = true
      return
    }
    const line = `${'  '.repeat(depth)}${describe(element)}`
    const size = encoder.encode(`${line}\n`).length
    if (bytes + size > options.maxBytes) {
      truncated = true
      return
    }
    lines.push(line)
    bytes += size
    count += 1
    if (depth >= options.maxDepth) {
      if (element.children.length > 0) truncated = true
      return
    }
    for (const child of Array.from(element.children)) walk(child, depth + 1)
  }

  walk(root, 0)
  return {
    found: true,
    invalidSelector: false,
    nodeCount: count,
    outline: lines.join('\n'),
    truncated,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const DOM_SNAPSHOT_KEYS: ReadonlySet<string> = new Set(['selector', 'maxBytes'])
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/** Strict params guard; the tool passes only `selector` (maxBytes is host-set). */
export function isDomSnapshotParams(value: unknown): value is DomSnapshotParams {
  if (!isRecord(value)) return false
  if (!Object.keys(value).every((key) => DOM_SNAPSHOT_KEYS.has(key))) return false
  if (value.selector !== undefined) {
    if (typeof value.selector !== 'string') return false
    if (value.selector.length === 0 || value.selector.length > DOM_SELECTOR_MAX_CHARS) return false
    if (CONTROL_CHARS.test(value.selector)) return false
  }
  if (value.maxBytes !== undefined) {
    if (typeof value.maxBytes !== 'number' || !Number.isInteger(value.maxBytes)) return false
    if (value.maxBytes < DOM_OUTLINE_MIN_BYTES || value.maxBytes > DOM_OUTLINE_MAX_BYTES) return false
  }
  return true
}

function resolveMaxBytes(params: DomSnapshotParams): number {
  const requested = params.maxBytes ?? DOM_OUTLINE_MAX_BYTES
  return Math.min(DOM_OUTLINE_MAX_BYTES, Math.max(DOM_OUTLINE_MIN_BYTES, requested))
}

/**
 * The exact expression evaluated in the page. The selector travels as a JSON
 * string literal, so quotes and backslashes cannot break out of the argument.
 */
export function buildDomOutlineExpression(params: DomSnapshotParams = {}): string {
  const options: DomOutlinePageOptions = {
    selector: params.selector ?? null,
    maxNodes: DOM_OUTLINE_MAX_NODES,
    maxDepth: DOM_OUTLINE_MAX_DEPTH,
    maxTextChars: DOM_OUTLINE_TEXT_CHARS,
    maxBytes: resolveMaxBytes(params),
  }
  return `(${collectDomOutline.toString()})(${JSON.stringify(options)})`
}

/**
 * Control characters would corrupt the model's view of the outline. Newlines
 * and tabs carry the structure, so only the rest is dropped.
 */
function sanitizeOutline(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
}

export type DomSnapshotParse =
  | { readonly kind: 'ok'; readonly snapshot: DomSnapshot }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'invalid_selector' }

/**
 * Re-normalize the page's answer. A missing or malformed value is a preview
 * failure, not an empty outline: silently reporting zero nodes would hide a
 * broken CDP read from the model.
 */
export function parseDomOutlineResult(
  value: unknown,
  params: DomSnapshotParams = {},
): DomSnapshotParse {
  if (!isRecord(value)) {
    throw studioError('preview_failed', 'vibe-studio: the page returned no DOM outline')
  }
  if (value.invalidSelector === true) return { kind: 'invalid_selector' }
  if (value.found !== true) return { kind: 'not_found' }
  if (typeof value.outline !== 'string') {
    throw studioError('preview_failed', 'vibe-studio: the page returned an invalid DOM outline')
  }
  const sanitized = sanitizeOutline(value.outline)
  const maxBytes = resolveMaxBytes(params)
  const clipped = utf8Bytes(sanitized) > maxBytes
  const nodeCount =
    typeof value.nodeCount === 'number' && Number.isFinite(value.nodeCount)
      ? Math.min(Math.max(0, Math.trunc(value.nodeCount)), DOM_OUTLINE_MAX_NODES)
      : 0
  return {
    kind: 'ok',
    snapshot: {
      selector: params.selector ?? null,
      nodeCount,
      outline: clipped ? truncateUtf8(sanitized, maxBytes) : sanitized,
      truncated: value.truncated === true || clipped,
    },
  }
}
