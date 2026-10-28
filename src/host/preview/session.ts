/**
 * Preview session service (T020, extended by T025).
 *
 * One live target at a time. Starting resolves the adapter kind through the
 * registry, validates the target config, then wires the screencast source and
 * the auxiliary CDP sessions (input, console, network). `release()` tears them
 * down in dependency order so no CDP handle or browser survives a stop.
 *
 * T025 adds the toolbar surface: navigate/reload/viewport, a liveness probe
 * that turns a crashed browser into a visible `failed` snapshot, and a restart
 * path that releases the dead session before starting a new one.
 */
import type { StudioError } from '../../contracts/errors'
import { isStudioError, studioError } from '../../contracts/errors'
import type {
  TargetCapabilities,
  TargetKind,
  TargetSession,
  TargetViewport,
} from '../../contracts/target'
import {
  DEFAULT_PREVIEW_FPS,
  DEFAULT_PREVIEW_QUALITY,
  isPreviewConsoleQuery,
  isPreviewInputEvent,
  isPreviewNavigateParams,
  isPreviewNetworkBodyParams,
  isPreviewNetworkQuery,
  isPreviewViewportParams,
  isPreviewStartParams,
  type PreviewConsoleClearResult,
  type PreviewConsoleSnapshot,
  type PreviewFrameMeta,
  type PreviewInputAck,
  type PreviewNetworkBody,
  type PreviewNetworkClearResult,
  type PreviewNetworkSnapshot,
  type PreviewSessionSnapshot,
  type PreviewSessionState,
  type PreviewStartParams,
  type PreviewTargetsResult,
  type PickSnapshot,
} from '../../contracts/transport'
import type { PreviewPicker } from '../inspect/inject'
import { createPreviewPicker } from '../inspect/inject'
import type { TargetAdapter } from '../targets/types'
import { validateTargetConfig } from '../targets/validate'
import type { TargetAdapterRegistry } from '../targets/registry'
import {
  createPreviewConsoleCollector,
  type PreviewConsoleCollector,
} from './console'
import type { PreviewFrame, PreviewFrameBuffer } from './frame-buffer'
import { createPreviewFrameBuffer } from './frame-buffer'
import type { PreviewInputDispatcher } from './input'
import { createPreviewInputDispatcher } from './input'
import type { PreviewNetworkCollector } from './network'
import { createPreviewNetworkCollector } from './network'
import { createScreencastSource, type ScreencastSource } from './screencast'

const PREVIEW_TARGET_ID = 'preview'
const PREVIEW_TARGET_NAME = 'Preview'
const DEFAULT_PREVIEW_KIND: TargetKind = 'web'
/** Only used to satisfy config validation when a URL is already known. */
const PLACEHOLDER_URL = 'http://127.0.0.1/'

export interface PreviewService {
  readonly buffer: PreviewFrameBuffer
  start(params: PreviewStartParams): Promise<PreviewSessionSnapshot>
  stop(): Promise<PreviewSessionSnapshot>
  status(): PreviewSessionSnapshot
  /** Validates and forwards one pointer/wheel/key event (T021). */
  input(event: unknown): Promise<PreviewInputAck>
  /** Bounded console history for the live preview (T023). */
  consoleList(query?: unknown): PreviewConsoleSnapshot
  /** Clears the Host console buffer; the panel clears its copy too. */
  consoleClear(): PreviewConsoleClearResult
  /** Bounded request/response history for the live preview (T024). */
  networkList(query?: unknown): PreviewNetworkSnapshot
  networkClear(): PreviewNetworkClearResult
  /** Fetches one response body on demand. */
  networkBody(params: unknown): Promise<PreviewNetworkBody>
  /** Registered adapters for the toolbar's target select (T025). */
  listTargets(): PreviewTargetsResult
  /** Navigates the live page after validating the URL (T025). */
  navigate(params: unknown): Promise<PreviewSessionSnapshot>
  /** Reloads the live page (T025). */
  reload(): Promise<PreviewSessionSnapshot>
  /** Resizes the live viewport; DPR needs a restart (T025). */
  setViewport(params: unknown): Promise<PreviewSessionSnapshot>
  /** Turns the in-page picker overlay on (T027). */
  pickStart(): Promise<PickSnapshot>
  /** Turns it off; safe to call when no preview runs. */
  pickStop(): Promise<PickSnapshot>
  /** Polled by the panel while a pick is pending (T027). */
  pickStatus(): PickSnapshot
  dispose(): Promise<void>
}

