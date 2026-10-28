// @vitest-environment jsdom
/**
 * T028 accessible role/name extraction: the page-side approximation that ships
 * inside the picker script, plus the Host-side re-validation.
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  ARIA_ROLES,
  describeAccessibility,
  normalizeAccessibility,
  normalizeAccessibleName,
  normalizeRole,
} from '../../../src/host/inspect/accessibility'

function mount(html: string, selector: string): Element {
  document.body.innerHTML = html
  const element = document.querySelector(selector)
  if (!element) throw new Error(`fixture element ${selector} is missing`)
  return element
}

function access(element: Element): ReturnType<typeof describeAccessibility> {
  return describeAccessibility(element, ARIA_ROLES)
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('describeAccessibility role', () => {
  it('maps common native elements to ARIA roles', () => {
    const cases: Array<[string, string, string | null]> = [
      ['<button>Save</button>', 'button', 'button'],
      ['<a href="/next">Next</a>', 'a', 'link'],
      ['<a>Anchor without href</a>', 'a', null],
      ['<input type="checkbox" aria-label="Done" />', 'input', 'checkbox'],
      ['<input type="search" aria-label="Find" />', 'input', 'searchbox'],
      ['<input type="number" aria-label="Qty" />', 'input', 'spinbutton'],
      ['<input type="hidden" />', 'input', null],
      ['<select aria-label="Pick"><option>A</option></select>', 'select', 'combobox'],
      ['<select multiple aria-label="Pick"><option>A</option></select>', 'select', 'listbox'],
      ['<textarea aria-label="Notes"></textarea>', 'textarea', 'textbox'],
      ['<h2>Heading</h2>', 'h2', 'heading'],
      ['<img src="a.png" alt="Logo" />', 'img', 'img'],
      ['<img src="a.png" alt="" />', 'img', 'presentation'],
      ['<nav aria-label="Main">x</nav>', 'nav', 'navigation'],
      ['<table><tr><td>c</td></tr></table>', 'table', 'table'],
      ['<table><tr><td>c</td></tr></table>', 'td', 'cell'],
      ['<hr />', 'hr', 'separator'],
    ]
    for (const [html, selector, role] of cases) {
      expect(access(mount(html, selector)).role).toBe(role)
    }
  })

  it('lets an explicit role win and rejects malformed tokens', () => {
    expect(access(mount('<div role="switch">x</div>', 'div')).role).toBe('switch')
    expect(access(mount('<button role="link">Save</button>', 'button')).role).toBe(
      'link',
    )
    expect(access(mount('<div role="not a role!">x</div>', 'div')).role).toBeNull()
  })

  it('only names form and section when they have an accessible name', () => {
    expect(access(mount('<form><button>Go</button></form>', 'form')).role).toBeNull()
    expect(access(mount('<form aria-label="Checkout"></form>', 'form')).role).toBe(
      'form',
    )
    expect(access(mount('<section><p>x</p></section>', 'section')).role).toBeNull()
    expect(
      access(mount('<section aria-label="News"><p>x</p></section>', 'section')).role,
    ).toBe('region')
  })
})

describe('describeAccessibility name', () => {
  it('prefers aria-labelledby, then aria-label, then native text', () => {
    const labelledBy = mount(
      '<div><span id="name">Account</span><button aria-labelledby="name">X</button></div>',
      'button',
    )
    expect(access(labelledBy).name).toBe('Account')

    const labelled = mount('<button aria-label="Close dialog">X</button>', 'button')
    expect(access(labelled).name).toBe('Close dialog')

    const text = mount('<button>  Save\n changes </button>', 'button')
    expect(access(text).name).toBe('Save changes')
  })

  it('reads native labels, alt text and values', () => {
    const labelled = mount(
      '<label for="email">Email</label><input id="email" type="email" />',
      '#email',
    )
    expect(access(labelled).name).toBe('Email')

    const wrapping = mount('<label>Name <input id="n" /></label>', '#n')
    expect(access(wrapping).name).toBe('Name')

    const img = mount('<img src="a.png" alt="Company logo" />', 'img')
    expect(access(img).name).toBe('Company logo')

    const submit = mount('<input type="submit" value="Send" />', 'input')
    expect(access(submit).name).toBe('Send')

    const placeholder = mount('<input placeholder="Search…" />', 'input')
    expect(access(placeholder).name).toBe('Search…')

    const titled = mount('<button title="Refresh"></button>', 'button')
    expect(access(titled).name).toBe('Refresh')
  })

  it('normalizes whitespace and caps names at 200 code points', () => {
    const long = mount(`<button>${'好'.repeat(500)}</button>`, 'button')
    const name = access(long).name
    expect(Array.from(name)).toHaveLength(200)
    expect(name.endsWith('…')).toBe(true)

    const empty = mount('<div></div>', 'div')
    expect(access(empty).name).toBe('')
  })
})

describe('host-side normalization', () => {
  it('normalizes roles to a single ARIA token', () => {
    expect(normalizeRole(' BUTTON ')).toBe('button')
    expect(normalizeRole('switch checkbox')).toBe('switch')
    expect(normalizeRole('')).toBeNull()
    expect(normalizeRole('not a role!')).toBeNull()
    expect(normalizeRole(7)).toBeNull()
    expect(normalizeRole('x'.repeat(40))).toBeNull()
  })

  it('normalizes accessible names', () => {
    expect(normalizeAccessibleName('  Save\n changes ')).toBe('Save changes')
    expect(Array.from(normalizeAccessibleName('好'.repeat(500)))).toHaveLength(200)
    expect(normalizeAccessibleName(undefined)).toBe('')
  })

  it('builds the accessibility pair from untrusted fields', () => {
    expect(normalizeAccessibility({ role: 'button', name: 'Save' })).toEqual({
      role: 'button',
      name: 'Save',
    })
    expect(normalizeAccessibility({})).toEqual({ role: null, name: '' })
    expect(normalizeAccessibility({ role: 42, name: null })).toEqual({ role: null, name: '' })
  })
})
