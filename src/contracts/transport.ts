/**
 * Wire contract for the Host ↔ Studio transport (T011, plan D3/D4).
 *
 * The Host owns exact authenticated routes under `/api/vibe`; the browser
 * always calls the document-relative form so DSH Desktop's `dsh-app://` fetch
 * bridge and DSH Web's origin-root mount both resolve the same path.
 *
 * Responses use one envelope for health and unary calls:
 * `{ ok: true, value }` or `{ ok: false, error }`. DSH Connection applies the
 * Host/Origin fence and browser authentication before a handler runs, so this
 * module never invents its own credential scheme.
 */
import { isStudioError, type StudioError } from './errors'
import type { TargetCapabilities } from './target'

export const TRANSPORT_VERSION = 1

export const VIBE_API_PREFIX = '/api/vibe'
export const HEALTH_PATH = `${VIBE_API_PREFIX}/health`
export const REQUEST_PATH = `${VIBE_API_PREFIX}/request`

/** Exact frame routes (T020, plan D3): stream first, long-poll fallback. */
export const STREAM_PATH = `${VIBE_API_PREFIX}/stream`
export const FRAME_PATH = `${VIBE_API_PREFIX}/frame`

export const FRAME_BOUNDARY = 'vibe-frame'
export const STREAM_CONTENT_TYPE = `multipart/x-mixed-replace; boundary=${FRAME_BOUNDARY}`

/** A screencast frame is bounded so an untrusted page cannot grow Host memory. */
export const MAX_PREVIEW_FRAME_BYTES = 4 * 1024 * 1024
/** Long-poll budget for `/api/vibe/frame?wait=1`. */
export const MAX_FRAME_WAIT_MS = 2000
/** Plan D3 default pace; S3 measured ~99 fps and ~20 KB/frame as the ceiling. */
export const DEFAULT_PREVIEW_FPS = 30
export const DEFAULT_PREVIEW_QUALITY = 70

export const PREVIEW_START_METHOD = 'preview.session.start'
export const PREVIEW_STOP_METHOD = 'preview.session.stop'
export const PREVIEW_STATUS_METHOD = 'preview.session.status'
/** Input events use the shared unary route rather than a dedicated route. */
export const PREVIEW_INPUT_METHOD = 'preview.input'

/** Unary requests carry input events and small commands; 64 KiB is ample. */
export const MAX_UNARY_BODY_BYTES = 64 * 1024
export const DEFAULT_UNARY_TIMEOUT_MS = 10_000

/** Built-in method proving the unary path end to end. */
export const STUDIO_PING_METHOD = 'studio.ping'

const UNARY_METHOD_PATTERN = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Config projection safe to show in the Studio panel. */
export interface TransportConfigSummary {
  readonly logLevel: string
  readonly allowedOrigins: readonly string[]
  readonly retentionDays: number
  readonly contextBudgetBytes: number
  readonly screenshotEnabled: boolean
}

export interface TransportHealth {
  readonly plugin: string
  readonly transportVersion: number
  readonly serverTime: string
  readonly uptimeMs: number
  readonly config: TransportConfigSummary
}

export interface UnaryRequest {
  readonly id?: string
  readonly method: string
  readonly params?: unknown
}

export interface UnarySuccess<T = unknown> {
  readonly ok: true
  readonly value: T
  readonly id?: string
}

export interface UnaryFailure {
  readonly ok: false
  readonly error: StudioError
  readonly id?: string
}

export type UnaryResponse<T = unknown> = UnarySuccess<T> | UnaryFailure

export interface PingResult {
  readonly pong: true
  readonly serverTime: string
  readonly transportVersion: number
  readonly echo: unknown
}

/** Preview lifecycle as seen by the panel (T020; the toolbar lands in T025). */
export type PreviewSessionState = 'idle' | 'ready' | 'failed'

export interface PreviewFrameMeta {
  readonly seq: number
  /** Host wall-clock time when the frame was published. */
  readonly ts: number
  readonly width: number
  readonly height: number
}

export interface PreviewSessionSnapshot {
  readonly status: PreviewSessionState
  readonly targetId: string | null
  readonly url: string | null
  readonly capabilities: TargetCapabilities | null
  readonly frame: PreviewFrameMeta | null
  readonly fps: number
  readonly quality: number
  readonly lastError?: StudioError
}

export interface PreviewStartParams {
  readonly url: string
  readonly viewport?: {
    readonly width: number
    readonly height: number
    readonly deviceScaleFactor?: number
  }
}

const PREVIEW_START_KEYS = new Set(['url', 'viewport'])
const PREVIEW_VIEWPORT_KEYS = new Set(['width', 'height', 'deviceScaleFactor'])

