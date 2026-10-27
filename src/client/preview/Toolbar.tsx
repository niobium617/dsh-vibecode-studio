/**
 * Preview toolbar (T025). Every piece of state shown here comes from the
 * session snapshot: target kind, URL, viewport and capabilities. The toolbar
 * never guesses whether an action is available; it disables what the snapshot
 * does not advertise and lets the Host validate again.
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

export interface ToolbarProps {
  readonly locale?: Locale
  readonly snapshot: PreviewSessionSnapshot | null
  readonly targets: readonly PreviewTargetSummary[]
  readonly kind: TargetKind
  readonly url: string
  readonly busy: ToolbarBusy
  readonly stats: PreviewTransportStats | null
  onKindChange(kind: TargetKind): void
  onUrlChange(url: string): void
  /** Submits the URL: starts an idle session, navigates a live one. */
  onSubmit(): void
  onStop(): void
  onReload(): void
  onViewportChange(viewport: Pick<TargetViewport, 'width' | 'height'>): void
  onOpenExternal(): void
}

const MIN_VIEWPORT = 64
const MAX_VIEWPORT = 7680

const toolbarStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  flexWrap: 'wrap',
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

const numberStyle: React.CSSProperties = {
  width: 64,
  font: 'inherit',
  padding: '4px 6px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
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

const noteStyle: React.CSSProperties = {
  margin: 0,
  opacity: 0.75,
}

function parseSize(value: string): number | null {
  if (!/^\d{1,5}$/.test(value.trim())) return null
  const parsed = Number(value)
  if (parsed < MIN_VIEWPORT || parsed > MAX_VIEWPORT) return null
  return parsed
}

export function Toolbar({
  locale,
  snapshot,
  targets,
  kind,
  url,
  busy,
  stats,
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
  const disabled = busy !== null
  const currentUrl = snapshot?.url ?? url
  const canOpenExternal = ready && isLocalPreviewUrl(currentUrl)

  const [width, setWidth] = React.useState('')
  const [height, setHeight] = React.useState('')
  const liveWidth = snapshot?.viewport?.width
  const liveHeight = snapshot?.viewport?.height

  // Follow viewport changes made elsewhere (restart, another panel) without
  // clobbering input that has not been applied yet: only a new snapshot size
  // replaces the fields.
  React.useEffect(() => {
    if (liveWidth === undefined || liveHeight === undefined) return
    setWidth(String(liveWidth))
    setHeight(String(liveHeight))
  }, [liveWidth, liveHeight])

  const parsedWidth = parseSize(width)
  const parsedHeight = parseSize(height)
  const viewportValid = parsedWidth !== null && parsedHeight !== null
  const viewportDirty =
    parsedWidth !== liveWidth || parsedHeight !== liveHeight
  const canApplyViewport = ready && !disabled && viewportValid && viewportDirty
  const showViewportError =
    (width.trim().length > 0 || height.trim().length > 0) && !viewportValid

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

  return (
    <form
      style={toolbarStyle}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div style={rowStyle}>
        <label htmlFor="vibe-preview-target" style={noteStyle}>
          {t('preview.target.label')}
        </label>
        <select
          id="vibe-preview-target"
          value={kind}
          disabled={ready || disabled}
          onChange={(event) => {
            const match = targetOptions.find(
              (target) => target.kind === event.target.value,
            )
            if (match) onKindChange(match.kind)
          }}
          style={buttonStyle}
        >
          {targetOptions.map((target) => (
            <option key={target.kind} value={target.kind}>
              {t(`preview.target.${target.kind}`) === `preview.target.${target.kind}`
                ? target.kind
                : t(`preview.target.${target.kind}`)}
            </option>
          ))}
        </select>

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
      </div>

      <div style={rowStyle}>
        <button
          type="button"
          style={buttonStyle}
          disabled={!ready || disabled}
          onClick={onReload}
        >
          {busy === 'reload' ? t('preview.reload.busy') : t('preview.reload')}
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={!canOpenExternal || disabled}
          title={
            canOpenExternal ? currentUrl : t('preview.openExternal.localOnly')
          }
          onClick={onOpenExternal}
        >
          {t('preview.openExternal')}
        </button>
        <button
          type="button"
          style={buttonStyle}
          disabled={!ready || disabled}
          onClick={onStop}
        >
          {busy === 'stop' ? t('preview.stop.busy') : t('preview.stop')}
        </button>
      </div>

      <div style={rowStyle}>
        <span style={noteStyle}>{t('preview.viewport.label')}</span>
        <input
          aria-label={t('preview.viewport.width')}
          type="text"
          inputMode="numeric"
          value={width}
          disabled={!ready || disabled}
          onChange={(event) => setWidth(event.target.value)}
          style={numberStyle}
        />
        <span style={noteStyle}>×</span>
        <input
          aria-label={t('preview.viewport.height')}
          type="text"
          inputMode="numeric"
          value={height}
          disabled={!ready || disabled}
          onChange={(event) => setHeight(event.target.value)}
          style={numberStyle}
        />
        <button
          type="button"
          style={buttonStyle}
          disabled={!canApplyViewport}
          onClick={() => {
            if (parsedWidth === null || parsedHeight === null) return
            onViewportChange({ width: parsedWidth, height: parsedHeight })
          }}
        >
          {busy === 'viewport'
            ? t('preview.viewport.applying')
            : t('preview.viewport.apply')}
        </button>
      </div>

      {showViewportError ? (
        <p role="note" style={noteStyle}>
          {t('preview.viewport.invalid')}
        </p>
      ) : null}

      <p style={noteStyle} aria-live="polite">
        {t('preview.state.label')}: {stateLabel}
        {' · '}
        {modeLabel}
        {stats ? ` · ${t('preview.stats.frames')}: ${stats.frames}` : ''}
        {stats && stats.lastSeq > 0 ? ` · #${stats.lastSeq}` : ''}
        {snapshot ? ` · ${snapshot.fps} fps` : ''}
      </p>
    </form>
  )
}
