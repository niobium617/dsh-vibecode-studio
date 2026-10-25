/**
 * T001 S1 client half: a right-sidebar tab that pulls or streams JPEG frames
 * through the same-origin `/api` bridge and renders them to a canvas.
 *
 * All measurements live here so the same numbers are available to a human
 * (panel), to the exported JSON report, and to the Playwright driver
 * (`globalThis.__vibeS1`).
 */
import * as React from 'react'
import {
  PULL_PATH,
  RPC_CHANNEL,
  STREAM_PATH,
  MultipartFrameParser,
  type StreamFrame,
} from './protocol'

export const inject = ['connection', 'slots', 'sidebarRight', 'sidebarRightTabs']

const ID = 'dsh-vibe-s1-spike'
const KIND = 'vibe-studio-s1'

type Mode = 'pull' | 'stream'

interface ReceivedFrame {
  bytes: Uint8Array
  seq: number
}

interface Health {
  plugin?: string
  fps?: number
  frameCount?: number
  framesReady?: boolean
  width?: number
  height?: number
  quality?: number
  metricsPath?: string
  hostRss?: number
  uptimeMs?: number
  [key: string]: unknown
}

interface Report {
  kind: 's1-transport-metrics'
  mode: Mode | null
  startedAt: string | null
  endedAt: string
  durationMs: number
  frames: number
  fps: number
  fpsBySecond: number[]
  bytes: number
  kbps: number
  avgBytesPerFrame: number
  latencyMs: { avg: number | null; p95: number | null; max: number | null }
  decodeMs: { avg: number | null; max: number | null }
  seqGaps: number
  duplicates: number
  errors: number
  reconnects: number
  drawQueueDrops: number
  streamDroppedReported: number
  firstFrameMs: number | null
  hostRss: number
  hostHealth: Health | { error: unknown } | null
  client: Record<string, unknown>
  postResult?: unknown
  postError?: string | null
}

