/**
 * Source adapters (T029): the page-side extractors live in `react.ts`,
 * `vue.ts` and `svelte.ts`; this module owns the Host-side validator.
 *
 * The page is untrusted: even our own binding can be called by page script, so
 * `normalizePickedElement` re-validates whatever `source` object arrives here
 * before it reaches an `ElementContext` or an annotation. Unknown extra keys
 * are dropped, positions outside the cap become `null`, and `via` must look
 * like an adapter tag so the fallback path stays explainable.
 */
import { SOURCE_FRAMEWORKS, type SourceContext, type SourceFramework } from '../../../contracts/inspect'

/** Adapter tags the page extractors report; `via` answers "how did we find it". */
export const SOURCE_VIAS = [
  'data-inspector',
  'fiber._debugSource',
  '__v_inspector',
  'data-v-inspector',
  '__file',
  '__svelte_meta',
] as const

const MAX_SOURCE_FILE_CHARS = 512
const MAX_SOURCE_VIA_CHARS = 64
const MAX_SOURCE_POSITION = 1_000_000

function isFramework(value: unknown): value is SourceFramework {
  return typeof value === 'string' && (SOURCE_FRAMEWORKS as readonly string[]).includes(value)
}

function normalizeFile(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value
    // Control characters and newlines would corrupt the annotation text.
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length === 0) return null
  const chars = Array.from(cleaned)
  if (chars.length <= MAX_SOURCE_FILE_CHARS) return cleaned
  return chars.slice(0, MAX_SOURCE_FILE_CHARS - 1).join('') + '…'
}

function normalizeVia(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const token = value.trim()
  if (token.length === 0 || token.length > MAX_SOURCE_VIA_CHARS) return null
  return /^[A-Za-z_$][\w.$:-]*$/.test(token) ? token : null
}

function normalizePosition(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < 0 || value > MAX_SOURCE_POSITION) return null
  return value
}

/**
 * Returns a fresh, bounded `SourceContext`, or `null` when the payload is not
 * a source at all. A missing `line`/`column` keeps the file: component-level
 * fallbacks (Vue `__file`) are still useful to a reader.
 */
export function normalizeSourceContext(value: unknown): SourceContext | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (!isFramework(record.framework)) return null
  const file = normalizeFile(record.file)
  const via = normalizeVia(record.via)
  if (!file || !via) return null
  return {
    framework: record.framework,
    via,
    file,
    line: normalizePosition(record.line),
    column: normalizePosition(record.column),
  }
}
