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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isAnnotation(value: unknown): value is Annotation {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    ANNOTATION_ID_PATTERN.test(value.id) &&
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
    `text: ${truncateChars(element.text, ELEMENT_TEXT_CHARS)}`,
    `html: ${truncateUtf8(element.html, DOM_SNIPPET_BYTES)}`,
    `box: ${element.box.x},${element.box.y} ${element.box.width}x${element.box.height}`,
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
