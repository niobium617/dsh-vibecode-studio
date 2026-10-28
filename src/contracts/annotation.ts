import {
  ANNOTATION_BUDGET_BYTES,
  DOM_SNIPPET_BYTES,
  ELEMENT_TEXT_CHARS,
  truncateChars,
  truncateUtf8,
  utf8Bytes,
} from './budget'
import { studioError } from './errors'
import { isSessionId, isTargetId, type SessionId, type TargetId } from './ids'
import { isElementContext, type ElementContext } from './inspect'
import { wrapUntrustedPageContent } from './untrusted'

export const ANNOTATION_SOURCES = ['element', 'region', 'manual'] as const
export type AnnotationSourceKind = (typeof ANNOTATION_SOURCES)[number]

export interface Annotation {
  readonly id: string
  readonly targetId: TargetId
  readonly sessionId?: SessionId
  readonly createdAt: string
  readonly source: AnnotationSourceKind
  readonly comment: string
  readonly element?: ElementContext
}

const ANNOTATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/**
 * Ids double as file names in `.vibe/annotations/<id>.json`, so the pattern is
 * deliberately narrow: no separators, no leading dot, never an empty stem.
 */
export function isAnnotationId(value: unknown): value is string {
  return typeof value === 'string' && ANNOTATION_ID_PATTERN.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isAnnotation(value: unknown): value is Annotation {
  if (!isRecord(value)) return false
  return (
    isAnnotationId(value.id) &&
    isTargetId(value.targetId) &&
    (value.sessionId === undefined || isSessionId(value.sessionId)) &&
    typeof value.createdAt === 'string' &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    typeof value.source === 'string' &&
    (ANNOTATION_SOURCES as readonly string[]).includes(value.source) &&
    typeof value.comment === 'string' &&
    (value.element === undefined || isElementContext(value.element))
  )
}

export function serializeAnnotation(annotation: Annotation): string {
  if (!isAnnotation(annotation)) {
    throw studioError('invalid_input', 'cannot serialize an invalid annotation')
  }
  return JSON.stringify(annotation)
}

export function deserializeAnnotation(json: string): Annotation {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw studioError('invalid_input', 'annotation is not valid JSON')
  }
  if (!isAnnotation(parsed)) {
    throw studioError('invalid_input', 'annotation payload has an invalid shape')
  }
  return parsed
}

/**
 * Annotation history (T033). The Host lists `.vibe/annotations` and the panel
 * searches it; entries are summaries because the full element context (up to
 * 2 KB of HTML) is only needed when one annotation is reopened.
 */
export const ANNOTATION_HISTORY_QUERY_MAX_CHARS = 200
export const ANNOTATION_HISTORY_LIMIT_DEFAULT = 50
export const ANNOTATION_HISTORY_LIMIT_MAX = 200
export const ANNOTATION_HISTORY_COMMENT_PREVIEW_CHARS = 300

export interface AnnotationHistoryQuery {
  /** Case-insensitive substring over comment, selector, tag, text and source. */
  readonly query?: string
  /** Maximum entries to return; the default keeps list responses small. */
  readonly limit?: number
}

export interface AnnotationHistoryEntry {
  readonly id: string
  readonly targetId: TargetId
  readonly createdAt: string
  readonly source: AnnotationSourceKind
  /** Comment preview, capped at {@link ANNOTATION_HISTORY_COMMENT_PREVIEW_CHARS}. */
  readonly comment: string
  readonly selector: string | null
  readonly tag: string | null
  readonly sourceFile: string | null
  readonly sourceLine: number | null
}

export interface AnnotationHistoryResult {
  readonly entries: readonly AnnotationHistoryEntry[]
  /** Matching annotations before `limit` was applied. */
  readonly total: number
  /** Files that look like annotations but could not be read or validated. */
  readonly skipped: number
}

export interface AnnotationIdParams {
  readonly id: string
}

export interface AnnotationHistorySaveResult {
  readonly id: string
}

export interface AnnotationHistoryRemoveResult {
  readonly id: string
  readonly removed: boolean
}

const HISTORY_QUERY_KEYS = new Set(['query', 'limit'])

/** Strict query guard; unknown keys and out-of-range limits are rejected. */
export function isAnnotationHistoryQuery(value: unknown): value is AnnotationHistoryQuery {
  if (!isRecord(value)) return false
  if (!Object.keys(value).every((key) => HISTORY_QUERY_KEYS.has(key))) return false
  if (value.query !== undefined) {
    if (typeof value.query !== 'string') return false
    if (value.query.length > ANNOTATION_HISTORY_QUERY_MAX_CHARS) return false
  }
  if (value.limit !== undefined) {
    if (typeof value.limit !== 'number' || !Number.isInteger(value.limit)) return false
    if (value.limit < 1 || value.limit > ANNOTATION_HISTORY_LIMIT_MAX) return false
  }
  return true
}

