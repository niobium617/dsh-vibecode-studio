/**
 * Preview console drawer (T023).
 *
 * The Host keeps the bounded capture; this drawer polls the unary
 * `preview.console.list` method with the last seen sequence and merges only new
 * entries. Filtering and clearing are local, except clear also drops the Host
 * buffer. Nothing here renders untrusted page text as markup: entries are plain
 * strings shown with React text nodes.
 */
import * as React from 'react'
import type { ConsoleEntry } from '../../contracts/telemetry'
import {
  MAX_CONSOLE_ENTRIES,
  PREVIEW_CONSOLE_CLEAR_METHOD,
  PREVIEW_CONSOLE_LIST_METHOD,
  type PreviewConsoleClearResult,
  type PreviewConsoleQuery,
  type PreviewConsoleSnapshot,
} from '../../contracts/transport'
import { createTranslator, type Locale } from '../i18n'
import { callUnary } from '../transport/client'
import {
  FOCUS_HIGHLIGHT_MS,
  findEntryRow,
  revealEntry,
  type DrawerFocus,
} from './focus'

export interface ConsoleSource {
  list(query: PreviewConsoleQuery): Promise<PreviewConsoleSnapshot>
  clear(): Promise<PreviewConsoleClearResult>
}

export interface ConsoleCounts {
  readonly total: number
  readonly errors: number
  readonly warnings: number
  readonly info: number
}

export interface ConsoleDrawerProps {
  /** Only poll while a preview session is live. */
  readonly active: boolean
  readonly locale?: Locale
  /** Test seam; defaults to the unary transport. */
  readonly source?: ConsoleSource
  /** Poll cadence in milliseconds (tests use a short interval). */
  readonly pollMs?: number
  /** Shown when this drawer is the selected bottom tab. */
  readonly visible?: boolean
  /** T056: reveal this entry (verification evidence) and highlight it briefly. */
  readonly focus?: DrawerFocus | null
  onClose?(): void
  /** Keeps the bottom tab count in sync while the drawer is closed. */
  onCountsChange?(counts: ConsoleCounts): void
}

type ConsoleFilter = 'all' | 'error' | 'warn' | 'info'

const FILTERS: readonly ConsoleFilter[] = ['all', 'error', 'warn', 'info']
const DEFAULT_POLL_MS = 1000

const DEFAULT_SOURCE: ConsoleSource = {
  list: (query) => callUnary<PreviewConsoleSnapshot>(PREVIEW_CONSOLE_LIST_METHOD, query),
  clear: () => callUnary<PreviewConsoleClearResult>(PREVIEW_CONSOLE_CLEAR_METHOD),
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

const bodyStyle: React.CSSProperties = {
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

function entryStyle(highlighted: boolean): React.CSSProperties {
  return {
    display: 'flex',
    gap: 6,
    alignItems: 'baseline',
    padding: '2px 4px',
    borderBottom: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.16))',
    background: highlighted ? 'rgba(79, 140, 246, 0.2)' : undefined,
    outline: highlighted ? '1px solid var(--dsw-accent-color, #4f8cff)' : undefined,
  }
}

function levelStyle(level: ConsoleEntry['level']): React.CSSProperties {
  return {
    flex: '0 0 auto',
    minWidth: 36,
    textAlign: 'right',
    textTransform: 'uppercase',
    fontWeight: 600,
    color:
      level === 'error'
        ? 'var(--dsw-danger-color, #d14343)'
        : level === 'warn'
          ? 'var(--dsw-warning-color, #c4811a)'
          : 'inherit',
    opacity: level === 'info' || level === 'debug' ? 0.65 : 1,
  }
}

const textStyle: React.CSSProperties = {
  flex: 1,
  // A long source URL must not squeeze the message into a one-word column.
  minWidth: '12ch',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
}

