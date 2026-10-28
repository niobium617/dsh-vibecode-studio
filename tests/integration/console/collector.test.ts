import { describe, expect, it } from 'vitest'
import {
  createPreviewConsoleCollector,
  formatConsoleArgs,
  normalizeConsoleText,
} from '../../../src/host/preview/console'
import type { ScreencastPageLike, ScreencastSessionLike } from '../../../src/host/targets/types'

type Listener = (params: unknown) => void

function fakePage(options: { readonly failEnable?: boolean } = {}) {
  const listeners = new Map<string, Set<Listener>>()
  const sent: string[] = []
  let detached = false

  const session: ScreencastSessionLike = {
    async send(method) {
      sent.push(method)
      if (options.failEnable && method === 'Runtime.enable') throw new Error('denied')
      return {}
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(event, set)
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener)
    },
    async detach() {
      detached = true
    },
  }

  const page: ScreencastPageLike = {
    viewport: () => null,
    async createCdpSession() {
      return session
    },
  }

  return {
    page,
    sent,
    emit(event: string, params: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(params)
    },
    listenerCount() {
      let count = 0
      for (const set of listeners.values()) count += set.size
      return count
    },
    get detached() {
      return detached
    },
  }
}

const NOW = 1_700_000_000_000

function collector(
  fake: ReturnType<typeof fakePage>,
  options: { maxEntries?: number; maxBytes?: number; maxTextBytes?: number } = {},
) {
  return createPreviewConsoleCollector({ page: fake.page, now: () => NOW, ...options })
}

