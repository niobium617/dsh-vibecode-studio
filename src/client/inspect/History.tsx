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
import {
  clearAnnotationStatus,
  setAnnotationStatus,
  useAnnotationStatuses,
} from './annotation-status'

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
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6,
}

/** Sits to the right of Delete so the notice stays attached to its annotation. */
const inlineStatusStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  marginLeft: 'auto',
  textAlign: 'right',
  font: '10px/1.4 system-ui, sans-serif',
}

const dialogOverlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
  background: 'rgba(0, 0, 0, 0.45)',
}

const dialogStyle: React.CSSProperties = {
  display: 'grid',
  gap: 10,
  width: 'min(320px, 100%)',
  boxSizing: 'border-box',
  padding: 12,
  borderRadius: 8,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  background: 'var(--dsw-surface-color, Canvas)',
  color: 'var(--dsw-text-primary, CanvasText)',
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.35)',
  font: '12px/1.5 system-ui, sans-serif',
}

const dialogTitleStyle: React.CSSProperties = {
  margin: 0,
  font: '600 13px/1.4 system-ui, sans-serif',
}

const dialogBodyStyle: React.CSSProperties = {
  margin: 0,
  opacity: 0.75,
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

export interface AnnotationHistoryProps {
  readonly locale?: Locale
}

export function AnnotationHistory({ locale }: AnnotationHistoryProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const state = useAnnotationHistory()
  const statuses = useAnnotationStatuses()
  // Deletion opens a modal instead of leaving a "deleted" line under the list.
  const [confirming, setConfirming] = React.useState<AnnotationHistoryEntry | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const cancelRef = React.useRef<HTMLButtonElement | null>(null)
  const [pendingId, setPendingId] = React.useState<string | null>(null)

  // The disk is the source of truth, so each mount refreshes the cached list.
  React.useEffect(() => {
    void loadAnnotationHistory()
  }, [])

  React.useEffect(() => {
    if (confirming === null) return
    cancelRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setConfirming(null)
      setDeleteError(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [confirming])

  const handleReopen = async (entry: AnnotationHistoryEntry): Promise<void> => {
    if (pendingId !== null) return
    setPendingId(entry.id)
    try {
      await reopenAnnotationFromHistory(entry.id)
      setAnnotationStatus(entry.id, {
        kind: 'success',
        message: t('annotation.history.reopened'),
      })
    } catch {
      setAnnotationStatus(entry.id, {
        kind: 'error',
        message: t('annotation.history.reopenFailed'),
      })
    } finally {
      setPendingId(null)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (confirming === null || deleting) return
    const entry = confirming
    setDeleting(true)
    setDeleteError(null)
    try {
      await removeHistoryAnnotation(entry.id)
      clearAnnotationStatus(entry.id)
      setConfirming(null)
    } catch {
      setDeleteError(t('annotation.history.deleteFailed'))
    } finally {
      setDeleting(false)
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
            const status = statuses.get(entry.id) ?? null
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
                  <button
                    type="button"
                    data-vibe-history-reopen="1"
                    style={reopenStyle}
                    disabled={pendingId !== null || deleting}
                    onClick={() => void handleReopen(entry)}
                  >
                    {pending ? t('annotation.history.reopening') : t('annotation.history.reopen')}
                  </button>
                  <button
                    type="button"
                    data-vibe-history-delete="1"
                    style={actionBaseStyle}
                    disabled={pendingId !== null || deleting}
                    onClick={() => {
                      setDeleteError(null)
                      setConfirming(entry)
                    }}
                  >
                    {t('annotation.history.delete')}
                  </button>
                  {status === null ? null : (
                    <span
                      data-vibe-history-status={status.kind}
                      role={status.kind === 'error' ? 'alert' : 'status'}
                      style={{
                        ...inlineStatusStyle,
                        color:
                          status.kind === 'error'
                            ? 'var(--dsw-danger-color, #d14343)'
                            : 'var(--dsw-success-color, #2ea043)',
                      }}
                    >
                      {status.message}
                    </span>
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

      {confirming === null ? null : (
        <div
          data-vibe-history-dialog="1"
          style={dialogOverlayStyle}
          onClick={(event) => {
            if (event.target !== event.currentTarget || deleting) return
            setConfirming(null)
            setDeleteError(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="vibe-history-delete-title"
            aria-describedby="vibe-history-delete-body"
            style={dialogStyle}
          >
            <h4 id="vibe-history-delete-title" style={dialogTitleStyle}>
              {t('annotation.history.deleteConfirm.title')}
            </h4>
            <p id="vibe-history-delete-body" style={dialogBodyStyle}>
              {t('annotation.history.deleteConfirm.body')}
            </p>
            <code title={confirming.selector ?? undefined} style={selectorStyle}>
              {confirming.selector ?? confirming.tag ?? t('annotation.item.noElement')}
            </code>
            {deleteError === null ? null : (
              <p role="alert" style={feedbackStyle('error')}>
                {deleteError}
              </p>
            )}
            <div style={{ ...actionsStyle, justifyContent: 'flex-end' }}>
              <button
                ref={cancelRef}
                type="button"
                data-vibe-history-cancel="1"
                style={actionBaseStyle}
                disabled={deleting}
                onClick={() => {
                  setConfirming(null)
                  setDeleteError(null)
                }}
              >
                {t('annotation.item.cancel')}
              </button>
              <button
                type="button"
                data-vibe-history-confirm="1"
                style={dangerStyle}
                disabled={deleting}
                onClick={() => void handleDelete()}
              >
                {t('annotation.history.confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
