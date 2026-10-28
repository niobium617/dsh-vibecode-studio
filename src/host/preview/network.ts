/**
 * Network capture over CDP (T024).
 *
 * A dedicated CDP session follows `Network.requestWillBeSent`,
 * `responseReceived`, `loadingFinished` and `loadingFailed`. Headers and URLs
 * are redacted before an entry is stored, and the bounded buffer keeps a
 * monotone revision cursor so a polling client receives pending rows again
 * once they gain a status or a duration. Response bodies are never captured
 * eagerly: `body()` asks CDP for one body, caps it, and returns it as
 * untrusted text.
 */
import { truncateChars, truncateUtf8, utf8Bytes } from '../../contracts/budget'
import { studioError, type StudioError } from '../../contracts/errors'
import { redactHeaders, redactUrl } from '../../contracts/redact'
import type { NetworkEntry, NetworkOutcome } from '../../contracts/telemetry'
import {
  MAX_NETWORK_BODY_BYTES,
  MAX_NETWORK_ENTRIES,
  type PreviewNetworkBody,
  type PreviewNetworkBodyParams,
  type PreviewNetworkClearResult,
  type PreviewNetworkQuery,
  type PreviewNetworkSnapshot,
} from '../../contracts/transport'
import type { ScreencastPageLike, ScreencastSessionLike } from '../targets/types'

const REQUEST_EVENT = 'Network.requestWillBeSent'
const RESPONSE_EVENT = 'Network.responseReceived'
const FINISHED_EVENT = 'Network.loadingFinished'
const FAILED_EVENT = 'Network.loadingFailed'
const NETWORK_ENABLE = 'Network.enable'
const GET_RESPONSE_BODY = 'Network.getResponseBody'

const MAX_URL_BYTES = 512
const MAX_HEADER_VALUE_BYTES = 512
const MAX_HEADERS = 64
const MAX_FAILURE_CHARS = 200
const MAX_DATE_MS = 8.64e15
const DEFAULT_MAX_BYTES = 256 * 1024

/**
 * Ask Edge to keep bodies for on-demand reads, but bound browser memory:
 * one resource may hold 5 MiB and the whole session 20 MiB.
 */
const ENABLE_PARAMS = {
  maxTotalBufferSize: 20 * 1024 * 1024,
  maxResourceBufferSize: 5 * 1024 * 1024,
  maxPostDataSize: 64 * 1024,
} as const

export interface PreviewNetworkStats {
  readonly received: number
  readonly stored: number
  readonly dropped: number
  readonly rejected: number
  readonly lastSeq: number
  readonly lastAt: number | null
}

export interface PreviewNetworkCollector {
  /** Creates the CDP session and enables Network; idempotent. */
  start(): Promise<void>
  /** Removes listeners, detaches the session and clears the buffer; idempotent. */
  stop(): Promise<void>
  snapshot(query?: PreviewNetworkQuery): PreviewNetworkSnapshot
  clear(): PreviewNetworkClearResult
  /** Fetches and caps one response body; throws `not_found` when unavailable. */
  body(params: PreviewNetworkBodyParams): Promise<PreviewNetworkBody>
  stats(): PreviewNetworkStats
  readonly active: boolean
}

export interface PreviewNetworkCollectorOptions {
  readonly page: ScreencastPageLike
  readonly maxEntries?: number
  readonly maxBytes?: number
  readonly maxBodyBytes?: number
  readonly now?: () => number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Protocol timestamps are epoch seconds (`wallTime`) or monotonic seconds. */
function epochMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  const ms = value < 1e12 ? value * 1000 : value
  return Math.abs(ms) <= MAX_DATE_MS ? Math.round(ms) : null
}