interface LiveSnapshot {
  running: boolean
  mode: Mode | null
  elapsedMs: number
  frames: number
  fps: number
  latencyAvg: number | null
  latencyP95: number | null
  bytesPerSecond: number
  seqGaps: number
  duplicates: number
  errors: number
  drawQueueDrops: number
  firstFrameMs: number | null
  heapUsed: number | null
  hostRss: number
  lastReport: Report | null
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done(): void {
      signal.removeEventListener('abort', done)
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function numberHeader(headers: Headers, name: string): number {
  const value = Number(headers.get(name))
  return Number.isFinite(value) ? value : 0
}

class Runner {
  private mode: Mode | null = null
  private abort: AbortController | null = null
  private startedAt = 0
  private stoppedAt: number | null = null
  private autoStop: ReturnType<typeof setTimeout> | null = null
  private canvas: HTMLCanvasElement | null = null

  private frames = 0
  private bytes = 0
  private lastSeq = -1
  private gaps = 0
  private duplicates = 0
  private errors = 0
  private reconnects = 0
  private drawDrops = 0
  private droppedReported = 0
  private hostRss = 0
  private firstFrameMs: number | null = null
  private connectedOnce = false

  private latencies: number[] = []
  private decodeTimes: number[] = []
  private frameTimes: number[] = []
  private heapBefore: number | null = null
  private health: Health | { error: unknown } | null = null
  private queue: ReceivedFrame[] = []
  private listeners = new Set<() => void>()
  private notifyTimer: ReturnType<typeof setTimeout> | null = null
  private lastReport: Report | null = null
  private donePromise: Promise<Report | null> | null = null
  private postResult: unknown = undefined
  private postError: string | null = null

  constructor(private readonly call: (endpoint: string, payload: unknown) => Promise<any>) {}

  setCanvas(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas
    if (canvas !== null) {
      canvas.width = 1280
      canvas.height = 800
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(mode: Mode, seconds?: number): void {
    if (this.abort !== null) this.stop()
    const abort = new AbortController()
    this.mode = mode
    this.abort = abort
    this.startedAt = Date.now()
    this.stoppedAt = null
    this.frames = 0
    this.bytes = 0
    this.lastSeq = -1
    this.gaps = 0
    this.duplicates = 0
    this.errors = 0
    this.reconnects = 0
    this.drawDrops = 0
    this.droppedReported = 0
    this.hostRss = 0
    this.firstFrameMs = null
    this.connectedOnce = false
    this.latencies = []
    this.decodeTimes = []
    this.frameTimes = []
    this.queue = []
    this.lastReport = null
    this.donePromise = null
    this.postResult = undefined
    this.postError = null
    this.health = null
    this.heapBefore = (performance as any).memory?.usedJSHeapSize ?? null

    Promise.resolve(this.call('health', {}))
      .then((result) => {
        this.health = result?.ok === true ? result.value as Health : { error: result?.error ?? result }
      })
      .catch((error) => {
        this.health = { error: String(error) }
      })

    void this.consume(abort.signal)
    void (mode === 'pull' ? this.pullLoop(abort.signal) : this.streamLoop(abort.signal))
    if (seconds !== undefined && seconds > 0) {
      this.autoStop = setTimeout(() => this.stop(), seconds * 1000)
    }
    this.notify()
  }

  stop(): void {
    if (this.abort === null) return
    if (this.autoStop !== null) {
      clearTimeout(this.autoStop)
      this.autoStop = null
    }
    this.stoppedAt = Date.now()
    this.abort.abort()
    this.abort = null
    const report = this.buildReport()
    this.lastReport = report
    this.donePromise = this.call('metrics', report)
      .then((result) => {
        this.postResult = result
        if (result?.ok !== true) this.postError = result?.error?.message ?? 'metrics RPC failed'
        this.notify()
        return this.buildReport()
      })
      .catch((error) => {
        this.postError = String(error)
        this.notify()
        return this.buildReport()
      })
    this.notify()
  }

  waitForReport(): Promise<Report | null> {
    return this.donePromise ?? Promise.resolve(this.lastReport)
  }

  report(): Report | null {
    return this.lastReport ?? (this.startedAt > 0 ? this.buildReport() : null)
  }

  snapshot(): LiveSnapshot {
    const now = this.stoppedAt ?? Date.now()
    const heap = (performance as any).memory?.usedJSHeapSize ?? null
    return {
      running: this.abort !== null,
      mode: this.mode,
      elapsedMs: this.startedAt === 0 ? 0 : Math.max(0, now - this.startedAt),
      frames: this.frames,
      fps: this.liveFps(now),
      latencyAvg: average(this.latencies.slice(-120)),
      latencyP95: percentile(this.latencies.slice(-120), 0.95),
      bytesPerSecond: this.startedAt === 0 ? 0 : this.bytes / Math.max(0.001, (now - this.startedAt) / 1000),
      seqGaps: this.gaps,
      duplicates: this.duplicates,
      errors: this.errors,
      drawQueueDrops: this.drawDrops,
      firstFrameMs: this.firstFrameMs,
      heapUsed: heap,
      hostRss: this.hostRss,
      lastReport: this.lastReport,
    }
  }

  private liveFps(now: number): number {
    const cutoff = now - 2000
    while (this.frameTimes.length > 0 && this.frameTimes[0] < cutoff) this.frameTimes.shift()
    return this.frameTimes.length / 2
  }

  private async pullLoop(signal: AbortSignal): Promise<void> {
    let after = -1
    while (!signal.aborted) {
      try {
        const response = await fetch(`${PULL_PATH}?wait=1&after=${after}`, {
          cache: 'no-store',
          signal,
        })
        if (!response.ok) {
          this.errors += 1
          await sleep(250, signal)
          continue
        }
        const seq = numberHeader(response.headers, 'x-vibe-seq')
        const ts = numberHeader(response.headers, 'x-vibe-ts')
        const hostRss = numberHeader(response.headers, 'x-vibe-host-rss')
        const bytes = new Uint8Array(await response.arrayBuffer())
        this.record(seq, ts, bytes.byteLength, hostRss, 0)
        this.enqueue({ bytes, seq })
        after = Math.max(after, seq)
      } catch (error) {
        if (signal.aborted) break
        this.errors += 1
        await sleep(300, signal)
      }
    }
  }

  private async streamLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const response = await fetch(STREAM_PATH, { cache: 'no-store', signal })
        if (!response.ok || response.body === null) throw new Error(`stream HTTP ${response.status}`)
        if (this.connectedOnce) this.reconnects += 1
        this.connectedOnce = true
        const reader = response.body.getReader()
        const parser = new MultipartFrameParser()
        while (!signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          parser.push(value, (frame: StreamFrame) => {
            this.record(frame.seq, frame.ts, frame.bytes.byteLength, frame.hostRss, frame.dropped)
            this.enqueue({ bytes: frame.bytes, seq: frame.seq })
          })
        }
        if (!signal.aborted) throw new Error('stream ended')
      } catch (error) {
        if (signal.aborted) break
        this.errors += 1
        await sleep(500, signal)
      }
    }
  }

  private record(seq: number, ts: number, size: number, hostRss: number, dropped: number): void {
    const now = Date.now()
    this.frames += 1
    this.bytes += size
    if (this.lastSeq >= 0) {
      if (seq === this.lastSeq) this.duplicates += 1
      else if (seq > this.lastSeq + 1) this.gaps += seq - this.lastSeq - 1
    }
    this.lastSeq = Math.max(this.lastSeq, seq)
    this.latencies.push(Math.max(0, now - ts))
    if (this.latencies.length > 5000) this.latencies.shift()
    this.frameTimes.push(now)
    if (this.frameTimes.length > 5000) this.frameTimes.shift()
    if (this.firstFrameMs === null && this.startedAt > 0) this.firstFrameMs = now - this.startedAt
    if (hostRss > 0) this.hostRss = hostRss
    if (dropped > 0) this.droppedReported += dropped
    this.scheduleNotify()
  }

  private enqueue(frame: ReceivedFrame): void {
    if (this.queue.length >= 2) {
      this.queue.shift()
      this.drawDrops += 1
    }
    this.queue.push(frame)
  }

  private async consume(signal: AbortSignal): Promise<void> {
    const canvas = this.canvas
    const context = canvas?.getContext('2d') ?? null
    for (;;) {
      const item = this.queue.shift()
      if (item === undefined) {
        if (signal.aborted) break
        await sleep(5, signal)
        continue
      }
      const begin = performance.now()
      try {
        // The typed-array generic (TS 5.7+) is narrower than BlobPart; the
        // runtime value is always a plain ArrayBuffer-backed view here.
        const bitmap = await createImageBitmap(new Blob([item.bytes as BlobPart], { type: 'image/jpeg' }))
        const end = performance.now()
        this.decodeTimes.push(end - begin)
        if (this.decodeTimes.length > 2000) this.decodeTimes.shift()
        const target = this.canvas?.getContext('2d') ?? context
        if (target !== null) target.drawImage(bitmap, 0, 0, 1280, 800)
        bitmap.close()
      } catch {
        // Decode failures are counted as client errors; the transport still records the frame.
        this.errors += 1
      }
      this.scheduleNotify()
    }
  }

  private buildReport(): Report {
    const end = this.stoppedAt ?? Date.now()
    const durationMs = this.startedAt === 0 ? 0 : Math.max(1, end - this.startedAt)
    const heap = (performance as any).memory?.usedJSHeapSize ?? null
    return {
      kind: 's1-transport-metrics',
      mode: this.mode,
      startedAt: this.startedAt === 0 ? null : new Date(this.startedAt).toISOString(),
      endedAt: new Date(end).toISOString(),
      durationMs,
      frames: this.frames,
      fps: round(this.frames / (durationMs / 1000)),
      fpsBySecond: this.fpsBySecond(),
      bytes: this.bytes,
      kbps: round(this.bytes / 1024 / (durationMs / 1000)),
      avgBytesPerFrame: this.frames === 0 ? 0 : Math.round(this.bytes / this.frames),
      latencyMs: {
        avg: roundOrNull(average(this.latencies)),
        p95: roundOrNull(percentile(this.latencies, 0.95)),
        max: roundOrNull(this.latencies.length === 0 ? null : Math.max(...this.latencies)),
      },
      decodeMs: {
        avg: roundOrNull(average(this.decodeTimes)),
        max: roundOrNull(this.decodeTimes.length === 0 ? null : Math.max(...this.decodeTimes)),
      },
      seqGaps: this.gaps,
      duplicates: this.duplicates,
      errors: this.errors,
      reconnects: this.reconnects,
      drawQueueDrops: this.drawDrops,
      streamDroppedReported: this.droppedReported,
      firstFrameMs: this.firstFrameMs,
      hostRss: this.hostRss,
      hostHealth: this.health,
      client: {
        heapBefore: this.heapBefore,
        heapAfter: heap,
        userAgent: navigator.userAgent,
        origin: location.origin,
        visibilityState: document.visibilityState,
        desktop: Boolean((globalThis as any).dshDesktop),
        desktopProtocol: (globalThis as any).dshDesktop?.protocolVersion ?? null,
        canvas: this.canvas === null ? null : `${this.canvas.width}x${this.canvas.height}`,
      },
      postResult: this.postResult,
      postError: this.postError,
    }
  }

  private fpsBySecond(): number[] {
    if (this.startedAt === 0) return []
    const buckets: number[] = []
    for (const time of this.frameTimes) {
      const index = Math.floor((time - this.startedAt) / 1000)
      if (index < 0) continue
      while (buckets.length <= index) buckets.push(0)
      buckets[index] += 1
    }
    return buckets
  }

  private scheduleNotify(): void {
    if (this.notifyTimer !== null) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null
      this.notify()
    }, 200)
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        // UI listener errors must not stop measurement.
      }
    }
  }
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : round(value)
}

