/**
 * Preview network drawer (T024).
 *
 * The Host captures CDP network events, redacts headers/URLs and keeps a
 * bounded buffer. This drawer polls the unary `preview.network.list` method
 * with the last revision and merges rows by id, so a pending request updates in
 * place once it gains a status and duration. Response bodies load only when a
 * row is expanded. Everything from the page is rendered as text.
 */
import * as React from 'react'
import type { NetworkEntry } from '../../contracts/telemetry'
import {
  MAX_NETWORK_ENTRIES,
  PREVIEW_NETWORK_BODY_METHOD,
  PREVIEW_NETWORK_CLEAR_METHOD,
  PREVIEW_NETWORK_LIST_METHOD,
  type PreviewNetworkBody,
  type PreviewNetworkClearResult,
  type PreviewNetworkQuery,
  type PreviewNetworkSnapshot,
} from '../../contracts/transport'
import { createTranslator, type Locale } from '../i18n'
import { callUnary } from '../transport/client'

export interface NetworkSource {
  list(query: PreviewNetworkQuery): Promise<PreviewNetworkSnapshot>
  clear(): Promise<PreviewNetworkClearResult>
  body(id: string): Promise<PreviewNetworkBody>
}

export interface NetworkCounts {
  readonly total: number
  readonly failed: number
}

export interface NetworkDrawerProps {
  /** Only poll while a preview session is live. */
  readonly active: boolean
  readonly locale?: Locale
  /** Test seam; defaults to the unary transport. */
  readonly source?: NetworkSource
  /** Poll cadence in milliseconds (tests use a short interval). */
  readonly pollMs?: number
  /** Shown when this drawer is the selected bottom tab. */
  readonly visible?: boolean
  onClose?(): void
  /** Keeps the bottom tab count in sync while the drawer is closed. */
  onCountsChange?(counts: NetworkCounts): void
}

type NetworkFilter = 'all' | 'error'

type BodyState =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly value: PreviewNetworkBody }
  | { readonly state: 'error'; readonly message: string }

const FILTERS: readonly NetworkFilter[] = ['all', 'error']
const DEFAULT_POLL_MS = 1000

const DEFAULT_SOURCE: NetworkSource = {
  list: (query) => callUnary<PreviewNetworkSnapshot>(PREVIEW_NETWORK_LIST_METHOD, query),
  clear: () => callUnary<PreviewNetworkClearResult>(PREVIEW_NETWORK_CLEAR_METHOD),
  body: (id) => callUnary<PreviewNetworkBody>(PREVIEW_NETWORK_BODY_METHOD, { id }),
}

function rootStyle(visible: boolean): React.CSSProperties {
  return {
    display: visible ? 'grid' : 'none',
    gridTemplateRows: 'auto minmax(0, 1fr)',
    gap: 6,
    height: '100%',
    minHeight: 0,
    padding: '6px 8px 8px',
    boxSizing: 'border-box',
    font: '12px/1.5 system-ui, sans-serif',
  }
}

const drawerBodyStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateRows: 'auto auto minmax(0, 1fr)',
  gap: 6,
  minHeight: 0,
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
}

const titleStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  font: '600 12px/1.4 system-ui, sans-serif',
}

const buttonStyle: React.CSSProperties = {
  font: 'inherit',
  padding: '4px 10px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

const filterRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
}

function filterStyle(active: boolean): React.CSSProperties {
  return {
    font: '11px/1.4 system-ui, sans-serif',
    padding: '2px 8px',
    border: `1px solid ${
      active ? 'var(--dsw-accent-color, #4f8cff)' : 'var(--dsw-border-color, rgba(127, 127, 127, 0.4))'
    }`,
    borderRadius: 999,
    background: 'transparent',
    color: 'inherit',
    opacity: active ? 1 : 0.7,
    cursor: 'pointer',
  }
}

const listStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: 'none',
  minHeight: 0,
  overflow: 'auto',
  display: 'grid',
  alignContent: 'start',
  gap: 2,
  font: '11px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace',
}

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto auto minmax(0, 1fr) auto auto',
  gap: 6,
  alignItems: 'baseline',
  width: '100%',
  textAlign: 'left',
  font: 'inherit',
  padding: '2px 4px',
  border: 'none',
  borderBottom: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.16))',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