function monotonicMs(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value * 1000 : null
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function capUrl(raw: string): string {
  return truncateUtf8(redactUrl(raw), MAX_URL_BYTES)
}

/**
 * Normalize, cap and redact one header map. Values are text as CDP reports
 * them; non-string values are dropped rather than stringified.
 */
export function normalizeNetworkHeaders(raw: unknown): Record<string, string> | undefined {
  const record = asRecord(raw)
  if (record === null) return undefined
  const entries: [string, string][] = []
  for (const [rawKey, rawValue] of Object.entries(record)) {
    if (entries.length >= MAX_HEADERS) break
    if (typeof rawValue !== 'string') continue
    const key = rawKey.trim()
    if (key.length === 0) continue
    entries.push([key, truncateUtf8(rawValue, MAX_HEADER_VALUE_BYTES)])
  }
  if (entries.length === 0) return undefined
  return redactHeaders(Object.fromEntries(entries))
}

interface StoredNetwork {
  readonly seq: number
  readonly requestId: string
  revision: number
  method: string
  url: string
  status: number | null
  outcome: NetworkOutcome
  resourceType: string | null
  mimeType: string | null
  /** Monotonic request time in milliseconds, for durations only. */
  startedMonoMs: number | null
  startedAt: string
  durationMs: number | null
  requestHeaders?: Readonly<Record<string, string>>
  responseHeaders?: Readonly<Record<string, string>>
  failure: string | null
  bytes: number
}

export interface NetworkRequestInput {
  readonly method: string
  readonly url: string
  readonly resourceType: string | null
  readonly requestHeaders?: Readonly<Record<string, string>>
  readonly startedAt: number
  readonly startedMonoMs: number | null
}

export interface NetworkResponseInput {
  readonly status: number | null
  readonly responseHeaders?: Readonly<Record<string, string>>
  readonly resourceType: string | null
  readonly mimeType: string | null
  /** Monotonic response time, used when `loadingFinished` never arrives. */
  readonly atMonoMs: number | null
}

function entryBytes(stored: StoredNetwork): number {
  let total = utf8Bytes(stored.method) + utf8Bytes(stored.url)
  if (stored.resourceType) total += utf8Bytes(stored.resourceType)
  if (stored.failure) total += utf8Bytes(stored.failure)
  for (const headers of [stored.requestHeaders, stored.responseHeaders]) {
    if (!headers) continue
    for (const [key, value] of Object.entries(headers)) {
      total += utf8Bytes(key) + utf8Bytes(value)
    }
  }
  return total
}

function toEntry(stored: StoredNetwork): NetworkEntry {
  return {
    id: `network-${stored.seq}`,
    method: stored.method,
    url: stored.url,
    status: stored.status,
    outcome: stored.outcome,
    resourceType: stored.resourceType,
    startedAt: stored.startedAt,
    durationMs: stored.durationMs,
    ...(stored.requestHeaders === undefined
      ? {}
      : { requestHeaders: stored.requestHeaders }),
    ...(stored.responseHeaders === undefined
      ? {}
      : { responseHeaders: stored.responseHeaders }),
    ...(stored.failure === null ? {} : { failure: stored.failure }),
  }
}

/**
 * Bounded network history. `revision` rises on every create and update so a
 * poller using `after` sees status changes; request ids keep their creation
 * sequence, and both counters survive `clear()`.
 */
export class PreviewNetworkBuffer {
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly entries: StoredNetwork[] = []
  private readonly byRequestId = new Map<string, StoredNetwork>()
  private readonly byId = new Map<string, StoredNetwork>()
  private seq = 0
  private revision = 0
  private byteCount = 0
  private droppedCount = 0

  constructor(options: { readonly maxEntries?: number; readonly maxBytes?: number } = {}) {
    this.maxEntries = Math.max(1, Math.trunc(options.maxEntries ?? MAX_NETWORK_ENTRIES))
    this.maxBytes = Math.max(1024, Math.trunc(options.maxBytes ?? DEFAULT_MAX_BYTES))
  }

  private touch(stored: StoredNetwork): void {
    const next = entryBytes(stored)
    this.byteCount += next - stored.bytes
    stored.bytes = next
    this.revision += 1
    stored.revision = this.revision
    this.evict()
  }

  startRequest(requestId: string, input: NetworkRequestInput): number {
    const existing = this.byRequestId.get(requestId)
    if (existing !== undefined) {
      // A redirect reuses the request id: show the final URL but keep the
      // original start time so the row's duration covers the whole chain.
      existing.method = input.method
      existing.url = input.url
      existing.resourceType = input.resourceType ?? existing.resourceType
      if (input.requestHeaders !== undefined) {
        existing.requestHeaders = input.requestHeaders
      }
      this.touch(existing)
      return existing.seq
    }

    this.seq += 1
    this.revision += 1
    const startedAt =
      Number.isFinite(input.startedAt) && Math.abs(input.startedAt) <= MAX_DATE_MS
        ? new Date(input.startedAt).toISOString()
        : new Date().toISOString()
    const stored: StoredNetwork = {
      seq: this.seq,
      requestId,
      revision: this.revision,
      method: input.method,
      url: input.url,
      status: null,
      outcome: 'pending',
      resourceType: input.resourceType,
      mimeType: null,
      startedMonoMs: input.startedMonoMs,
      startedAt,
      durationMs: null,
      ...(input.requestHeaders === undefined
        ? {}
        : { requestHeaders: input.requestHeaders }),
      failure: null,
      bytes: 0,
    }
    stored.bytes = entryBytes(stored)
    this.entries.push(stored)
    this.byRequestId.set(requestId, stored)
    this.byId.set(`network-${stored.seq}`, stored)
    this.byteCount += stored.bytes
    this.evict()
    return this.seq
  }

  setResponse(requestId: string, input: NetworkResponseInput): boolean {
    const stored = this.byRequestId.get(requestId)
    if (stored === undefined) return false
    stored.status = input.status
    if (input.status !== null) {
      stored.outcome = input.status >= 400 ? 'error' : 'success'
    }
    if (input.responseHeaders !== undefined) {
      stored.responseHeaders = input.responseHeaders
    }
    stored.resourceType = input.resourceType ?? stored.resourceType
    stored.mimeType = input.mimeType
    if (input.atMonoMs !== null && stored.startedMonoMs !== null) {
      stored.durationMs = Math.max(0, Math.round(input.atMonoMs - stored.startedMonoMs))
    }
    this.touch(stored)
    return true
  }

  finish(requestId: string, atMonoMs: number | null): boolean {
    const stored = this.byRequestId.get(requestId)
    if (stored === undefined) return false
    if (atMonoMs !== null && stored.startedMonoMs !== null) {
      stored.durationMs = Math.max(0, Math.round(atMonoMs - stored.startedMonoMs))
    }
    this.touch(stored)
    return true
  }

  fail(requestId: string, canceled: boolean, failure: string, atMonoMs: number | null): boolean {
    const stored = this.byRequestId.get(requestId)
    if (stored === undefined) return false
    stored.outcome = canceled ? 'aborted' : 'error'
    stored.failure = failure
    if (atMonoMs !== null && stored.startedMonoMs !== null) {
      stored.durationMs = Math.max(0, Math.round(atMonoMs - stored.startedMonoMs))
    }
    this.touch(stored)
    return true
  }

  private evict(): void {
    // Keep the newest entry even if it alone exceeds the byte budget.
    while (
      (this.entries.length > this.maxEntries || this.byteCount > this.maxBytes) &&
      this.entries.length > 1
    ) {
      const removed = this.entries.shift()
      if (removed === undefined) break
      this.byteCount -= removed.bytes
      this.droppedCount += 1
      if (this.byRequestId.get(removed.requestId) === removed) {
        this.byRequestId.delete(removed.requestId)
      }
      this.byId.delete(`network-${removed.seq}`)
    }
  }

  snapshot(query: PreviewNetworkQuery = {}): PreviewNetworkSnapshot {
    let selected = this.entries
    if (query.after !== undefined) {
      selected = selected.filter((stored) => stored.revision > (query.after as number))
    }
    if (query.limit !== undefined) {
      selected = selected.slice(-Math.trunc(query.limit))
    }
    return {
      entries: selected.map(toEntry),
      lastSeq: this.revision,
      dropped: this.droppedCount,
    }
  }

  clear(): PreviewNetworkClearResult {
    const cleared = this.entries.length
    this.entries.length = 0
    this.byRequestId.clear()
    this.byId.clear()
    this.byteCount = 0
    this.droppedCount = 0
    return { cleared, lastSeq: this.revision }
  }

  /** Internal request id and response metadata for one visible entry. */
  find(id: string): { requestId: string; status: number | null; mimeType: string | null } | null {
    const stored = this.byId.get(id)
    if (stored === undefined) return null
    return {
      requestId: stored.requestId,
      status: stored.status,
      mimeType: stored.mimeType,
    }
  }

  get lastSeq(): number {
    return this.revision
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

export function createPreviewNetworkCollector(
  options: PreviewNetworkCollectorOptions,
): PreviewNetworkCollector {
  const { page } = options
  const now = options.now ?? (() => Date.now())
  const maxBodyBytes = Math.max(64, Math.trunc(options.maxBodyBytes ?? MAX_NETWORK_BODY_BYTES))
  const buffer = new PreviewNetworkBuffer(options)

  let session: ScreencastSessionLike | undefined
  let starting: Promise<void> | undefined
  let running = false
  let stopping = false
  let epoch = 0
  const listeners: { event: string; listener: (params: unknown) => void }[] = []
  let received = 0
  let stored = 0
  let rejected = 0
  let lastAt: number | null = null

  function on(method: string, raw: unknown): void {
    if (!running) return
    const event = asRecord(raw)
    if (event === null) {
      rejected += 1
      return
    }
    const requestId = textOf(event.requestId)
    if (requestId === null || requestId.length === 0 || requestId.length > 128) {
      rejected += 1
      return
    }

    if (method === REQUEST_EVENT) {
      const request = asRecord(event.request)
      const rawUrl = request === null ? null : textOf(request.url)
      if (request === null || rawUrl === null || !isHttpUrl(rawUrl)) {
        rejected += 1
        return
      }
      const wall = epochMs(event.wallTime)
      const startedAt = wall ?? now()
      const requestHeaders = normalizeNetworkHeaders(request.headers)
      buffer.startRequest(requestId, {
        method: (textOf(request.method) ?? 'GET').toUpperCase(),
        url: capUrl(rawUrl),
        resourceType: textOf(event.type) ?? textOf(request.type),
        ...(requestHeaders === undefined ? {} : { requestHeaders }),
        startedAt,
        startedMonoMs: monotonicMs(event.timestamp),
      })
      received += 1
      stored += 1
      lastAt = startedAt
      return
    }

    if (method === RESPONSE_EVENT) {
      const response = asRecord(event.response)
      const status =
        response !== null && typeof response.status === 'number' && Number.isFinite(response.status)
          ? Math.trunc(response.status)
          : null
      const responseHeaders =
        response === null ? undefined : normalizeNetworkHeaders(response.headers)
      const accepted = buffer.setResponse(requestId, {
        status,
        ...(responseHeaders === undefined ? {} : { responseHeaders }),
        resourceType: textOf(event.type),
        mimeType: response === null ? null : textOf(response.mimeType),
        atMonoMs: monotonicMs(event.timestamp),
      })
      if (!accepted) rejected += 1
      return
    }

    if (method === FINISHED_EVENT) {
      if (!buffer.finish(requestId, monotonicMs(event.timestamp))) rejected += 1
      return
    }

    if (method === FAILED_EVENT) {
      const failure = truncateChars(
        textOf(event.errorText) ?? 'network request failed',
        MAX_FAILURE_CHARS,
      )
      if (!buffer.fail(requestId, event.canceled === true, failure, monotonicMs(event.timestamp))) {
        rejected += 1
      }
    }
  }

  function detachListeners(active: ScreencastSessionLike): void {
    for (const { event, listener } of listeners) active.off?.(event, listener)
    listeners.length = 0
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
      for (const event of [REQUEST_EVENT, RESPONSE_EVENT, FINISHED_EVENT, FAILED_EVENT]) {
        const listener = (raw: unknown): void => on(event, raw)
        listeners.push({ event, listener })
        created.on(event, listener)
      }
      // Listeners go on before `Network.enable` so early requests are seen.
      running = true
      try {
        await created.send(NETWORK_ENABLE, ENABLE_PARAMS)
      } catch (error) {
        running = false
        detachListeners(created)
        await created.detach().catch(() => undefined)
        session = undefined
        throw toPreviewError(error)
      }
      if (startedEpoch !== epoch) {
        // `stop()` ran while Network was being enabled.
        running = false
        detachListeners(created)
        await created.detach().catch(() => undefined)
        session = undefined
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
      detachListeners(active)
      await active.detach().catch(() => undefined)
    }
    buffer.clear()
    stopping = false
  }

  async function body(params: PreviewNetworkBodyParams): Promise<PreviewNetworkBody> {
    if (!running || session === undefined) {
      throw studioError('target_unavailable', 'vibe-studio: preview is not running')
    }
    const target = buffer.find(params.id)
    if (target === null || target.status === null) {
      throw studioError('not_found', 'vibe-studio: network response body is unavailable', {
        id: params.id,
      })
    }

    let raw: unknown
    try {
      raw = await session.send(GET_RESPONSE_BODY, { requestId: target.requestId })
    } catch {
      // Redirects, evicted bodies and no-body responses all land here.
      throw studioError('not_found', 'vibe-studio: network response body is unavailable', {
        id: params.id,
      })
    }
    const record = asRecord(raw)
    if (record === null) {
      throw studioError('not_found', 'vibe-studio: network response body is unavailable', {
        id: params.id,
      })
    }

    const encoded = textOf(record.body) ?? ''
    if (record.base64Encoded === true) {
      const decoded = Buffer.from(encoded, 'base64')
      const truncated = decoded.byteLength > maxBodyBytes
      const slice = truncated ? decoded.subarray(0, maxBodyBytes) : decoded
      return {
        id: params.id,
        status: target.status,
        mimeType: target.mimeType,
        body: slice.toString('base64'),
        base64Encoded: true,
        truncated,
        bytes: slice.byteLength,
      }
    }

    const truncated = utf8Bytes(encoded) > maxBodyBytes
    const text = truncated ? truncateUtf8(encoded, maxBodyBytes) : encoded
    return {
      id: params.id,
      status: target.status,
      mimeType: target.mimeType,
      body: text,
      base64Encoded: false,
      truncated,
      bytes: utf8Bytes(text),
    }
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
    body,
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

function toPreviewError(error: unknown): StudioError {
  const message = error instanceof Error ? error.message : typeof error
  // CDP/Playwright errors can carry local paths; keep the reason only.
  return studioError('preview_failed', `vibe-studio: network capture failed: ${message}`)
}
