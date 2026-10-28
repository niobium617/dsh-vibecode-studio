/**
 * Preview input surface (T021).
 *
 * The canvas is a picture of the target page, not a DOM node we can type into.
 * This transparent layer sits on top of it, turns real pointer/wheel/keyboard
 * events into viewport fractions, and forwards them through the unary
 * `preview.input` method. Requests are serialized so a click's press always
 * arrives before its release, and pointer moves are coalesced so a fast drag
 * cannot build an unbounded queue.
 */
import * as React from 'react'
import {
  PREVIEW_INPUT_METHOD,
  type PreviewInputEvent,
  type PreviewInputModifiers,
  type PreviewPointerAction,
  type PreviewPointerButton,
} from '../../contracts/transport'
import { createTranslator, type Locale } from '../i18n'
import { callUnary } from '../transport/client'
import { ImeInput, type ImeInputHandle } from './ImeInput'

export type InputSender = (event: PreviewInputEvent) => Promise<unknown>

const DEFAULT_INPUT_TIMEOUT_MS = 5_000
const MAX_QUEUE_LENGTH = 64
const MOVE_THROTTLE_MS = 30

const imeNoticeStyle: React.CSSProperties = {
  position: 'absolute',
  left: 8,
  right: 8,
  bottom: 8,
  margin: 0,
  padding: '6px 8px',
  borderRadius: 4,
  background: 'rgba(0, 0, 0, 0.72)',
  color: '#fff',
  font: '11px/1.4 system-ui, sans-serif',
  pointerEvents: 'none',
  zIndex: 2,
}

const layerStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  padding: 0,
  margin: 0,
  border: 'none',
  background: 'transparent',
  outline: 'none',
  cursor: 'default',
  touchAction: 'none',
  userSelect: 'none',
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Map a client-space point onto the preview viewport as a fraction. */
export function normalizePoint(
  clientX: number,
  clientY: number,
  rect: { readonly left: number; readonly top: number; width: number; height: number } | null,
): { x: number; y: number } | null {
  if (!rect || rect.width <= 0 || rect.height <= 0) return null
  return {
    x: clampFraction((clientX - rect.left) / rect.width),
    y: clampFraction((clientY - rect.top) / rect.height),
  }
}

/**
 * Wheel deltas arrive in pixels, lines or pages depending on the device; the
 * wire contract only carries pixels, bounded by `MAX_WHEEL_DELTA`.
 */
export function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  viewportHeight: number,
): number {
  const factor = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, viewportHeight) : 1
  const pixels = Number.isFinite(delta) ? delta * factor : 0
  return Math.min(2000, Math.max(-2000, pixels))
}

export function modifiersOf(event: {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}): PreviewInputModifiers {
  return {
    alt: event.altKey,
    ctrl: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  }
}

export function pointerButtonOf(button: number): PreviewPointerButton {
  if (button === 1) return 'middle'
  if (button === 2) return 'right'
  return 'left'
}

function pointerActionOf(type: string): PreviewPointerAction | null {
  if (type === 'pointerdown') return 'down'
  if (type === 'pointerup') return 'up'
  if (type === 'pointermove') return 'move'
  return null
}

/** Serializable text for a key press; composition is T022's job. */
export function textForKey(event: {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}): string | undefined {
  if (event.key.length !== 1) return undefined
  if (event.ctrlKey || event.metaKey) return undefined
  return event.key
}

/**
 * One in-flight request at a time. Pointer moves replace the newest queued
 * move instead of growing the queue; everything else keeps arrival order.
 */
export class InputForwarder {
  private readonly send: InputSender
  private readonly onError?: (error: unknown, event: PreviewInputEvent) => void
  private queue: PreviewInputEvent[] = []
  private inFlight = false
  private disposed = false

  constructor(send: InputSender, onError?: (error: unknown, event: PreviewInputEvent) => void) {
    this.send = send
    this.onError = onError
  }

  push(event: PreviewInputEvent): void {
    if (this.disposed) return
    if (event.kind === 'pointer' && event.action === 'move') {
      const last = this.queue[this.queue.length - 1]
      if (last && last.kind === 'pointer' && last.action === 'move') {
        this.queue[this.queue.length - 1] = event
        return
      }
    }
    if (this.queue.length >= MAX_QUEUE_LENGTH) {
      const moveIndex = this.queue.findIndex(
        (entry) => entry.kind === 'pointer' && entry.action === 'move',
      )
      if (moveIndex >= 0) this.queue.splice(moveIndex, 1)
      else this.queue.shift()
    }
    this.queue.push(event)
    void this.pump()
  }

  pending(): number {
    return this.queue.length
  }

  dispose(): void {
    this.disposed = true
    this.queue = []
  }

  private async pump(): Promise<void> {
    if (this.inFlight || this.disposed) return
    this.inFlight = true
    try {
      while (!this.disposed) {
        const next = this.queue.shift()
        if (next === undefined) break
        try {
          await this.send(next)
        } catch (error) {
          this.onError?.(error, next)
        }
      }
    } finally {
      this.inFlight = false
    }
  }
}

export interface InputLayerProps {
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>
  readonly active?: boolean
  readonly send?: InputSender
  readonly onError?: (error: unknown) => void
  readonly locale?: Locale
}

