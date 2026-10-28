/**
 * Element DOM context extraction (T028).
 *
 * `extractDomContext` runs inside the target page: it is serialized with
 * `Function.prototype.toString()` into the picker script, so it must stay
 * self-contained (no imports, no module-level helpers). It returns a shallow
 * HTML snippet, the visible text and a visibility flag.
 *
 * The page is untrusted, so the Host re-normalizes whatever arrives with the
 * exported `normalize*` helpers before it reaches a contract or the model.
 */
import { DOM_SNIPPET_BYTES, ELEMENT_TEXT_CHARS, truncateUtf8 } from '../../contracts/budget'

export interface ElementDomContext {
  readonly html: string
  readonly text: string
  readonly visible: boolean
}

/**
 * Runs inside the target page. Depth and node caps keep a huge component from
 * spending the whole serialization budget on one subtree.
 */
export function extractDomContext(element: Element): ElementDomContext {
  // Kept inside the function because this source is serialized into the page.
  const MAX_HTML_BYTES = 2048
  const MAX_TEXT_CHARS = 200
  const MAX_DEPTH = 6
  const MAX_NODES = 200
  const encoder = new TextEncoder()

  const utf8Bytes = (value: string): number => encoder.encode(value).length

  const capBytes = (value: string, maxBytes: number): string => {
    if (utf8Bytes(value) <= maxBytes) return value
    // The ellipsis is three bytes, so it counts against the same budget.
    const budget = maxBytes - 3
    let used = 0
    let out = ''
    for (const char of value) {
      const size = utf8Bytes(char)
      if (used + size > budget) break
      out += char
      used += size
    }
    return `${out}…`
  }

  const capChars = (value: string, maxChars: number): string => {
    const chars = Array.from(value)
    if (chars.length <= maxChars) return value
    return `${chars.slice(0, maxChars - 1).join('')}…`
  }

  const normalize = (value: string): string =>
    value
      // Control characters would corrupt the annotation text; whitespace runs
      // (including indentation from formatted markup) collapse to one space.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  let rawText = ''
  const innerText = (element as HTMLElement).innerText
  if (typeof innerText === 'string') {
    // innerText already skips display:none subtrees and script/style text.
    rawText = innerText
  } else {
    // Engines without innerText (jsdom in tests) get the same guarantee by
    // stripping non-content elements from a throwaway clone.
    const textClone = element.cloneNode(true) as Element
    for (const stripped of Array.from(
      textClone.querySelectorAll('script,style,template,noscript'),
    )) {
      stripped.remove()
    }
    rawText = textClone.textContent ?? ''
  }
  const text = capChars(normalize(rawText), MAX_TEXT_CHARS)

  let visible = element.isConnected && !element.hasAttribute('hidden')
  if (visible) {
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) visible = false
  }
  if (visible) {
    const view = element.ownerDocument.defaultView
    const style = view ? view.getComputedStyle(element) : null
    if (
      style &&
      (style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        (style.opacity !== '' && Number(style.opacity) === 0))
    ) {
      visible = false
    }
  }
  if (visible) {
    const check = (element as Element & {
      checkVisibility?: (options?: Record<string, boolean>) => boolean
    }).checkVisibility
    if (typeof check === 'function') {
      try {
        if (check.call(element, { checkOpacity: true, checkVisibilityCSS: true }) === false) {
          visible = false
        }
      } catch {
        // Older engines throw on unknown options; computed style already ran.
      }
    }
  }

  const clone = element.cloneNode(true) as Element
  let nodes = 0

  const prune = (node: Element, depth: number): void => {
    if (depth >= MAX_DEPTH) {
      while (node.firstChild) node.removeChild(node.firstChild)
      return
    }
    const children = Array.from(node.children)
    for (const child of children) {
      nodes += 1
      const childTag = child.tagName.toLowerCase()
      if (
        childTag === 'script' ||
        childTag === 'style' ||
        childTag === 'template' ||
        childTag === 'noscript'
      ) {
        child.remove()
        continue
      }
      if (nodes >= MAX_NODES) {
        child.remove()
        continue
      }
      prune(child, depth + 1)
    }
  }
  prune(clone, 0)

  let html = ''
  try {
    // Formatted JSX leaves indentation text nodes behind; one space keeps the
    // snippet readable and leaves more of the 2 KB budget for real markup.
    html = (clone.outerHTML ?? '').replace(/\s+/g, ' ').trim()
  } catch {
    // A malformed clone should degrade to "no snippet", not break the pick.
  }
  html = capBytes(html, MAX_HTML_BYTES)
  if (html.endsWith('…')) {
    // Never leave a half-written tag: drop back to the last complete tag.
    const body = html.slice(0, -1)
    const lastOpen = body.lastIndexOf('<')
    const lastClose = body.lastIndexOf('>')
    if (lastOpen > lastClose) html = `${body.slice(0, lastOpen)}…`
  }

  return { html, text, visible }
}

/** Caps a page-provided HTML fragment at the SPEC §5.3 2 KB budget. */
export function normalizeDomSnippet(value: unknown): string {
  if (typeof value !== 'string') return ''
  const cleaned = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, '')
    .trim()
  return truncateUtf8(cleaned, DOM_SNIPPET_BYTES)
}

/** Caps page-provided text at 200 code points, suffix included. */
export function normalizeElementText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  if (chars.length <= ELEMENT_TEXT_CHARS) return cleaned
  return `${chars.slice(0, ELEMENT_TEXT_CHARS - 1).join('')}…`
}

/** Visibility is a plain boolean on the wire; anything else is "unknown". */
export function normalizeVisibility(value: unknown): boolean {
  return value === true
}
