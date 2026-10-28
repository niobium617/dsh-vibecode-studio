// @vitest-environment jsdom
/**
 * T029 source adapters: the page-side extractors that ship inside the picker
 * script (React, Vue, Svelte) and the Host-side re-validation of what the page
 * returns. The adapters are serialized into the target page, so the tests also
 * pin the rule that they never throw and always degrade to `null`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeSourceContext, SOURCE_VIAS } from '../../../src/host/inspect/source'
import { reactSource } from '../../../src/host/inspect/source/react'
import { svelteSource } from '../../../src/host/inspect/source/svelte'
import { vueSource } from '../../../src/host/inspect/source/vue'

function mount(html: string, selector = 'button'): Element {
  document.body.innerHTML = html
  const element = document.querySelector(selector)
  if (!element) throw new Error(`fixture element ${selector} is missing`)
  return element
}

function attach(element: Element, key: string, value: unknown): void {
  // React/Vue attach their internals as enumerable own properties.
  Object.defineProperty(element, key, { value, enumerable: true, configurable: true })
}

afterEach(() => {
  document.body.innerHTML = ''
  delete (window as unknown as { __vue_inspector_store__?: unknown }).__vue_inspector_store__
})

describe('reactSource', () => {
  it('reads the dev-server inspector attributes', () => {
    const element = mount(
      '<div data-inspector-relative-path="src/App.jsx" data-inspector-line="9" data-inspector-column="4">' +
        '<button>Save</button></div>',
    )
    expect(reactSource(element)).toEqual({
      framework: 'react',
      via: 'data-inspector',
      file: 'src/App.jsx',
      line: 9,
      column: 4,
    })
  })

  it('keeps the file when a position attribute is not a usable number', () => {
    const element = mount(
      '<button data-inspector-relative-path="src/App.jsx" data-inspector-line="x">Save</button>',
    )
    expect(reactSource(element)).toMatchObject({
      via: 'data-inspector',
      file: 'src/App.jsx',
      line: null,
      column: null,
    })
  })

  it('falls back to the React 18 fiber _debugSource up the return chain', () => {
    const element = mount('<button>Save</button>')
    const fiber = {
      _debugSource: { fileName: 'src/App.jsx', lineNumber: 21, columnNumber: 8 },
    }
    attach(element, '__reactFiber$abc123', { _debugSource: null, return: fiber })
    expect(reactSource(element)).toEqual({
      framework: 'react',
      via: 'fiber._debugSource',
      file: 'src/App.jsx',
      line: 21,
      column: 8,
    })
  })

  it('returns null without metadata and survives patched internals', () => {
    expect(reactSource(mount('<button>Save</button>'))).toBeNull()

    const throwing = mount('<button>Save</button>')
    attach(throwing, '__reactFiber$boom', {
      get _debugSource(): unknown {
        throw new Error('patched')
      },
    })
    expect(() => reactSource(throwing)).not.toThrow()
    expect(reactSource(throwing)).toBeNull()
  })
})

describe('vueSource', () => {
  it('reads the hidden __v_inspector prop recorded by the Vue inspector plugin', () => {
    const element = mount('<button>Save</button>')
    attach(element, '__vnode', { props: { __v_inspector: 'src/App.vue:14:6' }, parent: null })
    expect(vueSource(element)).toEqual({
      framework: 'vue',
      via: '__v_inspector',
      file: 'src/App.vue',
      line: 14,
      column: 6,
    })
  })

  it('reads the plugin store by vnode props and walks to a parent vnode', () => {
    const positions = new WeakMap<object, [string, number, number]>()
    const childProps = {}
    const parentProps = {}
    positions.set(parentProps, ['src/App.vue', 23, 2])
    ;(window as unknown as { __vue_inspector_store__?: unknown }).__vue_inspector_store__ = {
      vnodeToPos: positions,
    }
    const element = mount('<button>Save</button>')
    attach(element, '__vnode', {
      props: childProps,
      parent: { props: parentProps, parent: null },
    })
    expect(vueSource(element)).toEqual({
      framework: 'vue',
      via: '__v_inspector',
      file: 'src/App.vue',
      line: 23,
      column: 2,
    })
  })

  it('accepts a leftover data-v-inspector attribute', () => {
    const element = mount('<button data-v-inspector="src/App.vue:7:1">Save</button>')
    expect(vueSource(element)).toMatchObject({
      via: 'data-v-inspector',
      file: 'src/App.vue',
      line: 7,
    })
  })

  it('falls back to the component __file without a line', () => {
    const element = mount('<button>Save</button>')
    attach(element, '__vueParentComponent', { type: { __file: 'src/App.vue' } })
    expect(vueSource(element)).toEqual({
      framework: 'vue',
      via: '__file',
      file: 'src/App.vue',
      line: null,
      column: null,
    })
  })

  it('returns null without metadata and survives a throwing store', () => {
    expect(vueSource(mount('<button>Save</button>'))).toBeNull()

    const element = mount('<button>Save</button>')
    attach(element, '__vnode', { props: {}, parent: null })
    ;(window as unknown as { __vue_inspector_store__?: unknown }).__vue_inspector_store__ = {
      vnodeToPos: {
        get(): unknown {
          throw new Error('patched')
        },
      },
    }
    expect(() => vueSource(element)).not.toThrow()
    expect(vueSource(element)).toBeNull()
  })
})

describe('svelteSource', () => {
  it('reads __svelte_meta.loc from the element', () => {
    const element = mount('<button>Save</button>')
    attach(element, '__svelte_meta', { loc: { file: 'src/App.svelte', line: 9, column: 4 } })
    expect(svelteSource(element)).toEqual({
      framework: 'svelte',
      via: '__svelte_meta',
      file: 'src/App.svelte',
      line: 9,
      column: 4,
    })
  })

  it('walks up to the nearest ancestor that carries the metadata', () => {
    const element = mount('<div><section><button>Save</button></section></div>')
    attach(document.querySelector('section')!, '__svelte_meta', {
      loc: { file: 'src/App.svelte', line: 18, column: 1 },
    })
    expect(svelteSource(element)).toMatchObject({
      via: '__svelte_meta',
      file: 'src/App.svelte',
      line: 18,
    })
  })

  it('returns null without metadata and survives a throwing getter', () => {
    expect(svelteSource(mount('<button>Save</button>'))).toBeNull()

    const throwing = mount('<button>Save</button>')
    attach(throwing, '__svelte_meta', {
      get loc(): unknown {
        throw new Error('patched')
      },
    })
    expect(() => svelteSource(throwing)).not.toThrow()
    expect(svelteSource(throwing)).toBeNull()
  })
})

describe('normalizeSourceContext', () => {
  const valid = {
    framework: 'react',
    via: 'data-inspector',
    file: 'src/App.jsx',
    line: 9,
    column: 4,
  }

  it('keeps the known fields and drops extras', () => {
    expect(normalizeSourceContext({ ...valid, evil: 'x', framework: 'react' })).toEqual(valid)
  })

  it('publishes the adapter tags it accepts', () => {
    expect(SOURCE_VIAS).toEqual([
      'data-inspector',
      'fiber._debugSource',
      '__v_inspector',
      'data-v-inspector',
      '__file',
      '__svelte_meta',
    ])
    for (const via of SOURCE_VIAS) {
      expect(normalizeSourceContext({ ...valid, via })).toMatchObject({ via })
    }
  })

  it('rejects values that are not a source at all', () => {
    expect(normalizeSourceContext(null)).toBeNull()
    expect(normalizeSourceContext('src/App.jsx')).toBeNull()
    expect(normalizeSourceContext([])).toBeNull()
    expect(normalizeSourceContext({ ...valid, framework: 'angular' })).toBeNull()
    expect(normalizeSourceContext({ ...valid, file: '   ' })).toBeNull()
    expect(normalizeSourceContext({ ...valid, file: 42 })).toBeNull()
    expect(normalizeSourceContext({ ...valid, via: 'not a tag!' })).toBeNull()
    expect(normalizeSourceContext({ ...valid, via: 'v'.repeat(70) })).toBeNull()
  })

  it('keeps a file-only source and nulls unusable positions', () => {
    expect(normalizeSourceContext({ ...valid, line: undefined, column: null })).toEqual({
      ...valid,
      line: null,
      column: null,
    })
    expect(
      normalizeSourceContext({ ...valid, line: -1, column: 1_000_001 }),
    ).toMatchObject({ line: null, column: null })
    expect(normalizeSourceContext({ ...valid, line: 1.5, column: '4' })).toMatchObject({
      line: null,
      column: null,
    })
  })

  it('collapses control characters and caps a long file', () => {
    const dirty = normalizeSourceContext({ ...valid, file: 'src/\u0000App\n.jsx' })
    expect(dirty?.file).toBe('src/ App .jsx')

    const long = normalizeSourceContext({ ...valid, file: 'a'.repeat(900) })
    expect(Array.from(long!.file)).toHaveLength(512)
    expect(long!.file.endsWith('…')).toBe(true)
  })
})
