/**
 * Svelte source adapter (T029).
 *
 * `svelteSource` runs inside the target page, serialized into the picker
 * script, so it must stay self-contained: no imports and no module-level
 * helpers.
 *
 * Svelte 5's dev runtime attaches `__svelte_meta = { parent, loc: { file,
 * line, column } }` while mounting; production builds drop it. The element
 * usually carries the metadata itself, but walking up the ancestors also
 * covers component boundaries and Svelte 4 (`add_location`).
 */
import type { SourceContext } from '../../../contracts/inspect'

export function svelteSource(element: Element): SourceContext | null {
  // Kept inside the function because this source is serialized into the page.
  const MAX_FILE_CHARS = 512
  const MAX_POSITION = 1_000_000
  const MAX_DEPTH = 64

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

  try {
    let node: Element | null = element
    let depth = 0
    while (node && depth < MAX_DEPTH) {
      const loc = (node as unknown as {
        __svelte_meta?: { loc?: { file?: unknown; line?: unknown; column?: unknown } } | null
      }).__svelte_meta?.loc
      const file = loc ? cleanFile(loc.file) : null
      if (file) {
        return {
          framework: 'svelte',
          via: '__svelte_meta',
          file,
          line: position(loc?.line),
          column: position(loc?.column),
        }
      }
      node = node.parentElement
      depth += 1
    }
  } catch {
    // A proxied/patched element must not break the pick.
  }

  return null
}
