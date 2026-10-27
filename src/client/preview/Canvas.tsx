/**
 * Preview page (T020): start a local target, render the frame canvas and show
 * which channel is carrying frames. The real toolbar and input forwarding land
 * in T025; this page exists so the stream/pull path can be exercised end to
 * end in Web and Desktop.
 *
 * Frames are coalesced: only the newest undrawn frame is kept, and the canvas
 * loop awaits one `createImageBitmap` at a time. That bounds decoding work at
 * what the display can actually paint, however fast CDP delivers frames.
 */
import * as React from 'react'
import {
  PREVIEW_START_METHOD,
  PREVIEW_STATUS_METHOD,
  PREVIEW_STOP_METHOD,
  type PreviewSessionSnapshot,
} from '../../contracts/transport'
import { createTranslator, type Locale } from '../i18n'
import { callUnary } from '../transport/client'
import { InputLayer } from './InputLayer'
import {
  PreviewTransport,
  type PreviewFrame,
  type PreviewTransportStats,
} from './transport'

/** The Vite fixture (`pnpm fixture:dev`) is the default manual test target. */
const DEFAULT_PREVIEW_URL = 'http://127.0.0.1:4320'
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 15_000

const pageStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 16,
  alignContent: 'start',
  font: '12px/1.5 system-ui, sans-serif',
}

const formStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
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

const errorStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--dsw-danger-color, #d14343)',
}

const stageStyle: React.CSSProperties = {
  position: 'relative',
  display: 'block',
  lineHeight: 0,
}