export function InputLayer({
  canvasRef,
  active = true,
  send,
  onError,
  locale,
}: InputLayerProps): React.ReactElement {
  const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
  const layerRef = React.useRef<HTMLDivElement | null>(null)
  const imeRef = React.useRef<ImeInputHandle | null>(null)
  const forwarderRef = React.useRef<InputForwarder | null>(null)
  const lastMoveRef = React.useRef(0)
  const sendRef = React.useRef<InputSender | undefined>(send)
  const errorRef = React.useRef<((error: unknown) => void) | undefined>(onError)
  const [imeFailed, setImeFailed] = React.useState(false)
  sendRef.current = send
  errorRef.current = onError

  React.useEffect(() => {
    const forwarder = new InputForwarder(
      (event) =>
        sendRef.current
          ? sendRef.current(event)
          : callUnary(PREVIEW_INPUT_METHOD, event, { timeoutMs: DEFAULT_INPUT_TIMEOUT_MS }),
      (error, event) => {
        // A failed composition insert has a dedicated, actionable hint (type
        // character by character or paste); other failures stay generic.
        if (event.kind === 'text') setImeFailed(true)
        else errorRef.current?.(error)
      },
    )
    forwarderRef.current = forwarder
    return () => {
      forwarder.dispose()
      forwarderRef.current = null
    }
  }, [])

  const push = React.useCallback((event: PreviewInputEvent): void => {
    forwarderRef.current?.push(event)
  }, [])

  React.useEffect(() => {
    if (!active) setImeFailed(false)
  }, [active])

  const pointAt = React.useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      return normalizePoint(clientX, clientY, canvas?.getBoundingClientRect() ?? null)
    },
    [canvasRef],
  )

  // React's synthetic wheel listener can be passive, so `preventDefault` needs
  // a native non-passive listener for the panel not to scroll instead.
  React.useEffect(() => {
    const layer = layerRef.current
    if (!active || !layer) return
    const onWheel = (event: WheelEvent): void => {
      const point = pointAt(event.clientX, event.clientY)
      if (point === null) return
      event.preventDefault()
      const height = canvasRef.current?.getBoundingClientRect().height ?? 0
      forwarderRef.current?.push({
        kind: 'wheel',
        x: point.x,
        y: point.y,
        deltaX: normalizeWheelDelta(event.deltaX, event.deltaMode, height),
        deltaY: normalizeWheelDelta(event.deltaY, event.deltaMode, height),
        modifiers: modifiersOf(event),
      })
    }
    layer.addEventListener('wheel', onWheel, { passive: false })
    return () => layer.removeEventListener('wheel', onWheel)
  }, [active, canvasRef, pointAt])

  const onPointerEvent = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!active) return
    const action = pointerActionOf(event.type)
    if (action === null) return
    const point = pointAt(event.clientX, event.clientY)
    if (point === null) return

    if (action === 'down') {
      // Focus the composition box, not the layer: an input method needs a
      // real editable element and the IME popup should open near the click.
      const layerRect = layerRef.current?.getBoundingClientRect() ?? null
      if (imeRef.current && layerRect) {
        imeRef.current.focusAt(event.clientX - layerRect.left, event.clientY - layerRect.top)
      } else {
        layerRef.current?.focus({ preventScroll: true })
      }
      event.preventDefault()
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId)
      } catch {
        // Capture is best-effort (jsdom and older engines lack it).
      }
    }
    if (action === 'up') {
      try {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      } catch {
        // Already released.
      }
    }
    if (action === 'move') {
      const now = typeof performance === 'object' ? performance.now() : Date.now()
      if (now - lastMoveRef.current < MOVE_THROTTLE_MS) return
      lastMoveRef.current = now
    }

    forwarderRef.current?.push({
      kind: 'pointer',
      action,
      x: point.x,
      y: point.y,
      button: action === 'move' ? undefined : pointerButtonOf(event.button),
      clickCount: 1,
      modifiers: modifiersOf(event),
    })
  }

  const onKey = (event: React.KeyboardEvent<HTMLDivElement>, action: 'down' | 'up'): void => {
    if (!active) return
    if (event.nativeEvent.isComposing || event.key === 'Process') return
    // Let the hidden textarea's paste event through: a synthetic Ctrl+V would
    // not paste in the target, but the pasted text can be inserted as a whole.
    if (action === 'down' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
      return
    }
    if (event.key.length === 0 || event.key.length > 32) return
    event.preventDefault()
    const text = action === 'down' ? textForKey(event) : undefined
    forwarderRef.current?.push({
      kind: 'key',
      action,
      key: event.key,
      ...(event.code ? { code: event.code } : {}),
      ...(text === undefined ? {} : { text }),
      modifiers: modifiersOf(event),
    })
  }

  return (
    <div
      ref={layerRef}
      data-vibe-input="1"
      role="group"
      tabIndex={0}
      aria-label={t('preview.input.label')}
      title={t('preview.input.hint')}
      style={layerStyle}
      onPointerDown={onPointerEvent}
      onPointerUp={onPointerEvent}
      onPointerMove={onPointerEvent}
      onPointerCancel={onPointerEvent}
      onKeyDown={(event) => onKey(event, 'down')}
      onKeyUp={(event) => onKey(event, 'up')}
    >
      <ImeInput
        ref={imeRef}
        active={active}
        push={push}
        locale={locale}
        onFailure={() => setImeFailed(true)}
        onCompositionStart={() => setImeFailed(false)}
      />
      {imeFailed ? (
        <p role="status" data-vibe-ime-notice="1" style={imeNoticeStyle}>
          {t('preview.input.ime.failed')}
        </p>
      ) : null}
    </div>
  )
}
