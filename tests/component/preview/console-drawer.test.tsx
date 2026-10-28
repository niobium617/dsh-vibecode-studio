// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import {
  ConsoleDrawer,
  type ConsoleCounts,
  type ConsoleSource,
} from '../../../src/client/preview/ConsoleDrawer'
import type { ConsoleEntry } from '../../../src/contracts/telemetry'
import type {
  PreviewConsoleClearResult,
  PreviewConsoleQuery,
  PreviewConsoleSnapshot,
} from '../../../src/contracts/transport'

const POLL_MS = 500

function entry(id: number, level: ConsoleEntry['level'], text: string): ConsoleEntry {
  return {
    id: `console-${id}`,
    level,
    text,
    timestamp: '2026-10-27T00:00:00.000Z',
  }
}

function snapshot(
  entries: readonly ConsoleEntry[],
  lastSeq: number,
  dropped = 0,
): PreviewConsoleSnapshot {
  return { entries, lastSeq, dropped }
}

interface SetupOptions {
  readonly active?: boolean
  readonly visible?: boolean
  readonly list?: (query: PreviewConsoleQuery) => Promise<PreviewConsoleSnapshot>
  readonly clear?: () => Promise<PreviewConsoleClearResult>
  readonly onCountsChange?: (counts: ConsoleCounts) => void
}

