/**
 * Input forwarding over CDP (T021).
 *
 * The panel sends viewport fractions; this module maps them onto the live
 * target viewport and dispatches `Input.dispatchMouseEvent` /
 * `Input.dispatchKeyEvent` on one lazily created CDP session. Events run on a
 * single queue so a click's press always precedes its release, and the session
 * is detached with the preview session so stopping leaves no CDP handle.
 */
import { studioError, type StudioError } from '../../contracts/errors'
import type {
  PreviewInputAck,
  PreviewInputEvent,
  PreviewInputModifiers,
  PreviewKeyInput,
  PreviewPointerButton,
  PreviewPointerInput,
  PreviewWheelInput,
} from '../../contracts/transport'
import type { ScreencastPageLike, ScreencastSessionLike } from '../targets/types'

export interface PreviewInputDispatcher {
  dispatch(event: PreviewInputEvent): Promise<PreviewInputAck>
  /** Rejects queued work, waits for in-flight sends, detaches; idempotent. */
  stop(): Promise<void>
  readonly active: boolean
}

export interface PreviewInputDispatcherOptions {
  readonly page: ScreencastPageLike
  readonly now?: () => number
}

const MODIFIER_BITS: Readonly<Record<keyof PreviewInputModifiers, number>> = {
  alt: 1,
  ctrl: 2,
  meta: 4,
  shift: 8,
}

const BUTTON_BITS: Readonly<Record<PreviewPointerButton, number>> = {
  left: 1,
  middle: 4,
  right: 2,
}

interface NamedKey {
  readonly virtualKeyCode: number
  readonly text?: string
}

/** Keys whose CDP virtual-key code is not the character code. */
const NAMED_KEYS: Readonly<Record<string, NamedKey>> = {
  Enter: { virtualKeyCode: 13, text: '\r' },
  Tab: { virtualKeyCode: 9 },
  Backspace: { virtualKeyCode: 8 },
  Delete: { virtualKeyCode: 46 },
  Escape: { virtualKeyCode: 27 },
  ' ': { virtualKeyCode: 32, text: ' ' },
  ArrowLeft: { virtualKeyCode: 37 },
  ArrowUp: { virtualKeyCode: 38 },
  ArrowRight: { virtualKeyCode: 39 },
  ArrowDown: { virtualKeyCode: 40 },
  Home: { virtualKeyCode: 36 },
  End: { virtualKeyCode: 35 },
  PageUp: { virtualKeyCode: 33 },
  PageDown: { virtualKeyCode: 34 },
  Insert: { virtualKeyCode: 45 },
  Shift: { virtualKeyCode: 16 },
  Control: { virtualKeyCode: 17 },
  Alt: { virtualKeyCode: 18 },
  Meta: { virtualKeyCode: 91 },
  CapsLock: { virtualKeyCode: 20 },
  F1: { virtualKeyCode: 112 },
  F2: { virtualKeyCode: 113 },
  F3: { virtualKeyCode: 114 },
  F4: { virtualKeyCode: 115 },
  F5: { virtualKeyCode: 116 },
  F6: { virtualKeyCode: 117 },
  F7: { virtualKeyCode: 118 },
  F8: { virtualKeyCode: 119 },
  F9: { virtualKeyCode: 120 },
  F10: { virtualKeyCode: 121 },
  F11: { virtualKeyCode: 122 },
  F12: { virtualKeyCode: 123 },
}

export function modifierMask(modifiers?: PreviewInputModifiers): number {
  if (!modifiers) return 0
  let mask = 0
  if (modifiers.alt) mask |= MODIFIER_BITS.alt
  if (modifiers.ctrl) mask |= MODIFIER_BITS.ctrl
  if (modifiers.meta) mask |= MODIFIER_BITS.meta
  if (modifiers.shift) mask |= MODIFIER_BITS.shift
  return mask
}

/** Clamp a viewport fraction and convert it to CSS pixels inside the viewport. */
export function mapPoint(
  x: number,
  y: number,
  viewport: { readonly width: number; readonly height: number },
): { x: number; y: number } {
  const clamp = (value: number, limit: number): number => {
    if (!Number.isFinite(value)) return 0
    const scaled = Math.round(value * limit)
    return Math.min(limit - 1, Math.max(0, scaled))
  }
  return { x: clamp(x, viewport.width), y: clamp(y, viewport.height) }
}

function unavailable(reason: string): StudioError {
  return studioError('target_unavailable', 'vibe-studio: preview input is unavailable', {
    reason,
  })
}

