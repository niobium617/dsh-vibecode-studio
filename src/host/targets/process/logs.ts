/**
 * Bounded log buffer for the dev server supervisor (T019).
 *
 * Dev servers can be chatty, so stdout/stderr are kept in a ring buffer with
 * both an entry and a byte budget. Chunks are split into lines, a trailing
 * partial line is held until the next chunk (or `flush`), and ANSI escapes are
 * stripped so the UI shows readable text. Sequence numbers keep increasing even
 * when old entries are dropped, which lets a later reader ask for `after`.
 */

const ANSI_PATTERN = /\u001b\[[0-?]*[ -/]*[@-~]/g

export type DevServerLogStream = 'stdout' | 'stderr' | 'system'

export interface DevServerLogEntry {
  readonly seq: number
  readonly at: string
  readonly stream: DevServerLogStream
  readonly line: string
}

export interface LogRingBufferOptions {
  /** Retained entries (default 500). */
  readonly maxEntries?: number
  /** Retained UTF-8 bytes across entry text (default 64 KiB). */
  readonly maxBytes?: number
  /** Lines longer than this are truncated (default 2000 characters). */
  readonly maxLineLength?: number
}

export interface LogRingBufferSnapshotOptions {
  /** Only entries with a sequence number greater than this. */
  readonly after?: number
  /** Keep only the last N matching entries. */
  readonly limit?: number
}

export interface LogRingBuffer {
  /** Appends a raw chunk; partial trailing lines are buffered per stream. */
  append(stream: 'stdout' | 'stderr', chunk: string, at?: Date): void
  /** Appends one supervisor-generated line (no line splitting). */
  system(line: string, at?: Date): void
  /** Emits any buffered partial lines, e.g. when the process exits. */
  flush(at?: Date): void
  snapshot(options?: LogRingBufferSnapshotOptions): readonly DevServerLogEntry[]
  clear(): void
  readonly size: number
  readonly bytes: number
  /** Entries removed because a budget was exceeded. */
  readonly dropped: number
}

/** Strips SGR/CSI sequences; exported for the supervisor's error mapping. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

export function createLogRingBuffer(options: LogRingBufferOptions = {}): LogRingBuffer {
  const maxEntries = Math.max(1, Math.trunc(options.maxEntries ?? 500))
  const maxBytes = Math.max(256, Math.trunc(options.maxBytes ?? 64 * 1024))
  const maxLineLength = Math.max(80, Math.trunc(options.maxLineLength ?? 2000))

  const entries: DevServerLogEntry[] = []
  const pending = new Map<'stdout' | 'stderr', string>()
  let nextSeq = 1
  let dropped = 0
  let bytes = 0

  function normalize(raw: string): string {
    const line = stripAnsi(raw).replace(/\r+$/, '').trimEnd()
    return line.length > maxLineLength ? `${line.slice(0, maxLineLength)}…` : line
  }

  function evict(): void {
    // Keep the newest entry even if a single line exceeds the byte budget.
    while ((entries.length > maxEntries || bytes > maxBytes) && entries.length > 1) {
      const removed = entries.shift()
      if (!removed) break
      bytes -= byteLength(removed.line)
      dropped += 1
    }
  }

  function push(stream: DevServerLogStream, raw: string, at: Date): void {
    const line = normalize(raw)
    if (line.length === 0) return
    entries.push({ seq: nextSeq, at: at.toISOString(), stream, line })
    nextSeq += 1
    bytes += byteLength(line)
    evict()
  }

  return {
    append(stream, chunk, at = new Date()) {
      if (!chunk) return
      const buffered = `${pending.get(stream) ?? ''}${chunk}`
      const lines = buffered.split('\n')
      const tail = lines.pop() ?? ''
      // A stream that never emits a newline must not grow without bound.
      pending.set(stream, tail.length > maxLineLength * 4 ? tail.slice(-maxLineLength * 4) : tail)
      for (const line of lines) push(stream, line, at)
    },

    system(line, at = new Date()) {
      push('system', line, at)
    },

    flush(at = new Date()) {
      for (const [stream, tail] of pending) {
        if (tail.length > 0) push(stream, tail, at)
      }
      pending.clear()
    },

    snapshot(snapshotOptions = {}) {
      let selected = entries
      if (snapshotOptions.after !== undefined) {
        selected = selected.filter((entry) => entry.seq > (snapshotOptions.after as number))
      }
      if (snapshotOptions.limit !== undefined && snapshotOptions.limit >= 0) {
        selected = selected.slice(-Math.trunc(snapshotOptions.limit))
      }
      return selected.slice()
    },

    clear() {
      entries.length = 0
      pending.clear()
      nextSeq = 1
      dropped = 0
      bytes = 0
    },

    get size() {
      return entries.length
    },
    get bytes() {
      return bytes
    },
    get dropped() {
      return dropped
    },
  }
}
