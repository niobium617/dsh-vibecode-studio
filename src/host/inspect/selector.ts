/**
 * Element selector generation (T027).
 *
 * Priority follows SPEC §6.4: a unique `data-testid` wins, then a unique `id`,
 * then `aria-label`/`name`, then a semantic class, and finally an
 * `nth-of-type` path. Every candidate is checked against the live document (or
 * shadow root) so the result says whether it really is unique.
 *
 * `buildSelector` is serialized with `Function.prototype.toString()` into the
 * injected page script, so it must stay self-contained: no imports and no
 * module-level helpers. DOM globals (`document`, `CSS`) are fine.
 */

export interface SelectorResult {
  readonly selector: string
  readonly unique: boolean
}

export function buildSelector(element: Element): SelectorResult {
  // Kept inside the function because this source is serialized into the page:
  // a module-level constant would be a free variable there.
  /** Long class names are usually generated (CSS modules, styled-components). */
  const MAX_CLASS_CHARS = 40
  const MAX_CLASS_CANDIDATES = 4
  const doc = element.ownerDocument
  const rootNode = element.getRootNode() as Document | ShadowRoot
  const scope: ParentNode =
    typeof (rootNode as ParentNode).querySelectorAll === 'function' ? rootNode : doc

  const isUnique = (selector: string, node: Element): boolean => {
    if (selector.length === 0) return false
    try {
      return scope.querySelectorAll(selector).length === 1 && scope.querySelector(selector) === node
    } catch {
      return false
    }
  }

  const escapeIdent = (value: string): string => {
    const css = (globalThis as { CSS?: { escape?: (input: string) => string } }).CSS
    if (css && typeof css.escape === 'function') return css.escape(value)
    let out = ''
    for (let index = 0; index < value.length; index += 1) {
      const char = value.charAt(index)
      const code = value.charCodeAt(index)
      out += /[A-Za-z0-9_-]/.test(char) ? char : `\\${code.toString(16)} `
    }
    // A leading digit needs the hex escape with a trailing space.
    if (/^[0-9]/.test(out)) out = `\\3${out.charAt(0)} ${out.slice(1)}`
    return out
  }

  const attrValue = (value: string): string =>
    `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

  const tag = element.tagName.toLowerCase()

  // 1. Test hooks are the most stable selector an app can offer.
  const testId = element.getAttribute('data-testid')
  if (testId) {
    const selector = `[data-testid=${attrValue(testId)}]`
    if (isUnique(selector, element)) return { selector, unique: true }
  }

  // 2. A unique id is short and readable.
  const id = element.id
  if (id) {
    const selector = `#${escapeIdent(id)}`
    if (isUnique(selector, element)) return { selector, unique: true }
  }

  // 3. Accessible labels and form names are stable across class churn.
  const ariaLabel = element.getAttribute('aria-label')
  if (ariaLabel) {
    const scoped = `${tag}[aria-label=${attrValue(ariaLabel)}]`
    if (isUnique(scoped, element)) return { selector: scoped, unique: true }
    const any = `[aria-label=${attrValue(ariaLabel)}]`
    if (isUnique(any, element)) return { selector: any, unique: true }
  }
  const name = element.getAttribute('name')
  if (name) {
    const scoped = `${tag}[name=${attrValue(name)}]`
    if (isUnique(scoped, element)) return { selector: scoped, unique: true }
    const any = `[name=${attrValue(name)}]`
    if (isUnique(any, element)) return { selector: any, unique: true }
  }

  // 4. A plain semantic class, as long as it identifies exactly this element.
  const classes: string[] = []
  for (const className of Array.from(element.classList)) {
    if (className.length === 0 || className.length > MAX_CLASS_CHARS) continue
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(className)) continue
    if (!/[A-Za-z]/.test(className)) continue
    // Generated suffixes (CSS modules, CSS-in-JS) are brittle across builds.
    if (/(?:[_-][a-f0-9]{5,}|[a-f0-9]{8,})$/i.test(className)) continue
    if (/^css-[a-z0-9]+$/i.test(className)) continue
    classes.push(className)
  }
  for (const className of classes.slice(0, MAX_CLASS_CANDIDATES)) {
    const selector = `${tag}.${className}`
    if (isUnique(selector, element)) return { selector, unique: true }
  }
  if (classes.length > 1) {
    const selector = `${tag}.${classes.slice(0, 3).join('.')}`
    if (isUnique(selector, element)) return { selector, unique: true }
  }

  // 5. Fall back to a positional path, shortened at the nearest unique anchor.
  const parts: string[] = []
  let node: Element | null = element
  while (node && node !== doc.documentElement) {
    // Stop at the nearest ancestor with a unique anchor and keep the path
    // below it.
    if (node !== element) {
      const anchorId = node.id
      if (anchorId) {
        const anchor = `#${escapeIdent(anchorId)}`
        if (isUnique(anchor, node)) {
          parts.unshift(anchor)
          break
        }
      }
      const anchorTestId = node.getAttribute('data-testid')
      if (anchorTestId) {
        const anchor = `[data-testid=${attrValue(anchorTestId)}]`
        if (isUnique(anchor, node)) {
          parts.unshift(anchor)
          break
        }
      }
    }

    const nodeTag = node.tagName.toLowerCase()
    const parent: Element | null = node.parentElement
    let part = nodeTag
    if (parent) {
      let sameTag = 0
      let index = 1
      for (let cursor = 0; cursor < parent.children.length; cursor += 1) {
        const sibling: Element = parent.children[cursor] as Element
        if (sibling.tagName === node.tagName) {
          sameTag += 1
          if (sibling === node) index = sameTag
        }
      }
      if (sameTag > 1) part += `:nth-of-type(${index})`
    }
    parts.unshift(part)
    node = node.parentElement
  }

  const selector = parts.join(' > ')
  return { selector, unique: isUnique(selector, element) }
}