export interface PreviewServiceOptions {
  readonly targets: TargetAdapterRegistry
  readonly fps?: number
  readonly quality?: number
  /** Test seam: substitutes the CDP source. */
  readonly createSource?: (
    page: NonNullable<ReturnType<NonNullable<TargetAdapter['screencastPage']>>>,
    buffer: PreviewFrameBuffer,
  ) => ScreencastSource
  /** Test seam: substitutes the CDP input dispatcher. */
  readonly createInput?: (
    page: NonNullable<ReturnType<NonNullable<TargetAdapter['screencastPage']>>>,
  ) => PreviewInputDispatcher
  /** Test seam: substitutes the CDP console collector. */
  readonly createConsole?: (
    page: NonNullable<ReturnType<NonNullable<TargetAdapter['screencastPage']>>>,
  ) => PreviewConsoleCollector
  /** Test seam: substitutes the CDP network collector. */
  readonly createNetwork?: (
    page: NonNullable<ReturnType<NonNullable<TargetAdapter['screencastPage']>>>,
  ) => PreviewNetworkCollector
  /** Test seam: substitutes the injected picker (T027). */
  readonly createPicker?: (
    page: NonNullable<ReturnType<NonNullable<TargetAdapter['screencastPage']>>>,
  ) => PreviewPicker
}

function toPreviewError(error: unknown): StudioError {
  if (isStudioError(error)) return error
  const message = error instanceof Error ? error.message : typeof error
  return studioError('preview_failed', `vibe-studio: preview failed: ${message}`)
}

function frameMeta(frame: PreviewFrame | null): PreviewFrameMeta | null {
  if (frame === null) return null
  return { seq: frame.seq, ts: frame.ts, width: frame.width, height: frame.height }
}

function disconnectedError(): StudioError {
  return studioError('target_unavailable', 'vibe-studio: preview target disconnected')
}

function notRunning(): StudioError {
  return studioError('target_unavailable', 'vibe-studio: preview is not running')
}

