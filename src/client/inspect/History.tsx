/**
 * Annotation history panel (T033). The list is read from the Host, which owns
 * `.vibe/annotations`; search runs there as well so a corrupt or large
 * directory never has to cross the wire whole. Every action is explicit:
 * reopening puts the annotation back in the queue above, deleting asks for a
 * second click, and nothing is ever sent or submitted from this panel.
 */
import * as React from 'react'
import type { AnnotationHistoryEntry } from '../../contracts/annotation'
import { createTranslator, type Locale } from '../i18n'
import { EmptyState, ErrorState, LoadingState } from '../shell/StateViews'
import {
  loadAnnotationHistory,
  removeHistoryAnnotation,
  reopenAnnotationFromHistory,
  searchAnnotationHistory,
  useAnnotationHistory,
} from './history-store'

const sectionStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 12,
  borderTop: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.3))',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  margin: 0,
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  font: '600 12px/1.4 system-ui, sans-serif',
}

const countStyle: React.CSSProperties = {
  font: '10px/1.4 system-ui, sans-serif',
  opacity: 0.6,
}

const searchStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 8px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  font: '12px/1.5 system-ui, sans-serif',
}

const listStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  margin: 0,
  padding: 0,
  listStyle: 'none',
}

const itemStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: 8,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.3))',
  borderRadius: 6,
}

const rowStyle: React.CSSProperties = {
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

const commentStyle: React.CSSProperties = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  font: '12px/1.5 system-ui, sans-serif',
}