const methodStyle: React.CSSProperties = {
  fontWeight: 600,
  textTransform: 'uppercase',
}

function statusStyle(entry: NetworkEntry): React.CSSProperties {
  const failed = isFailure(entry)
  return {
    minWidth: 34,
    textAlign: 'right',
    fontWeight: failed ? 600 : 400,
    color: failed ? 'var(--dsw-danger-color, #d14343)' : 'inherit',
    opacity: entry.outcome === 'pending' ? 0.6 : 1,
  }
}

const urlStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const timeStyle: React.CSSProperties = {
  opacity: 0.65,
  whiteSpace: 'nowrap',
}

const durationStyle: React.CSSProperties = {
  minWidth: 48,
  textAlign: 'right',
  opacity: 0.75,
  whiteSpace: 'nowrap',
}

const detailStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '6px 8px 8px 8px',
  borderBottom: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.16))',
}

const detailHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontWeight: 600,
  opacity: 0.8,
}

const headerListStyle: React.CSSProperties = {
  margin: 0,
  display: 'grid',
  gridTemplateColumns: 'max-content minmax(0, 1fr)',
  gap: '1px 8px',
}

const headerKeyStyle: React.CSSProperties = {
  opacity: 0.7,
  wordBreak: 'break-word',
}

const headerValueStyle: React.CSSProperties = {
  margin: 0,
  wordBreak: 'break-word',
}

const bodyStyle: React.CSSProperties = {
  margin: 0,
  padding: 6,
  maxHeight: 160,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: 'var(--dsw-surface-alt, rgba(127, 127, 127, 0.08))',
  borderRadius: 4,
}

const noteStyle: React.CSSProperties = {
  margin: 0,
  opacity: 0.75,
}

