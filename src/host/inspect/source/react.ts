/**
 * React source adapter (T029).
 *
 * `reactSource` runs inside the target page, serialized into the picker
 * script, so it must stay self-contained: no imports and no module-level
 * helpers. It is also best-effort — a page object whose getters throw must
 * degrade to `null`, never break the pick.
 *
 * Fallback order:
 *   1. `data-inspector-*` attributes added at build time by
 *      `@react-dev-inspector/babel-plugin` (dev server only). React 19 dropped
 *      the runtime `_debugSource`, so this is the primary path.
 *   2. The React 18 dev fiber `_debugSource` on the element's fiber chain.
 *   3. `null` — no source metadata; the Host reports it as unavailable.
 */
import type { SourceContext } from '../../../contracts/inspect'

export function reactSource(element: Element): SourceContext | null {
  // Kept inside the function because this source is serialized into the page.
  const MAX_FILE_CHARS = 512
  const MAX_POSITION = 1_000_000
  const MAX_FIBER_DEPTH = 64

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

  const attrPosition = (raw: string | null): number | null => {
    if (raw === null || raw.trim() === '') return null
    return position(Number(raw))
  }

  const result = (
    via: string,
    file: string | null,
    line: number | null,
    column: number | null,
  ): SourceContext | null => {
    if (!file) return null
    return { framework: 'react', via, file, line, column }
  }

  // --- 1. build-time attributes -------------------------------------------
  try {
    if (typeof element.closest === 'function') {
      const holder = element.closest('[data-inspector-relative-path]')
      if (holder) {
        const file = cleanFile(holder.getAttribute('data-inspector-relative-path'))
        if (file) {
          return result(
            'data-inspector',
            file,
            attrPosition(holder.getAttribute('data-inspector-line')),
            attrPosition(holder.getAttribute('data-inspector-column')),
          )
        }
      }
    }
  } catch {
    // Fall through to the fiber walk.
  }

  // --- 2. React 18 dev fiber ----------------------------------------------
  try {
    const record = element as unknown as Record<string, unknown>
    const names = Object.keys(record)
    let key: string | null = null
    for (let index = 0; index < names.length && index < 200; index += 1) {
      if (names[index].indexOf('__reactFiber$') === 0) {
        key = names[index]
        break
      }
    }
    let fiber: unknown = key === null ? null : record[key]
    let depth = 0
    while (fiber && typeof fiber === 'object' && depth < MAX_FIBER_DEPTH) {
      const debug = (fiber as { _debugSource?: { fileName?: unknown; lineNumber?: unknown; columnNumber?: unknown } })
        ._debugSource
      if (debug) {
        const found = result(
          'fiber._debugSource',
          cleanFile(debug.fileName),
          position(debug.lineNumber),
          position(debug.columnNumber),
        )
        if (found) return found
      }
      fiber = (fiber as { return?: unknown }).return ?? null
      depth += 1
    }
  } catch {
    // The fiber chain is internal React state; a patched object must not throw.
  }

  return null
}
