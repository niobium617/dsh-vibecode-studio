/**
 * Send log for the API page (T044).
 *
 * The Host writes one redacted row per send and searches host-side; this panel
 * shows one page. Opening a row refills the request builder — nothing is
 * replayed automatically, and the notice reminds the user that secret values
 * were removed when the row was stored. Clearing the log asks for a second
 * click and deletes the whole document.
 */
import * as React from 'react'
import type { ApiHistoryEntry } from '../../contracts/api'
import { createTranslator, type Locale } from '../i18n'
import { EmptyState, ErrorState, LoadingState } from '../shell/StateViews'
import { openDraftInBuilder } from './draft-store'
import {
  clearApiHistory,
  loadApiHistory,
  searchApiHistory,
  useApiHistory,
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

const spacerStyle: React.CSSProperties = {
  marginLeft: 'auto',
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
  gap: 2,
  margin: 0,
  padding: 0,
  listStyle: 'none',
}

const itemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 6px',
  borderRadius: 4,
  font: '11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
}

const methodStyle: React.CSSProperties = {
  flex: '0 0 auto',
  fontWeight: 600,
}

const urlStyle: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const metaStyle: React.CSSProperties = {
  flex: '0 0 auto',
  font: '10px/1.4 system-ui, sans-serif',
  opacity: 0.6,
}

const actionStyle: React.CSSProperties = {
  flex: '0 0 auto',
  font: '11px/1.4 system-ui, sans-serif',
  padding: '2px 8px',
  borderRadius: 4,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

const dangerStyle: React.CSSProperties = {
  ...actionStyle,
  borderColor: 'var(--dsw-danger-color, #d14343)',
  color: 'var(--dsw-danger-color, #d14343)',
}

const noteStyle: React.CSSProperties = {
  margin: 0,
  font: '10px/1.5 system-ui, sans-serif',
  opacity: 0.7,
}

const errorLineStyle: React.CSSProperties = {
  margin: 0,
  font: '10px/1.5 system-ui, sans-serif',
  color: 'var(--dsw-color-danger, #c62828)',
}

const confirmStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: 8,
  borderRadius: 6,
  border: '1px solid var(--dsw-danger-color, #d14343)',
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

/** "200 · 12 ms" when both exist; either part alone still reads fine. */
function entryMeta(entry: ApiHistoryEntry): string {
  const parts: string[] = []
  if (entry.status !== undefined) parts.push(String(entry.status))
  if (entry.elapsedMs !== undefined) parts.push(`${entry.elapsedMs} ms`)
  return parts.join(' · ')
}

export interface HistoryListProps {
  readonly locale?: Locale
}

export function HistoryList({ locale }: HistoryListProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const state = useApiHistory()
  const [confirming, setConfirming] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)
  const [clearError, setClearError] = React.useState<string | null>(null)

  // Sends land on disk, so every mount refreshes the cached page.
  React.useEffect(() => {
    void loadApiHistory()
  }, [])

  const searching = state.query.trim() !== ''
  const ready = state.status === 'ready'

  const handleOpen = (entry: ApiHistoryEntry): void => {
    openDraftInBuilder({ spec: entry.request, source: 'history' })
  }

  const handleClear = async (): Promise<void> => {
    if (clearing) return
    setClearing(true)
    setClearError(null)
    try {
      await clearApiHistory()
      setConfirming(false)
    } catch {
      setClearError(t('api.history.clearFailed'))
    } finally {
      setClearing(false)
    }
  }

  return (
    <section data-vibe-send-history="1" style={sectionStyle} aria-labelledby="vibe-send-history-title">
      <div style={headerStyle}>
        <h3 id="vibe-send-history-title" style={titleStyle}>
          {t('api.history.title')}
        </h3>
        <span data-vibe-send-history-count="1" style={countStyle}>
          {state.total}
        </span>
        {state.total === 0 ? null : (
          <span style={spacerStyle}>
            <button
              type="button"
              style={actionStyle}
              data-vibe-send-history-clear="1"
              disabled={clearing}
              onClick={() => {
                setClearError(null)
                setConfirming(true)
              }}
            >
              {t('api.history.clear')}
            </button>
          </span>
        )}
      </div>

      <input
        type="search"
        data-vibe-send-history-search="1"
        aria-label={t('api.history.search')}
        placeholder={t('api.history.searchPlaceholder')}
        value={state.query}
        onChange={(event) => searchApiHistory(event.target.value)}
        style={searchStyle}
      />

      {state.status === 'loading' && state.entries.length === 0 ? (
        <LoadingState label={t('api.history.loading')} />
      ) : null}

      {state.status === 'error' ? (
        <ErrorState
          title={t('api.history.error.title')}
          body={t('api.history.error.body')}
          retryLabel={t('state.error.retry')}
          onRetry={() => void loadApiHistory()}
        />
      ) : null}

      {state.skipped > 0 ? (
        <p data-vibe-send-history-skipped="1" role="status" style={noteStyle}>
          {t('api.history.skipped', { count: state.skipped })}
        </p>
      ) : null}

      {ready && state.entries.length === 0 ? (
        searching ? (
          <EmptyState
            title={t('api.history.noMatch.title')}
            body={t('api.history.noMatch.body')}
            action={
              <button type="button" style={actionStyle} onClick={() => searchApiHistory('')}>
                {t('api.history.clearSearch')}
              </button>
            }
          />
        ) : (
          <EmptyState title={t('api.history.empty.title')} body={t('api.history.empty.body')} />
        )
      ) : null}

      {state.entries.length > 0 ? (
        <ol data-vibe-send-history-list="1" style={listStyle}>
          {state.entries.map((entry) => (
            <li key={entry.id} data-vibe-send-history-item={entry.id} style={itemStyle}>
              <span style={methodStyle}>{entry.method}</span>
              <span style={urlStyle} title={entry.url}>
                {entry.url}
              </span>
              <span style={metaStyle}>
                {entryMeta(entry)} · {formatDateTime(entry.at)}
              </span>
              <button
                type="button"
                style={actionStyle}
                data-vibe-send-history-open="1"
                onClick={() => handleOpen(entry)}
              >
                {t('api.history.open')}
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      {state.total > state.entries.length ? (
        <p data-vibe-send-history-more="1" style={noteStyle}>
          {t('api.history.more', { count: state.total - state.entries.length })}
        </p>
      ) : null}

      {confirming ? (
        <div style={confirmStyle} role="alertdialog" data-vibe-send-history-confirm="1">
          <strong style={titleStyle}>{t('api.history.clearConfirm.title')}</strong>
          <p style={noteStyle}>{t('api.history.clearConfirm.body')}</p>
          {clearError === null ? null : (
            <p role="alert" style={errorLineStyle}>
              {clearError}
            </p>
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              type="button"
              style={actionStyle}
              data-vibe-send-history-cancel="1"
              disabled={clearing}
              onClick={() => {
                setConfirming(false)
                setClearError(null)
              }}
            >
              {t('api.collections.cancel')}
            </button>
            <button
              type="button"
              style={dangerStyle}
              data-vibe-send-history-confirm-clear="1"
              disabled={clearing}
              onClick={() => void handleClear()}
            >
              {t('api.history.confirmClear')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
