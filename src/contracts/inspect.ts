/**
 * The picker's wire shape. It mirrors the S4 spike result so the page overlay,
 * host and annotation renderer can share one contract.
 */

export const SOURCE_FRAMEWORKS = ['react', 'vue', 'svelte', 'unknown'] as const
export type SourceFramework = (typeof SOURCE_FRAMEWORKS)[number]

export interface SourceContext {
  readonly framework: SourceFramework
  readonly via: string
  readonly file: string
  readonly line: number | null
  readonly column: number | null
}

export interface ElementBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ElementContext {
  readonly selector: string
  readonly unique: boolean
  readonly tag: string
  readonly id: string | null
  readonly classes: readonly string[]
  /** Explicit or implicit ARIA role, e.g. `button`; null when unknown. */
  readonly role: string | null
  /** Accessible name, not the `name` attribute. */
  readonly name: string
  readonly text: string
  readonly html: string
  /** Whether the element had a non-zero box and was not CSS-hidden. */
  readonly visible: boolean
  readonly box: ElementBox
  readonly source: SourceContext | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function isSourceContext(value: unknown): value is SourceContext {
  if (!isRecord(value)) return false
  const framework = value.framework
  return (
    typeof framework === 'string' &&
    (SOURCE_FRAMEWORKS as readonly string[]).includes(framework) &&
    typeof value.via === 'string' &&
    typeof value.file === 'string' &&
    (value.line === null ||
      (typeof value.line === 'number' && Number.isInteger(value.line) && value.line >= 0)) &&
    (value.column === null ||
      (typeof value.column === 'number' && Number.isInteger(value.column) && value.column >= 0))
  )
}

function isElementBox(value: unknown): value is ElementBox {
  if (!isRecord(value)) return false
  return (
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height)
  )
}

export function isElementContext(value: unknown): value is ElementContext {
  if (!isRecord(value)) return false
  return (
    typeof value.selector === 'string' &&
    value.selector.length > 0 &&
    typeof value.unique === 'boolean' &&
    typeof value.tag === 'string' &&
    value.tag.length > 0 &&
    (value.id === null || typeof value.id === 'string') &&
    Array.isArray(value.classes) &&
    value.classes.every((entry) => typeof entry === 'string') &&
    (value.role === null || typeof value.role === 'string') &&
    typeof value.name === 'string' &&
    typeof value.text === 'string' &&
    typeof value.html === 'string' &&
    typeof value.visible === 'boolean' &&
    isElementBox(value.box) &&
    (value.source === null || isSourceContext(value.source))
  )
}
