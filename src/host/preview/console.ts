/**
 * Console capture over CDP (T023).
 *
 * One dedicated CDP session listens for `Runtime.consoleAPICalled` and
 * `Runtime.exceptionThrown`; page text is untrusted, so every message is
 * normalized, stripped of control characters and truncated before it enters a
 * bounded ring buffer. The buffer keeps a monotone `seq` across clears, and
 * `stop()` removes both listeners and detaches the session so stopping or
 * switching a preview leaves nothing behind.
 */
import { truncateUtf8, utf8Bytes } from '../../contracts/budget'
import { studioError, type StudioError } from '../../contracts/errors'
import { redactUrl } from '../../contracts/redact'
import type { ConsoleEntry, ConsoleLevel, ConsoleSource } from '../../contracts/telemetry'
import {
  MAX_CONSOLE_ENTRIES,
  MAX_CONSOLE_TEXT_BYTES,
  type PreviewConsoleClearResult,
  type PreviewConsoleQuery,
  type PreviewConsoleSnapshot,
} from '../../contracts/transport'
import type { ScreencastPageLike, ScreencastSessionLike } from '../targets/types'

const CONSOLE_EVENT = 'Runtime.consoleAPICalled'
const EXCEPTION_EVENT = 'Runtime.exceptionThrown'
const RUNTIME_ENABLE = 'Runtime.enable'
/** Largest timestamp `Date` accepts; anything else falls back to wall clock. */
const MAX_DATE_MS = 8.64e15
const MAX_SOURCE_URL_BYTES = 512
const MAX_ARGS = 64
const MAX_ARG_CHARS = 4096
const MAX_PREVIEW_PROPERTIES = 8
/** Console types whose events the panel shows (protocol Runtime.ConsoleAPICalledType). */
const LEVEL_BY_TYPE: Readonly<Record<string, ConsoleLevel>> = {
  log: 'info',
  info: 'info',
  debug: 'debug',
  warning: 'warn',
  error: 'error',
  assert: 'error',
  trace: 'debug',
  dir: 'info',
  dirxml: 'info',
  table: 'info',
  count: 'info',
  timeEnd: 'info',
  startGroup: 'info',
  startGroupCollapsed: 'info',
  endGroup: 'info',
  profile: 'info',
  profileEnd: 'info',
}

const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

export interface ConsoleRecordInput {
  readonly level: ConsoleLevel
  readonly text: string
  /** Epoch milliseconds. */
  readonly timestamp: number
  readonly source?: ConsoleSource
}

export interface PreviewConsoleStats {
  readonly received: number
  readonly stored: number
  readonly dropped: number
  readonly rejected: number
  readonly lastSeq: number
  readonly lastAt: number | null
}

export interface PreviewConsoleCollector {
  /** Creates the CDP session and enables Runtime; idempotent. */
  start(): Promise<void>
  /** Removes listeners, detaches the session and clears the buffer; idempotent. */
  stop(): Promise<void>
  snapshot(query?: PreviewConsoleQuery): PreviewConsoleSnapshot
  /** Clears the Host buffer only; the panel must drop its local copy too. */
  clear(): PreviewConsoleClearResult
  stats(): PreviewConsoleStats
  readonly active: boolean
}

export interface PreviewConsoleCollectorOptions {
  readonly page: ScreencastPageLike
  readonly maxEntries?: number
  readonly maxBytes?: number
  readonly maxTextBytes?: number
  readonly now?: () => number
}

/** Strip ANSI/control characters and normalize line endings for display. */
export function normalizeConsoleText(raw: string): string {
  return raw
    .replace(ANSI_PATTERN, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_PATTERN, ' ')
    .trim()
}

