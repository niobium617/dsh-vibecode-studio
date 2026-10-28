/**
 * Comment bubble for a picked element (T031).
 *
 * The picked element's box is in viewport pixels; the preview draws the frame
 * into a letterboxed box inside the stage, so the bubble is anchored by scaling
 * the box into the stage and clamping it there. Saving only adds the annotation
 * to the queue — the composer handoff is T032, so nothing here sends anything.
 */
import * as React from 'react'
import type { ElementBox, ElementContext } from '../../contracts/inspect'
import { createTranslator, type Locale } from '../i18n'

/** Fixed footprint used for clamping; the CSS width matches it. */
export const BUBBLE_WIDTH = 240
export const BUBBLE_HEIGHT = 168
export const BUBBLE_GAP = 6
export const BUBBLE_MARGIN = 4
/** Keeps a single comment comfortably inside the 4 KB annotation budget. */
export const ANNOTATION_COMMENT_MAX_CHARS = 2_000

export interface BubbleFrame {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface BubbleGeometry {
  readonly box: ElementBox
  readonly viewport: { readonly width: number; readonly height: number }
  /** The drawn frame's offset and size inside the preview stage. */
  readonly frame: BubbleFrame
}

export interface BubblePlacement {
  readonly left: number
  readonly top: number
  readonly side: 'above' | 'below'
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * Places the bubble below the element when it fits, otherwise above it; either
 * way it stays inside the frame so a pick near an edge never pushes it out.
 */
export function placeBubble({ box, viewport, frame }: BubbleGeometry): BubblePlacement {
  const viewportWidth = viewport.width > 0 ? viewport.width : 1
  const viewportHeight = viewport.height > 0 ? viewport.height : 1
  const scaleX = frame.width / viewportWidth
  const scaleY = frame.height / viewportHeight

  const elementLeft = frame.left + box.x * scaleX
  const elementTop = frame.top + box.y * scaleY
  const elementBottom = frame.top + (box.y + box.height) * scaleY

  const minLeft = frame.left + BUBBLE_MARGIN
  const maxLeft = frame.left + frame.width - BUBBLE_WIDTH - BUBBLE_MARGIN
  const minTop = frame.top + BUBBLE_MARGIN
  const maxTop = frame.top + frame.height - BUBBLE_HEIGHT - BUBBLE_MARGIN

  const below = elementBottom + BUBBLE_GAP
  const above = elementTop - BUBBLE_HEIGHT - BUBBLE_GAP
  const useAbove = below > maxTop && above >= minTop

  return {
    left: Math.round(clamp(elementLeft, minLeft, maxLeft)),
    top: Math.round(clamp(useAbove ? above : below, minTop, maxTop)),
    side: useAbove ? 'above' : 'below',
  }
}

const bubbleStyle: React.CSSProperties = {
  position: 'absolute',
  zIndex: 6,
  display: 'grid',
  gap: 6,
  width: BUBBLE_WIDTH,
  boxSizing: 'border-box',
  padding: '6px 8px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 6,
  background: 'var(--dsw-surface-color, Canvas)',
  color: 'var(--dsw-text-primary, CanvasText)',
  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.28)',
  font: '12px/1.5 system-ui, sans-serif',
}

const anchorStyle: React.CSSProperties = {
  display: 'block',
  padding: '2px 6px',
  borderRadius: 4,
  background: 'rgba(127, 127, 127, 0.12)',
  font: '11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  resize: 'vertical',
  minHeight: 54,
  padding: '4px 6px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
}

const actionBaseStyle: React.CSSProperties = {
  font: 'inherit',
  padding: '3px 8px',
  borderRadius: 4,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

const saveStyle: React.CSSProperties = {
  ...actionBaseStyle,
  borderColor: 'var(--dsw-accent-color, #3b82f6)',
  background: 'rgba(59, 130, 246, 0.18)',
}

const hintBaseStyle: React.CSSProperties = {
  margin: 0,
  font: '10px/1.4 system-ui, sans-serif',
  opacity: 0.7,
}

const warnStyle: React.CSSProperties = {
  ...hintBaseStyle,
  opacity: 1,
  color: 'var(--dsw-danger-color, #d14343)',
}

export interface AnnotationBubbleProps {
  readonly locale?: Locale
  readonly element: ElementContext
  readonly placement: BubblePlacement
  /** Receives the trimmed comment; the caller adds it to the queue. */
  onSave(comment: string): void
  onCancel(): void
}

/**
 * The comment editor shown next to the picked element. The flow is pick → type
 * → save, so the textarea takes focus and the primary button is the only one
 * styled as an action.
 */
export function AnnotationBubble({
  locale,
  element,
  placement,
  onSave,
  onCancel,
}: AnnotationBubbleProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const [comment, setComment] = React.useState('')
  const [warned, setWarned] = React.useState(false)
  const commentText = comment.trim()

  const submit = (): void => {
    if (commentText.length === 0) {
      setWarned(true)
      return
    }
    onSave(commentText)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      submit()
    }
  }

  const classes = element.classes.length > 0 ? `.${element.classes.join('.')}` : ''
  return (
    <div
      data-vibe-annotation-bubble="1"
      data-side={placement.side}
      role="group"
      aria-label={t('annotation.bubble.title')}
      style={{ ...bubbleStyle, left: placement.left, top: placement.top }}
    >
      <code style={anchorStyle} title={element.selector}>
        {element.tag}
        {classes}
      </code>
      <textarea
        data-vibe-annotation-input="1"
        aria-label={t('annotation.bubble.placeholder')}
        placeholder={t('annotation.bubble.placeholder')}
        value={comment}
        maxLength={ANNOTATION_COMMENT_MAX_CHARS}
        rows={3}
        autoFocus
        style={inputStyle}
        onChange={(event) => {
          setComment(event.target.value)
          if (warned) setWarned(false)
        }}
        onKeyDown={onKeyDown}
      />
      <div style={actionsStyle}>
        <button type="button" data-vibe-annotation-save="1" style={saveStyle} onClick={submit}>
          {t('annotation.bubble.save')}
        </button>
        <button
          type="button"
          data-vibe-annotation-cancel="1"
          style={actionBaseStyle}
          onClick={onCancel}
        >
          {t('annotation.bubble.cancel')}
        </button>
      </div>
      <p
        data-vibe-annotation-hint={warned ? 'warn' : 'hint'}
        role={warned ? 'status' : undefined}
        style={warned ? warnStyle : hintBaseStyle}
      >
        {warned ? t('annotation.bubble.empty') : t('annotation.bubble.hint')}
      </p>
    </div>
  )
}