const metaStyle: React.CSSProperties = {
  margin: 0,
  font: '10px/1.4 system-ui, sans-serif',
  opacity: 0.65,
  overflowWrap: 'anywhere',
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

const reopenStyle: React.CSSProperties = {
  ...actionBaseStyle,
  borderColor: 'var(--dsw-accent-color, #3b82f6)',
  background: 'rgba(59, 130, 246, 0.18)',
}

const dangerStyle: React.CSSProperties = {
  ...actionBaseStyle,
  borderColor: 'var(--dsw-danger-color, #d14343)',
  color: 'var(--dsw-danger-color, #d14343)',
}

const noteStyle: React.CSSProperties = {
  margin: 0,
  font: '10px/1.5 system-ui, sans-serif',
  opacity: 0.7,
}

function feedbackStyle(kind: 'success' | 'error'): React.CSSProperties {
  return {
    margin: 0,
    font: '11px/1.5 system-ui, sans-serif',
    color:
      kind === 'success'
        ? 'var(--dsw-success-color, #2ea043)'
        : 'var(--dsw-danger-color, #d14343)',
  }
}

/** Source paths are page data; the list only needs the last segment. */
function sourceLeaf(file: string): string {
  const parts = file.split(/[\\/]/)
  const leaf = parts[parts.length - 1] ?? file
  return leaf.length > 0 ? leaf : file
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

interface HistoryFeedback {
  readonly kind: 'success' | 'error'
  readonly message: string
}

export interface AnnotationHistoryProps {
  readonly locale?: Locale
}

export function AnnotationHistory({ locale }: AnnotationHistoryProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const state = useAnnotationHistory()
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null)
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const [feedback, setFeedback] = React.useState<HistoryFeedback | null>(null)

  // The disk is the source of truth, so each mount refreshes the cached list.
  React.useEffect(() => {
    void loadAnnotationHistory()
  }, [])

  const handleReopen = async (entry: AnnotationHistoryEntry): Promise<void> => {
    if (pendingId !== null) return
    setPendingId(entry.id)
    setFeedback(null)
    try {
      await reopenAnnotationFromHistory(entry.id)
      setFeedback({ kind: 'success', message: t('annotation.history.reopened') })
    } catch {
      setFeedback({ kind: 'error', message: t('annotation.history.reopenFailed') })
    } finally {
      setPendingId(null)
    }
  }

  const handleDelete = async (entry: AnnotationHistoryEntry): Promise<void> => {
    if (pendingId !== null) return
    setPendingId(entry.id)
    setFeedback(null)
    try {
      const removed = await removeHistoryAnnotation(entry.id)
      setFeedback({
        kind: 'success',
        message: removed ? t('annotation.history.deleted') : t('annotation.history.gone'),
      })
    } catch {
      setFeedback({ kind: 'error', message: t('annotation.history.deleteFailed') })
    } finally {
      setPendingId(null)
      setConfirmingId(null)
    }
  }

  const searching = state.query.trim() !== ''
  const ready = state.status === 'ready'

  return (
    <section data-vibe-history="1" style={sectionStyle} aria-labelledby="vibe-history-title">
      <div style={headerStyle}>
        <h3 id="vibe-history-title" style={titleStyle}>
          {t('annotation.history.title')}
        </h3>
        <span data-vibe-history-count="1" style={countStyle}>
          {state.total}
        </span>
      </div>

      <input
        type="search"
        data-vibe-history-search="1"
        aria-label={t('annotation.history.search')}
        placeholder={t('annotation.history.searchPlaceholder')}
        value={state.query}
        onChange={(event) => searchAnnotationHistory(event.target.value)}
        style={searchStyle}
      />

      {state.status === 'loading' && state.entries.length === 0 ? (
        <LoadingState label={t('annotation.history.loading')} />
      ) : null}

      {state.status === 'error' ? (
        <ErrorState
          title={t('annotation.history.error.title')}
          body={t('annotation.history.error.body')}
          retryLabel={t('state.error.retry')}
          onRetry={() => void loadAnnotationHistory()}
        />
      ) : null}

      {state.skipped > 0 ? (
        <p data-vibe-history-skipped="1" role="status" style={noteStyle}>
          {t('annotation.history.skipped', { count: state.skipped })}
        </p>
      ) : null}

      {ready && state.entries.length === 0 ? (
        searching ? (
          <EmptyState
            title={t('annotation.history.noMatch.title')}
            body={t('annotation.history.noMatch.body')}
            action={
              <button type="button" style={actionBaseStyle} onClick={() => searchAnnotationHistory('')}>
                {t('annotation.history.clear')}
              </button>
            }
          />
        ) : (
          <EmptyState
            title={t('annotation.history.empty.title')}
            body={t('annotation.history.empty.body')}
          />
        )
      ) : null}

      {state.entries.length > 0 ? (
        <ol data-vibe-history-list="1" style={listStyle}>
          {state.entries.map((entry) => {
            const pending = pendingId === entry.id
            const confirming = confirmingId === entry.id
            return (
              <li key={entry.id} data-vibe-history-item={entry.id} style={itemStyle}>
                <div style={rowStyle}>
                  <code
                    data-vibe-history-selector="1"
                    title={entry.selector ?? undefined}
                    style={selectorStyle}
                  >
                    {entry.selector ?? entry.tag ?? t('annotation.item.noElement')}
                  </code>
                  <span data-vibe-history-time="1" title={entry.createdAt} style={timeStyle}>
                    {formatDateTime(entry.createdAt)}
                  </span>
                </div>
                {entry.sourceFile === null ? null : (
                  <p data-vibe-history-source="1" title={entry.sourceFile} style={metaStyle}>
                    {sourceLeaf(entry.sourceFile)}
                    {entry.sourceLine === null ? '' : `:${entry.sourceLine}`}
                  </p>
                )}
                <p data-vibe-history-comment="1" style={commentStyle}>
                  {entry.comment}
                </p>
                <div style={actionsStyle}>
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        data-vibe-history-confirm="1"
                        style={dangerStyle}
                        disabled={pending}
                        onClick={() => void handleDelete(entry)}
                      >
                        {t('annotation.history.confirmDelete')}
                      </button>
                      <button
                        type="button"
                        data-vibe-history-cancel="1"
                        style={actionBaseStyle}
                        disabled={pending}
                        onClick={() => setConfirmingId(null)}
                      >
                        {t('annotation.item.cancel')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        data-vibe-history-reopen="1"
                        style={reopenStyle}
                        disabled={pendingId !== null}
                        onClick={() => void handleReopen(entry)}
                      >
                        {pending ? t('annotation.history.reopening') : t('annotation.history.reopen')}
                      </button>
                      <button
                        type="button"
                        data-vibe-history-delete="1"
                        style={actionBaseStyle}
                        disabled={pendingId !== null}
                        onClick={() => {
                          setFeedback(null)
                          setConfirmingId(entry.id)
                        }}
                      >
                        {t('annotation.history.delete')}
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      ) : null}

      {state.total > state.entries.length ? (
        <p data-vibe-history-more="1" style={noteStyle}>
          {t('annotation.history.more', { count: state.total - state.entries.length })}
        </p>
      ) : null}

      {feedback === null ? null : (
        <p
          data-vibe-history-status={feedback.kind}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          style={feedbackStyle(feedback.kind)}
        >
          {feedback.message}
        </p>
      )}
    </section>
  )
}
