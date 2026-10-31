/**
 * Preview page (T020, toolbar and lifecycle T025, Layout v2 U01).
 *
 * The page owns the frame canvas and the transport feed; the toolbar drives the
 * Host session. Layout v2 keeps the canvas as the main surface: one status line,
 * one address row, a permanent bottom tab bar, and drawers that overlay the
 * stage without changing its size. Viewport sizes moved to Settings → Preview,
 * with a few presets behind the "More" menu.
 *
 * A one-second status poll turns a crashed browser or closed tab into a
 * visible, restartable `failed` snapshot — there is no automatic reconnect.
 * Unmounting this page (an internal tab switch) only detaches the frame feed;
 * the shell calls `stopPreviewSession` when the whole DSH panel closes.
 *
 * Frames are coalesced: only the newest undrawn frame is kept, and the canvas
 * loop awaits one `createImageBitmap` at a time. That bounds decoding work at
 * what the display can actually paint, however fast CDP delivers frames.
 */
import * as React from 'react'
import type { Annotation } from '../../contracts/annotation'
import type { TargetKind, TargetViewport } from '../../contracts/target'
import type { VerifyEvidence } from '../../contracts/verify'
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
import { AnnotationBubble, placeBubble } from '../inspect/AnnotationBubble'
import {
  addAnnotationToQueue,
  clipboardSender,
  createElementAnnotation,
  sendQueuedAnnotation,
  type AnnotationSender,
} from '../inspect/AnnotationQueue'
import { AnnotationSaveNotice } from '../inspect/AnnotationSaveNotice'
import { persistAnnotation } from '../inspect/history-store'
import { PickCard, usePicker } from '../inspect/Picker'
import { setActiveTab } from '../shell/store'
import { callUnary } from '../transport/client'
import { VerifyPanel } from '../verify/VerifyPanel'
import { ConsoleDrawer, type ConsoleCounts } from './ConsoleDrawer'
import type { DrawerFocus } from './focus'
import { InputLayer } from './InputLayer'
import { markPreviewActive } from './lifecycle'
import { isLocalPreviewUrl } from './local-url'
import { NetworkDrawer, type NetworkCounts } from './NetworkDrawer'
import {
  PreviewTabs,
  type PreviewDrawerKind,
  type TabCount,
} from './PreviewTabs'
import { Toolbar, type StageSize, type ToolbarBusy } from './Toolbar'
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
const DRAWER_HEIGHT = '40%'

const pageStyle: React.CSSProperties = {
  display: 'grid',
  // Exactly three children: toolbar, stage, drawer tabs.
  gridTemplateRows: 'auto minmax(0, 1fr) auto',
  gap: 6,
  height: '100%',
  minHeight: 0,
  boxSizing: 'border-box',
  padding: '8px 8px 0',
  font: '12px/1.5 system-ui, sans-serif',
}

const stageStyle: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 0,
  overflow: 'hidden',
  borderRadius: 4,
  background: '#111',
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

const canvasStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  height: '100%',
  background: '#111',
}

const emptyHintStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'grid',
  placeItems: 'center',
  padding: 16,
  margin: 0,
  textAlign: 'center',
  color: '#cfcfcf',
  font: '12px/1.6 system-ui, sans-serif',
  pointerEvents: 'none',
}

const errorBannerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 8,
  right: 8,
  zIndex: 6,
  margin: 0,
  padding: '6px 8px',
  borderRadius: 4,
  background: 'rgba(120, 24, 24, 0.92)',
  color: '#fff',
  font: '11px/1.5 system-ui, sans-serif',
}

const failureOverlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 3,
  display: 'grid',
  placeItems: 'center',
  padding: 16,
  background: 'rgba(0, 0, 0, 0.6)',
}

const failureCardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 6,
  width: '100%',
  maxWidth: 340,
  padding: 12,
  border: '1px solid var(--dsw-danger-color, #d14343)',
  borderRadius: 6,
  background: '#1c1c1e',
  color: '#f2f2f2',
  font: '12px/1.5 system-ui, sans-serif',
}

const failureListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  opacity: 0.85,
}

const failureNoteStyle: React.CSSProperties = {
  margin: 0,
  opacity: 0.85,
  wordBreak: 'break-word',
}