const h = React.createElement

const S: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    height: '100%',
    minHeight: 0,
    padding: 10,
    boxSizing: 'border-box',
    fontSize: 12,
    color: 'var(--dsw-text-primary, #e6e6e6)',
    background: 'var(--dsw-bg-primary, #14161a)',
  },
  row: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  button: {
    padding: '4px 10px',
    borderRadius: 6,
    border: '1px solid var(--dsw-border, #3a3f47)',
    background: 'var(--dsw-bg-secondary, #23262c)',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: 12,
  },
  primary: { borderColor: '#4c8dff', background: '#1c2f52' },
  canvas: {
    width: '100%',
    maxHeight: '62%',
    objectFit: 'contain',
    background: '#000',
    borderRadius: 6,
    border: '1px solid var(--dsw-border, #3a3f47)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
    gap: 4,
  },
  cell: {
    padding: '4px 6px',
    borderRadius: 4,
    background: 'var(--dsw-bg-secondary, #23262c)',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  hint: { opacity: 0.7, lineHeight: 1.4 },
}

function makePanel(runner: Runner): React.FC {
  return function StudioPanel() {
    const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
    const [, force] = React.useReducer((value: number) => value + 1, 0)
    const [copyState, setCopyState] = React.useState('')

    React.useEffect(() => {
      runner.setCanvas(canvasRef.current)
      const unsubscribe = runner.subscribe(force)
      return () => {
        unsubscribe()
        runner.setCanvas(null)
      }
    }, [])

    const snap = runner.snapshot()
    const latency = snap.latencyAvg === null ? '—' : `${Math.round(snap.latencyAvg)} ms`
    const p95 = snap.latencyP95 === null ? '—' : `${Math.round(snap.latencyP95)} ms`
    const heap = snap.heapUsed === null ? '—' : `${(snap.heapUsed / 1024 / 1024).toFixed(1)} MB`
    const rss = snap.hostRss === 0 ? '—' : `${(snap.hostRss / 1024 / 1024).toFixed(1)} MB`

    return h('div', { style: S.root },
      h('div', { style: { fontWeight: 600, fontSize: 13 } }, 'Vibe Studio — S1 transport spike'),
      h('div', { style: S.row },
        h('button', {
          style: { ...S.button, ...S.primary },
          onClick: () => runner.start('pull', 30),
        }, 'Pull 30 s'),
        h('button', {
          style: { ...S.button, ...S.primary },
          onClick: () => runner.start('stream', 30),
        }, 'Stream 30 s'),
        h('button', { style: S.button, onClick: () => runner.stop() }, 'Stop'),
        h('button', {
          style: S.button,
          onClick: () => {
            const report = runner.report()
            const text = JSON.stringify(report, null, 2)
            void navigator.clipboard?.writeText(text).then(
              () => setCopyState('已复制报告'),
              () => setCopyState('复制失败'),
            )
          },
        }, '复制报告'),
        h('span', { style: S.hint }, copyState),
      ),
      h('div', { style: S.grid },
        cell('状态', snap.running ? `${snap.mode} · ${(snap.elapsedMs / 1000).toFixed(1)} s` : snap.lastReport ? '已停止' : '未开始'),
        cell('fps（2 s）', snap.fps.toFixed(1)),
        cell('帧数', String(snap.frames)),
        cell('首帧', snap.firstFrameMs === null ? '—' : `${Math.round(snap.firstFrameMs)} ms`),
        cell('延迟均值', latency),
        cell('延迟 p95', p95),
        cell('丢帧/缺口', `${snap.seqGaps} / ${snap.drawQueueDrops}`),
        cell('错误/重连', `${snap.errors}`),
        cell('码率', `${(snap.bytesPerSecond / 1024).toFixed(0)} KB/s`),
        cell('客户端堆', heap),
        cell('Host RSS', rss),
        cell('重复帧', `${snap.duplicates}`),
      ),
      h('canvas', { ref: canvasRef, style: S.canvas }),
      h('div', { style: S.hint },
        'Pull = GET /api/vibe/frame?wait=1 长轮询；Stream = multipart/x-mixed-replace。',
        h('br'),
        '切到其他右栏 tab 再切回，页面保持挂载且计数继续；停止后报告自动写入 spikes/s1/metrics.jsonl。',
      ),
    )
  }
}

