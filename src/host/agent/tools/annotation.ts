/**
 * T048: `vibe_annotation_get` — reopen one saved annotation by id.
 *
 * The user's comment is an instruction and stays outside the untrusted
 * wrapper; everything derived from the page (selector, tag, text, markup,
 * source location) appears inside the `content` block produced by
 * `renderAnnotationText`, so the model can tell data from instruction.
 *
 * `element.html` is deliberately not duplicated as a structured field: the
 * wrapped `content` is the one canonical view of the page markup, and keeping
 * a raw copy outside the wrapper would undercut that boundary.
 */
import {
  ELEMENT_TEXT_CHARS,
  OBSERVE_BUDGET_BYTES,
  truncateChars,
  truncateUtf8,
  utf8Bytes,
} from '../../../contracts/budget'
import type { Annotation } from '../../../contracts/annotation'
import { renderAnnotationText } from '../../../contracts/annotation'
import type { ElementContext } from '../../../contracts/inspect'
import type { VibeToolRunContext } from './register'

export interface AnnotationToolDeps {
  readonly history: {
    get(params?: unknown): Promise<Annotation>
  }
}

export interface AnnotationElementOutput {
  readonly selector: string
  readonly unique: boolean
  readonly tag: string
  readonly role?: string
  readonly name?: string
  readonly text: string
  readonly visible: boolean
  readonly source?: {
    readonly framework: string
    readonly via: string
    readonly file: string
    readonly line?: number
    readonly column?: number
  }
}

export interface AnnotationToolOutput {
  readonly id: string
  readonly targetId: string
  readonly createdAt: string
  readonly source: string
  readonly comment: string
  readonly element?: AnnotationElementOutput
  readonly content: string
}

function elementOutput(element: ElementContext): AnnotationElementOutput {
  const source = element.source
  return {
    selector: element.selector,
    unique: element.unique,
    tag: element.tag,
    ...(element.role === null ? {} : { role: element.role }),
    ...(element.name ? { name: truncateChars(element.name, ELEMENT_TEXT_CHARS) } : {}),
    text: truncateChars(element.text, ELEMENT_TEXT_CHARS),
    visible: element.visible,
    ...(source
      ? {
          source: {
            framework: source.framework,
            via: source.via,
            file: source.file,
            ...(source.line === null ? {} : { line: source.line }),
            ...(source.column === null ? {} : { column: source.column }),
          },
        }
      : {}),
  }
}

/**
 * One annotation as the model sees it; `content` is the prompt-ready block.
 *
 * The comment is repeated (structured field plus renderer), so a long comment
 * could push the JSON past the 8 KB tool budget; shrinking it here keeps the
 * payload parseable instead of letting the registry cut it mid-string.
 */
export function toAnnotationToolOutput(annotation: Annotation): AnnotationToolOutput {
  const element = annotation.element
  let comment = annotation.comment
  const build = (): AnnotationToolOutput => ({
    id: annotation.id,
    targetId: annotation.targetId,
    createdAt: annotation.createdAt,
    source: annotation.source,
    comment,
    ...(element ? { element: elementOutput(element) } : {}),
    content: renderAnnotationText(annotation),
  })

  let output = build()
  let steps = 0
  while (utf8Bytes(JSON.stringify(output)) > OBSERVE_BUDGET_BYTES && steps < 16) {
    steps += 1
    const over = utf8Bytes(JSON.stringify(output)) - OBSERVE_BUDGET_BYTES
    const next = Math.max(0, utf8Bytes(comment) - over - 32)
    if (next === utf8Bytes(comment)) break
    comment = truncateUtf8(comment, next)
    output = build()
  }
  return output
}

/** Typed view of the handler; assignable to `VibeToolHandler` for registration. */
export type AnnotationGetHandler = (
  args: Readonly<Record<string, unknown>>,
  exec: VibeToolRunContext,
) => Promise<AnnotationToolOutput>

export function createAnnotationGetHandler(deps: AnnotationToolDeps): AnnotationGetHandler {
  return async (args): Promise<AnnotationToolOutput> => {
    const annotation = await deps.history.get({ id: args.id })
    return toAnnotationToolOutput(annotation)
  }
}