function setup(initial: PreviewConsoleSnapshot, options: SetupOptions = {}) {
  const calls: PreviewConsoleQuery[] = []
  let current = initial
  const list = vi.fn(async (query: PreviewConsoleQuery) => {
    calls.push(query)
    return options.list ? options.list(query) : current
  })
  const clear = vi.fn(async () =>
    options.clear
      ? options.clear()
      : { cleared: current.entries.length, lastSeq: current.lastSeq },
  )
  const source: ConsoleSource = { list, clear }
  const view = render(
    <ConsoleDrawer
      active={options.active ?? true}
      source={source}
      pollMs={POLL_MS}
      visible={options.visible ?? true}
      onCountsChange={options.onCountsChange}
    />,
  )
  return {
    view,
    source,
    calls,
    list,
    clear,
    setSnapshot(next: PreviewConsoleSnapshot) {
      current = next
    },
  }
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function entryElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-vibe-console-entry="1"]'))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ConsoleDrawer', () => {
  it('polls incrementally and shows errors and warnings', async () => {
    const { view, calls, setSnapshot } = setup(
      snapshot([entry(1, 'error', 'boom'), entry(2, 'warn', 'careful'), entry(3, 'info', 'hi')], 3),
    )
    await settle()

    expect(calls).toEqual([{}])
    expect(view.getByText('Console · 1 errors · 1 warnings')).toBeTruthy()
    expect(entryElements(view.container)).toHaveLength(3)
    expect(view.getByText('boom')).toBeTruthy()
    expect(view.getByText('careful')).toBeTruthy()

    setSnapshot(snapshot([], 3))
    await advance(POLL_MS)
    expect(calls).toEqual([{}, { after: 3 }])
    // Nothing new arrived, so the existing rows stay.
    expect(entryElements(view.container)).toHaveLength(3)
  })

  it('merges only new entries and drops duplicate ids', async () => {
    const { view, setSnapshot } = setup(snapshot([entry(1, 'info', 'first')], 1))
    await settle()

    // A retried response may repeat the last entry; the drawer keeps one copy.
    setSnapshot(snapshot([entry(1, 'info', 'first'), entry(2, 'error', 'second')], 2))
    await advance(POLL_MS)

    const rows = entryElements(view.container)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.textContent).toContain('first')
    expect(rows[1]?.textContent).toContain('second')
  })

  it('filters by level without changing the counts', async () => {
    const { view } = setup(
      snapshot(
        [
          entry(1, 'error', 'boom'),
          entry(2, 'warn', 'careful'),
          entry(3, 'info', 'hi'),
          entry(4, 'debug', 'trace'),
        ],
        4,
      ),
    )
    await settle()

    fireEvent.click(view.getByRole('button', { name: 'Errors (1)' }))
    expect(entryElements(view.container).map((row) => row.dataset.level)).toEqual(['error'])

    fireEvent.click(view.getByRole('button', { name: 'Warnings (1)' }))
    expect(entryElements(view.container).map((row) => row.dataset.level)).toEqual(['warn'])

    fireEvent.click(view.getByRole('button', { name: 'Info (2)' }))
    expect(entryElements(view.container).map((row) => row.dataset.level)).toEqual([
      'info',
      'debug',
    ])

    fireEvent.click(view.getByRole('button', { name: 'All (4)' }))
    expect(entryElements(view.container)).toHaveLength(4)
  })

  it('clears both the Host buffer and the local list', async () => {
    const { view, calls, clear, setSnapshot } = setup(
      snapshot([entry(1, 'error', 'boom'), entry(2, 'warn', 'careful')], 2),
    )
    await settle()

    fireEvent.click(view.getByRole('button', { name: 'Clear' }))
    await settle()

    expect(clear).toHaveBeenCalledTimes(1)
    expect(entryElements(view.container)).toHaveLength(0)
    expect(view.getByText('Console · 0 errors · 0 warnings')).toBeTruthy()
    expect(
      view.getByText('No messages yet. Interact with the preview and entries appear automatically.'),
    ).toBeTruthy()

    // The next poll resumes from the sequence the Host reported.
    setSnapshot(snapshot([], 2))
    await advance(POLL_MS)
    expect(calls.at(-1)).toEqual({ after: 2 })
    expect(entryElements(view.container)).toHaveLength(0)
  })

  it('ignores a poll response that arrives after clear', async () => {
    let resolvePending: ((value: PreviewConsoleSnapshot) => void) | undefined
    let pending = false
    const { view, calls, clear } = setup(snapshot([entry(1, 'error', 'stale')], 1), {
      list: () =>
        pending
          ? new Promise<PreviewConsoleSnapshot>((resolve) => {
              resolvePending = resolve
            })
          : Promise.resolve(snapshot([entry(1, 'error', 'stale')], 1)),
      clear: async () => ({ cleared: 1, lastSeq: 6 }),
    })
    await settle()

    pending = true
    await advance(POLL_MS)
    expect(calls.at(-1)).toEqual({ after: 1 })

    fireEvent.click(view.getByRole('button', { name: 'Clear' }))
    await settle()
    expect(clear).toHaveBeenCalledTimes(1)
    expect(entryElements(view.container)).toHaveLength(0)

    // The response was requested before clear; it must not repopulate the log.
    resolvePending?.(snapshot([entry(1, 'error', 'stale')], 1))
    await settle()
    expect(entryElements(view.container)).toHaveLength(0)
  })

  it('does not poll while inactive', async () => {
    const { list, view } = setup(snapshot([entry(1, 'error', 'boom')], 1), { active: false })
    await settle()
    await advance(POLL_MS * 3)

    expect(list).not.toHaveBeenCalled()
    expect(view.getByText('Console · 0 errors · 0 warnings')).toBeTruthy()
  })

  it('reports Host failures without dropping already drawn entries', async () => {
    let failing = false
    const initial = snapshot([entry(1, 'error', 'boom')], 1)
    const { view } = setup(initial, {
      list: () =>
        failing
          ? Promise.reject(new Error('preview is not running'))
          : Promise.resolve(initial),
    })
    await settle()
    expect(entryElements(view.container)).toHaveLength(1)

    failing = true
    await advance(POLL_MS)

    expect(entryElements(view.container)).toHaveLength(1)
    expect(view.getByRole('status').textContent).toContain('preview is not running')
  })

  it('renders the entry source as plain text', async () => {
    const { view } = setup(
      snapshot(
        [
          {
            ...entry(1, 'error', 'boom'),
            source: { url: 'http://127.0.0.1:4320/a.js?token=REDACTED', line: 3, column: 9 },
          },
        ],
        1,
      ),
    )
    await settle()

    expect(view.getByText('http://127.0.0.1:4320/a.js?token=REDACTED:3:9')).toBeTruthy()
  })

  it('stays hidden but keeps counting while another tab is selected', async () => {
    const counts: ConsoleCounts[] = []
    const { view } = setup(
      snapshot([entry(1, 'error', 'boom'), entry(2, 'info', 'hi')], 2),
      { visible: false, onCountsChange: (value) => counts.push(value) },
    )
    await settle()

    const root = view.container.querySelector<HTMLElement>('#vibe-console-drawer')
    expect(root?.style.display).toBe('none')
    expect(counts.at(-1)).toEqual({ total: 2, errors: 1, warnings: 0, info: 1 })
  })

  it('hides its own close affordance only when no handler is given', async () => {
    const { view } = setup(snapshot([], 0))
    await settle()
    expect(view.queryByRole('button', { name: 'Close drawer' })).toBeNull()
  })
})
