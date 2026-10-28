/**
 * Annotation queue (T031): drafts sit in the side panel until the user sends
 * them, where the bubble's flow (pick → type → save) leaves off. The queue is a
 * module-level store because the bubble lives on the preview page while the list
 * lives on the Annotations tab; switching tabs unmounts one and keeps the other.
 *
 * Sending is explicit and never automatic. Until T032 wires the composer, the
 * default sender copies `renderAnnotationText` to the clipboard (the S2 fallback)
 * and the caller can inject the real handoff.
 *
 * Persistence, search and history are T033; this store lives for the panel
 * session only.
 */
import * as React from 'react'
import {
  isAnnotation,
  renderAnnotationText,
  type Annotation,
} from '../../contracts/annotation'
import { asTargetId } from '../../contracts/ids'
import type { ElementContext } from '../../contracts/inspect'
import { createTranslator, type Locale } from '../i18n'
import { EmptyState } from '../shell/StateViews'
import { ANNOTATION_COMMENT_MAX_CHARS } from './AnnotationBubble'

/**
 * A sender receives the stored annotation and its rendered text (≤ 4 KB) and
 * may return the success message to show (T032 will report where it landed).
 */
export type AnnotationSender = (
  annotation: Annotation,
  text: string,
) => Promise<string | void>

let idCounter = 0

/** Ids double as file names later (T033), so keep them in the contract's shape. */
export function newAnnotationId(now: number = Date.now()): string {
  idCounter = (idCounter + 1) % 46_656
  return `a-${now.toString(36)}-${idCounter.toString(36)}`
}

export interface NewElementAnnotation {
  readonly targetId: string
  readonly comment: string
  readonly element: ElementContext
  readonly id?: string
  readonly createdAt?: string
}

export function createElementAnnotation(input: NewElementAnnotation): Annotation {
  return {
    id: input.id ?? newAnnotationId(),
    targetId: asTargetId(input.targetId),
    createdAt: input.createdAt ?? new Date().toISOString(),
    source: 'element',
    comment: input.comment.trim(),
    element: input.element,
  }
}

let entries: readonly Annotation[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

/** Stable until the next mutation, as `useSyncExternalStore` requires. */
export function annotationQueueSnapshot(): readonly Annotation[] {
  return entries
}

export function subscribeAnnotationQueue(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Adds a draft at the top; a repeated id replaces the old entry. */
export function addAnnotationToQueue(annotation: Annotation): boolean {
  if (!isAnnotation(annotation)) return false
  entries = [annotation, ...entries.filter((entry) => entry.id !== annotation.id)]
  emit()
  return true
}

/** Edits a queued comment. Empty or unknown ids are rejected. */
export function updateQueuedAnnotation(id: string, comment: string): boolean {
  const next = comment.trim()
  if (next.length === 0) return false
  const index = entries.findIndex((entry) => entry.id === id)
  if (index < 0) return false
  const updated: Annotation = { ...entries[index]!, comment: next }
  entries = entries.map((entry, position) => (position === index ? updated : entry))
  emit()
  return true
}

export function removeQueuedAnnotation(id: string): boolean {
  const next = entries.filter((entry) => entry.id !== id)
  if (next.length === entries.length) return false
  entries = next
  emit()
  return true
}

/** Tests and a future "discard all" use this; the panel session owns the data. */
export function clearAnnotationQueue(): void {
  if (entries.length === 0) return
  entries = []
  emit()
}

export function useAnnotationQueue(): readonly Annotation[] {
  return React.useSyncExternalStore(
    subscribeAnnotationQueue,
    annotationQueueSnapshot,
    annotationQueueSnapshot,
  )
}

/**
 * T031 fallback sender: put the rendered annotation on the clipboard so it can
 * be pasted into the conversation. T032 replaces this with the composer API.
 */
export async function copyAnnotationToClipboard(
  annotation: Annotation,
  text: string = renderAnnotationText(annotation),
): Promise<void> {
  const clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard
  if (clipboard === null || typeof clipboard.writeText !== 'function') {
    throw new Error('clipboard unavailable')
  }
  await clipboard.writeText(text)
}

const defaultSender: AnnotationSender = (annotation) => copyAnnotationToClipboard(annotation)

const listStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  margin: 0,
  padding: 12,
  listStyle: 'none',
}

const itemStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: 8,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.3))',
  borderRadius: 6,
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const selectorStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  padding: '2px 6px',
  borderRadius: 4,
  background: 'rgba(127, 127, 127, 0.12)',
  font: '11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const timeStyle: React.CSSProperties = {
  flex: '0 0 auto',
  font: '10px/1.4 system-ui, sans-serif',
  opacity: 0.6,
}

