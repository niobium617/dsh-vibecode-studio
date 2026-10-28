import { describe, expect, it } from 'vitest'
import { createLogRingBuffer } from '../../../src/host/targets/process/logs'

const AT = new Date('2026-10-27T10:00:00.000Z')

describe('dev server log ring buffer', () => {
  it('splits chunks into lines and holds partial lines per stream', () => {
    const buffer = createLogRingBuffer()

    buffer.append('stdout', 'VITE v8.3.5  rea', AT)
    buffer.append('stdout', 'dy in 362 ms\nLocal:   http://127.0.0.1:4320/\npart', AT)
    buffer.append('stderr', 'warning: deprecated\r\n', AT)

    expect(
      buffer.snapshot().map((entry) => ({ stream: entry.stream, line: entry.line })),
    ).toEqual([
      { stream: 'stdout', line: 'VITE v8.3.5  ready in 362 ms' },
      { stream: 'stdout', line: 'Local:   http://127.0.0.1:4320/' },
      { stream: 'stderr', line: 'warning: deprecated' },
    ])

    buffer.flush(AT)
    expect(buffer.snapshot().at(-1)?.line).toBe('part')
    expect(buffer.snapshot().at(-1)?.stream).toBe('stdout')
  })

  it('strips ANSI escapes, skips empty lines and truncates long lines', () => {
    const buffer = createLogRingBuffer()

    buffer.append('stdout', '\u001b[32mready\u001b[0m\n\n   \n', AT)
    buffer.append('stdout', `${'x'.repeat(2500)}\n`, AT)

    const entries = buffer.snapshot()
    expect(entries).toHaveLength(2)
    expect(entries[0].line).toBe('ready')
    expect(entries[1].line).toHaveLength(2001)
    expect(entries[1].line.endsWith('…')).toBe(true)
  })

  it('evicts old entries by count and keeps sequence numbers increasing', () => {
    const buffer = createLogRingBuffer({ maxEntries: 3 })

    for (let index = 1; index <= 5; index += 1) {
      buffer.append('stdout', `line ${index}\n`, AT)
    }

    expect(buffer.snapshot().map((entry) => entry.line)).toEqual(['line 3', 'line 4', 'line 5'])
    expect(buffer.snapshot().map((entry) => entry.seq)).toEqual([3, 4, 5])
    expect(buffer.dropped).toBe(2)
    expect(buffer.size).toBe(3)

    expect(buffer.snapshot({ after: 4 }).map((entry) => entry.line)).toEqual(['line 5'])
    expect(buffer.snapshot({ limit: 2 }).map((entry) => entry.line)).toEqual(['line 4', 'line 5'])
  })

  it('enforces a byte budget while keeping the newest line', () => {
    const buffer = createLogRingBuffer({ maxEntries: 100, maxBytes: 256 })

    buffer.append('stdout', `${'a'.repeat(100)}\n${'b'.repeat(100)}\n${'c'.repeat(100)}\n`, AT)

    expect(buffer.snapshot().map((entry) => entry.line[0])).toEqual(['b', 'c'])
    expect(buffer.bytes).toBeLessThanOrEqual(256)
    expect(buffer.dropped).toBe(1)
  })

  it('records supervisor messages and resets everything on clear', () => {
    const buffer = createLogRingBuffer()

    buffer.append('stdout', 'out\n', AT)
    buffer.system('starting dev server', AT)
    expect(buffer.snapshot().map((entry) => entry.stream)).toEqual(['stdout', 'system'])

    buffer.clear()
    expect(buffer.snapshot()).toEqual([])
    expect(buffer.size).toBe(0)
    expect(buffer.bytes).toBe(0)
    expect(buffer.dropped).toBe(0)

    buffer.append('stderr', 'after clear\n', AT)
    expect(buffer.snapshot()[0].seq).toBe(1)
  })
})
