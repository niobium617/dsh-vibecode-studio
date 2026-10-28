/**
 * Element picking UI (T027).
 *
 * The overlay, hit testing and selector generation live in the target page
 * (`src/host/inspect`); the panel only turns the mode on and off and reads the
 * resulting pick back through `preview.pick.*`. Polling is faster while the
 * mode is on so a click shows up promptly, and falls back to the status cadence
 * once it is off.
 *
 * The Host owns the truth: `active` and `seq` come from the snapshot, so a page
 * that cancelled the mode itself (Esc) or a navigation that reset it is
 * reflected without the panel guessing.
 */
import * as React from 'react'
import type { ElementContext } from '../../contracts/inspect'
import {
  PREVIEW_PICK_START_METHOD,
  PREVIEW_PICK_STATUS_METHOD,
  PREVIEW_PICK_STOP_METHOD,
  type PickSnapshot,
} from '../../contracts/transport'
import { createTranslator, type Locale } from '../i18n'
import { callUnary } from '../transport/client'

/** Fast enough that a click feels immediate, slow enough to stay cheap. */
export const PICK_POLL_ACTIVE_MS = 300
export const PICK_POLL_IDLE_MS = 1_000
const PICK_ACTION_TIMEOUT_MS = 5_000

/** The three Host calls the picker needs; injectable for tests. */
export interface PickSource {
  start(): Promise<PickSnapshot>
  stop(): Promise<PickSnapshot>
  status(): Promise<PickSnapshot>
}

export const hostPickSource: PickSource = {
  start: () =>
    callUnary<PickSnapshot>(PREVIEW_PICK_START_METHOD, undefined, {
      timeoutMs: PICK_ACTION_TIMEOUT_MS,
    }),
  stop: () =>
    callUnary<PickSnapshot>(PREVIEW_PICK_STOP_METHOD, undefined, {
      timeoutMs: PICK_ACTION_TIMEOUT_MS,
    }),
  status: () => callUnary<PickSnapshot>(PREVIEW_PICK_STATUS_METHOD),
}

export interface PickerOptions {
  /** The session is live and its capabilities advertise `pick`. */
  readonly enabled: boolean
  readonly source?: PickSource
  onError?(error: unknown): void
}

export interface PickerState {
  readonly picking: boolean
  readonly busy: boolean
  /** The last pick, until it is dismissed; null when there is none to show. */
  readonly pick: ElementContext | null
  toggle(): void
  dismiss(): void
}

/**
 * Starts/stops pick mode and polls the Host for the picked element. Outside a
 * live session the state is dropped, because the Host disposes the page script
 * with the session.
 */
