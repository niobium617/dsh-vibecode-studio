// @vitest-environment jsdom
/**
 * T044 send log against a fake Host: newest-first rows, host-side search, open
 * into the builder (never a resend), and a two-click clear. Secrets were
 * redacted when the row was stored, so opening only refills the form.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { HistoryList } from '../../../src/client/api/HistoryList'
import { RequestBuilder } from '../../../src/client/api/RequestBuilder'
import { resetDraftStore } from '../../../src/client/api/draft-store'
import {
  resetApiHistoryStore,
  setApiHistoryApi,
  setApiHistoryLimit,
} from '../../../src/client/api/history-store'
import { resetApiCollectionStore } from '../../../src/client/api/collection-store'
import { createFakeHistory, historyEntry, spec, type FakeHistoryOptions } from './fakes'
import type { ApiHistoryEntry } from '../../../src/contracts/api'

const ITEMS = historyEntry({ id: 'entry-items', url: 'https://api.example.com/items' })
const USERS = historyEntry({
  id: 'entry-users',
  method: 'POST',
  url: 'https://api.example.com/users',
  status: 201,
  elapsedMs: 40,
  request: spec({ method: 'POST', url: 'https://api.example.com/users' }),
})

beforeEach(() => {
  resetApiHistoryStore()
  resetApiCollectionStore()
  resetDraftStore()
})

afterEach(() => {
  cleanup()
})

function mount(
  entries: readonly ApiHistoryEntry[] = [USERS, ITEMS],
  options: FakeHistoryOptions = {},
) {
  const fake = createFakeHistory(entries, options)
  setApiHistoryApi(fake.api)
  return { fake, ...render(<HistoryList />) }
}

describe('HistoryList rows', () => {
  it('shows the empty state before the first send', async () => {
    const fake = createFakeHistory([])
    setApiHistoryApi(fake.api)
    render(<HistoryList />)

    expect(await screen.findByText('Nothing sent yet')).toBeDefined()
    // No clear button when there is nothing to clear.
    expect(screen.queryByText('Clear history')).toBeNull()
  })

  it('renders newest-first rows with status and elapsed time', async () => {
    const { container, fake } = mount()

    expect(await screen.findByText('POST')).toBeDefined()
    const rows = container.querySelectorAll('[data-vibe-send-history-item]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.getAttribute('data-vibe-send-history-item')).toBe('entry-users')
    expect(rows[1]!.getAttribute('data-vibe-send-history-item')).toBe('entry-items')
    expect(rows[0]!.textContent).toContain('https://api.example.com/users')
    expect(rows[0]!.textContent).toContain('201 · 40 ms')
    expect(container.querySelector('[data-vibe-send-history-count="1"]')?.textContent).toBe('2')
    // One page is asked for explicitly, 50 rows by default.
    expect(fake.list).toHaveBeenCalledWith({ limit: 50 })
  })

  it('says how many older rows are not shown', async () => {
    const fake = createFakeHistory([ITEMS, USERS], { pageLimit: 1 })
    setApiHistoryApi(fake.api)
    render(<HistoryList />)

    expect(await screen.findByText('1 older requests not shown.')).toBeDefined()
  })

  it('reports unreadable rows without failing the page', async () => {
    const fake = createFakeHistory([ITEMS], { skipped: 3 })
    setApiHistoryApi(fake.api)
    render(<HistoryList />)

    expect(await screen.findByText('https://api.example.com/items')).toBeDefined()
    expect(screen.getByText('3 history rows could not be read.')).toBeDefined()
  })

  it('shows an error state and retries', async () => {
    const fake = createFakeHistory([ITEMS], { failList: true })
    setApiHistoryApi(fake.api)
    render(<HistoryList />)

    expect(await screen.findByText('History unavailable')).toBeDefined()

    fake.options.failList = false
    fireEvent.click(screen.getByText('Retry'))

    expect(await screen.findByText('https://api.example.com/items')).toBeDefined()
    expect(screen.queryByText('History unavailable')).toBeNull()
  })

  it('renders Chinese labels', async () => {
    const fake = createFakeHistory([])
    setApiHistoryApi(fake.api)
    render(<HistoryList locale="zh-CN" />)

    expect(await screen.findByText('还没发送过')).toBeDefined()
    expect(screen.getByLabelText('搜索历史')).toBeDefined()
    expect(screen.getByLabelText('显示条数')).toBeDefined()
  })
})

describe('HistoryList page size', () => {
  it('asks for 50 rows by default and keeps the search when the size changes', async () => {
    const { fake, container } = mount([ITEMS])
    await screen.findByText('https://api.example.com/items')

    const select = container.querySelector<HTMLSelectElement>('[data-vibe-send-history-limit="1"]')!
    expect(select.value).toBe('50')
    expect([...select.options].map((option) => option.value)).toEqual(['50', '100', '200'])

    fireEvent.change(screen.getByLabelText('Search history'), { target: { value: 'items' } })
    await waitFor(() => expect(fake.list).toHaveBeenLastCalledWith({ query: 'items', limit: 50 }))

    fireEvent.change(select, { target: { value: '200' } })
    await waitFor(() => expect(fake.list).toHaveBeenLastCalledWith({ query: 'items', limit: 200 }))
    expect(select.value).toBe('200')
  })

  it('shows more rows after raising the page size', async () => {
    const many = Array.from({ length: 60 }, (_, index) =>
      historyEntry({ id: `entry-${index}`, url: `https://api.example.com/items/${index}` }),
    )
    const { container } = mount(many)
    await screen.findByText('https://api.example.com/items/0')

    expect(container.querySelectorAll('[data-vibe-send-history-item]')).toHaveLength(50)
    expect(screen.getByText('10 older requests not shown.')).toBeDefined()

    fireEvent.change(container.querySelector('[data-vibe-send-history-limit="1"]')!, {
      target: { value: '200' },
    })

    await waitFor(() =>
      expect(container.querySelectorAll('[data-vibe-send-history-item]')).toHaveLength(60),
    )
    expect(screen.queryByText(/older requests not shown/)).toBeNull()
  })

  it('caps the page at 200 rows', async () => {
    const fake = createFakeHistory([ITEMS])
    setApiHistoryApi(fake.api)
    setApiHistoryLimit(500)
    const { container } = render(<HistoryList />)
    await screen.findByText('https://api.example.com/items')

    expect(fake.list).toHaveBeenLastCalledWith({ limit: 200 })
    expect(
      container.querySelector<HTMLSelectElement>('[data-vibe-send-history-limit="1"]')!.value,
    ).toBe('200')
  })
})

describe('HistoryList search', () => {
  it('searches host-side and offers to clear a search with no matches', async () => {
    const { fake } = mount()
    await screen.findByText('https://api.example.com/items')
    expect(fake.list).toHaveBeenCalledTimes(1)

    const input = screen.getByLabelText('Search history') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'users' } })

    await waitFor(() => expect(fake.list).toHaveBeenLastCalledWith({ query: 'users', limit: 50 }))
    await waitFor(() =>
      expect(screen.queryByText('https://api.example.com/items')).toBeNull(),
    )
    expect(screen.getByText('https://api.example.com/users')).toBeDefined()

    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(await screen.findByText('No matching requests')).toBeDefined()

    fireEvent.click(screen.getByText('Clear search'))

    expect(await screen.findByText('https://api.example.com/items')).toBeDefined()
    expect(input.value).toBe('')
    expect(fake.list).toHaveBeenLastCalledWith({ limit: 50 })
  })
})

describe('HistoryList open', () => {
  it('refills the builder from a row without resending', async () => {
    const fake = createFakeHistory([USERS])
    setApiHistoryApi(fake.api)
    const { container } = render(<><RequestBuilder /><HistoryList /></>)

    const open = await screen.findByText('Open')
    fireEvent.click(open)

    const url = container.querySelector<HTMLInputElement>('[data-vibe-request-url="1"]')!
    const method = container.querySelector<HTMLSelectElement>('[data-vibe-request-method="1"]')!
    expect(url.value).toBe('https://api.example.com/users')
    expect(method.value).toBe('POST')
    expect(container.querySelector('[data-vibe-load-notice="1"]')?.textContent).toContain(
      'Loaded a request from history',
    )
    // Opening is a read: the fake Host logged no extra row.
    expect(fake.entries).toHaveLength(1)
  })
})

describe('HistoryList clear', () => {
  it('asks before clearing and empties the log afterwards', async () => {
    const { fake, container } = mount()
    await screen.findByText('https://api.example.com/items')

    fireEvent.click(screen.getByText('Clear history'))

    const dialog = container.querySelector('[data-vibe-send-history-confirm="1"]')!
    expect(dialog.textContent).toContain('Clear the send log?')
    expect(dialog.textContent).toContain('Saved collections are not affected.')

    fireEvent.click(container.querySelector('[data-vibe-send-history-cancel="1"]')!)
    expect(container.querySelector('[data-vibe-send-history-confirm="1"]')).toBeNull()
    expect(fake.clear).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Clear history'))
    fireEvent.click(container.querySelector('[data-vibe-send-history-confirm-clear="1"]')!)

    await waitFor(() => expect(fake.clear).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Nothing sent yet')).toBeDefined()
    expect(container.querySelector('[data-vibe-send-history-confirm="1"]')).toBeNull()
  })

  it('keeps the dialog open and reports a failed clear', async () => {
    const fake = createFakeHistory([ITEMS], { failClear: true })
    setApiHistoryApi(fake.api)
    const { container } = render(<HistoryList />)
    await screen.findByText('https://api.example.com/items')

    fireEvent.click(screen.getByText('Clear history'))
    fireEvent.click(container.querySelector('[data-vibe-send-history-confirm-clear="1"]')!)

    expect(await screen.findByText('The history could not be cleared.')).toBeDefined()
    expect(container.querySelector('[data-vibe-send-history-confirm="1"]')).not.toBeNull()
    expect(screen.getByText('https://api.example.com/items')).toBeDefined()
  })
})