export function createPreviewService(options: PreviewServiceOptions): PreviewService {
  const fps = options.fps ?? DEFAULT_PREVIEW_FPS
  const quality = options.quality ?? DEFAULT_PREVIEW_QUALITY
  const buffer = createPreviewFrameBuffer()

  let state: PreviewSessionState = 'idle'
  let adapter: TargetAdapter | undefined
  let source: ScreencastSource | undefined
  let inputDispatcher: PreviewInputDispatcher | undefined
  let inputSupported = false
  let consoleCollector: PreviewConsoleCollector | undefined
  let networkCollector: PreviewNetworkCollector | undefined
  let picker: PreviewPicker | undefined
  let targetId: string | null = null
  let kind: TargetKind | null = null
  let url: string | null = null
  let viewport: TargetViewport | null = null
  let capabilities: TargetCapabilities | null = null
  let lastError: StudioError | undefined
  let startPromise: Promise<PreviewSessionSnapshot> | undefined
  let stopPromise: Promise<PreviewSessionSnapshot> | undefined

  /**
   * A browser that crashed or exited reports `isAlive() === false`. Flip the
   * session to `failed` with a stable error the panel can show, and leave the
   * handles in place: the next start releases them before launching again, and
   * stop still cleans up a session the user chooses to discard.
   */
  function checkHealth(): void {
    if (state !== 'ready' || !adapter || typeof adapter.isAlive !== 'function') return
    if (adapter.isAlive()) return
    state = 'failed'
    lastError = disconnectedError()
  }

  function snapshot(): PreviewSessionSnapshot {
    checkHealth()
    const base: PreviewSessionSnapshot = {
      status: state,
      targetId,
      kind,
      url,
      viewport,
      capabilities,
      frame: frameMeta(buffer.latest()),
      fps: source?.fps ?? fps,
      quality: source?.quality ?? quality,
    }
    return lastError === undefined ? base : { ...base, lastError }
  }

  async function release(): Promise<void> {
    const activeSource = source
    source = undefined
    if (activeSource) await activeSource.stop().catch(() => undefined)
    buffer.clear()
    // Console and input own their own CDP sessions; stop them before the
    // adapter closes the page so a stopped preview leaves no handle behind.
    const activeConsole = consoleCollector
    consoleCollector = undefined
    if (activeConsole) await activeConsole.stop().catch(() => undefined)
    const activeNetwork = networkCollector
    networkCollector = undefined
    if (activeNetwork) await activeNetwork.stop().catch(() => undefined)
    const activeInput = inputDispatcher
    inputDispatcher = undefined
    inputSupported = false
    if (activeInput) await activeInput.stop().catch(() => undefined)
    // The picker holds its own CDP session and a page binding.
    const activePicker = picker
    picker = undefined
    if (activePicker) await activePicker.dispose().catch(() => undefined)
    const activeAdapter = adapter
    adapter = undefined
    if (activeAdapter) await activeAdapter.stop().catch(() => undefined)
  }

  async function runStart(params: PreviewStartParams): Promise<PreviewSessionSnapshot> {
    const requestedKind = params.kind ?? DEFAULT_PREVIEW_KIND
    let config
    try {
      config = validateTargetConfig({
        id: PREVIEW_TARGET_ID,
        name: PREVIEW_TARGET_NAME,
        kind: requestedKind,
        url: params.url,
        ...(params.viewport === undefined ? {} : { viewport: params.viewport }),
      })
    } catch (error) {
      // Normalized config errors are caller mistakes; keep the field hint.
      throw toPreviewError(error)
    }

    let selected: TargetAdapter
    try {
      selected = options.targets.get(requestedKind)
    } catch (error) {
      throw toPreviewError(error)
    }
    if (!selected.capabilities.screencast || typeof selected.screencastPage !== 'function') {
      throw studioError('unsupported', 'vibe-studio: the target does not support screencast')
    }

    // A failed session (crash or start error) may still hold handles; release
    // them before reusing the adapter so a restart cannot leak a browser.
    await release()
    lastError = undefined
    targetId = null
    kind = null
    url = null
    viewport = null
    capabilities = null

    adapter = selected
    let session: TargetSession
    try {
      session = await selected.start(config)
    } catch (error) {
      const mapped = toPreviewError(error)
      await release()
      state = 'failed'
      lastError = mapped
      throw mapped
    }

    const page = selected.screencastPage?.()
    if (!page) {
      const mapped = studioError(
        'target_unavailable',
        'vibe-studio: preview target has no live page for screencast',
      )
      await release()
      state = 'failed'
      lastError = mapped
      throw mapped
    }

    const createSource = options.createSource
    const created = createSource
      ? createSource(page, buffer)
      : createScreencastSource({ page, buffer, fps, quality })
    source = created
    try {
      await created.start()
    } catch (error) {
      const mapped = toPreviewError(error)
      await release()
      state = 'failed'
      lastError = mapped
      throw mapped
    }

    inputSupported = session.capabilities.input
    if (inputSupported) {
      inputDispatcher =
        options.createInput?.(page) ?? createPreviewInputDispatcher({ page })
    }

    // Console capture is auxiliary: if CDP refuses Runtime.enable the preview
    // still runs, but the snapshot stops advertising the capability.
    let consoleReady = false
    if (session.capabilities.console) {
      const createdConsole =
        options.createConsole?.(page) ?? createPreviewConsoleCollector({ page })
      try {
        await createdConsole.start()
        consoleCollector = createdConsole
        consoleReady = true
      } catch {
        await createdConsole.stop().catch(() => undefined)
      }
    }

    // Network capture degrades the same way: an auxiliary CDP session that
    // cannot start never blocks the preview itself.
    let networkReady = false
    if (session.capabilities.network) {
      const createdNetwork =
        options.createNetwork?.(page) ?? createPreviewNetworkCollector({ page })
      try {
        await createdNetwork.start()
        networkCollector = createdNetwork
        networkReady = true
      } catch {
        await createdNetwork.stop().catch(() => undefined)
      }
    }

    // Picking degrades like the other auxiliary capabilities: a page that
    // refuses the injected script loses the button, not the preview.
    let pickReady = false
    if (session.capabilities.pick) {
      let createdPicker: PreviewPicker | undefined
      try {
        createdPicker = options.createPicker?.(page) ?? createPreviewPicker({ page })
        await createdPicker.install()
        picker = createdPicker
        pickReady = true
      } catch {
        await createdPicker?.dispose().catch(() => undefined)
      }
    }

    targetId = session.targetId
    kind = session.kind
    url = session.url
    viewport = config.viewport
    capabilities = {
      ...session.capabilities,
      ...(session.capabilities.console && !consoleReady ? { console: false } : {}),
      ...(session.capabilities.network && !networkReady ? { network: false } : {}),
      ...(session.capabilities.pick && !pickReady ? { pick: false } : {}),
    }
    state = 'ready'
    return snapshot()
  }

  function requireReady(): TargetAdapter {
    if (state !== 'ready') throw notRunning()
    if (!adapter) throw notRunning()
    return adapter
  }

  async function input(event: unknown): Promise<PreviewInputAck> {
    if (!isPreviewInputEvent(event)) {
      throw studioError('invalid_input', 'vibe-studio: invalid preview input event', {
        field: 'event',
      })
    }
    if (state !== 'ready') throw notRunning()
    if (!inputSupported || !inputDispatcher) {
      throw studioError('unsupported', 'vibe-studio: the target does not support input', {
        capability: 'input',
      })
    }
    return inputDispatcher.dispatch(event)
  }

  function requireConsole(): PreviewConsoleCollector {
    if (state !== 'ready') throw notRunning()
    if (!consoleCollector) {
      throw studioError('unsupported', 'vibe-studio: console capture is unavailable', {
        capability: 'console',
      })
    }
    return consoleCollector
  }

  function consoleList(query?: unknown): PreviewConsoleSnapshot {
    if (query !== undefined && !isPreviewConsoleQuery(query)) {
      throw studioError('invalid_input', 'vibe-studio: invalid console query', {
        field: 'query',
      })
    }
    return requireConsole().snapshot(query)
  }

  function consoleClear(): PreviewConsoleClearResult {
    return requireConsole().clear()
  }

  function requireNetwork(): PreviewNetworkCollector {
    if (state !== 'ready') throw notRunning()
    if (!networkCollector) {
      throw studioError('unsupported', 'vibe-studio: network capture is unavailable', {
        capability: 'network',
      })
    }
    return networkCollector
  }

  function networkList(query?: unknown): PreviewNetworkSnapshot {
    if (query !== undefined && !isPreviewNetworkQuery(query)) {
      throw studioError('invalid_input', 'vibe-studio: invalid network query', {
        field: 'query',
      })
    }
    return requireNetwork().snapshot(query)
  }

  function networkClear(): PreviewNetworkClearResult {
    return requireNetwork().clear()
  }

  async function networkBody(params: unknown): Promise<PreviewNetworkBody> {
    if (!isPreviewNetworkBodyParams(params)) {
      throw studioError('invalid_input', 'vibe-studio: invalid network body params', {
        field: 'params',
      })
    }
    return requireNetwork().body(params)
  }

  function listTargets(): PreviewTargetsResult {
    return {
      targets: options.targets.list().map((entry) => ({ id: entry.id, kind: entry.kind })),
    }
  }

  async function navigate(params: unknown): Promise<PreviewSessionSnapshot> {
    if (!isPreviewNavigateParams(params)) {
      throw studioError('invalid_input', 'vibe-studio: invalid preview navigate params', {
        field: 'params',
      })
    }
    const active = requireReady()
    if (typeof active.navigate !== 'function') {
      throw studioError('unsupported', 'vibe-studio: the target does not support navigation', {
        capability: 'navigate',
      })
    }
    await active.navigate(params.url)
    url = params.url.trim()
    // The new document runs a fresh, idle picker script.
    picker?.reset()
    return snapshot()
  }

  async function reload(): Promise<PreviewSessionSnapshot> {
    const active = requireReady()
    if (typeof active.reload === 'function') {
      await active.reload()
    } else if (typeof active.navigate === 'function' && url !== null) {
      await active.navigate(url)
    } else {
      throw studioError('unsupported', 'vibe-studio: the target does not support reload', {
        capability: 'reload',
      })
    }
    picker?.reset()
    return snapshot()
  }

  async function setViewport(params: unknown): Promise<PreviewSessionSnapshot> {
    if (!isPreviewViewportParams(params)) {
      throw studioError('invalid_input', 'vibe-studio: invalid preview viewport params', {
        field: 'params',
      })
    }
    const active = requireReady()
    if (typeof active.setViewport !== 'function') {
      throw studioError('unsupported', 'vibe-studio: the target does not support viewport changes', {
        capability: 'viewport',
      })
    }
    let normalized: TargetViewport
    try {
      normalized = validateTargetConfig({
        id: PREVIEW_TARGET_ID,
        name: PREVIEW_TARGET_NAME,
        kind: kind ?? DEFAULT_PREVIEW_KIND,
        url: url ?? PLACEHOLDER_URL,
        viewport: params.viewport,
      }).viewport
    } catch (error) {
      const field = isStudioError(error) ? error.details?.field : undefined
      throw studioError('invalid_input', 'vibe-studio: invalid preview viewport', {
        field: typeof field === 'string' ? field : 'viewport',
      })
    }
    // DPR belongs to the browser context and cannot change in place; report the
    // size the page actually gets and keep the original scale factor.
    const applied: TargetViewport = {
      width: normalized.width,
      height: normalized.height,
      deviceScaleFactor: viewport?.deviceScaleFactor ?? normalized.deviceScaleFactor,
    }
    await active.setViewport(applied)
    viewport = applied
    return snapshot()
  }

  const IDLE_PICK: PickSnapshot = Object.freeze({
    active: false,
    seq: 0,
    pick: null,
    ts: null,
  })

  function requirePicker(): PreviewPicker {
    if (state !== 'ready') throw notRunning()
    if (!picker) {
      throw studioError('unsupported', 'vibe-studio: element picking is unavailable', {
        capability: 'pick',
      })
    }
    return picker
  }

  async function pickStart(): Promise<PickSnapshot> {
    const active = requirePicker()
    await active.activate()
    return active.snapshot()
  }

  async function pickStop(): Promise<PickSnapshot> {
    // Stop is idempotent: the panel calls it from a finally block that may run
    // after the session was stopped or crashed.
    if (state !== 'ready' || !picker) return IDLE_PICK
    const active = picker
    await active.deactivate()
    return active.snapshot()
  }

  function pickStatus(): PickSnapshot {
    if (state !== 'ready' || !picker) return IDLE_PICK
    return picker.snapshot()
  }

  async function start(params: PreviewStartParams): Promise<PreviewSessionSnapshot> {
    if (!isPreviewStartParams(params)) {
      throw studioError('invalid_input', 'vibe-studio: invalid preview start params', {
        field: 'params',
      })
    }
    checkHealth()
    if (state === 'ready') return snapshot()
    if (startPromise) return startPromise
    if (stopPromise) await stopPromise
    startPromise = runStart(params)
    try {
      return await startPromise
    } finally {
      startPromise = undefined
    }
  }

  async function runStop(): Promise<PreviewSessionSnapshot> {
    await release()
    state = 'idle'
    lastError = undefined
    targetId = null
    kind = null
    url = null
    viewport = null
    capabilities = null
    return snapshot()
  }

  async function stop(): Promise<PreviewSessionSnapshot> {
    if (startPromise) await startPromise.catch(() => undefined)
    if (stopPromise) return stopPromise
    stopPromise = runStop()
    try {
      return await stopPromise
    } finally {
      stopPromise = undefined
    }
  }

  return {
    buffer,
    start,
    stop,
    status: snapshot,
    input,
    consoleList,
    consoleClear,
    networkList,
    networkClear,
    networkBody,
    listTargets,
    navigate,
    reload,
    setViewport,
    pickStart,
    pickStop,
    pickStatus,
    async dispose() {
      await stop()
    },
  }
}
