// @vitest-environment jsdom
/**
 * Selector generation (T027): priority order from SPEC §6.4, generated-class
 * skipping, nth-of-type paths and the uniqueness flag.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { buildSelector } from '../../../src/host/inspect/selector'

function mount(html: string): void {
  document.body.innerHTML = html
}

function el(selector: string): Element {
  const found = document.querySelector(selector)
  if (!found) throw new Error(`missing fixture element ${selector}`)
  return found
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('buildSelector', () => {
  it('prefers a unique data-testid over everything else', () => {
    mount(
      '<button id="save" data-testid="buy-now">A</button>' +
        '<button data-testid="cancel">B</button>',
    )
    expect(buildSelector(el('[data-testid="buy-now"]'))).toEqual({
      selector: '[data-testid="buy-now"]',
      unique: true,
    })
  })

  it('falls back to a unique id when the testid repeats', () => {
    mount('<button data-testid="dup" id="save">A</button><button data-testid="dup">B</button>')
    expect(buildSelector(el('#save'))).toEqual({ selector: '#save', unique: true })
  })

  it('uses aria-label and name when they identify one element', () => {
    mount(
      '<button aria-label="Close dialog">x</button>' +
        '<input name="email">' +
        '<input name="nickname">',
    )
    expect(buildSelector(el('[aria-label="Close dialog"]'))).toEqual({
      selector: 'button[aria-label="Close dialog"]',
      unique: true,
    })
    expect(buildSelector(el('[name="email"]'))).toEqual({
      selector: 'input[name="email"]',
      unique: true,
    })
  })

  it('uses a semantic class and skips generated-looking ones', () => {
    mount(
      '<button class="ghost checkout-primary">A</button>' +
        '<button class="ghost">B</button>' +
        '<div id="gen"><span class="css-1a2b3c">G</span></div>',
    )
    expect(buildSelector(el('.checkout-primary'))).toEqual({
      selector: 'button.checkout-primary',
      unique: true,
    })
    const generated = buildSelector(el('#gen span'))
    expect(generated.selector).not.toContain('css-1a2b3c')
    expect(generated.selector).toBe('#gen > span')
    expect(generated.unique).toBe(true)
  })

  it('builds an nth-of-type path below the nearest unique anchor', () => {
    mount('<div id="panel"><ul><li>1</li><li>2</li></ul></div>')
    const target = el('#panel li:nth-of-type(2)')
    expect(buildSelector(target)).toEqual({
      selector: '#panel > ul > li:nth-of-type(2)',
      unique: true,
    })
  })

  it('keeps duplicate anchors out of the path and resolves by position', () => {
    mount('<div class="rows"><div class="row"><span>1</span></div><div class="row"><span>2</span></div></div>')
    const result = buildSelector(el('.row:nth-of-type(2) span'))
    expect(result.unique).toBe(true)
    expect(result.selector).toContain('div:nth-of-type(2)')
    expect(document.querySelector(result.selector)).toBe(el('.row:nth-of-type(2) span'))
  })

  it('escapes quotes in attribute values', () => {
    mount('<button data-testid=\'a"b\'>A</button>')
    expect(buildSelector(el('button'))).toEqual({
      selector: '[data-testid="a\\"b"]',
      unique: true,
    })
  })

  it('marks a detached element as non-unique instead of guessing', () => {
    mount('<button>A</button>')
    const element = el('button')
    element.remove()
    const result = buildSelector(element)
    expect(result.selector).toBe('button')
    expect(result.unique).toBe(false)
  })

  it('scopes uniqueness to an open shadow root', () => {
    mount('<div id="host"></div>')
    const host = el('#host')
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<button id="inner">Inner</button>'
    const inner = shadow.querySelector('#inner')!
    expect(buildSelector(inner)).toEqual({ selector: '#inner', unique: true })
    expect(document.querySelector('#inner')).toBeNull()
  })
})
