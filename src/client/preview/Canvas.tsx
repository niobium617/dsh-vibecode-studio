/**
 * Preview page (T020, toolbar and lifecycle T025).
 *
 * The page owns the frame canvas and the transport feed; the toolbar above it
 * drives the Host session. A one-second status poll turns a crashed browser or
 * closed tab into a visible, restartable `failed` snapshot — there is no
 * automatic reconnect. Unmounting this page (an internal tab switch) only
 * detaches the frame feed; the shell calls `stopPreviewSession` when the whole
 * DSH panel closes.
 *
 * Frames are coalesced: only the newest undrawn frame is kept, and the canvas
 * loop awaits one `createImageBitmap` at a time. That bounds decoding work at
 * what the display can actually paint, however fast CDP delivers frames.
 */
import * as React from 'react'
import type { TargetKind, TargetViewport } from '../../contracts/target'
import {
  PREVIEW_NAVIGATE_METHOD,
  PREVIEW_RELOAD_METHOD,
  PREVIEW_START_METHOD,
  PREVIEW_STATUS_METHOD,
  PREVIEW_STOP_METHOD,
  PREVIEW_TARGETS_METHOD,
  PREVIEW_VIEWPORT_METHOD,
  type PreviewSessionSnapshot,
  type PreviewTargetsResult,
} from '../../contracts/transport'
import { createTranslator, type Locale } from '../i18n'
import { callUnary } from '../transport/client'
import { ConsoleDrawer } from './ConsoleDrawer'
import { InputLayer } from './InputLayer'
import { markPreviewActive } from './lifecycle'
import { isLocalPreviewUrl } from './local-url'
import { NetworkDrawer } from './NetworkDrawer'
import { Toolbar, type ToolbarBusy } from './Toolbar'
import {
  PreviewTransport,
  type PreviewFrame,
  type PreviewTransportStats,
} from './transport'

/** The Vite fixture (`pnpm fixture:dev`) is the default manual test target. */
const DEFAULT_PREVIEW_URL = 'http://127.0.0.1:4320'
const START_TIMEOUT_MS = 30_000
const STOP_TIMEOUT_MS = 15_000
const STATUS_INTERVAL_MS = 1_000

const pageStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 16,
  alignContent: 'start',
  font: '12px/1.5 system-ui, sans-serif',
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
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

const crashStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  padding: '8px 10px',
  border: '1px solid var(--dsw-danger-color, #d14343)',
  borderRadius: 4,
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
  const [kind, setKind] = React.useState<TargetKind>('web')
  const [targets, setTargets] = React.useState<PreviewTargetsResult['targets']>([])
  const [snapshot, setSnapshot] = React.useState<PreviewSessionSnapshot | null>(null)
  const [busy, setBusy] = React.useState<ToolbarBusy>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [stats, setStats] = React.useState<PreviewTransportStats | null>(null)

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const transportRef = React.useRef<PreviewTransport | null>(null)
  const latestRef = React.useRef<PreviewFrame | null>(null)
  const lastServerUrlRef = React.useRef<string | null>(null)
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

  /**
   * Applies a Host snapshot. Idle and failed sessions lose the frame feed; a
   * failed session keeps the lifecycle flag because its handles may still be
   * alive and the panel close path must stop them.
   */
  const syncSnapshot = React.useCallback(
    (next: PreviewSessionSnapshot): void => {
      if (!mountedRef.current) return
      setSnapshot(next)
      if (next.kind !== null) setKind(next.kind)
      if (next.url !== null && next.url !== lastServerUrlRef.current) {
        lastServerUrlRef.current = next.url
        setUrl(next.url)
      }
      if (next.status === 'ready') {
        markPreviewActive(true)
        if (transportRef.current === null) attach()
        return
      }
      if (next.status === 'idle') markPreviewActive(false)
      detach()
    },
    [attach, detach],
  )

  const refreshStatus = React.useCallback(async (): Promise<void> => {
    try {
      const next = await callUnary<PreviewSessionSnapshot>(PREVIEW_STATUS_METHOD)
      syncSnapshot(next)
    } catch {
      // The Host may be reloading; the next poll retries.
    }
  }, [syncSnapshot])

  React.useEffect(() => {
    mountedRef.current = true
    let cancelled = false

    void (async () => {
      try {
        const [initial, targetList] = await Promise.all([
          callUnary<PreviewSessionSnapshot>(PREVIEW_STATUS_METHOD),
          callUnary<PreviewTargetsResult>(PREVIEW_TARGETS_METHOD),
        ])
        if (cancelled || !mountedRef.current) return
        setTargets(targetList.targets)
        syncSnapshot(initial)
      } catch {
        // Older Hosts without T025 have no targets method; the toolbar falls
        // back to the single web target.
      }
    })()

    // Liveness poll: this is how a crashed browser becomes visible. It only
    // reads state; reconnection stays an explicit user action.
    const statusTimer = setInterval(() => void refreshStatus(), STATUS_INTERVAL_MS)
    const statsTimer = setInterval(() => {
      const transport = transportRef.current
      setStats(transport?.stats() ?? null)
    }, 500)

    return () => {
      cancelled = true
      mountedRef.current = false
      clearInterval(statusTimer)
      clearInterval(statsTimer)
      transportRef.current?.stop()
      transportRef.current = null
      latestRef.current = null
    }
  }, [refreshStatus, syncSnapshot])

  const runAction = async (
    label: Exclude<ToolbarBusy, null>,
    action: () => Promise<void>,
  ): Promise<void> => {
    if (busy !== null) return
    setBusy(label)
    setError(null)
    try {
      await action()
    } catch (failure) {
      if (mountedRef.current) setError(errorMessage(failure))
      await refreshStatus()
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const currentViewport = (): Pick<TargetViewport, 'width' | 'height'> | undefined => {
    if (!snapshot?.viewport) return undefined
    return { width: snapshot.viewport.width, height: snapshot.viewport.height }
  }

  const handleStart = async (): Promise<void> => {
    const target = url.trim()
    if (target.length === 0) {
      setError(t('preview.error.url'))
      return
    }
    await runAction('start', async () => {
      const viewport = currentViewport()
      const next = await callUnary<PreviewSessionSnapshot>(
        PREVIEW_START_METHOD,
        { url: target, kind, ...(viewport ? { viewport } : {}) },
        { timeoutMs: START_TIMEOUT_MS },
      )
      syncSnapshot(next)
    })
  }

  const handleNavigate = async (): Promise<void> => {
    const target = url.trim()
    if (target.length === 0) {
      setError(t('preview.error.url'))
      return
    }
    await runAction('navigate', async () => {
      const next = await callUnary<PreviewSessionSnapshot>(
        PREVIEW_NAVIGATE_METHOD,
        { url: target },
        { timeoutMs: START_TIMEOUT_MS },
      )
      syncSnapshot(next)
    })
  }

  const handleReload = async (): Promise<void> => {
    await runAction('reload', async () => {
      const next = await callUnary<PreviewSessionSnapshot>(PREVIEW_RELOAD_METHOD, undefined, {
        timeoutMs: START_TIMEOUT_MS,
      })
      syncSnapshot(next)
    })
  }

  const handleViewport = async (
    viewport: Pick<TargetViewport, 'width' | 'height'>,
  ): Promise<void> => {
    await runAction('viewport', async () => {
      const next = await callUnary<PreviewSessionSnapshot>(
        PREVIEW_VIEWPORT_METHOD,
        { viewport },
        { timeoutMs: START_TIMEOUT_MS },
      )
      syncSnapshot(next)
    })
  }

  const handleStop = async (): Promise<void> => {
    await runAction('stop', async () => {
      detach()
      const next = await callUnary<PreviewSessionSnapshot>(
        PREVIEW_STOP_METHOD,
        undefined,
        { timeoutMs: STOP_TIMEOUT_MS },
      )
      syncSnapshot(next)
    })
  }

  const handleOpenExternal = (): void => {
    const target = snapshot?.url ?? url.trim()
    if (!isLocalPreviewUrl(target)) {
      setError(t('preview.openExternal.localOnly'))
      return
    }
    // DSH Desktop denies the in-app window and hands the URL to the system
    // browser; a null return is the normal deny path, not a failure.
    window.open(target, '_blank', 'noopener,noreferrer')
  }

  const state = snapshot?.status ?? 'idle'
  const ready = state === 'ready'

  return (
    <div data-vibe-preview="1" style={pageStyle}>
      <Toolbar
        locale={locale}
        snapshot={snapshot}
        targets={targets}
        kind={kind}
        url={url}
        busy={busy}
        stats={stats}
        onKindChange={setKind}
        onUrlChange={setUrl}
        onSubmit={() => void (ready ? handleNavigate() : handleStart())}
        onStop={() => void handleStop()}
        onReload={() => void handleReload()}
        onViewportChange={(viewport) => void handleViewport(viewport)}
        onOpenExternal={handleOpenExternal}
      />

      {error === null ? null : (
        <p role="alert" style={errorStyle}>
          {error}
        </p>
      )}

      {state === 'failed' ? (
        <div role="alert" style={crashStyle}>
          <strong>{t('preview.crash.title')}</strong>
          {snapshot?.lastError ? (
            <p style={noteStyle}>{snapshot.lastError.message}</p>
          ) : null}
          <p style={noteStyle}>{t('preview.crash.hint')}</p>
          <div style={rowStyle}>
            <button
              type="button"
              style={buttonStyle}
              disabled={busy !== null}
              onClick={() => void handleStart()}
            >
              {busy === 'start' ? t('preview.restart.busy') : t('preview.restart')}
            </button>
            <button
              type="button"
              style={buttonStyle}
              disabled={busy !== null}
              onClick={() => void handleStop()}
            >
              {busy === 'stop' ? t('preview.stop.busy') : t('preview.stop')}
            </button>
          </div>
        </div>
      ) : null}

      <div style={stageStyle}>
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          aria-label={t('preview.canvas.label')}
          style={canvasStyle}
        />
        {ready ? (
          <InputLayer
            canvasRef={canvasRef}
            locale={locale}
            onError={(failure) => {
              if (mountedRef.current) setError(errorMessage(failure))
            }}
          />
        ) : null}
      </div>
      {ready ? <p style={noteStyle}>{t('preview.input.hint')}</p> : null}
      {ready && snapshot?.capabilities?.console === true ? (
        <ConsoleDrawer active locale={locale} />
      ) : null}
      {ready && snapshot?.capabilities?.network === true ? (
        <NetworkDrawer active locale={locale} />
      ) : null}
    </div>
  )
}