function capChars(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function previewValue(property: Record<string, unknown>): string {
  if (property.value !== undefined) return String(property.value)
  if (property.subtype === 'null') return 'null'
  if (typeof property.type === 'string') return property.type
  return '…'
}

/** One compact line for a CDP RemoteObject; never throws on odd shapes. */
export function formatRemoteObject(raw: unknown): string {
  const object = asRecord(raw)
  if (object === null) return ''
  const unrepresentable = textOf(object.unserializableValue)
  if (unrepresentable !== null) return capChars(unrepresentable, MAX_ARG_CHARS)

  const type = textOf(object.type) ?? 'unknown'
  switch (type) {
    case 'string':
      return capChars(textOf(object.value) ?? textOf(object.description) ?? '', MAX_ARG_CHARS)
    case 'number':
    case 'boolean':
    case 'bigint':
      return object.value === undefined
        ? capChars(textOf(object.description) ?? type, MAX_ARG_CHARS)
        : capChars(String(object.value), MAX_ARG_CHARS)
    case 'undefined':
      return 'undefined'
    case 'symbol':
      return capChars(textOf(object.description) ?? 'symbol', MAX_ARG_CHARS)
    case 'function':
      return capChars(textOf(object.description) ?? 'function', MAX_ARG_CHARS)
    case 'object': {
      if (object.subtype === 'null') return 'null'
      const description = textOf(object.description)
      const preview = asRecord(object.preview)
      if (preview === null) {
        return capChars(description ?? 'Object', MAX_ARG_CHARS)
      }
      const rawProperties = Array.isArray(preview.properties) ? preview.properties : []
      const properties = rawProperties
        .slice(0, MAX_PREVIEW_PROPERTIES)
        .map((entry, index) => {
          const property = asRecord(entry)
          if (property === null) return null
          if (object.subtype === 'array') return previewValue(property)
          const name = textOf(property.name) ?? String(index)
          return `${name}: ${previewValue(property)}`
        })
        .filter((entry): entry is string => entry !== null)
      const truncated = rawProperties.length > properties.length || preview.overflow === true
      const inner = `${properties.join(object.subtype === 'array' ? ', ' : ', ')}${
        truncated ? (properties.length > 0 ? ', …' : '…') : ''
      }`
      if (object.subtype === 'array') {
        return capChars(`[${inner}]`, MAX_ARG_CHARS)
      }
      const head = textOf(preview.description) ?? description ?? 'Object'
      return capChars(`${head} {${inner}}`, MAX_ARG_CHARS)
    }
    default:
      return capChars(textOf(object.description) ?? type, MAX_ARG_CHARS)
  }
}

/** Join console arguments the way a one-line console row wants them. */
export function formatConsoleArgs(args: unknown): string {
  if (!Array.isArray(args) || args.length === 0) return ''
  return args
    .slice(0, MAX_ARGS)
    .map((argument) => formatRemoteObject(argument))
    .filter((text) => text.length > 0)
    .join(' ')
}

/**
 * Runtime timestamps are epoch milliseconds; some hosts report seconds. Accept
 * both and fall back to the Host clock when the value is unusable.
 */
export function normalizeConsoleTimestamp(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  const ms = value < 1e12 ? value * 1000 : value
  return Math.abs(ms) <= MAX_DATE_MS ? Math.round(ms) : fallback
}

function sourceUrl(url: string): string {
  return truncateUtf8(redactUrl(url), MAX_SOURCE_URL_BYTES)
}

function firstStackSource(stackTrace: unknown): ConsoleSource | undefined {
  const stack = asRecord(stackTrace)
  const frames = stack !== null && Array.isArray(stack.callFrames) ? stack.callFrames : []
  for (const frame of frames) {
    const callFrame = asRecord(frame)
    if (callFrame === null) continue
    const url = textOf(callFrame.url)
    if (url === null || url.length === 0) continue
    return {
      url: sourceUrl(url),
      line: typeof callFrame.lineNumber === 'number' ? callFrame.lineNumber + 1 : null,
      column: typeof callFrame.columnNumber === 'number' ? callFrame.columnNumber + 1 : null,
    }
  }
  return undefined
}

function exceptionSource(details: Record<string, unknown>): ConsoleSource | undefined {
  const stacked = firstStackSource(details.stackTrace)
  if (stacked !== undefined) return stacked
  const url = textOf(details.url)
  if (url === null || url.length === 0) return undefined
  return {
    url: sourceUrl(url),
    line: typeof details.lineNumber === 'number' ? details.lineNumber + 1 : null,
    column: typeof details.columnNumber === 'number' ? details.columnNumber + 1 : null,
  }
}

/**
 * Map one CDP event onto a buffer record. `null` means the event carries
 * nothing the panel should show (e.g. `console.clear()`).
 */
export function mapConsoleEvent(
  method: string,
  raw: unknown,
  now: () => number = () => Date.now(),
): ConsoleRecordInput | null {
  const event = asRecord(raw)
  if (event === null) return null
  const timestamp = normalizeConsoleTimestamp(event.timestamp, now())

  if (method === EXCEPTION_EVENT) {
    const details = asRecord(event.exceptionDetails)
    if (details === null) return null
    const base = textOf(details.text) ?? 'Uncaught'
    const description = formatRemoteObject(details.exception)
    const text = description.length === 0 || base.includes(description)
      ? base
      : `${base}: ${description}`
    const source = exceptionSource(details)
    return source === undefined
      ? { level: 'error', text, timestamp }
      : { level: 'error', text, timestamp, source }
  }

  if (method !== CONSOLE_EVENT) return null
  const type = textOf(event.type)
  if (type === null) return null
  const level = LEVEL_BY_TYPE[type]
  if (level === undefined) return null
  const text = formatConsoleArgs(event.args)
  const source = firstStackSource(event.stackTrace)
  return source === undefined
    ? { level, text, timestamp }
    : { level, text, timestamp, source }
}

interface StoredEntry {
  readonly seq: number
  readonly entry: ConsoleEntry
}

/**
 * Bounded console history. `seq` and `dropped` survive clears so a polling
 * client can distinguish an empty buffer from a restarted sequence.
 */
export class PreviewConsoleBuffer {
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly maxTextBytes: number
  private readonly entries: StoredEntry[] = []
  private seq = 0
  private byteCount = 0
  private droppedCount = 0

  constructor(options: {
    readonly maxEntries?: number
    readonly maxBytes?: number
    readonly maxTextBytes?: number
  } = {}) {
    this.maxEntries = Math.max(1, Math.trunc(options.maxEntries ?? MAX_CONSOLE_ENTRIES))
    this.maxBytes = Math.max(256, Math.trunc(options.maxBytes ?? 64 * 1024))
    this.maxTextBytes = Math.max(
      32,
      Math.trunc(options.maxTextBytes ?? MAX_CONSOLE_TEXT_BYTES),
    )
  }

  push(input: ConsoleRecordInput): number {
    this.seq += 1
    const text = truncateUtf8(normalizeConsoleText(input.text), this.maxTextBytes)
    const source = input.source
    const timestamp =
      Number.isFinite(input.timestamp) && Math.abs(input.timestamp) <= MAX_DATE_MS
        ? new Date(input.timestamp).toISOString()
        : new Date().toISOString()
    const entry: ConsoleEntry = {
      id: `console-${this.seq}`,
      level: input.level,
      text,
      timestamp,
      ...(source === undefined ? {} : { source }),
    }
    this.entries.push({ seq: this.seq, entry })
    this.byteCount += utf8Bytes(text) + (source === undefined ? 0 : utf8Bytes(source.url))
    this.evict()
    return this.seq
  }

  private evict(): void {
    // Keep the newest entry even if one message exceeds the byte budget.
    while (
      (this.entries.length > this.maxEntries || this.byteCount > this.maxBytes) &&
      this.entries.length > 1
    ) {
      const removed = this.entries.shift()
      if (removed === undefined) break
      this.byteCount -= utf8Bytes(removed.entry.text)
      if (removed.entry.source) this.byteCount -= utf8Bytes(removed.entry.source.url)
      this.droppedCount += 1
    }
  }

  snapshot(query: PreviewConsoleQuery = {}): PreviewConsoleSnapshot {
    let selected = this.entries
    if (query.after !== undefined) {
      selected = selected.filter((stored) => stored.seq > (query.after as number))
    }
    if (query.limit !== undefined) {
      selected = selected.slice(-Math.trunc(query.limit))
    }
    return {
      entries: selected.map((stored) => stored.entry),
      lastSeq: this.seq,
      dropped: this.droppedCount,
    }
  }

  clear(): PreviewConsoleClearResult {
    const cleared = this.entries.length
    this.entries.length = 0
    this.byteCount = 0
    this.droppedCount = 0
    return { cleared, lastSeq: this.seq }
  }

  get lastSeq(): number {
    return this.seq
  }

  get size(): number {
    return this.entries.length
  }

  get bytes(): number {
    return this.byteCount
  }

  get dropped(): number {
    return this.droppedCount
  }
}

function toPreviewError(error: unknown): StudioError {
  const message = error instanceof Error ? error.message : typeof error
  // CDP/Playwright errors can carry local paths; keep the reason only.
  return studioError('preview_failed', `vibe-studio: console capture failed: ${message}`)
}

export function createPreviewConsoleCollector(
  options: PreviewConsoleCollectorOptions,
): PreviewConsoleCollector {
  const { page } = options
  const now = options.now ?? (() => Date.now())
  const buffer = new PreviewConsoleBuffer(options)

  let session: ScreencastSessionLike | undefined
  let starting: Promise<void> | undefined
  let running = false
  let stopping = false
  let epoch = 0
  let consoleListener: ((params: unknown) => void) | undefined
  let exceptionListener: ((params: unknown) => void) | undefined
  let received = 0
  let stored = 0
  let rejected = 0
  let lastAt: number | null = null

  function record(method: string, raw: unknown): void {
    if (!running) return
    received += 1
    const mapped = mapConsoleEvent(method, raw, now)
    if (mapped === null) {
      rejected += 1
      return
    }
    buffer.push(mapped)
    stored += 1
    lastAt = mapped.timestamp
  }

  async function start(): Promise<void> {
    if (running) return
    if (starting) return starting
    const startedEpoch = epoch
    starting = (async () => {
      stopping = false
      let created: ScreencastSessionLike
      try {
        created = await page.createCdpSession()
      } catch (error) {
        throw toPreviewError(error)
      }
      if (startedEpoch !== epoch) {
        await created.detach().catch(() => undefined)
        return
      }
      session = created
      consoleListener = (raw) => record(CONSOLE_EVENT, raw)
      exceptionListener = (raw) => record(EXCEPTION_EVENT, raw)
      // Listeners go on before `Runtime.enable` so no event is missed.
      created.on(CONSOLE_EVENT, consoleListener)
      created.on(EXCEPTION_EVENT, exceptionListener)
      running = true
      try {
        await created.send(RUNTIME_ENABLE)
      } catch (error) {
        running = false
        created.off?.(CONSOLE_EVENT, consoleListener)
        created.off?.(EXCEPTION_EVENT, exceptionListener)
        await created.detach().catch(() => undefined)
        session = undefined
        consoleListener = undefined
        exceptionListener = undefined
        throw toPreviewError(error)
      }
      if (startedEpoch !== epoch) {
        // `stop()` ran while Runtime was being enabled.
        running = false
        created.off?.(CONSOLE_EVENT, consoleListener)
        created.off?.(EXCEPTION_EVENT, exceptionListener)
        await created.detach().catch(() => undefined)
        session = undefined
        consoleListener = undefined
        exceptionListener = undefined
      }
    })()
    try {
      await starting
    } finally {
      starting = undefined
    }
  }

  async function stop(): Promise<void> {
    if (stopping) return
    epoch += 1
    stopping = true
    running = false
    const active = session
    session = undefined
    if (active) {
      if (consoleListener) active.off?.(CONSOLE_EVENT, consoleListener)
      if (exceptionListener) active.off?.(EXCEPTION_EVENT, exceptionListener)
      await active.detach().catch(() => undefined)
    }
    consoleListener = undefined
    exceptionListener = undefined
    buffer.clear()
    stopping = false
  }

  return {
    start,
    stop,
    snapshot(query) {
      return buffer.snapshot(query)
    },
    clear() {
      return buffer.clear()
    },
    stats() {
      return {
        received,
        stored,
        dropped: buffer.dropped,
        rejected,
        lastSeq: buffer.lastSeq,
        lastAt,
      }
    },
    get active() {
      return running
    },
  }
}