const inputHintStyle: React.CSSProperties = {
  position: 'absolute',
  left: 8,
  bottom: 8,
  zIndex: 2,
  margin: 0,
  padding: '2px 6px',
  borderRadius: 4,
  background: 'rgba(0, 0, 0, 0.55)',
  color: '#e6e6e6',
  font: '11px/1.4 system-ui, sans-serif',
  pointerEvents: 'none',
}

const pickHintStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 8,
  right: 8,
  zIndex: 2,
  margin: 0,
  padding: '2px 6px',
  borderRadius: 4,
  background: 'rgba(59, 130, 246, 0.88)',
  color: '#fff',
  font: '11px/1.4 system-ui, sans-serif',
  pointerEvents: 'none',
}

function drawerLayerStyle(open: boolean): React.CSSProperties {
  return {
    display: open ? 'grid' : 'none',
    gridTemplateRows: 'minmax(0, 1fr)',
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: DRAWER_HEIGHT,
    zIndex: 4,
    borderTop: '1px solid var(--dsw-border-color, rgba(127, 127, 127, 0.4))',
    background: 'var(--dsw-surface-color, Canvas)',
    color: 'var(--dsw-text-primary, CanvasText)',
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Picks the largest box with `aspect` (width / height) that fits the stage.
 * The canvas keeps the target page's ratio; the leftover stage area is a
 * letterbox, never a stretch.
 */
export function fitContain(
  stage: StageSize | null,
  aspect: number,
): StageSize | null {
  if (stage === null) return null
  if (!(stage.width > 0) || !(stage.height > 0)) return null
  if (!(aspect > 0) || !Number.isFinite(aspect)) return null
  const width = Math.min(stage.width, stage.height * aspect)
  return { width: Math.floor(width), height: Math.floor(width / aspect) }
}

export interface PreviewPageProps {
  readonly locale?: Locale
  /** Composer handoff for the save notice; defaults to the clipboard. */
  readonly send?: AnnotationSender
}

interface QueueNotice {
  readonly annotation: Annotation
  /** False when the history write failed; the annotation is still queued. */
  readonly persisted: boolean
  /** Outcome of the bubble's direct "Send to chat", once it resolves. */
  readonly sent: { readonly ok: boolean; readonly message: string } | null
}

export function PreviewPage({ locale, send }: PreviewPageProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const [url, setUrl] = React.useState(DEFAULT_PREVIEW_URL)
  const [kind, setKind] = React.useState<TargetKind>('web')
  const [targets, setTargets] = React.useState<PreviewTargetsResult['targets']>([])
  const [snapshot, setSnapshot] = React.useState<PreviewSessionSnapshot | null>(null)
  const [busy, setBusy] = React.useState<ToolbarBusy>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [stats, setStats] = React.useState<PreviewTransportStats | null>(null)
  const [stageSize, setStageSize] = React.useState<StageSize | null>(null)
  const [drawer, setDrawer] = React.useState<PreviewDrawerKind | null>(null)
  /** T056: the evidence row the Verification panel asked the drawers to reveal. */
  const [focus, setFocus] = React.useState<DrawerFocus | null>(null)
  const focusNonce = React.useRef(0)
  // `unsaved` means the note is in the queue but the history file was not written.
  const [queueNotice, setQueueNotice] = React.useState<QueueNotice | null>(null)
  const [consoleCounts, setConsoleCounts] = React.useState<ConsoleCounts>({
    total: 0,
    errors: 0,
    warnings: 0,
    info: 0,
  })
  const [networkCounts, setNetworkCounts] = React.useState<NetworkCounts>({
    total: 0,
    failed: 0,
  })

  const state = snapshot?.status ?? 'idle'
  const ready = state === 'ready'
  // Stop releases the host collectors before the session reports idle. Keep the
  // drawers from polling that half-torn-down session (it answers `unsupported`)
  // and close any open drawer as soon as the user asks to stop.
  const stopping = busy === 'stop'
  const canPick = ready && !stopping && snapshot?.capabilities?.pick === true

  // The picker polls the Host, which owns the page overlay; the panel only
  // reads its snapshot (T027).
  const picker = usePicker({
    enabled: canPick,
    onError: (failure) => setError(errorMessage(failure)),
  })
  const pickedElement = picker.pick

  // A fresh pick reopens the comment bubble and hides the previous confirmation.
  React.useEffect(() => {
    if (pickedElement !== null) setQueueNotice(null)
  }, [pickedElement])

  /**
   * Queues the comment and writes the history file. Save and direct-send share
   * this step so both land in the history list; a failed write only downgrades
   * the notice, exactly as before.
   */
  const queuePickedComment = (comment: string): Annotation | null => {
    const targetId = snapshot?.targetId ?? null
    if (targetId === null || pickedElement === null) return null
    const annotation = createElementAnnotation({ targetId, comment, element: pickedElement })
    if (!addAnnotationToQueue(annotation)) return null
    setQueueNotice({ annotation, persisted: true, sent: null })
    picker.dismiss()
    void persistAnnotation(annotation).then((saved) => {
      if (saved) return
      setQueueNotice((current) =>
        current?.annotation.id === annotation.id ? { ...current, persisted: false } : current,
      )
    })
    return annotation
  }

  /** "Send to chat" in the bubble: history first, then the composer handoff. */
  const sendPickedComment = (comment: string): void => {
    const annotation = queuePickedComment(comment)
    if (annotation === null) return
    void sendQueuedAnnotation(annotation, send ?? clipboardSender, {
      sent: t('annotation.item.sent'),
      failed: t('annotation.item.sendFailed'),
    }).then((result) => {
      setQueueNotice((current) =>
        current?.annotation.id === annotation.id
          ? { ...current, sent: { ok: result.ok, message: result.message } }
          : current,
      )
    })
  }

  const stageRef = React.useRef<HTMLDivElement | null>(null)
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

  // The stage is measured so the canvas can keep the target ratio inside the
  // available pane; the drawer overlays it and must not trigger a resize.
  React.useEffect(() => {
    const stage = stageRef.current
    if (stage === null) return
    const measure = (): void => {
      const rect = stage.getBoundingClientRect()
      setStageSize((previous) =>
        previous !== null &&
        Math.abs(previous.width - rect.width) < 1 &&
        Math.abs(previous.height - rect.height) < 1
          ? previous
          : { width: rect.width, height: rect.height },
      )
    }
    measure()
    if (typeof ResizeObserver !== 'function') return
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

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

  const canConsole = ready && !stopping && snapshot?.capabilities?.console === true
  const canNetwork = ready && !stopping && snapshot?.capabilities?.network === true

  React.useEffect(() => {
    if (stopping) {
      setDrawer(null)
      return
    }
    // Console/network close with the session; the verification panel stays
    // open because it is where a beginner learns the checks cannot run yet.
    if (!ready) setDrawer((current) => (current === 'verify' ? current : null))
  }, [ready, stopping])

  const toggleDrawer = (next: PreviewDrawerKind): void => {
    setDrawer((current) => (current === next ? null : next))
  }

  // A verification evidence button opens the drawer that owns the entry and
  // asks it to reveal the row; the nonce makes a repeat click observable.
  const openEvidence = (evidence: VerifyEvidence): void => {
    focusNonce.current += 1
    setFocus({ id: evidence.id, nonce: focusNonce.current })
    setDrawer(evidence.kind)
  }

  // The bitmap keeps the target page ratio; the residual stage area is a
  // letterbox so pointer mapping stays exact (the input layer matches the
  // canvas box, not the stage).
  const aspect =
    snapshot?.viewport && snapshot.viewport.height > 0
      ? snapshot.viewport.width / snapshot.viewport.height
      : 16 / 9
  const box = fitContain(stageSize, aspect)
  const boxStyle: React.CSSProperties =
    box === null
      ? { position: 'relative', width: '100%', maxWidth: '100%', aspectRatio: String(aspect) }
      : { position: 'relative', width: box.width, height: box.height }

  // The canvas is centred in the stage by flex, so the drawn frame's stage
  // offset follows from the measured stage and the fitted box (T031 bubble).
  const stageFrame =
    box !== null && stageSize !== null
      ? {
          left: Math.max(0, (stageSize.width - box.width) / 2),
          top: Math.max(0, (stageSize.height - box.height) / 2),
          width: box.width,
          height: box.height,
        }
      : null
  const bubblePlacement =
    pickedElement !== null && snapshot?.viewport && stageFrame !== null
      ? placeBubble({ box: pickedElement.box, viewport: snapshot.viewport, frame: stageFrame })
      : null

  const consoleTab: TabCount = { available: canConsole, count: consoleCounts.total }
  const networkTab: TabCount = { available: canNetwork, count: networkCounts.total }

  return (
    <div data-vibe-preview="1" data-layout="v2" style={pageStyle}>
      <Toolbar
        locale={locale}
        snapshot={snapshot}
        targets={targets}
        kind={kind}
        url={url}
        busy={busy}
        stats={stats}
        stageSize={stageSize}
        picking={picker.picking}
        canPick={canPick}
        onKindChange={setKind}
        onUrlChange={setUrl}
        onSubmit={() => void (ready ? handleNavigate() : handleStart())}
        onStop={() => void handleStop()}
        onReload={() => void handleReload()}
        onViewportChange={(viewport) => void handleViewport(viewport)}
        onOpenExternal={handleOpenExternal}
        onPickToggle={picker.toggle}
      />

      <div ref={stageRef} data-vibe-stage="1" style={stageStyle}>
        <div style={boxStyle}>
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
              picking={picker.picking}
              onError={(failure) => {
                if (mountedRef.current) setError(errorMessage(failure))
              }}
            />
          ) : null}
        </div>

        {state === 'idle' ? (
          <p data-vibe-empty="1" style={emptyHintStyle}>
            {t('preview.empty.hint')}
          </p>
        ) : null}

        {state === 'failed' ? (
          <div data-vibe-failure="1" style={failureOverlayStyle}>
            <div role="alert" style={failureCardStyle}>
              <strong>{t('preview.failure.title')}</strong>
              {snapshot?.lastError ? (
                <p style={failureNoteStyle}>{snapshot.lastError.message}</p>
              ) : null}
              <p style={failureNoteStyle}>{t('preview.failure.checks')}</p>
              <ul style={failureListStyle}>
                <li>{t('preview.failure.check.fixture')}</li>
                <li>{t('preview.failure.check.port')}</li>
                <li>{t('preview.failure.check.edge')}</li>
              </ul>
              <div>
                <button
                  type="button"
                  style={{ ...buttonStyle, background: '#f2f2f2', color: '#111' }}
                  disabled={busy !== null}
                  onClick={() => void handleStart()}
                >
                  {busy === 'start' ? t('preview.restart.busy') : t('preview.restart')}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {ready && !picker.picking ? (
          <p data-vibe-input-hint="1" style={inputHintStyle}>
            {t('preview.input.hint')}
          </p>
        ) : null}

        {picker.picking ? (
          <p data-vibe-pick-hint="1" role="status" style={pickHintStyle}>
            {t('preview.pick.hint.active')}
          </p>
        ) : null}

        {pickedElement ? (
          <PickCard locale={locale} pick={pickedElement} onClose={picker.dismiss} />
        ) : null}

        {pickedElement !== null && bubblePlacement !== null && snapshot?.targetId ? (
          <AnnotationBubble
            locale={locale}
            element={pickedElement}
            placement={bubblePlacement}
            onSave={queuePickedComment}
            onSend={sendPickedComment}
            onCancel={picker.dismiss}
          />
        ) : null}

        {queueNotice === null ? null : (
          <AnnotationSaveNotice
            key={queueNotice.annotation.id}
            locale={locale}
            annotation={queueNotice.annotation}
            persisted={queueNotice.persisted}
            sent={queueNotice.sent?.ok ?? false}
            initialMessage={queueNotice.sent?.message}
            onViewQueue={() => setActiveTab('annotations')}
            send={send}
          />
        )}

        {error === null ? null : (
          <p role="alert" style={errorBannerStyle}>
            {error}
          </p>
        )}

        <div data-vibe-drawer-layer="1" style={drawerLayerStyle(drawer !== null)}>
          <ConsoleDrawer
            active={canConsole}
            locale={locale}
            visible={drawer === 'console'}
            focus={focus}
            onClose={() => setDrawer(null)}
            onCountsChange={setConsoleCounts}
          />
          <NetworkDrawer
            active={canNetwork}
            locale={locale}
            visible={drawer === 'network'}
            focus={focus}
            onClose={() => setDrawer(null)}
            onCountsChange={setNetworkCounts}
          />
          <VerifyPanel
            locale={locale}
            visible={drawer === 'verify'}
            ready={ready && !stopping}
            onClose={() => setDrawer(null)}
            onOpenEvidence={openEvidence}
          />
        </div>
      </div>

      <PreviewTabs
        locale={locale}
        ready={ready}
        console={consoleTab}
        network={networkTab}
        verify={{ available: true }}
        open={drawer}
        onToggle={toggleDrawer}
      />
    </div>
  )
}