const sourceStyle: React.CSSProperties = {
  flex: '0 1 auto',
  minWidth: 0,
  maxWidth: '45%',
  opacity: 0.6,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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

function formatSource(source: NonNullable<ConsoleEntry['source']>): string {
  const line = source.line === null ? '' : `:${source.line}`
  const column = source.column === null ? '' : `:${source.column}`
  return `${source.url}${line}${column}`
}

export function ConsoleDrawer({
  active,
  locale,
  source = DEFAULT_SOURCE,
  pollMs = DEFAULT_POLL_MS,
  visible = true,
  focus = null,
  onClose,
  onCountsChange,
}: ConsoleDrawerProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const [entries, setEntries] = React.useState<readonly ConsoleEntry[]>([])
  const [filter, setFilter] = React.useState<ConsoleFilter>('all')
  const [status, setStatus] = React.useState<string | null>(null)
  const [clearing, setClearing] = React.useState(false)
  const lastSeq = React.useRef(0)
  /** Bumped by clear so an in-flight poll cannot repopulate the list. */
  const clearEpoch = React.useRef(0)
  const mounted = React.useRef(true)
  const listRef = React.useRef<HTMLOListElement | null>(null)
  const [highlightId, setHighlightId] = React.useState<string | null>(null)
  /** Nonce of the last focus handled, so a re-render does not re-scroll. */
  const handledFocus = React.useRef<number | null>(null)

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
      setHighlightId(null)
      handledFocus.current = null
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
          // Host sequence restarted (plugin reload); fetch the whole buffer.
          snapshot = await source.list({})
        }
        if (cancelled || !mounted.current || clearEpoch.current !== epoch) return
        const reset = snapshot.lastSeq < after
        lastSeq.current = snapshot.lastSeq
        setEntries((previous) => {
          const base = reset ? [] : previous
          const seen = new Set(base.map((entry) => entry.id))
          const merged = [...base, ...snapshot.entries.filter((entry) => !seen.has(entry.id))]
          return merged.length > MAX_CONSOLE_ENTRIES
            ? merged.slice(merged.length - MAX_CONSOLE_ENTRIES)
            : merged
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
    // While an evidence row is highlighted, leave the scroll position alone:
    // the bottom-follow would pull it out of view on the next poll.
    if (!visible || highlightId !== null) return
    const list = listRef.current
    if (list !== null) list.scrollTop = list.scrollHeight
  }, [entries.length, visible, highlightId])

  React.useEffect(() => {
    if (!visible || focus === null) return
    if (handledFocus.current === focus.nonce) return
    const row = findEntryRow(listRef.current, 'data-vibe-console-entry', focus.id)
    // The entry may arrive with the next poll; the effect re-runs then.
    if (row === null) return
    handledFocus.current = focus.nonce
    setFilter('all')
    revealEntry(row)
    setHighlightId(focus.id)
    const timer = setTimeout(() => {
      if (mounted.current) setHighlightId(null)
    }, FOCUS_HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [focus, visible, entries])

  const counts = React.useMemo(() => {
    let errors = 0
    let warnings = 0
    let info = 0
    for (const entry of entries) {
      if (entry.level === 'error') errors += 1
      else if (entry.level === 'warn') warnings += 1
      else info += 1
    }
    return { total: entries.length, errors, warnings, info }
  }, [entries])

  React.useEffect(() => {
    onCountsChange?.(counts)
  }, [counts, onCountsChange])

  const visibleEntries = React.useMemo(
    () =>
      entries.filter((entry) => {
        if (filter === 'all') return true
        if (filter === 'error') return entry.level === 'error'
        if (filter === 'warn') return entry.level === 'warn'
        return entry.level === 'info' || entry.level === 'debug'
      }),
    [entries, filter],
  )

  const filterCount = (name: ConsoleFilter): number => {
    if (name === 'all') return entries.length
    if (name === 'error') return counts.errors
    if (name === 'warn') return counts.warnings
    return counts.info
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
      setStatus(null)
    } catch (error) {
      if (mounted.current) setStatus(errorMessage(error))
    } finally {
      if (mounted.current) setClearing(false)
    }
  }

  return (
    <section
      id="vibe-console-drawer"
      data-vibe-console="1"
      aria-label={t('preview.console.title')}
      style={rootStyle(visible)}
    >
      <div style={headerStyle}>
        <strong style={titleStyle}>
          {t('preview.console.title')} ·{' '}
          {t('preview.console.summary', {
            errors: counts.errors,
            warnings: counts.warnings,
          })}
        </strong>
        <button
          type="button"
          style={buttonStyle}
          disabled={clearing || entries.length === 0}
          onClick={() => void handleClear()}
        >
          {clearing ? t('preview.console.clearing') : t('preview.console.clear')}
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

      <div style={bodyStyle}>
        <p role="status" style={noteStyle}>
          {status === null
            ? ''
            : t('preview.console.unavailable', { message: status })}
        </p>

        <div role="group" aria-label={t('preview.console.filters')} style={filterRowStyle}>
          {FILTERS.map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={filter === name}
              style={filterStyle(filter === name)}
              onClick={() => setFilter(name)}
            >
              {t(`preview.console.filter.${name}`)} ({filterCount(name)})
            </button>
          ))}
        </div>
        <ol
          id="vibe-console-log"
          role="log"
          aria-label={t('preview.console.log')}
          aria-live="off"
          ref={listRef}
          style={listStyle}
        >
          {visibleEntries.length === 0 ? (
            <li style={emptyStyle}>{t('preview.console.empty')}</li>
          ) : (
            visibleEntries.map((entry) => (
              <li
                key={entry.id}
                data-vibe-console-entry="1"
                data-entry-id={entry.id}
                data-level={entry.level}
                style={entryStyle(highlightId === entry.id)}
              >
                <span style={levelStyle(entry.level)}>{entry.level}</span>
                <span style={textStyle}>{entry.text}</span>
                {entry.source ? (
                  <span style={sourceStyle}>{formatSource(entry.source)}</span>
                ) : null}
              </li>
            ))
          )}
        </ol>
      </div>
    </section>
  )
}