describe('preview console collector', () => {
  it('maps console arguments and exceptions with redacted sources', async () => {
    const fake = fakePage()
    const capture = collector(fake)
    await capture.start()
    expect(fake.sent).toEqual(['Runtime.enable'])
    expect(capture.active).toBe(true)

    fake.emit('Runtime.consoleAPICalled', {
      type: 'warning',
      timestamp: NOW + 123,
      args: [
        { type: 'string', value: 'hello' },
        {
          type: 'object',
          subtype: 'object',
          description: 'Object',
          preview: {
            description: 'Object',
            properties: [
              { name: 'a', type: 'number', value: 1 },
              { name: 'b', type: 'string', value: 'x' },
            ],
          },
        },
      ],
      stackTrace: {
        callFrames: [
          {
            url: 'http://127.0.0.1:4320/app.js?token=secret',
            lineNumber: 9,
            columnNumber: 4,
          },
        ],
      },
    })
    fake.emit('Runtime.exceptionThrown', {
      timestamp: NOW + 200,
      exceptionDetails: {
        text: 'Uncaught',
        exception: { type: 'object', subtype: 'error', description: 'Error: boom' },
        url: 'http://127.0.0.1:4320/broken.js',
        lineNumber: 0,
        columnNumber: 2,
      },
    })

    const snapshot = capture.snapshot()
    expect(snapshot.lastSeq).toBe(2)
    expect(snapshot.dropped).toBe(0)
    expect(snapshot.entries).toHaveLength(2)
    expect(snapshot.entries[0]).toMatchObject({
      id: 'console-1',
      level: 'warn',
      text: 'hello Object {a: 1, b: x}',
      timestamp: new Date(NOW + 123).toISOString(),
      source: {
        url: 'http://127.0.0.1:4320/app.js?token=REDACTED',
        line: 10,
        column: 5,
      },
    })
    expect(snapshot.entries[1]).toMatchObject({
      level: 'error',
      text: 'Uncaught: Error: boom',
      source: {
        url: 'http://127.0.0.1:4320/broken.js',
        line: 1,
        column: 3,
      },
    })

    await capture.stop()
    expect(capture.active).toBe(false)
    expect(fake.listenerCount()).toBe(0)
    expect(fake.detached).toBe(true)
  })

  it('strips control characters and truncates each message', async () => {
    const fake = fakePage()
    const capture = collector(fake, { maxTextBytes: 64 })
    await capture.start()

    fake.emit('Runtime.consoleAPICalled', {
      type: 'log',
      timestamp: NOW,
      args: [{ type: 'string', value: `\u001b[31mred\u001b[0m\u0000 ${'汉'.repeat(80)}` }],
    })

    const [entry] = capture.snapshot().entries
    expect(entry.text.startsWith('red ')).toBe(true)
    expect(entry.text).not.toContain('\u001b')
    expect(entry.text).not.toContain('\u0000')
    expect(Buffer.byteLength(entry.text, 'utf8')).toBeLessThanOrEqual(64)
    expect(entry.text.endsWith('…')).toBe(true)
    await capture.stop()
  })

  it('drops old entries at the cap but keeps sequence numbers monotonic', async () => {
    const fake = fakePage()
    const capture = collector(fake, { maxEntries: 3 })
    await capture.start()

    for (let index = 1; index <= 5; index += 1) {
      fake.emit('Runtime.consoleAPICalled', {
        type: 'info',
        timestamp: NOW,
        args: [{ type: 'string', value: `entry-${index}` }],
      })
    }

    const snapshot = capture.snapshot()
    expect(snapshot.lastSeq).toBe(5)
    expect(snapshot.dropped).toBe(2)
    expect(snapshot.entries.map((entry) => entry.id)).toEqual([
      'console-3',
      'console-4',
      'console-5',
    ])
    expect(capture.snapshot({ after: 4 }).entries.map((entry) => entry.id)).toEqual(['console-5'])
    expect(capture.snapshot({ limit: 1 }).entries.map((entry) => entry.id)).toEqual(['console-5'])

    expect(capture.clear()).toEqual({ cleared: 3, lastSeq: 5 })
    expect(capture.snapshot().entries).toEqual([])
    expect(capture.snapshot().lastSeq).toBe(5)

    fake.emit('Runtime.consoleAPICalled', {
      type: 'error',
      timestamp: NOW,
      args: [{ type: 'string', value: 'after-clear' }],
    })
    expect(capture.snapshot().entries[0]).toMatchObject({ id: 'console-6', level: 'error' })
    await capture.stop()
  })

  it('ignores console.clear() and malformed events without storing them', async () => {
    const fake = fakePage()
    const capture = collector(fake)
    await capture.start()

    fake.emit('Runtime.consoleAPICalled', { type: 'clear', timestamp: NOW, args: [] })
    fake.emit('Runtime.consoleAPICalled', null)
    fake.emit('Runtime.exceptionThrown', { timestamp: NOW })

    expect(capture.snapshot().entries).toEqual([])
    expect(capture.stats()).toMatchObject({ received: 3, stored: 0, rejected: 3 })
    await capture.stop()
  })

  it('detaches and removes listeners when Runtime.enable fails', async () => {
    const fake = fakePage({ failEnable: true })
    const capture = collector(fake)

    await expect(capture.start()).rejects.toMatchObject({ code: 'preview_failed' })
    expect(capture.active).toBe(false)
    expect(fake.listenerCount()).toBe(0)
    expect(fake.detached).toBe(true)
  })
})

describe('console formatting helpers', () => {
  it('formats arrays and unserializable values', () => {
    expect(
      formatConsoleArgs([
        { type: 'number', unserializableValue: 'NaN' },
        {
          type: 'object',
          subtype: 'array',
          description: 'Array(2)',
          preview: {
            description: 'Array(2)',
            properties: [
              { name: '0', type: 'number', value: 1 },
              { name: '1', type: 'string', value: 'two' },
            ],
          },
        },
        { type: 'undefined' },
      ]),
    ).toBe('NaN [1, two] undefined')
  })

  it('normalizes line endings and strips ANSI', () => {
    expect(normalizeConsoleText('\u001b[1mhi\r\nthere\u0007')).toBe('hi\nthere')
  })
})