const canvasStyle: React.CSSProperties = {
  width: '100%',
  height: 'auto',
  display: 'block',
  background: '#111',
  borderRadius: 4,
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface PreviewPageProps {
  readonly locale?: Locale
}

export function PreviewPage({ locale }: PreviewPageProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const [url, setUrl] = React.useState(DEFAULT_PREVIEW_URL)
  const [snapshot, setSnapshot] = React.useState<PreviewSessionSnapshot | null>(null)
  const [busy, setBusy] = React.useState<'start' | 'stop' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [stats, setStats] = React.useState<PreviewTransportStats | null>(null)

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const transportRef = React.useRef<PreviewTransport | null>(null)
  const latestRef = React.useRef<PreviewFrame | null>(null)
  const drawingRef = React.useRef(false)
  const mountedRef = React.useRef(true)

  const paint = React.useCallback(async (): Promise<void> => {
    if (drawingRef.current || typeof createImageBitmap !== 'function') return
    drawingRef.current = true
    try {
      while (mountedRef.current) {
        const frame = latestRef.current
        if (frame === null) break
        latestRef.current = null
        let bitmap: ImageBitmap
        try {
          bitmap = await createImageBitmap(
            new Blob([frame.bytes.slice().buffer], { type: 'image/jpeg' }),
          )
        } catch {
          continue
        }
        const canvas = canvasRef.current
        if (!mountedRef.current || canvas === null) {
          bitmap.close()
          break
        }
        if (canvas.width !== frame.width) canvas.width = frame.width
        if (canvas.height !== frame.height) canvas.height = frame.height
        const context = canvas.getContext('2d')
        if (context) context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        bitmap.close()
      }
    } finally {
      drawingRef.current = false
    }
  }, [])

  const onFrame = React.useCallback(
    (frame: PreviewFrame): void => {
      latestRef.current = frame
      void paint()
    },
    [paint],
  )

  const detach = React.useCallback((): void => {
    transportRef.current?.stop()
    transportRef.current = null
    latestRef.current = null
    setStats(null)
  }, [])

  const attach = React.useCallback((): void => {
    transportRef.current?.stop()
    const transport = new PreviewTransport({ onFrame })
    transportRef.current = transport
    transport.start()
    setStats(transport.stats())
  }, [onFrame])

  const refreshStatus = React.useCallback(async (): Promise<PreviewSessionSnapshot | null> => {
    try {
      const next = await callUnary<PreviewSessionSnapshot>(PREVIEW_STATUS_METHOD)
      if (!mountedRef.current) return null
      setSnapshot(next)
      if (next.url) setUrl(next.url)
      return next
    } catch {
      return null
    }
  }, [])

  React.useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    void callUnary<PreviewSessionSnapshot>(PREVIEW_STATUS_METHOD)
      .then((next) => {
        if (cancelled || !mountedRef.current) return
        setSnapshot(next)
        if (next.url) setUrl(next.url)
        if (next.status === 'ready') attach()
      })
      .catch(() => undefined)

    const timer = setInterval(() => {
      const transport = transportRef.current
      setStats(transport?.stats() ?? null)
    }, 500)

    return () => {
      cancelled = true
      mountedRef.current = false
      clearInterval(timer)
      transportRef.current?.stop()
      transportRef.current = null
      latestRef.current = null
    }
  }, [attach])

  const handleStart = async (event?: React.FormEvent): Promise<void> => {
    event?.preventDefault()
    if (busy !== null) return
    const target = url.trim()
    if (target.length === 0) {
      setError(t('preview.error.url'))
      return
    }
    setBusy('start')
    setError(null)
    try {
      const next = await callUnary<PreviewSessionSnapshot>(
        PREVIEW_START_METHOD,
        { url: target },
        { timeoutMs: START_TIMEOUT_MS },
      )
      if (!mountedRef.current) return
      setSnapshot(next)
      if (next.url) setUrl(next.url)
      attach()
    } catch (failure) {
      if (!mountedRef.current) return
      setError(errorMessage(failure))
      await refreshStatus()
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const handleStop = async (): Promise<void> => {
    if (busy !== null) return
    setBusy('stop')
    setError(null)
    detach()
    try {
      const next = await callUnary<PreviewSessionSnapshot>(
        PREVIEW_STOP_METHOD,
        undefined,
        { timeoutMs: STOP_TIMEOUT_MS },
      )
      if (mountedRef.current) setSnapshot(next)
    } catch (failure) {
      if (mountedRef.current) setError(errorMessage(failure))
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const state = snapshot?.status ?? 'idle'
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

  return (
    <div data-vibe-preview="1" style={pageStyle}>
      <form style={formStyle} onSubmit={(event) => void handleStart(event)}>
        <label htmlFor="vibe-preview-url" style={{ font: '600 12px/1.4 system-ui, sans-serif' }}>
          {t('preview.url.label')}
        </label>
        <div style={rowStyle}>
          <input
            id="vibe-preview-url"
            type="url"
            value={url}
            placeholder={DEFAULT_PREVIEW_URL}
            spellCheck={false}
            autoComplete="off"
            disabled={state === 'ready' || busy !== null}
            onChange={(event) => setUrl(event.target.value)}
            style={inputStyle}
          />
          {state === 'ready' ? (
            <button
              type="button"
              style={buttonStyle}
              disabled={busy !== null}
              onClick={() => void handleStop()}
            >
              {busy === 'stop' ? t('preview.stop.busy') : t('preview.stop')}
            </button>
          ) : (
            <button type="submit" style={buttonStyle} disabled={busy !== null}>
              {busy === 'start' ? t('preview.start.busy') : t('preview.start')}
            </button>
          )}
        </div>
        <p style={noteStyle}>
          {t('preview.state.label')}: {stateLabel}
          {' · '}
          {modeLabel}
          {stats ? ` · ${t('preview.stats.frames')}: ${stats.frames}` : ''}
          {stats && stats.lastSeq > 0 ? ` · #${stats.lastSeq}` : ''}
          {snapshot ? ` · ${snapshot.fps} fps` : ''}
        </p>
      </form>

      {error === null ? null : (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}

      <div style={stageStyle}>
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          aria-label={t('preview.canvas.label')}
          style={canvasStyle}
        />
        {state === 'ready' ? (
          <InputLayer
            canvasRef={canvasRef}
            locale={locale}
            onError={(failure) => {
              if (mountedRef.current) setError(errorMessage(failure))
            }}
          />
        ) : null}
      </div>
      {state === 'ready' ? <p style={noteStyle}>{t('preview.input.hint')}</p> : null}
    </div>
  )
}