const metaStyle: React.CSSProperties = {
  margin: 0,
  font: '10px/1.4 system-ui, sans-serif',
  opacity: 0.65,
  overflowWrap: 'anywhere',
}

const commentStyle: React.CSSProperties = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  font: '12px/1.5 system-ui, sans-serif',
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
}

const actionBaseStyle: React.CSSProperties = {
  font: 'inherit',
  padding: '2px 8px',
  borderRadius: 4,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

const sendStyle: React.CSSProperties = {
  ...actionBaseStyle,
  borderColor: 'var(--dsw-accent-color, #3b82f6)',
  background: 'rgba(59, 130, 246, 0.18)',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  resize: 'vertical',
  minHeight: 48,
  padding: '4px 6px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
}

const footerStyle: React.CSSProperties = {
  margin: 0,
  padding: '0 12px 12px',
  font: '10px/1.5 system-ui, sans-serif',
  opacity: 0.65,
}

function feedbackStyle(kind: 'success' | 'error'): React.CSSProperties {
  return {
    margin: 0,
    padding: '0 12px 8px',
    font: '11px/1.5 system-ui, sans-serif',
    color:
      kind === 'success'
        ? 'var(--dsw-success-color, #2ea043)'
        : 'var(--dsw-danger-color, #d14343)',
  }
}

/** A source path is page data; the queue only needs its last segment. */
function sourceLeaf(file: string): string {
  const parts = file.split(/[\\/]/)
  const leaf = parts[parts.length - 1] ?? file
  return leaf.length > 0 ? leaf : file
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

interface QueueFeedback {
  readonly kind: 'success' | 'error'
  readonly message: string
}

export interface AnnotationQueueProps {
  readonly locale?: Locale
  /** Injectable handoff; defaults to the clipboard fallback until T032. */
  readonly send?: AnnotationSender
  /**
   * Optional history write-through; the shell injects the T033 saver. Edits
   * stay valid in the queue even when persistence fails.
   */
  readonly persist?: (annotation: Annotation) => Promise<boolean>
}

/**
 * The side-panel queue. Items can be edited, sent or removed; sending removes
 * the draft only after the sender resolves, so a failed handoff never loses the
 * comment.
 */
export function AnnotationQueue({
  locale,
  send = defaultSender,
  persist,
}: AnnotationQueueProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const queue = useAnnotationQueue()
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState('')
  const [editWarned, setEditWarned] = React.useState(false)
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [feedback, setFeedback] = React.useState<QueueFeedback | null>(null)

  const startEdit = (annotation: Annotation): void => {
    setEditingId(annotation.id)
    setDraft(annotation.comment)
    setEditWarned(false)
  }

  const saveEdit = (id: string): void => {
    if (draft.trim().length === 0) {
      setEditWarned(true)
      return
    }
    const current = queue.find((entry) => entry.id === id) ?? null
    if (!updateQueuedAnnotation(id, draft)) return
    setEditingId(null)
    setEditWarned(false)
    if (!persist || !current) return
    const updated: Annotation = { ...current, comment: draft.trim() }
    setFeedback(null)
    void persist(updated).then((saved) => {
      if (!saved) {
        setFeedback({ kind: 'error', message: t('annotation.history.saveFailed') })
      }
    })
  }

  const handleSend = async (annotation: Annotation): Promise<void> => {
    if (pendingId !== null) return
    setPendingId(annotation.id)
    setFeedback(null)
    try {
      const message = await send(annotation, renderAnnotationText(annotation))
      removeQueuedAnnotation(annotation.id)
      setFeedback({
        kind: 'success',
        message: typeof message === 'string' && message.length > 0 ? message : t('annotation.item.sent'),
      })
    } catch {
      setFeedback({ kind: 'error', message: t('annotation.item.sendFailed') })
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div data-vibe-annotation-queue="1">
      {queue.length === 0 ? (
        <EmptyState
          title={t('annotation.queue.empty.title')}
          body={t('page.annotations.empty')}
        />
      ) : (
        <ol data-vibe-annotation-list="1" style={listStyle}>
        {queue.map((annotation) => {
          const element = annotation.element
          const source = element?.source ?? null
          const sourceText = source
            ? `${sourceLeaf(source.file)}${source.line === null ? '' : `:${source.line}`}`
            : null
          const editing = editingId === annotation.id
          const pending = pendingId === annotation.id
          return (
            <li key={annotation.id} data-vibe-annotation-item={annotation.id} style={itemStyle}>
              <div style={headerStyle}>
                <code
                  data-vibe-annotation-selector="1"
                  title={element?.selector}
                  style={selectorStyle}
                >
                  {element?.selector ?? t('annotation.item.noElement')}
                </code>
                <span data-vibe-annotation-time="1" title={annotation.createdAt} style={timeStyle}>
                  {formatTime(annotation.createdAt)}
                </span>
              </div>
              {sourceText === null ? null : (
                <p data-vibe-annotation-source="1" title={source!.file} style={metaStyle}>
                  {sourceText}
                </p>
              )}
              {editing ? (
                <div style={{ display: 'grid', gap: 6 }}>
                  <textarea
                    data-vibe-annotation-edit-input="1"
                    aria-label={t('annotation.bubble.placeholder')}
                    value={draft}
                    maxLength={ANNOTATION_COMMENT_MAX_CHARS}
                    rows={3}
                    style={inputStyle}
                    onChange={(event) => {
                      setDraft(event.target.value)
                      if (editWarned) setEditWarned(false)
                    }}
                  />
                  {editWarned ? (
                    <p role="status" style={feedbackStyle('error')} data-vibe-edit-warning="1">
                      {t('annotation.item.editEmpty')}
                    </p>
                  ) : null}
                  <div style={actionsStyle}>
                    <button
                      type="button"
                      data-vibe-annotation-edit-save="1"
                      style={sendStyle}
                      onClick={() => saveEdit(annotation.id)}
                    >
                      {t('annotation.item.save')}
                    </button>
                    <button
                      type="button"
                      data-vibe-annotation-edit-cancel="1"
                      style={actionBaseStyle}
                      onClick={() => {
                        setEditingId(null)
                        setEditWarned(false)
                      }}
                    >
                      {t('annotation.item.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p data-vibe-annotation-comment="1" style={commentStyle}>
                    {annotation.comment}
                  </p>
                  <div style={actionsStyle}>
                    <button
                      type="button"
                      data-vibe-annotation-send="1"
                      style={sendStyle}
                      disabled={pendingId !== null}
                      onClick={() => void handleSend(annotation)}
                    >
                      {pending ? t('annotation.item.sending') : t('annotation.item.send')}
                    </button>
                    <button
                      type="button"
                      data-vibe-annotation-edit="1"
                      style={actionBaseStyle}
                      disabled={pendingId !== null}
                      onClick={() => startEdit(annotation)}
                    >
                      {t('annotation.item.edit')}
                    </button>
                    <button
                      type="button"
                      data-vibe-annotation-remove="1"
                      style={actionBaseStyle}
                      disabled={pendingId !== null}
                      onClick={() => removeQueuedAnnotation(annotation.id)}
                    >
                      {t('annotation.item.remove')}
                    </button>
                  </div>
                </>
              )}
            </li>
          )
        })}
        </ol>
      )}
      {feedback === null ? null : (
        <p
          data-vibe-annotation-status={feedback.kind}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          style={feedbackStyle(feedback.kind)}
        >
          {feedback.message}
        </p>
      )}
      {queue.length === 0 ? null : (
        <p data-vibe-annotation-hint="1" style={footerStyle}>
          {t('annotation.queue.hint')}
        </p>
      )}
    </div>
  )
}
