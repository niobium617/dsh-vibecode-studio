// @vitest-environment jsdom
/**
 * T028 DOM context extraction: the page-side extractor that ships inside the
 * picker script, plus the Host-side re-validation of what the page returns.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { utf8Bytes } from '../../../src/contracts/budget'
import {
  extractDomContext,
  normalizeDomSnippet,
  normalizeElementText,
  normalizeVisibility,
} from '../../../src/host/inspect/dom'

const RECT = {
  left: 0,
  top: 0,
  width: 120,
  height: 32,
  right: 120,
  bottom: 32,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect

function mount(html: string, selector = 'button'): Element {
  document.body.innerHTML = html
  const element = document.querySelector(selector)
  if (!element) throw new Error(`fixture element ${selector} is missing`)
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(RECT)
  return element
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('extractDomContext', () => {
  it('returns a compact snippet, visible text and visibility', () => {
    const element = mount('<button data-testid="save" class="primary">  Save\n changes </button>')

    const context = extractDomContext(element)

    expect(context.html).toBe('<button data-testid="save" class="primary"> Save changes </button>')
    expect(context.text).toBe('Save changes')
    expect(context.visible).toBe(true)
  })

  it('strips script/style and non-content elements from the snippet and text', () => {
    const element = mount(
      '<div><style>.x{color:red}</style><script>window.x=1</script><noscript>n</noscript>Keep</div>',
      'div',
    )

    const context = extractDomContext(element)

    expect(context.html).not.toContain('<script')
    expect(context.html).not.toContain('<style')
    expect(context.html).not.toContain('<noscript')
    expect(context.html).toContain('Keep')
    expect(context.text).toBe('Keep')
  })

  it('caps snippet depth and node count', () => {
    const deep = `<div>${'<div>'.repeat(40)}deep${'</div>'.repeat(40)}</div>`
    const element = mount(deep, 'div')
    const context = extractDomContext(element)

    // Depth cap: 6 nested levels below the root can survive (root plus six).
    expect((context.html.match(/<div/g) ?? []).length).toBeLessThanOrEqual(7)
    expect(context.html).not.toContain('deep')

    const wide = `<div>${'<span>x</span>'.repeat(400)}</div>`
    const wideElement = mount(wide, 'div')
    const wideContext = extractDomContext(wideElement)
    expect((wideContext.html.match(/<span/g) ?? []).length).toBeLessThan(200)
  })

  it('keeps the snippet within 2 KB of UTF-8 without splitting a character or tag', () => {
    const element = mount(`<div><span>${'文'.repeat(800)}</span></div>`, 'div')

    const context = extractDomContext(element)

    expect(utf8Bytes(context.html)).toBeLessThanOrEqual(2048)
    expect(context.html.endsWith('…')).toBe(true)
    const body = context.html.slice(0, -1)
    expect(body.lastIndexOf('<')).toBeLessThan(body.lastIndexOf('>'))
    expect(context.html).not.toContain('�')
  })

  it('caps text at 200 code points including the ellipsis', () => {
    const element = mount(`<p>${'好'.repeat(500)}</p>`, 'p')

    const context = extractDomContext(element)

    expect(Array.from(context.text)).toHaveLength(200)
    expect(context.text.endsWith('…')).toBe(true)
  })

  it('reports CSS-hidden, zero-sized, detached and hidden-attribute elements as invisible', () => {
    expect(extractDomContext(mount('<button style="display:none">A</button>')).visible).toBe(false)
    expect(extractDomContext(mount('<button style="visibility:hidden">B</button>')).visible).toBe(
      false,
    )
    expect(extractDomContext(mount('<button hidden>C</button>')).visible).toBe(false)
    expect(extractDomContext(mount('<button>D</button>')).visible).toBe(true)

    const zero = mount('<button>E</button>')
    vi.spyOn(zero, 'getBoundingClientRect').mockReturnValue({ ...RECT, width: 0 } as DOMRect)
    expect(extractDomContext(zero).visible).toBe(false)

    const detached = document.createElement('button')
    detached.textContent = 'F'
    expect(extractDomContext(detached).visible).toBe(false)
  })
})

describe('normalizeDomSnippet', () => {
  it('caps page HTML at 2 KB and removes control characters', () => {
    const capped = normalizeDomSnippet(`<div>${'x'.repeat(5000)}</div>`)
    expect(utf8Bytes(capped)).toBeLessThanOrEqual(2048)
    expect(capped.endsWith('…')).toBe(true)

    const cleaned = normalizeDomSnippet('<p>\u0000a\u0007b</p>')
    expect(cleaned).toBe('<p>ab</p>')
  })

  it('returns an empty snippet for non-strings', () => {
    expect(normalizeDomSnippet(null)).toBe('')
    expect(normalizeDomSnippet(42)).toBe('')
    expect(normalizeDomSnippet(undefined)).toBe('')
  })
})

describe('normalizeElementText', () => {
  it('collapses whitespace and caps at 200 code points', () => {
    expect(normalizeElementText('  Save\n\t changes  ')).toBe('Save changes')
    const capped = normalizeElementText('好'.repeat(500))
    expect(Array.from(capped)).toHaveLength(200)
    expect(capped.endsWith('…')).toBe(true)
    expect(Array.from(normalizeElementText('a'.repeat(200)))).toHaveLength(200)
  })

  it('returns an empty string for non-strings', () => {
    expect(normalizeElementText(null)).toBe('')
    expect(normalizeElementText({})).toBe('')
  })
})

describe('normalizeVisibility', () => {
  it('only accepts a literal true', () => {
    expect(normalizeVisibility(true)).toBe(true)
    expect(normalizeVisibility('true')).toBe(false)
    expect(normalizeVisibility(1)).toBe(false)
    expect(normalizeVisibility(undefined)).toBe(false)
  })
})