export function isAnnotationIdParams(value: unknown): value is AnnotationIdParams {
  if (!isRecord(value)) return false
  if (Object.keys(value).length !== 1) return false
  return isAnnotationId(value.id)
}

export function normalizeAnnotationQuery(query: string | undefined): string {
  return (query ?? '').trim().toLowerCase()
}

/**
 * True when the query matches any searchable field. The query is normalised
 * once by the caller; matching stays case-insensitive for CJK and Latin text.
 */
export function matchesAnnotationQuery(annotation: Annotation, query: string): boolean {
  const needle = normalizeAnnotationQuery(query)
  if (needle === '') return true
  const element = annotation.element
  const fields: readonly (string | null | undefined)[] = [
    annotation.id,
    annotation.targetId,
    annotation.comment,
    element?.selector,
    element?.tag,
    element?.name,
    element?.text,
    element?.source?.file,
  ]
  return fields.some(
    (field) => typeof field === 'string' && field.toLowerCase().includes(needle),
  )
}

/** Summary for the history list; never carries the full element context. */
export function toAnnotationHistoryEntry(annotation: Annotation): AnnotationHistoryEntry {
  const element = annotation.element
  return {
    id: annotation.id,
    targetId: annotation.targetId,
    createdAt: annotation.createdAt,
    source: annotation.source,
    comment: truncateChars(annotation.comment, ANNOTATION_HISTORY_COMMENT_PREVIEW_CHARS),
    selector: element?.selector ?? null,
    tag: element?.tag ?? null,
    sourceFile: element?.source?.file ?? null,
    sourceLine: element?.source?.line ?? null,
  }
}

export interface RenderAnnotationOptions {
  readonly budgetBytes?: number
}

const MIN_RENDER_BUDGET_BYTES = 512

function sourceText(element: ElementContext): string {
  const source = element.source
  if (!source) return 'unavailable'
  const location = `${source.file}:${source.line ?? '?'}:${source.column ?? '?'}`
  return `${location} (${source.framework} via ${source.via})`
}

function elementText(element: ElementContext): string {
  return [
    `selector: ${element.selector}${element.unique ? '' : ' (not unique)'}`,
    `tag: ${element.tag}`,
    `id: ${element.id ?? 'none'}`,
    `classes: ${element.classes.join(' ') || 'none'}`,
    `role: ${element.role ?? 'none'}`,
    `name: ${element.name || 'none'}`,
    `text: ${truncateChars(element.text, ELEMENT_TEXT_CHARS)}`,
    `html: ${truncateUtf8(element.html, DOM_SNIPPET_BYTES)}`,
    `box: ${element.box.x},${element.box.y} ${element.box.width}x${element.box.height}`,
    `visible: ${element.visible}`,
    `source: ${sourceText(element)}`,
  ].join('\n')
}

/**
 * Render a compact annotation for the composer/model. Element context is
 * wrapped as untrusted page content; the comment stays outside the wrapper
 * because it is the user's instruction. The result never exceeds the budget.
 */
export function renderAnnotationText(
  annotation: Annotation,
  options: RenderAnnotationOptions = {},
): string {
  if (!isAnnotation(annotation)) {
    throw studioError('invalid_input', 'cannot render an invalid annotation')
  }

  const budget = Math.max(MIN_RENDER_BUDGET_BYTES, options.budgetBytes ?? ANNOTATION_BUDGET_BYTES)
  const head = [
    `Annotation ${annotation.id}`,
    `Target: ${annotation.targetId}`,
    ...(annotation.sessionId ? [`Session: ${annotation.sessionId}`] : []),
    `Created: ${annotation.createdAt}`,
    `Source: ${annotation.source}`,
  ].join('\n')

  const rawElement = annotation.element ? elementText(annotation.element) : 'No element selected.'
  const elementBudget = Math.max(0, budget - utf8Bytes(head) - 512)
  const wrapped = wrapUntrustedPageContent(rawElement, {
    maxContentBytes: Math.min(DOM_SNIPPET_BYTES, elementBudget),
    source: annotation.element ? 'element-context' : undefined,
  })

  const commentLabel = '\n\nComment:\n'
  const elementLabel = '\n\nElement context:\n'
  const fixed = `${head}${commentLabel}${elementLabel}${wrapped}`
  const comment = truncateUtf8(annotation.comment, Math.max(0, budget - utf8Bytes(fixed)))
  return `${head}${commentLabel}${comment}${elementLabel}${wrapped}`
}