/**
 * Input wire contract (T021). Coordinates are fractions of the preview
 * viewport in both axes, so the client never needs to know the target's pixel
 * size or the panel's CSS scale. The Host maps them onto the live viewport.
 */
export interface PreviewInputModifiers {
  readonly alt?: boolean
  readonly ctrl?: boolean
  readonly meta?: boolean
  readonly shift?: boolean
}

export type PreviewPointerButton = 'left' | 'middle' | 'right'
export type PreviewPointerAction = 'down' | 'up' | 'move'
export type PreviewKeyAction = 'down' | 'up'

export interface PreviewPointerInput {
  readonly kind: 'pointer'
  readonly action: PreviewPointerAction
  readonly x: number
  readonly y: number
  readonly button?: PreviewPointerButton
  readonly clickCount?: number
  readonly modifiers?: PreviewInputModifiers
}

export interface PreviewWheelInput {
  readonly kind: 'wheel'
  readonly x: number
  readonly y: number
  readonly deltaX: number
  readonly deltaY: number
  readonly modifiers?: PreviewInputModifiers
}

export interface PreviewKeyInput {
  readonly kind: 'key'
  readonly action: PreviewKeyAction
  readonly key: string
  readonly code?: string
  /** Printable character to insert; the Host supplies it for named keys. */
  readonly text?: string
  readonly modifiers?: PreviewInputModifiers
}

/**
 * Composed text (T022). An IME produces a whole phrase, so it is inserted in
 * one `Input.insertText` call rather than replayed as per-key events;
 * intermediate composition updates never leave the panel.
 */
export interface PreviewTextInput {
  readonly kind: 'text'
  readonly text: string
}

export type PreviewInputEvent =
  | PreviewPointerInput
  | PreviewWheelInput
  | PreviewKeyInput
  | PreviewTextInput

export interface PreviewInputAck {
  readonly ts: number
  readonly viewport: { readonly width: number; readonly height: number }
  /** Mapped viewport point for pointer/wheel events. */
  readonly point?: { readonly x: number; readonly y: number }
}

export const MAX_WHEEL_DELTA = 2000
export const MAX_KEY_TEXT_LENGTH = 32
/** Composition/paste text is inserted in one go; the limit counts code points. */
export const MAX_INSERT_TEXT_LENGTH = 1024
const POINTER_ACTIONS: ReadonlySet<string> = new Set(['down', 'up', 'move'])
const POINTER_BUTTONS: ReadonlySet<string> = new Set(['left', 'middle', 'right'])
const KEY_ACTIONS: ReadonlySet<string> = new Set(['down', 'up'])
const MODIFIER_KEYS = new Set(['alt', 'ctrl', 'meta', 'shift'])
const POINTER_INPUT_KEYS = new Set([
  'kind',
  'action',
  'x',
  'y',
  'button',
  'clickCount',
  'modifiers',
])
const WHEEL_INPUT_KEYS = new Set(['kind', 'x', 'y', 'deltaX', 'deltaY', 'modifiers'])
const KEY_INPUT_KEYS = new Set(['kind', 'action', 'key', 'code', 'text', 'modifiers'])
const TEXT_INPUT_KEYS = new Set(['kind', 'text'])
const KEY_CODE_PATTERN = /^[A-Za-z0-9]{1,32}$/
/** A high surrogate without its low half, or a low half on its own. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function isFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(record).every((key) => allowed.has(key))
}

function isModifiers(value: unknown): value is PreviewInputModifiers {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!hasOnlyKeys(record, MODIFIER_KEYS)) return false
  return Object.values(record).every((entry) => typeof entry === 'boolean')
}

function isPoint(record: Record<string, unknown>): boolean {
  return isFraction(record.x) && isFraction(record.y)
}

/**
 * Text that may cross the wire as one insert: non-empty, bounded in code
 * points (an emoji counts once) and free of lone surrogates.
 */
export function isInsertableText(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.length > MAX_INSERT_TEXT_LENGTH * 2) return false
  if (Array.from(value).length > MAX_INSERT_TEXT_LENGTH) return false
  return !LONE_SURROGATE.test(value)
}

