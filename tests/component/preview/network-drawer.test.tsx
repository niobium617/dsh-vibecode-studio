// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import {
  NetworkDrawer,
  type NetworkCounts,
  type NetworkSource,
} from '../../../src/client/preview/NetworkDrawer'
import type { DrawerFocus } from '../../../src/client/preview/focus'
import type { NetworkEntry } from '../../../src/contracts/telemetry'
import type {
  PreviewNetworkBody,
  PreviewNetworkClearResult,
  PreviewNetworkQuery,
  PreviewNetworkSnapshot,
} from '../../../src/contracts/transport'

const POLL_MS = 500

function entry(overrides: Partial<NetworkEntry> & Pick<NetworkEntry, 'id'>): NetworkEntry {
  return {
    method: 'GET',
    url: `http://127.0.0.1:4320/api/${overrides.id}`,
    status: 200,
    outcome: 'success',
    resourceType: 'Fetch',
    startedAt: '2026-10-27T10:20:30.000Z',
    durationMs: 42,
    ...overrides,
  }
}

const OK_ENTRY = entry({ id: 'network-1', url: 'http://127.0.0.1:4320/api/echo' })
const BAD_ENTRY = entry({
  id: 'network-2',
  method: 'POST',
  url: 'http://127.0.0.1:4320/api/boom?token=REDACTED',
  status: 500,
  outcome: 'error',
  resourceType: 'XHR',
  durationMs: 7,
  requestHeaders: { authorization: 'REDACTED', 'content-type': 'application/json' },
  responseHeaders: { 'set-cookie': 'REDACTED', 'content-type': 'application/json' },
})
const PENDING_ENTRY = entry({
  id: 'network-3',
  url: 'http://127.0.0.1:4320/api/slow',
  status: null,
  outcome: 'pending',
  durationMs: null,
})

function snapshot(
  entries: readonly NetworkEntry[],
  lastSeq: number,
  dropped = 0,
): PreviewNetworkSnapshot {
  return { entries, lastSeq, dropped }
}

const BODY: PreviewNetworkBody = {
  id: 'network-1',
  status: 200,
  mimeType: 'application/json',
  body: '{"ok":true}',
  base64Encoded: false,
  truncated: false,
  bytes: 11,
}

interface SetupOptions {
  readonly active?: boolean
  readonly visible?: boolean
  readonly onCountsChange?: (counts: NetworkCounts) => void
  readonly list?: (query: PreviewNetworkQuery) => Promise<PreviewNetworkSnapshot>
  readonly clear?: () => Promise<PreviewNetworkClearResult>
  readonly body?: (id: string) => Promise<PreviewNetworkBody>
}

