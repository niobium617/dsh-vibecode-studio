/**
 * Preview toolbar (T025, Layout v2 U01).
 *
 * Two permanent rows only: a one-line status bar and the address row. Anything
 * else — viewport presets, open in browser, stop, restart and the target kind —
 * lives behind the "More" menu so the canvas keeps the space. The live status
 * line expands into a details popover (mode, frames, sequence, last error)
 * without pushing the canvas down.
 *
 * Every piece of state shown here comes from the session snapshot: kind, URL,
 * viewport and capabilities. The toolbar never guesses whether an action is
 * available; it disables what the snapshot does not advertise and lets the Host
 * validate again.
 */
import * as React from 'react'
import type { TargetKind, TargetViewport } from '../../contracts/target'
import type {
  PreviewSessionSnapshot,
  PreviewTargetSummary,
} from '../../contracts/transport'
import { createTranslator, type Locale } from '../i18n'
import { isLocalPreviewUrl } from './local-url'
import type { PreviewTransportStats } from './transport'

export type ToolbarBusy = 'start' | 'stop' | 'navigate' | 'reload' | 'viewport' | null

export interface StageSize {
  readonly width: number
  readonly height: number
}

export interface ToolbarProps {
  readonly locale?: Locale
  readonly snapshot: PreviewSessionSnapshot | null
  readonly targets: readonly PreviewTargetSummary[]
  readonly kind: TargetKind
  readonly url: string
  readonly busy: ToolbarBusy
  readonly stats: PreviewTransportStats | null
  /** Measured preview stage, used by the "fit panel" viewport preset. */
  readonly stageSize?: StageSize | null
  onKindChange(kind: TargetKind): void
  onUrlChange(url: string): void
  /** Submits the URL: starts an idle session, navigates a live one. */
  onSubmit(): void
  onStop(): void
  onReload(): void
  onViewportChange(viewport: Pick<TargetViewport, 'width' | 'height'>): void
  onOpenExternal(): void
}

/** Built-in presets; custom sizes live in Settings → Preview. */
export const VIEWPORT_PRESETS: readonly Pick<TargetViewport, 'width' | 'height'>[] = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]

/** Host validation range (`preview.session.viewport`). */
const VIEWPORT_MIN = 64
const VIEWPORT_MAX = 7680

function clampViewport(value: number): number {
  return Math.min(VIEWPORT_MAX, Math.max(VIEWPORT_MIN, value))
}

const rootStyle: React.CSSProperties = {
  position: 'relative',
  display: 'grid',
  gap: 6,
  minWidth: 0,
}

const statusRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  minHeight: 24,
}

const statusButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  font: '12px/1.4 system-ui, sans-serif',
  padding: '2px 4px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
}

function dotStyle(state: 'idle' | 'ready' | 'failed'): React.CSSProperties {
  return {
    flex: '0 0 auto',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background:
      state === 'ready'
        ? 'var(--dsw-success-color, #2ea043)'
        : state === 'failed'
          ? 'var(--dsw-danger-color, #d14343)'
          : 'var(--dsw-border-color, rgba(127, 127, 127, 0.6))',
  }
}

const statusTextStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const addressRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  font: 'inherit',
  padding: '4px 6px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
}

const buttonStyle: React.CSSProperties = {
  flex: '0 0 auto',
  font: 'inherit',
  padding: '4px 10px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

const iconButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  padding: '4px 8px',
}

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  right: 0,
  zIndex: 20,
  minWidth: 190,
  maxWidth: 280,
  display: 'grid',
  gap: 4,
  padding: 8,
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 6,
  background: 'var(--dsw-surface-color, Canvas)',
  color: 'var(--dsw-text-primary, CanvasText)',
  boxShadow: '0 6px 20px rgba(0, 0, 0, 0.28)',
  font: '12px/1.5 system-ui, sans-serif',
}

const detailsPopoverStyle: React.CSSProperties = {
  ...popoverStyle,
  left: 0,
  right: 'auto',
  minWidth: 200,
}

const menuItemStyle: React.CSSProperties = {
  font: 'inherit',
  textAlign: 'left',
  padding: '4px 6px',
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

const menuLabelStyle: React.CSSProperties = {
  opacity: 0.65,
  font: '11px/1.4 system-ui, sans-serif',
}

const presetRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
}