export function usePicker({
  enabled,
  source = hostPickSource,
  onError,
}: PickerOptions): PickerState {
  const [state, setState] = React.useState<PickSnapshot | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [dismissedSeq, setDismissedSeq] = React.useState(0)
  const activeRef = React.useRef(false)
  const busyRef = React.useRef(false)
  const mountRef = React.useRef(true)
  const errorRef = React.useRef(onError)
  errorRef.current = onError

  const apply = React.useCallback((next: PickSnapshot | null): void => {
    activeRef.current = next?.active === true
    setState(next)
  }, [])

  React.useEffect(() => {
    mountRef.current = true
    return () => {
      mountRef.current = false
    }
  }, [])

  React.useEffect(() => {
    if (!enabled) {
      apply(null)
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      try {
        const next = await source.status()
        if (!cancelled) apply(next)
      } catch {
        // A reloading Host answers `unsupported`; the next tick retries.
      }
      if (cancelled) return
      timer = setTimeout(
        () => void tick(),
        activeRef.current ? PICK_POLL_ACTIVE_MS : PICK_POLL_IDLE_MS,
      )
    }
    void tick()
    return () => {
      cancelled = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [apply, enabled, source])

  const run = React.useCallback(
    async (action: 'start' | 'stop'): Promise<void> => {
      if (busyRef.current) return
      busyRef.current = true
      setBusy(true)
      try {
        const next = action === 'start' ? await source.start() : await source.stop()
        if (mountRef.current) apply(next)
      } catch (failure) {
        if (mountRef.current) errorRef.current?.(failure)
        // The mode did not change; re-read rather than assume.
        try {
          const next = await source.status()
          if (mountRef.current) apply(next)
        } catch {
          // Keep the previous state.
        }
      } finally {
        busyRef.current = false
        if (mountRef.current) setBusy(false)
      }
    },
    [apply, source],
  )

  const toggle = React.useCallback((): void => {
    if (!enabled) return
    void run(activeRef.current ? 'stop' : 'start')
  }, [enabled, run])

  const dismiss = React.useCallback((): void => {
    setDismissedSeq(state?.seq ?? 0)
  }, [state?.seq])

  const pick = state !== null && state.seq > dismissedSeq ? state.pick : null

  return {
    picking: state?.active === true,
    busy,
    pick,
    toggle,
    dismiss,
  }
}

const toggleBaseStyle: React.CSSProperties = {
  flex: '0 0 auto',
  font: 'inherit',
  padding: '4px 8px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

function toggleStyle(picking: boolean): React.CSSProperties {
  if (!picking) return toggleBaseStyle
  return {
    ...toggleBaseStyle,
    borderColor: 'var(--dsw-accent-color, #3b82f6)',
    background: 'rgba(59, 130, 246, 0.18)',
  }
}

export interface PickToggleProps {
  readonly locale?: Locale
  readonly picking: boolean
  /** The snapshot advertises `pick`; when false the button explains why not. */
  readonly available: boolean
  readonly disabled?: boolean
  onToggle(): void
}

export function PickToggle({
  locale,
  picking,
  available,
  disabled = false,
  onToggle,
}: PickToggleProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const label = picking ? t('preview.pick.stop') : t('preview.pick.start')
  return (
    <button
      type="button"
      data-vibe-pick-toggle="1"
      aria-pressed={picking}
      aria-label={label}
      title={available ? t('preview.pick.hint') : t('preview.pick.unavailable')}
      disabled={!available || disabled}
      style={toggleStyle(picking)}
      onClick={onToggle}
    >
      {picking ? '✕' : '⌖'}
    </button>
  )
}

const cardStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 8,
  zIndex: 5,
  display: 'grid',
  gap: 4,
  width: 'min(320px, calc(100% - 16px))',
  boxSizing: 'border-box',
  padding: '6px 8px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 6,
  background: 'var(--dsw-surface-color, Canvas)',
  color: 'var(--dsw-text-primary, CanvasText)',
  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.28)',
  font: '12px/1.5 system-ui, sans-serif',
}

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const closeButtonStyle: React.CSSProperties = {
  marginLeft: 'auto',
  padding: '0 4px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
}

function badgeStyle(unique: boolean): React.CSSProperties {
  return {
    padding: '0 6px',
    borderRadius: 999,
    font: '10px/1.6 system-ui, sans-serif',
    background: unique ? 'rgba(46, 160, 67, 0.16)' : 'rgba(209, 67, 67, 0.16)',
    color: unique ? 'var(--dsw-success-color, #2ea043)' : 'var(--dsw-danger-color, #d14343)',
  }
}

const selectorStyle: React.CSSProperties = {
  display: 'block',
  padding: '4px 6px',
  borderRadius: 4,
  background: 'rgba(127, 127, 127, 0.12)',
  font: '11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace',
  overflowWrap: 'anywhere',
  userSelect: 'all',
}

const metaStyle: React.CSSProperties = {
  margin: 0,
  opacity: 0.75,
  font: '11px/1.4 system-ui, sans-serif',
  overflowWrap: 'anywhere',
}

export interface PickCardProps {
  readonly locale?: Locale
  readonly pick: ElementContext
  onClose(): void
}

/** A source path is page data; the card only needs its last segment. */
function sourceLeaf(file: string): string {
  const parts = file.split(/[\\/]/)
  const leaf = parts[parts.length - 1] ?? file
  return leaf.length > 0 ? leaf : file
}

/** Shows what was picked, including where it lives in the framework source. */
export function PickCard({ locale, pick, onClose }: PickCardProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const classes = pick.classes.length > 0 ? `.${pick.classes.join('.')}` : ''
  const source = pick.source
  const sourceText = source
    ? `${sourceLeaf(source.file)}${source.line === null ? '' : `:${source.line}`}`
    : t('preview.pick.sourceUnavailable')
  return (
    <div
      data-vibe-pick-card="1"
      role="group"
      aria-label={t('preview.pick.card.title')}
      style={cardStyle}
    >
      <div style={cardHeaderStyle}>
        <strong>{t('preview.pick.card.title')}</strong>
        <span
          data-vibe-pick-unique={pick.unique ? '1' : '0'}
          style={badgeStyle(pick.unique)}
        >
          {pick.unique ? t('preview.pick.unique') : t('preview.pick.notUnique')}
        </span>
        <button
          type="button"
          aria-label={t('preview.pick.close')}
          title={t('preview.pick.close')}
          style={closeButtonStyle}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <code data-vibe-pick-selector="1" style={selectorStyle}>
        {pick.selector}
      </code>
      <p style={metaStyle}>
        {pick.tag}
        {classes}
      </p>
      <p style={metaStyle}>
        {t('preview.pick.box')}: {pick.box.x}, {pick.box.y} · {pick.box.width}×
        {pick.box.height}
      </p>
      <p
        data-vibe-pick-source={source ? '1' : '0'}
        data-vibe-pick-source-via={source ? source.via : undefined}
        title={source ? source.file : undefined}
        style={metaStyle}
      >
        {t('preview.pick.source')}: {sourceText}
      </p>
    </div>
  )
}