function setup(initial: PreviewNetworkSnapshot, options: SetupOptions = {}) {
  const calls: PreviewNetworkQuery[] = []
  const bodyCalls: string[] = []
  let current = initial
  const list = vi.fn(async (query: PreviewNetworkQuery) => {
    calls.push(query)
    return options.list ? options.list(query) : current
  })
  const clear = vi.fn(async () =>
    options.clear
      ? options.clear()
      : { cleared: current.entries.length, lastSeq: current.lastSeq },
  )
  const body = vi.fn(async (id: string) => {
    bodyCalls.push(id)
    return options.body ? options.body(id) : BODY
  })
  const source: NetworkSource = { list, clear, body }
  const view = render(
    <NetworkDrawer
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
    bodyCalls,
    list,
    clear,
    body,
    setSnapshot(next: PreviewNetworkSnapshot) {
      current = next
    },
    /** T056: swap the shared `focus` prop without remounting the drawer. */
    rerender(next: { focus?: DrawerFocus | null; visible?: boolean } = {}) {
      view.rerender(
        <NetworkDrawer
          active={options.active ?? true}
          source={source}
          pollMs={POLL_MS}
          visible={next.visible ?? options.visible ?? true}
          focus={next.focus ?? null}
          onCountsChange={options.onCountsChange}
        />,
      )
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

function rowElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-vibe-network-entry="1"]'))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('NetworkDrawer', () => {
  it('polls incrementally and shows method, URL, status and time', async () => {
    const { view, calls } = setup(snapshot([OK_ENTRY, BAD_ENTRY, PENDING_ENTRY], 3))
    await settle()

    expect(calls).toEqual([{}])
    expect(view.getByText('Network · 3 requests · 1 failed')).toBeTruthy()

    const rows = rowElements(view.container)
    expect(rows).toHaveLength(3)
    expect(rows[0]?.textContent).toContain('GET')
    expect(rows[0]?.textContent).toContain('http://127.0.0.1:4320/api/echo')
    expect(rows[0]?.textContent).toContain('200')
    expect(rows[0]?.textContent).toContain('10:20:30')
    expect(rows[0]?.textContent).toContain('42 ms')
    expect(rows[0]?.dataset.error).toBeUndefined()

    // 4xx/5xx rows are marked for the UI (red status, failed filter).
    expect(rows[1]?.dataset.status).toBe('500')
    expect(rows[1]?.dataset.error).toBe('1')

    expect(rows[2]?.dataset.status).toBe('pending')
    expect(rows[2]?.textContent).toContain('pending')
  })

  it('filters to failed requests without changing the summary', async () => {
    const { view } = setup(snapshot([OK_ENTRY, BAD_ENTRY, PENDING_ENTRY], 3))
    await settle()

    fireEvent.click(view.getByRole('button', { name: 'Failed (1)' }))
    expect(rowElements(view.container).map((row) => row.dataset.status)).toEqual(['500'])
    expect(view.getByText('Network · 3 requests · 1 failed')).toBeTruthy()

    fireEvent.click(view.getByRole('button', { name: 'All (3)' }))
    expect(rowElements(view.container)).toHaveLength(3)
  })

  it('updates a pending row in place when its response arrives', async () => {
    const { view, calls, setSnapshot } = setup(snapshot([OK_ENTRY, PENDING_ENTRY], 2))
    await settle()
    expect(rowElements(view.container)).toHaveLength(2)
    expect(rowElements(view.container)[1]?.textContent).toContain('pending')

    setSnapshot(
      snapshot(
        [
          entry({
            id: 'network-3',
            url: 'http://127.0.0.1:4320/api/slow',
            status: 204,
            durationMs: 180,
          }),
        ],
        4,
      ),
    )
    await advance(POLL_MS)

    expect(calls).toEqual([{}, { after: 2 }])
    const rows = rowElements(view.container)
    expect(rows).toHaveLength(2)
    expect(rows[1]?.textContent).toContain('204')
    expect(rows[1]?.textContent).toContain('180 ms')
    expect(rows[1]?.dataset.status).toBe('204')
  })

  it('loads a response body on demand and caches it per row', async () => {
    const { view, bodyCalls } = setup(snapshot([OK_ENTRY, BAD_ENTRY], 2))
    await settle()

    fireEvent.click(view.getByRole('button', { name: /\/api\/echo/ }))
    await settle()

    expect(bodyCalls).toEqual(['network-1'])
    expect(view.getByText('{"ok":true}')).toBeTruthy()
    expect(view.container.querySelector('[data-vibe-network-header="request"]')).toBeNull()
    expect(view.getAllByText('No headers.')).toHaveLength(2)

    // Collapsing and reopening reuses the cached body.
    fireEvent.click(view.getByRole('button', { name: /\/api\/echo/ }))
    fireEvent.click(view.getByRole('button', { name: /\/api\/echo/ }))
    await settle()
    expect(bodyCalls).toEqual(['network-1'])
    expect(view.getByText('{"ok":true}')).toBeTruthy()
  })

  it('shows request and response headers as plain text with sensitive values redacted', async () => {
    const { view, bodyCalls } = setup(snapshot([BAD_ENTRY], 1))
    await settle()

    fireEvent.click(view.getByRole('button', { name: /\/api\/boom/ }))
    await settle()

    const requestHeaders = view.container.querySelector(
      '[data-vibe-network-header="request"]',
    )
    const responseHeaders = view.container.querySelector(
      '[data-vibe-network-header="response"]',
    )
    expect(requestHeaders?.textContent).toContain('authorization')
    expect(requestHeaders?.textContent).toContain('REDACTED')
    expect(requestHeaders?.textContent).toContain('content-type')
    expect(responseHeaders?.textContent).toContain('set-cookie')
    expect(responseHeaders?.textContent).toContain('REDACTED')
    expect(responseHeaders?.textContent).not.toContain('sid=')
    expect(bodyCalls).toEqual(['network-2'])
  })

  it('does not request a body for a pending request', async () => {
    const { view, bodyCalls } = setup(snapshot([PENDING_ENTRY], 1))
    await settle()

    fireEvent.click(view.getByRole('button', { name: /\/api\/slow/ }))
    await settle()

    expect(bodyCalls).toEqual([])
    expect(view.getByText('No response body.')).toBeTruthy()
  })

  it('shows the truncation and base64 notes for capped bodies', async () => {
    const { view } = setup(snapshot([OK_ENTRY], 1), {
      body: async () => ({
        ...BODY,
        body: 'aGVsbG8=',
        base64Encoded: true,
        truncated: true,
        bytes: 5,
      }),
    })
    await settle()
    fireEvent.click(view.getByRole('button', { name: /\/api\/echo/ }))
    await settle()

    expect(view.getByText('Body truncated.')).toBeTruthy()
    expect(view.getByText('base64 · 5 bytes')).toBeTruthy()
  })

  it('clears both the Host buffer and the local rows', async () => {
    const { view, calls, clear, setSnapshot } = setup(snapshot([OK_ENTRY, BAD_ENTRY], 2))
    await settle()

    fireEvent.click(view.getByRole('button', { name: 'Clear' }))
    await settle()

    expect(clear).toHaveBeenCalledTimes(1)
    expect(rowElements(view.container)).toHaveLength(0)
    expect(view.getByText('Network · 0 requests · 0 failed')).toBeTruthy()
    expect(
      view.getByText(
        'No requests yet. Interact with the preview and requests appear automatically.',
      ),
    ).toBeTruthy()

    setSnapshot(snapshot([], 2))
    await advance(POLL_MS)
    expect(calls.at(-1)).toEqual({ after: 2 })
  })

  it('does not poll while inactive', async () => {
    const { list, view } = setup(snapshot([OK_ENTRY], 1), { active: false })
    await settle()
    await advance(POLL_MS * 3)

    expect(list).not.toHaveBeenCalled()
    expect(view.getByText('Network · 0 requests · 0 failed')).toBeTruthy()
  })

  it('reports Host failures without dropping already drawn rows', async () => {
    let failing = false
    const initial = snapshot([OK_ENTRY], 1)
    const { view } = setup(initial, {
      list: () =>
        failing ? Promise.reject(new Error('preview is not running')) : Promise.resolve(initial),
    })
    await settle()
    expect(rowElements(view.container)).toHaveLength(1)

    failing = true
    await advance(POLL_MS)

    expect(rowElements(view.container)).toHaveLength(1)
    expect(view.getByRole('status').textContent).toContain('preview is not running')
  })

  it('stays hidden but keeps counting while another tab is selected', async () => {
    const counts: NetworkCounts[] = []
    const { view } = setup(snapshot([OK_ENTRY, BAD_ENTRY], 2), {
      visible: false,
      onCountsChange: (value) => counts.push(value),
    })
    await settle()

    const root = view.container.querySelector<HTMLElement>('#vibe-network-drawer')
    expect(root?.style.display).toBe('none')
    expect(counts.at(-1)).toEqual({ total: 2, failed: 1 })
  })

  it('hides its own close affordance only when no handler is given', async () => {
    const { view } = setup(snapshot([], 0))
    await settle()
    expect(view.queryByRole('button', { name: 'Close drawer' })).toBeNull()
  })

  it('reveals and highlights the evidence row once per focus (T056)', async () => {
    const { view, rerender } = setup(snapshot([OK_ENTRY, BAD_ENTRY], 2))
    await settle()

    const row = () =>
      view.container.querySelector<HTMLElement>('[data-entry-id="network-2"]')
    const scrollIntoView = vi.fn()
    if (row() !== null) row()!.scrollIntoView = scrollIntoView

    const focus: DrawerFocus = { id: 'network-2', nonce: 1 }
    await act(async () => rerender({ focus }))

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(row()?.style.background).not.toBe('')

    await act(async () => rerender({ focus }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    await advance(2000)
    expect(row()?.style.background).toBe('')
  })
})