/** Strict shape check; the Host validates again before touching CDP. */
export function isPreviewInputEvent(value: unknown): value is PreviewInputEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!isModifiers(record.modifiers)) return false

  if (record.kind === 'pointer') {
    if (!hasOnlyKeys(record, POINTER_INPUT_KEYS)) return false
    if (typeof record.action !== 'string' || !POINTER_ACTIONS.has(record.action)) return false
    if (!isPoint(record)) return false
    if (record.button !== undefined) {
      if (typeof record.button !== 'string' || !POINTER_BUTTONS.has(record.button)) return false
    }
    if (record.clickCount !== undefined) {
      const count = record.clickCount
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 3) {
        return false
      }
    }
    return true
  }

  if (record.kind === 'wheel') {
    if (!hasOnlyKeys(record, WHEEL_INPUT_KEYS)) return false
    if (!isPoint(record)) return false
    for (const axis of ['deltaX', 'deltaY'] as const) {
      const delta = record[axis]
      if (typeof delta !== 'number' || !Number.isFinite(delta)) return false
      if (Math.abs(delta) > MAX_WHEEL_DELTA) return false
    }
    return true
  }

  if (record.kind === 'key') {
    if (!hasOnlyKeys(record, KEY_INPUT_KEYS)) return false
    if (typeof record.action !== 'string' || !KEY_ACTIONS.has(record.action)) return false
    if (typeof record.key !== 'string' || record.key.length === 0 || record.key.length > 32) {
      return false
    }
    if (record.code !== undefined) {
      if (typeof record.code !== 'string' || !KEY_CODE_PATTERN.test(record.code)) return false
    }
    if (record.text !== undefined) {
      if (
        typeof record.text !== 'string' ||
        record.text.length === 0 ||
        record.text.length > MAX_KEY_TEXT_LENGTH
      ) {
        return false
      }
    }
    return true
  }

  if (record.kind === 'text') {
    if (!hasOnlyKeys(record, TEXT_INPUT_KEYS)) return false
    return isInsertableText(record.text)
  }

  return false
}

/** Strict shape check; range checks stay in `validateTargetConfig`. */
export function isPreviewStartParams(value: unknown): value is PreviewStartParams {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).some((key) => !PREVIEW_START_KEYS.has(key))) return false
  if (typeof candidate.url !== 'string') return false
  if (candidate.url.trim().length === 0 || candidate.url.length > 2048) return false
  if (candidate.viewport === undefined) return true
  const viewport = candidate.viewport
  if (!viewport || typeof viewport !== 'object' || Array.isArray(viewport)) return false
  const size = viewport as Record<string, unknown>
  if (Object.keys(size).some((key) => !PREVIEW_VIEWPORT_KEYS.has(key))) return false
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return false
  if (size.deviceScaleFactor !== undefined && !Number.isFinite(size.deviceScaleFactor)) {
    return false
  }
  return true
}

/**
 * Browser-relative form of an app route. DSH Desktop serves the panel from
 * `dsh-app://app/`, where a leading `/` would bypass the fetch bridge.
 */
export function appRoute(path: string): string {
  return path.replace(/^\/+/, '')
}

export function isValidUnaryMethod(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && UNARY_METHOD_PATTERN.test(value)
}

export function isUnaryRequest(value: unknown): value is UnaryRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (!isValidUnaryMethod(candidate.method)) return false
  if (candidate.id !== undefined) {
    if (typeof candidate.id !== 'string' || !REQUEST_ID_PATTERN.test(candidate.id)) return false
  }
  return candidate.params === undefined || isJsonValue(candidate.params)
}

export function isUnarySuccess(value: unknown): value is UnarySuccess {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.ok !== true || !('value' in candidate)) return false
  if (candidate.id !== undefined && typeof candidate.id !== 'string') return false
  return true
}

export function isUnaryFailure(value: unknown): value is UnaryFailure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.ok !== false || !isStudioError(candidate.error)) return false
  if (candidate.id !== undefined && typeof candidate.id !== 'string') return false
  return true
}

export function isTransportHealth(value: unknown): value is TransportHealth {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.plugin !== 'string') return false
  if (candidate.transportVersion !== TRANSPORT_VERSION) return false
  if (typeof candidate.serverTime !== 'string') return false
  if (!Number.isFinite(candidate.uptimeMs) || (candidate.uptimeMs as number) < 0) return false
  const config = candidate.config
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false
  const summary = config as Record<string, unknown>
  return (
    typeof summary.logLevel === 'string' &&
    Array.isArray(summary.allowedOrigins) &&
    summary.allowedOrigins.every((origin) => typeof origin === 'string') &&
    Number.isFinite(summary.retentionDays) &&
    Number.isFinite(summary.contextBudgetBytes) &&
    typeof summary.screenshotEnabled === 'boolean'
  )
}

/** JSON-only check so an untrusted request never smuggles class instances. */
function isJsonValue(value: unknown, depth = 0): boolean {
  if (depth > 32) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1))
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    return Object.values(value as Record<string, unknown>).every((entry) =>
      isJsonValue(entry, depth + 1),
    )
  }
  return false
}
