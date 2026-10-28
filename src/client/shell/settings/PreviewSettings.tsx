/**
 * Settings → Preview group (U01 Layout v2).
 *
 * The viewport width/height inputs used to live permanently on the preview
 * page. They move here, collapsed behind a `<details>` so the group only reads
 * the Host when opened. Applying goes through the existing
 * `preview.session.viewport` method; no new contract.
 */
import * as React from 'react'
import {
  PREVIEW_STATUS_METHOD,
  PREVIEW_VIEWPORT_METHOD,
  type PreviewSessionSnapshot,
} from '../../../contracts/transport'
import { createTranslator, type Locale } from '../../i18n'
import { callUnary } from '../../transport/client'

const VIEWPORT_MIN = 64
const VIEWPORT_MAX = 7680
const APPLY_TIMEOUT_MS = 30_000

export interface PreviewSettingsApi {
  status(): Promise<PreviewSessionSnapshot>
  viewport(viewport: { readonly width: number; readonly height: number }): Promise<PreviewSessionSnapshot>
}

export const transportPreviewSettingsApi: PreviewSettingsApi = {
  status: () => callUnary<PreviewSessionSnapshot>(PREVIEW_STATUS_METHOD),
  viewport: (viewport) =>
    callUnary<PreviewSessionSnapshot>(
      PREVIEW_VIEWPORT_METHOD,
      { viewport },
      { timeoutMs: APPLY_TIMEOUT_MS },
    ),
}

export interface PreviewSettingsProps {
  readonly locale?: Locale
  /** Test seam; defaults to the unary transport. */
  readonly api?: PreviewSettingsApi
}

const groupStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  paddingTop: 6,
  borderTop: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.24))',
}

const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  font: '600 12px/1.4 system-ui, sans-serif',
}

const fieldStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
}

const labelStyle: React.CSSProperties = {
  font: '600 12px/1.4 system-ui, sans-serif',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'end',
}

const inputStyle: React.CSSProperties = {
  font: 'inherit',
  width: 90,
  padding: '4px 6px',
  border: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
  borderRadius: 4,
  background: 'transparent',
  color: 'inherit',
}

const hintStyle: React.CSSProperties = {
  margin: 0,
  opacity: 0.7,
}

const issueStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: 'var(--dsw-danger-color, #d14343)',
}

const statusStyle: React.CSSProperties = {
  margin: 0,
  opacity: 0.8,
}

function isViewportSize(value: string): boolean {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= VIEWPORT_MIN && parsed <= VIEWPORT_MAX
}

export function PreviewSettings({
  locale,
  api = transportPreviewSettingsApi,
}: PreviewSettingsProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const [loaded, setLoaded] = React.useState(false)
  const [width, setWidth] = React.useState('')
  const [height, setHeight] = React.useState('')
  const [ready, setReady] = React.useState(false)
  const [applying, setApplying] = React.useState(false)
  const [note, setNote] = React.useState<string | null>(null)
  const [invalid, setInvalid] = React.useState(false)
  const mounted = React.useRef(true)

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const applySnapshot = React.useCallback((snapshot: PreviewSessionSnapshot): void => {
    setReady(snapshot.status === 'ready')
    if (snapshot.viewport) {
      setWidth(String(snapshot.viewport.width))
      setHeight(String(snapshot.viewport.height))
    }
  }, [])

  const load = React.useCallback(async (): Promise<void> => {
    try {
      const snapshot = await api.status()
      if (!mounted.current) return
      applySnapshot(snapshot)
      setNote(null)
    } catch (error) {
      if (!mounted.current) return
      setNote(
        t('settings.preview.unavailable', {
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    } finally {
      if (mounted.current) setLoaded(true)
    }
  }, [api, applySnapshot, t])

  const onExpand = (event: React.SyntheticEvent<HTMLDetailsElement>): void => {
    if (event.currentTarget.open && !loaded) void load()
  }

  const onApply = async (): Promise<void> => {
    if (applying) return
    if (!isViewportSize(width) || !isViewportSize(height)) {
      setInvalid(true)
      setNote(null)
      return
    }
    setInvalid(false)
    setApplying(true)
    try {
      const snapshot = await api.viewport({ width: Number(width), height: Number(height) })
      if (!mounted.current) return
      applySnapshot(snapshot)
      setNote(t('settings.preview.applied'))
    } catch (error) {
      if (!mounted.current) return
      setNote(
        t('settings.preview.unavailable', {
          message: error instanceof Error ? error.message : String(error),
        }),
      )
    } finally {
      if (mounted.current) setApplying(false)
    }
  }

  return (
    <details
      data-settings-preview="1"
      style={groupStyle}
      onToggle={onExpand}
    >
      <summary style={summaryStyle}>{t('settings.preview.label')}</summary>
      <p style={hintStyle}>{t('settings.preview.hint')}</p>

      {loaded && !ready ? (
        <p style={statusStyle}>{t('settings.preview.idle')}</p>
      ) : null}

      <div style={fieldStyle}>
        <label htmlFor="vibe-settings-preview-width" style={labelStyle}>
          {t('settings.preview.width')}
        </label>
        <div style={rowStyle}>
          <input
            id="vibe-settings-preview-width"
            type="number"
            min={VIEWPORT_MIN}
            max={VIEWPORT_MAX}
            step={1}
            style={inputStyle}
            aria-invalid={invalid}
            disabled={!ready || applying}
            value={width}
            onChange={(event) => {
              setWidth(event.target.value)
              setInvalid(false)
            }}
          />
          <label htmlFor="vibe-settings-preview-height" style={labelStyle}>
            {t('settings.preview.height')}
          </label>
          <input
            id="vibe-settings-preview-height"
            type="number"
            min={VIEWPORT_MIN}
            max={VIEWPORT_MAX}
            step={1}
            style={inputStyle}
            aria-invalid={invalid}
            disabled={!ready || applying}
            value={height}
            onChange={(event) => {
              setHeight(event.target.value)
              setInvalid(false)
            }}
          />
          <button
            type="button"
            disabled={!ready || applying}
            onClick={() => void onApply()}
          >
            {applying ? t('settings.preview.applying') : t('settings.preview.apply')}
          </button>
        </div>
      </div>

      {invalid ? (
        <ul role="alert" style={issueStyle}>
          <li>{t('preview.viewport.invalid')}</li>
        </ul>
      ) : null}

      {note ? (
        <p role="status" style={statusStyle}>
          {note}
        </p>
      ) : null}
    </details>
  )
}