function cell(label: string, value: string): React.ReactElement {
  return h('div', { style: S.cell, title: `${label}: ${value}` },
    h('div', { style: { opacity: 0.62, fontSize: 10 } }, label),
    h('div', { style: { fontWeight: 600 } }, value),
  )
}

export function apply(ctx: any): void {
  const call = (endpoint: string, payload: unknown): Promise<any> =>
    ctx.connection.rpc.call(RPC_CHANNEL, endpoint, payload)
  const runner = new Runner(call)
  const StudioPanel = makePanel(runner)

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID,
    kind: KIND,
    title: () => 'Vibe Studio S1',
    guide: [{
      id: 'vibe-studio-s1',
      title: () => 'Vibe Studio S1',
      description: () => 'Transport spike: pull vs stream',
    }],
    keepMounted: true,
  }), 'vibe-s1: tab type')

  // `slots.inject` is the documented way for a contributed tab body to join
  // the keyed slot that sidebar-right itself owns.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: ID,
  }, StudioPanel)), 'vibe-s1: tab body')

  const debug = {
    openTab: (): unknown => {
      try {
        ctx.sidebarRight.openTab(KIND)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: String(error) }
      }
    },
    start: (mode: Mode, seconds?: number): LiveSnapshot => {
      runner.start(mode, seconds)
      return runner.snapshot()
    },
    stop: (): Report | null => {
      runner.stop()
      return runner.report()
    },
    report: (): Report | null => runner.report(),
    waitForReport: (): Promise<Report | null> => runner.waitForReport(),
    health: (): Promise<any> => call('health', {}),
    version: 's1-1',
  }
  ;(globalThis as any).__vibeS1 = debug
  ctx.effect(() => () => {
    if ((globalThis as any).__vibeS1 === debug) delete (globalThis as any).__vibeS1
    runner.stop()
  }, 'vibe-s1: debug hook')
}
