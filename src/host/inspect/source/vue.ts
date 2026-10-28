/**
 * Vue source adapter (T029).
 *
 * `vueSource` runs inside the target page, serialized into the picker script,
 * so it must stay self-contained: no imports and no module-level helpers.
 *
 * Fallback order:
 *   1. The vnode hidden prop `__v_inspector` / the global
 *      `__vue_inspector_store__.vnodeToPos` map filled by
 *      `vite-plugin-vue-inspector`. The plugin deletes the `data-v-inspector`
 *      attribute at runtime and moves the value to a non-enumerable vnode
 *      prop, so reading the DOM attribute alone always misses.
 *   2. A leftover `data-v-inspector` attribute (some plugin versions keep it).
 *   3. The owning component's `__file` — file only, no line, because component
 *      options do not record element positions.
 *   4. `null`.
 */
import type { SourceContext } from '../../../contracts/inspect'

export function vueSource(element: Element): SourceContext | null {
  // Kept inside the function because this source is serialized into the page.
  const MAX_FILE_CHARS = 512
  const MAX_POSITION = 1_000_000
  const MAX_VNODE_DEPTH = 64

  const cleanFile = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const cleaned = value
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (cleaned.length === 0) return null
    return cleaned.slice(0, MAX_FILE_CHARS)
  }

  const position = (value: unknown): number | null => {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null
    if (value < 0 || value > MAX_POSITION) return null
    return value
  }

  /** `file:line:column`, the shape the Vue inspector plugin records. */
  const parsePosition = (raw: unknown): [string, number | null, number | null] | null => {
    if (typeof raw !== 'string') return null
    const match = raw.match(/^(.+):(\d+):(\d+)$/)
    if (!match) return null
    const file = cleanFile(match[1])
    if (!file) return null
    return [file, position(Number(match[2])), position(Number(match[3]))]
  }

  const arrayPosition = (value: unknown): [string, number | null, number | null] | null => {
    if (!Array.isArray(value) || value.length < 3) return null
    const file = cleanFile(value[0])
    if (!file) return null
    return [file, position(value[1]), position(value[2])]
  }

  const result = (
    via: string,
    found: [string, number | null, number | null],
  ): SourceContext => ({ framework: 'vue', via, file: found[0], line: found[1], column: found[2] })

  // --- 1. vnode props and the plugin's global store ------------------------
  try {
    const record = element as unknown as {
      __vnode?: {
        props?: Record<string, unknown> | null
        parent?: unknown
        ctx?: { type?: { __file?: unknown } } | null
      } | null
      __vueParentComponent?: { type?: { __file?: unknown } } | null
    }
    const store = (window as unknown as {
      __vue_inspector_store__?: { vnodeToPos?: { get?: (props: unknown) => unknown } }
    }).__vue_inspector_store__
    let vnode: unknown = record.__vnode ?? null
    let depth = 0
    while (vnode && typeof vnode === 'object' && depth < MAX_VNODE_DEPTH) {
      const props = (vnode as { props?: Record<string, unknown> | null }).props
      if (props && typeof props === 'object') {
        const positions = store && store.vnodeToPos ? store.vnodeToPos : null
        const get = positions && typeof positions.get === 'function' ? positions.get : null
        if (positions && get) {
          try {
            const stored = arrayPosition(get.call(positions, props))
            if (stored) return result('__v_inspector', stored)
          } catch {
            // A patched store must not break the pick.
          }
        }
        const hidden = parsePosition(props.__v_inspector)
        if (hidden) return result('__v_inspector', hidden)
      }
      vnode = (vnode as { parent?: unknown }).parent ?? null
      depth += 1
    }

    // 2. A leftover attribute from older plugin versions.
    if (typeof element.closest === 'function') {
      const holder = element.closest('[data-v-inspector]')
      const fromAttr = holder ? parsePosition(holder.getAttribute('data-v-inspector')) : null
      if (fromAttr) return result('data-v-inspector', fromAttr)
    }

    // 3. Component file only.
    const componentFile =
      cleanFile(record.__vueParentComponent?.type?.__file) ??
      cleanFile(record.__vnode?.ctx?.type?.__file)
    if (componentFile) {
      return { framework: 'vue', via: '__file', file: componentFile, line: null, column: null }
    }
  } catch {
    // Vue internals are patched freely by app code; never throw from a pick.
  }

  return null
}
