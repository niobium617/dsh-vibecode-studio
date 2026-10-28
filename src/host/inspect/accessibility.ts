/**
 * Accessible role/name extraction (T028).
 *
 * `describeAccessibility` runs inside the target page (serialized into the
 * picker script), so like `buildSelector` it must stay self-contained: no
 * imports and no module-level helpers. It approximates the ARIA role and
 * accessible-name computation for the element shapes a picker meets in
 * practice; it is not a full accessibility-tree implementation.
 */
import { ELEMENT_TEXT_CHARS } from '../../contracts/budget'

/**
 * ARIA 1.2 role vocabulary. Both the page-side extractor (via a parameter, so
 * the serialized source has no free variable) and the Host-side normalizer use
 * it, so an invalid `role` attribute never reaches the contract.
 */
export const ARIA_ROLES: readonly string[] = [
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'meter',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
]

export interface ElementAccessibility {
  readonly role: string | null
  readonly name: string
}

export function describeAccessibility(
  element: Element,
  roles: readonly string[],
): ElementAccessibility {
  // Kept inside the function because this source is serialized into the page.
  const MAX_ROLE_CHARS = 32
  const MAX_NAME_CHARS = 200

  const tag = element.tagName.toLowerCase()

  const normalize = (value: string): string =>
    value
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

  const capChars = (value: string, maxChars: number): string => {
    const chars = Array.from(value)
    if (chars.length <= maxChars) return value
    return `${chars.slice(0, maxChars - 1).join('')}…`
  }

  const visibleText = (node: Element | null): string => {
    if (!node) return ''
    const raw =
      typeof (node as HTMLElement).innerText === 'string'
        ? (node as HTMLElement).innerText
        : (node.textContent ?? '')
    return capChars(normalize(raw), MAX_NAME_CHARS)
  }

  const byId = (id: string): Element | null => {
    const root = element.getRootNode()
    if (root && typeof (root as ParentNode).querySelector === 'function') {
      const selector = `[id="${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`
      try {
        const found = (root as ParentNode).querySelector(selector)
        if (found) return found
      } catch {
        // Fall through to the document-level lookup.
      }
    }
    return element.ownerDocument ? element.ownerDocument.getElementById(id) : null
  }

  const labelText = (): string => {
    const id = element.id
    if (id) {
      const doc = element.ownerDocument
      const labels = doc.querySelectorAll('label[for]')
      for (const label of Array.from(labels)) {
        if (label.getAttribute('for') === id) return visibleText(label)
      }
    }
    const wrapping = typeof element.closest === 'function' ? element.closest('label') : null
    return wrapping ? visibleText(wrapping) : ''
  }

  const fromLabelledBy = (ids: string): string => {
    const parts: string[] = []
    for (const id of ids.trim().split(/\s+/)) {
      if (!id) continue
      const referenced = byId(id)
      if (!referenced) continue
      const ariaLabel = referenced.getAttribute('aria-label')
      const part = ariaLabel ? ariaLabel : visibleText(referenced)
      if (part) parts.push(part)
      if (parts.length >= 4) break
    }
    return parts.join(' ')
  }

  // --- accessible name -----------------------------------------------------
  let name = ''
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) name = fromLabelledBy(labelledBy)
  if (!name) {
    const ariaLabel = element.getAttribute('aria-label')
    if (ariaLabel) name = ariaLabel
  }

  const inputType = tag === 'input' ? (element.getAttribute('type') || 'text').toLowerCase() : ''

  if (!name && (tag === 'img' || tag === 'area')) {
    const alt = element.getAttribute('alt')
    if (alt) name = alt
  }
  if (!name && tag === 'input') {
    const value = element.getAttribute('value')
    if ((inputType === 'button' || inputType === 'submit' || inputType === 'reset') && value) {
      name = value
    } else if (inputType === 'image') {
      const alt = element.getAttribute('alt')
      if (alt) name = alt
    }
  }
  if (!name && (tag === 'input' || tag === 'select' || tag === 'textarea')) {
    name = labelText()
  }
  if (!name && tag === 'fieldset') {
    name = visibleText(element.querySelector('legend'))
  }
  if (!name && tag === 'table') {
    name = visibleText(element.querySelector('caption'))
  }
  if (!name && tag === 'figure') {
    name = visibleText(element.querySelector('figcaption'))
  }
  if (!name) {
    const title = element.getAttribute('title')
    if (title) name = title
  }
  if (!name && (tag === 'input' || tag === 'textarea')) {
    const placeholder = element.getAttribute('placeholder') || element.getAttribute('aria-placeholder')
    if (placeholder) name = placeholder
  }
  // Name from content is not allowed for landmarks; otherwise it is a useful
  // approximation for buttons, links, headings and generic containers.
  if (!name && tag !== 'form' && tag !== 'section') name = visibleText(element)
  name = capChars(normalize(name), MAX_NAME_CHARS)

  // --- role ----------------------------------------------------------------
  let role: string | null = null
  const explicitRole = element.getAttribute('role')
  if (explicitRole) {
    const token = (explicitRole.trim().toLowerCase().split(/\s+/)[0] ?? '')
    if (
      /^[a-z][a-z-]*$/.test(token) &&
      token.length <= MAX_ROLE_CHARS &&
      roles.indexOf(token) >= 0
    ) {
      role = token
    }
  }

  if (!role) {
    if (tag === 'a' || tag === 'area') role = element.hasAttribute('href') ? 'link' : null
    else if (tag === 'button') role = 'button'
    else if (tag === 'input') {
      if (inputType === 'hidden') role = null
      else if (
        inputType === 'button' ||
        inputType === 'submit' ||
        inputType === 'reset' ||
        inputType === 'image' ||
        inputType === 'file'
      ) {
        role = 'button'
      } else if (inputType === 'checkbox') role = 'checkbox'
      else if (inputType === 'radio') role = 'radio'
      else if (inputType === 'range') role = 'slider'
      else if (inputType === 'number') role = 'spinbutton'
      else if (inputType === 'search') role = 'searchbox'
      else if (
        inputType === 'color' ||
        inputType === 'date' ||
        inputType === 'time' ||
        inputType === 'datetime-local' ||
        inputType === 'month' ||
        inputType === 'week'
      ) {
        role = null
      } else role = 'textbox'
    } else if (tag === 'select') {
      const size = Number(element.getAttribute('size') ?? '0')
      role = element.hasAttribute('multiple') || size > 1 ? 'listbox' : 'combobox'
    } else if (tag === 'textarea') role = 'textbox'
    else if (/^h[1-6]$/.test(tag)) role = 'heading'
    else if (tag === 'img') role = element.getAttribute('alt') === '' ? 'presentation' : 'img'
    else if (tag === 'nav') role = 'navigation'
    else if (tag === 'main') role = 'main'
    else if (tag === 'header') role = 'banner'
    else if (tag === 'footer') role = 'contentinfo'
    else if (tag === 'aside') role = 'complementary'
    // A form/section only enters the accessibility tree when it has a name.
    else if (tag === 'form') role = name ? 'form' : null
    else if (tag === 'section') role = name ? 'region' : null
    else if (tag === 'article') role = 'article'
    else if (tag === 'dialog') role = 'dialog'
    else if (tag === 'ul' || tag === 'ol' || tag === 'menu') role = 'list'
    else if (tag === 'li') role = 'listitem'
    else if (tag === 'table') role = 'table'
    else if (tag === 'tr') role = 'row'
    else if (tag === 'th') role = 'columnheader'
    else if (tag === 'td') role = 'cell'
    else if (tag === 'progress') role = 'progressbar'
    else if (tag === 'meter') role = 'meter'
    else if (tag === 'output') role = 'status'
    else if (tag === 'details') role = 'group'
    else if (tag === 'summary') role = 'button'
    else if (tag === 'fieldset') role = 'group'
    else if (tag === 'figure') role = 'figure'
    else if (tag === 'hr') role = 'separator'
    else if (tag === 'option') role = 'option'
    else if (tag === 'optgroup') role = 'group'
  }

  return { role, name }
}

/** A page-provided role must look like one ARIA token. */
export function normalizeRole(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const token = (value.trim().toLowerCase().split(/\s+/)[0] ?? '')
  if (!/^[a-z][a-z-]*$/.test(token) || token.length > 32) return null
  return ARIA_ROLES.indexOf(token) >= 0 ? token : null
}

/** Accessible names are page content: collapse whitespace and cap the length. */
export function normalizeAccessibleName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/\s+/g, ' ').trim()
  const chars = Array.from(cleaned)
  if (chars.length <= ELEMENT_TEXT_CHARS) return cleaned
  return `${chars.slice(0, ELEMENT_TEXT_CHARS - 1).join('')}…`
}

export function normalizeAccessibility(value: Record<string, unknown>): ElementAccessibility {
  return {
    role: normalizeRole(value.role),
    name: normalizeAccessibleName(value.name),
  }
}