const emptyStyle: React.CSSProperties = {
  margin: 0,
  padding: 4,
  opacity: 0.65,
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isFailure(entry: NetworkEntry): boolean {
  return entry.outcome === 'error' || entry.outcome === 'aborted' || (entry.status ?? 0) >= 400
}

function formatStartedAt(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : iso.slice(11, 19)
}

function formatDuration(durationMs: number | null): string {
  return durationMs === null ? '' : `${Math.round(durationMs)} ms`
}

function headersOf(
  headers: Readonly<Record<string, string>> | undefined,
): readonly [string, string][] {
  return headers === undefined ? [] : Object.entries(headers).sort(([a], [b]) => a.localeCompare(b))
}

export function NetworkDrawer({
  active,
  locale,
  source = DEFAULT_SOURCE,
  pollMs = DEFAULT_POLL_MS,
  visible = true,
  onClose,
  onCountsChange,
}: NetworkDrawerProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const [entries, setEntries] = React.useState<readonly NetworkEntry[]>([])
  const [filter, setFilter] = React.useState<NetworkFilter>('all')
  const [status, setStatus] = React.useState<string | null>(null)
  const [clearing, setClearing] = React.useState(false)
  const [expanded, setExpanded] = React.useState<string | null>(null)
  const [bodies, setBodies] = React.useState<Readonly<Record<string, BodyState>>>({})
  const lastSeq = React.useRef(0)
  /** Bumped by clear so an in-flight poll cannot repopulate the list. */
  const clearEpoch = React.useRef(0)
  const mounted = React.useRef(true)
  const listRef = React.useRef<HTMLOListElement | null>(null)

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  React.useEffect(() => {
    if (!active) {
      lastSeq.current = 0
      clearEpoch.current += 1
      setEntries([])
      setStatus(null)
      setClearing(false)
      setExpanded(null)
      setBodies({})
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async (): Promise<void> => {
      const epoch = clearEpoch.current
      const after = lastSeq.current
      try {
        let snapshot = await source.list(after === 0 ? {} : { after })
        if (snapshot.lastSeq < after) {
          // Host revision restarted (plugin reload); fetch the whole buffer.
          snapshot = await source.list({})
        }
        if (cancelled || !mounted.current || clearEpoch.current !== epoch) return
        const reset = snapshot.lastSeq < after
        lastSeq.current = snapshot.lastSeq
        setEntries((previous) => {
          // Rows are revised in place, so a later snapshot replaces an id
          // instead of being skipped as a duplicate.
          const merged = new Map((reset ? [] : previous).map((entry) => [entry.id, entry]))
          for (const entry of snapshot.entries) merged.set(entry.id, entry)
          const list = [...merged.values()]
          return list.length > MAX_NETWORK_ENTRIES
            ? list.slice(list.length - MAX_NETWORK_ENTRIES)
            : list
        })
        setStatus(null)
      } catch (error) {
        if (!cancelled && mounted.current && clearEpoch.current === epoch) {
          setStatus(errorMessage(error))
        }
      } finally {
        if (!cancelled && mounted.current) {
          timer = setTimeout(() => void tick(), pollMs)
        }
      }
    }

    void tick()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [active, source, pollMs])

  React.useEffect(() => {
    if (!visible) return
    const list = listRef.current
    if (list !== null) list.scrollTop = list.scrollHeight
  }, [entries.length, visible])

  const failedCount = React.useMemo(
    () => entries.filter((entry) => isFailure(entry)).length,
    [entries],
  )

  const counts = React.useMemo(
    () => ({ total: entries.length, failed: failedCount }),
    [entries.length, failedCount],
  )

  React.useEffect(() => {
    onCountsChange?.(counts)
  }, [counts, onCountsChange])

  const visibleEntries = React.useMemo(
    () => (filter === 'all' ? entries : entries.filter((entry) => isFailure(entry))),
    [entries, filter],
  )

  const loadBody = React.useCallback(
    async (id: string): Promise<void> => {
      const epoch = clearEpoch.current
      setBodies((previous) => ({ ...previous, [id]: { state: 'loading' } }))
      try {
        const value = await source.body(id)
        if (!mounted.current || clearEpoch.current !== epoch) return
        setBodies((previous) => ({ ...previous, [id]: { state: 'ready', value } }))
      } catch (error) {
        if (!mounted.current || clearEpoch.current !== epoch) return
        setBodies((previous) => ({
          ...previous,
          [id]: { state: 'error', message: errorMessage(error) },
        }))
      }
    },
    [source],
  )

  const toggleEntry = (entry: NetworkEntry): void => {
    if (expanded === entry.id) {
      setExpanded(null)
      return
    }
    setExpanded(entry.id)
    // Only responses can have a body; pending and failed rows stay quiet.
    if (entry.status !== null && bodies[entry.id] === undefined) {
      void loadBody(entry.id)
    }
  }

  const handleClear = async (): Promise<void> => {
    if (clearing) return
    setClearing(true)
    clearEpoch.current += 1
    try {
      const result = await source.clear()
      if (!mounted.current) return
      lastSeq.current = result.lastSeq
      setEntries([])
      setExpanded(null)
      setBodies({})
      setStatus(null)
    } catch (error) {
      if (mounted.current) setStatus(errorMessage(error))
    } finally {
      if (mounted.current) setClearing(false)
    }
  }

  return (
    <section
      id="vibe-network-drawer"
      data-vibe-network="1"
      aria-label={t('preview.network.title')}
      style={rootStyle(visible)}
    >
      <div style={headerStyle}>
        <strong style={titleStyle}>
          {t('preview.network.title')} ·{' '}
          {t('preview.network.summary', {
            requests: entries.length,
            failed: failedCount,
          })}
        </strong>
        <button
          type="button"
          style={buttonStyle}
          disabled={clearing || entries.length === 0}
          onClick={() => void handleClear()}
        >
          {clearing ? t('preview.network.clearing') : t('preview.network.clear')}
        </button>
        {onClose ? (
          <button
            type="button"
            aria-label={t('preview.drawer.close')}
            style={buttonStyle}
            onClick={onClose}
          >
            ✕
          </button>
        ) : null}
      </div>

      <div style={drawerBodyStyle}>
        <p role="status" style={noteStyle}>
          {status === null
            ? ''
            : t('preview.network.unavailable', { message: status })}
        </p>

        <div role="group" aria-label={t('preview.network.filters')} style={filterRowStyle}>
          {FILTERS.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={filter === name}
              style={filterStyle(filter === name)}
              onClick={() => setFilter(name)}
            >
              {t(`preview.network.filter.${name}`)} ({name === 'all' ? entries.length : failedCount})
            </button>
          ))}
        </div>
        <ol
          id="vibe-network-log"
          role="log"
          aria-label={t('preview.network.log')}
          aria-live="off"
          ref={listRef}
          style={listStyle}
        >
          {visibleEntries.length === 0 ? (
            <li style={emptyStyle}>
              {entries.length === 0
                ? t('preview.network.empty')
                : t('preview.network.emptyFilter')}
            </li>
          ) : (
            visibleEntries.map((entry) => {
                const isOpen = expanded === entry.id
                const body = bodies[entry.id]
                const requestHeaders = headersOf(entry.requestHeaders)
                const responseHeaders = headersOf(entry.responseHeaders)
                return (
                  <li
                    key={entry.id}
                    data-vibe-network-entry="1"
                    data-status={entry.status ?? entry.outcome}
                    data-error={isFailure(entry) ? '1' : undefined}
                  >
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      data-vibe-network-row="1"
                      style={rowStyle}
                      onClick={() => toggleEntry(entry)}
                    >
                      <span style={methodStyle}>{entry.method}</span>
                      <span style={statusStyle(entry)}>
                        {entry.status ?? t(`preview.network.outcome.${entry.outcome}`)}
                      </span>
                      <span style={urlStyle} title={entry.url}>
                        {entry.url}
                      </span>
                      <span style={timeStyle}>{formatStartedAt(entry.startedAt)}</span>
                      <span style={durationStyle}>{formatDuration(entry.durationMs)}</span>
                    </button>
                    {isOpen ? (
                      <div style={detailStyle}>
                        <p style={detailHeadingStyle}>
                          {t('preview.network.detail.requestHeaders')}
                        </p>
                        {requestHeaders.length === 0 ? (
                          <p style={noteStyle}>{t('preview.network.detail.noHeaders')}</p>
                        ) : (
                          <dl style={headerListStyle} data-vibe-network-header="request">
                            {requestHeaders.map(([key, value]) => (
                              <React.Fragment key={key}>
                                <dt style={headerKeyStyle}>{key}</dt>
                                <dd style={headerValueStyle}>{value}</dd>
                              </React.Fragment>
                            ))}
                          </dl>
                        )}

                        <p style={detailHeadingStyle}>
                          {t('preview.network.detail.responseHeaders')}
                        </p>
                        {responseHeaders.length === 0 ? (
                          <p style={noteStyle}>{t('preview.network.detail.noHeaders')}</p>
                        ) : (
                          <dl style={headerListStyle} data-vibe-network-header="response">
                            {responseHeaders.map(([key, value]) => (
                              <React.Fragment key={key}>
                                <dt style={headerKeyStyle}>{key}</dt>
                                <dd style={headerValueStyle}>{value}</dd>
                              </React.Fragment>
                            ))}
                          </dl>
                        )}

                        <p style={detailHeadingStyle}>{t('preview.network.detail.body')}</p>
                        {entry.status === null ? (
                          <p style={noteStyle}>{t('preview.network.detail.noBody')}</p>
                        ) : body === undefined || body.state === 'loading' ? (
                          <p style={noteStyle}>{t('preview.network.detail.bodyLoading')}</p>
                        ) : body.state === 'error' ? (
                          <p role="status" style={noteStyle}>
                            {t('preview.network.unavailable', { message: body.message })}
                          </p>
                        ) : (
                          <>
                            <pre data-vibe-network-body="1" style={bodyStyle}>
                              {body.value.body.length === 0
                                ? t('preview.network.detail.noBody')
                                : body.value.body}
                            </pre>
                            {body.value.truncated ? (
                              <p style={noteStyle}>{t('preview.network.detail.truncated')}</p>
                            ) : null}
                            {body.value.base64Encoded ? (
                              <p style={noteStyle}>
                                {t('preview.network.detail.base64', {
                                  bytes: body.value.bytes,
                                })}
                              </p>
                            ) : null}
                          </>
                        )}
                        {entry.failure ? <p style={noteStyle}>{entry.failure}</p> : null}
                      </div>
                    ) : null}
                  </li>
                )
              })
            )}
          </ol>
      </div>
    </section>
  )
}
