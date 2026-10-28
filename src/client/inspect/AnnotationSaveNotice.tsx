/**
 * Save notice (T034 rework): the confirmation shown after a bubble saves.
 *
 * G3 measured 4–5 actions from pick to composer because the preview tab had no
 * send entry — the user had to open the queue first. This notice puts "Send to
 * chat" where the save lands, so pick → save → send is three clicks. Sending is
 * still explicit: nothing fires on mount or on save, and a failed handoff keeps
 * the draft in the queue for retry.
 */
import * as React from 'react'
import type { Annotation } from '../../contracts/annotation'
import { createTranslator, type Locale } from '../i18n'
import {
  clipboardSender,
  sendQueuedAnnotation,
  type AnnotationSender,
} from './AnnotationQueue'

export interface AnnotationSaveNoticeProps {
  readonly locale?: Locale
  readonly annotation: Annotation
  /** False when the history write failed; the annotation is still queued. */
  readonly persisted: boolean
  readonly onViewQueue: () => void
  /** Injectable handoff; the shell passes the composer sender. */
  readonly send?: AnnotationSender
}

type NoticeSend =
  | { readonly status: 'idle' }
  | { readonly status: 'pending' }
  | { readonly status: 'done'; readonly ok: boolean; readonly message: string }

const noticeStyle: React.CSSProperties = {
  position: 'absolute',
  right: 8,
  bottom: 8,
  zIndex: 5,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: 0,
  padding: '3px 6px 3px 8px',
  borderRadius: 4,
  background: 'rgba(0, 0, 0, 0.72)',
  color: '#e6e6e6',
  font: '11px/1.4 system-ui, sans-serif',
}

const noticeButtonStyle: React.CSSProperties = {
  font: 'inherit',
  padding: '1px 6px',
  borderRadius: 3,
  border: '1px solid rgba(255, 255, 255, 0.4)',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

export function AnnotationSaveNotice({
  locale,
  annotation,
  persisted,
  onViewQueue,
  send = clipboardSender,
}: AnnotationSaveNoticeProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const [state, setState] = React.useState<NoticeSend>({ status: 'idle' })

  const sending = state.status === 'pending'
  const sent = state.status === 'done' && state.ok

  const handleSend = async (): Promise<void> => {
    if (sending) return
    setState({ status: 'pending' })
    const result = await sendQueuedAnnotation(annotation, send, {
      sent: t('annotation.item.sent'),
      failed: t('annotation.item.sendFailed'),
    })
    setState({ status: 'done', ok: result.ok, message: result.message })
  }

  return (
    <div data-vibe-annotation-notice="1" role="status" style={noticeStyle}>
      <span data-vibe-annotation-notice-text="1">
        {state.status === 'done'
          ? state.message
          : persisted
            ? t('annotation.bubble.saved')
            : t('annotation.history.saveFailed')}
      </span>
      {sent ? null : (
        <button
          type="button"
          data-vibe-annotation-send-now="1"
          style={noticeButtonStyle}
          disabled={sending}
          onClick={() => void handleSend()}
        >
          {sending ? t('annotation.item.sending') : t('annotation.item.send')}
        </button>
      )}
      <button
        type="button"
        data-vibe-annotation-view="1"
        style={noticeButtonStyle}
        onClick={onViewQueue}
      >
        {t('annotation.queue.view')}
      </button>
    </div>
  )
}