const presetStyle: React.CSSProperties = {
  font: '11px/1.4 system-ui, sans-serif',
  padding: '2px 8px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 999,
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
}

const detailRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  minWidth: 0,
}

const detailValueStyle: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'right',
}

const dividerStyle: React.CSSProperties = {
  height: 1,
  margin: '2px 0',
  background: 'var(--dsw-border-color, rgba(127, 127, 127, 0.3))',
}

function presetLabel(preset: Pick<TargetViewport, 'width' | 'height'>): string {
  return `${preset.width} × ${preset.height}`
}

export function Toolbar({
  locale,
  snapshot,
  targets,
  kind,
  url,
  busy,
  stats,
  stageSize,
  onKindChange,
  onUrlChange,
  onSubmit,
  onStop,
  onReload,
  onViewportChange,
  onOpenExternal,
}: ToolbarProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const state = snapshot?.status ?? 'idle'
  const ready = state === 'ready'
  const failed = state === 'failed'
  const disabled = busy !== null
  const currentUrl = snapshot?.url ?? url
  const canOpenExternal = ready && isLocalPreviewUrl(currentUrl)

  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const menuRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: Event): void => {
      const node = menuRef.current
      if (node !== null && event.target instanceof Node && !node.contains(event.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  React.useEffect(() => {
    if (!ready) {
      setDetailsOpen(false)
      setMenuOpen(false)
    }
  }, [ready])

  React.useEffect(() => {
    if (!menuOpen && !detailsOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      setDetailsOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen, detailsOpen])

  const stateLabel =
    state === 'ready'
      ? t('preview.state.ready')
      : state === 'failed'
        ? t('preview.state.failed')
        : t('preview.state.idle')
  const modeLabel =
    stats?.mode === 'stream'
      ? t('preview.mode.stream')
      : stats?.mode === 'pull'
        ? t('preview.mode.pull')
        : t('preview.mode.idle')
  const submitLabel =
    busy === 'navigate'
      ? t('preview.navigate.busy')
      : ready
        ? t('preview.go')
        : busy === 'start'
          ? t('preview.start.busy')
          : t('preview.start')
  const targetOptions: readonly PreviewTargetSummary[] =
    targets.length > 0 ? targets : [{ id: 'web', kind: 'web' }]
  const adaptiveSize: StageSize | null =
    stageSize && stageSize.width >= VIEWPORT_MIN && stageSize.height >= VIEWPORT_MIN
      ? {
          width: clampViewport(Math.round(stageSize.width)),
          height: clampViewport(Math.round(stageSize.height)),
        }
      : null

  const closeMenu = (): void => setMenuOpen(false)

  return (
    <div style={rootStyle}>
      <div style={statusRowStyle}>
        <button
          type="button"
          data-vibe-status="1"
          data-state={state}
          aria-expanded={detailsOpen}
          aria-controls="vibe-preview-details"
          title={t('preview.status.details')}
          style={statusButtonStyle}
          onClick={() => setDetailsOpen((value) => !value)}
        >
          <span style={dotStyle(state)} aria-hidden="true" />
          <span style={statusTextStyle}>
            {stateLabel}
            {ready ? ` · ${snapshot?.fps ?? 0} fps` : ''}
          </span>
        </button>

        <div ref={menuRef} style={{ position: 'relative', flex: '0 0 auto' }}>
          <button
            type="button"
            data-vibe-more-toggle="1"
            aria-expanded={menuOpen}
            aria-controls="vibe-preview-more"
            style={iconButtonStyle}
            onClick={() => setMenuOpen((value) => !value)}
          >
            ⋯ {t('preview.more')}
          </button>
          {menuOpen ? (
            <div
              id="vibe-preview-more"
              role="menu"
              aria-label={t('preview.more')}
              data-vibe-more-menu="1"
              style={popoverStyle}
            >
              <span style={menuLabelStyle}>
                {t('preview.more.viewport')}
                {snapshot?.viewport
                  ? ` · ${presetLabel(snapshot.viewport)}`
                  : ''}
              </span>
              <div style={presetRowStyle}>
                {VIEWPORT_PRESETS.map((preset) => (
                  <button
                    key={presetLabel(preset)}
                    type="button"
                    role="menuitem"
                    style={presetStyle}
                    disabled={!ready || disabled}
                    onClick={() => {
                      onViewportChange(preset)
                      closeMenu()
                    }}
                  >
                    {presetLabel(preset)}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  style={presetStyle}
                  disabled={!ready || disabled || adaptiveSize === null}
                  title={
                    adaptiveSize === null
                      ? t('preview.more.adaptive')
                      : presetLabel(adaptiveSize)
                  }
                  onClick={() => {
                    if (adaptiveSize !== null) onViewportChange(adaptiveSize)
                    closeMenu()
                  }}
                >
                  {t('preview.more.adaptive')}
                </button>
              </div>

              <div style={dividerStyle} />

              <button
                type="button"
                role="menuitem"
                style={menuItemStyle}
                disabled={!canOpenExternal || disabled}
                title={canOpenExternal ? currentUrl : t('preview.openExternal.localOnly')}
                onClick={() => {
                  onOpenExternal()
                  closeMenu()
                }}
              >
                {t('preview.openExternal')}
              </button>
              <button
                type="button"
                role="menuitem"
                style={menuItemStyle}
                disabled={!ready || disabled}
                onClick={() => {
                  onStop()
                  closeMenu()
                }}
              >
                {busy === 'stop' ? t('preview.stop.busy') : t('preview.stop')}
              </button>
              {failed ? (
                <button
                  type="button"
                  role="menuitem"
                  style={menuItemStyle}
                  disabled={disabled}
                  onClick={() => {
                    onSubmit()
                    closeMenu()
                  }}
                >
                  {busy === 'start' ? t('preview.restart.busy') : t('preview.restart')}
                </button>
              ) : null}

              {targetOptions.length > 1 ? (
                <>
                  <div style={dividerStyle} />
                  <label style={menuLabelStyle} htmlFor="vibe-preview-target">
                    {t('preview.more.target')}
                  </label>
                  <select
                    id="vibe-preview-target"
                    value={kind}
                    disabled={ready || disabled}
                    style={menuItemStyle}
                    onChange={(event) => {
                      const match = targetOptions.find(
                        (target) => target.kind === event.target.value,
                      )
                      if (match) onKindChange(match.kind)
                      closeMenu()
                    }}
                  >
                    {targetOptions.map((target) => (
                      <option key={target.kind} value={target.kind}>
                        {t(`preview.target.${target.kind}`) ===
                        `preview.target.${target.kind}`
                          ? target.kind
                          : t(`preview.target.${target.kind}`)}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {detailsOpen ? (
        <div
          id="vibe-preview-details"
          role="group"
          aria-label={t('preview.details.title')}
          data-vibe-status-details="1"
          style={detailsPopoverStyle}
        >
          <div style={detailRowStyle}>
            <span style={menuLabelStyle}>{t('preview.details.mode')}</span>
            <span style={detailValueStyle}>{modeLabel}</span>
          </div>
          <div style={detailRowStyle}>
            <span style={menuLabelStyle}>{t('preview.details.frames')}</span>
            <span style={detailValueStyle}>{stats?.frames ?? 0}</span>
          </div>
          <div style={detailRowStyle}>
            <span style={menuLabelStyle}>{t('preview.details.seq')}</span>
            <span style={detailValueStyle}>#{stats?.lastSeq ?? 0}</span>
          </div>
          {snapshot?.lastError ? (
            <div style={detailRowStyle}>
              <span style={menuLabelStyle}>{t('preview.details.error')}</span>
              <span style={detailValueStyle} title={snapshot.lastError.message}>
                {snapshot.lastError.message}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      <form
        style={addressRowStyle}
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <input
          id="vibe-preview-url"
          type="url"
          aria-label={t('preview.url.label')}
          value={url}
          placeholder="http://127.0.0.1:4320"
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onUrlChange(event.target.value)}
          style={inputStyle}
        />
        <button type="submit" style={buttonStyle} disabled={disabled}>
          {submitLabel}
        </button>
        {ready ? (
          <button
            type="button"
            aria-label={t('preview.reload')}
            title={t('preview.reload')}
            style={iconButtonStyle}
            disabled={disabled}
            onClick={onReload}
          >
            {busy === 'reload' ? '…' : '↻'}
          </button>
        ) : null}
      </form>
    </div>
  )
}