function keyEventParams(
  event: PreviewKeyInput,
  modifiers: number,
): { method: string; params: Record<string, unknown> } {
  const named = NAMED_KEYS[event.key]
  const singleCharacter = event.key.length === 1
  const isAlphanumeric = singleCharacter && /^[A-Za-z0-9]$/.test(event.key)
  const text =
    event.action === 'down'
      ? (event.text ?? named?.text ?? (singleCharacter ? event.key : undefined))
      : undefined
  const virtualKeyCode =
    named?.virtualKeyCode ??
    (isAlphanumeric ? event.key.toUpperCase().charCodeAt(0) : undefined)

  const params: Record<string, unknown> = {
    type: event.action === 'down' ? 'keyDown' : 'keyUp',
    key: event.key,
    modifiers,
  }
  if (event.code !== undefined) params.code = event.code
  if (virtualKeyCode !== undefined) {
    params.windowsVirtualKeyCode = virtualKeyCode
    params.nativeVirtualKeyCode = virtualKeyCode
  }
  if (text !== undefined) {
    params.text = text
    params.unmodifiedText = text
  }
  return { method: 'Input.dispatchKeyEvent', params }
}

export function createPreviewInputDispatcher(
  options: PreviewInputDispatcherOptions,
): PreviewInputDispatcher {
  const { page } = options
  const now = options.now ?? (() => Date.now())

  let session: ScreencastSessionLike | undefined
  let creating: Promise<ScreencastSessionLike> | undefined
  let stopped = false
  let epoch = 0
  let tail: Promise<unknown> = Promise.resolve()
  const pressed = new Set<PreviewPointerButton>()

  function requireViewport(): { width: number; height: number } {
    const viewport = page.viewport()
    if (!viewport || viewport.width <= 0 || viewport.height <= 0) {
      throw unavailable('no_viewport')
    }
    return { width: viewport.width, height: viewport.height }
  }

  async function ensureSession(): Promise<ScreencastSessionLike> {
    if (stopped) throw unavailable('stopped')
    if (session) return session
    if (creating) return creating
    const startedEpoch = epoch
    creating = (async () => {
      let created: ScreencastSessionLike
      try {
        created = await page.createCdpSession()
      } catch {
        throw unavailable('cdp_session')
      }
      if (stopped || startedEpoch !== epoch) {
        await created.detach().catch(() => undefined)
        throw unavailable('stopped')
      }
      session = created
      return created
    })()
    try {
      return await creating
    } finally {
      creating = undefined
    }
  }

  function buttonMask(): number {
    let mask = 0
    for (const button of pressed) mask |= BUTTON_BITS[button]
    return mask
  }

  function mouseParams(
    event: PreviewPointerInput | PreviewWheelInput,
    viewport: { width: number; height: number },
  ): { method: string; params: Record<string, unknown>; point: { x: number; y: number } } {
    const point = mapPoint(event.x, event.y, viewport)
    const modifiers = modifierMask(event.modifiers)
    if (event.kind === 'wheel') {
      return {
        method: 'Input.dispatchMouseEvent',
        point,
        params: {
          type: 'mouseWheel',
          x: point.x,
          y: point.y,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          button: 'none',
          buttons: buttonMask(),
          modifiers,
        },
      }
    }

    const button = event.button ?? 'left'
    if (event.action === 'down') pressed.add(button)
    if (event.action === 'up') pressed.delete(button)
    const buttons = buttonMask()
    const type =
      event.action === 'down'
        ? 'mousePressed'
        : event.action === 'up'
          ? 'mouseReleased'
          : 'mouseMoved'
    return {
      method: 'Input.dispatchMouseEvent',
      point,
      params: {
        type,
        x: point.x,
        y: point.y,
        button: event.action === 'move' ? 'none' : button,
        clickCount: event.clickCount ?? 1,
        buttons,
        modifiers,
      },
    }
  }

  async function run(event: PreviewInputEvent): Promise<PreviewInputAck> {
    if (stopped) throw unavailable('stopped')
    const viewport = requireViewport()
    const active = await ensureSession()
    if (stopped) throw unavailable('stopped')

    let method: string
    let params: Record<string, unknown>
    let point: { x: number; y: number } | undefined
    if (event.kind === 'key') {
      const mapped = keyEventParams(event, modifierMask(event.modifiers))
      method = mapped.method
      params = mapped.params
    } else {
      const mapped = mouseParams(event, viewport)
      method = mapped.method
      params = mapped.params
      point = mapped.point
    }

    try {
      await active.send(method, params)
    } catch {
      // Never echo Playwright/CDP text: it can contain local paths.
      throw unavailable('cdp_failed')
    }
    const ack: PreviewInputAck = {
      ts: now(),
      viewport: { width: viewport.width, height: viewport.height },
    }
    return point === undefined ? ack : { ...ack, point }
  }

  function enqueue(task: () => Promise<PreviewInputAck>): Promise<PreviewInputAck> {
    const result = tail.then(task, task)
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  return {
    dispatch(event) {
      return enqueue(() => run(event))
    },
    async stop() {
      if (stopped) return
      stopped = true
      epoch += 1
      pressed.clear()
      await tail.catch(() => undefined)
      const active = session
      session = undefined
      if (creating) await creating.catch(() => undefined)
      if (active) await active.detach().catch(() => undefined)
    },
    get active() {
      return !stopped
    },
  }
}
