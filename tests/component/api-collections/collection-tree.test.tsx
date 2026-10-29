// @vitest-environment jsdom
/**
 * T044 collection tree against a fake Host: summaries load on mount, expanding
 * reads that one collection, a saved request only refills the builder (never
 * sends), and deleting a collection asks twice. The tree is mounted beside a
 * real builder so the hand-off is asserted where the user sees it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CollectionTree } from '../../../src/client/api/CollectionTree'
import { RequestBuilder } from '../../../src/client/api/RequestBuilder'
import {
  resetApiCollectionStore,
  setApiCollectionApi,
} from '../../../src/client/api/collection-store'
import { resetDraftStore } from '../../../src/client/api/draft-store'
import type { ApiCollection } from '../../../src/contracts/api'
import { createFakeCollections, spec } from './fakes'

const WEATHER: ApiCollection = {
  id: 'weather',
  name: 'Weather',
  requests: [{ id: 'list-items', name: 'List items', request: spec() }],
  folders: [
    {
      id: 'write',
      name: 'Write',
      requests: [{ id: 'create-item', name: 'Create item', request: spec({ method: 'POST' }) }],
    },
  ],
}

beforeEach(() => {
  resetApiCollectionStore()
  resetDraftStore()
})

afterEach(() => {
  cleanup()
})

function mount(collection: ApiCollection = WEATHER) {
  const fake = createFakeCollections([collection])
  setApiCollectionApi(fake.api)
  return { fake, ...render(<CollectionTree />) }
}

describe('CollectionTree list', () => {
  it('shows the empty state when nothing is stored', async () => {
    const fake = createFakeCollections([])
    setApiCollectionApi(fake.api)
    render(<CollectionTree />)

    expect(await screen.findByText('No saved requests yet')).toBeDefined()
    expect(fake.list).toHaveBeenCalledTimes(1)
  })

  it('shows summaries with counts and reads one collection only when expanded', async () => {
    const { fake, container } = mount()

    expect(await screen.findByText('Weather')).toBeDefined()
    expect(screen.getByText('2 requests')).toBeDefined()
    expect(container.querySelector('[data-vibe-collections-count="1"]')?.textContent).toBe('1')
    expect(fake.read).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Weather'))

    expect(await screen.findByText('List items')).toBeDefined()
    expect(screen.getByText('Create item')).toBeDefined()
    expect(screen.getByText('Write')).toBeDefined()
    expect(fake.read).toHaveBeenCalledWith('weather')

    fireEvent.click(screen.getByText('Weather'))
    await waitFor(() => expect(screen.queryByText('List items')).toBeNull())
  })

  it('reports unreadable collection files without hiding the readable ones', async () => {
    const fake = createFakeCollections([WEATHER], { skipped: 2 })
    setApiCollectionApi(fake.api)
    render(<CollectionTree />)

    expect(await screen.findByText('Weather')).toBeDefined()
    expect(screen.getByText('2 collection files could not be read.')).toBeDefined()
  })

  it('shows an error state and retries', async () => {
    const fake = createFakeCollections([WEATHER], { failList: true })
    setApiCollectionApi(fake.api)
    render(<CollectionTree />)

    expect(await screen.findByText('Collections unavailable')).toBeDefined()

    fake.options.failList = false
    fireEvent.click(screen.getByText('Retry'))

    expect(await screen.findByText('Weather')).toBeDefined()
    expect(screen.queryByText('Collections unavailable')).toBeNull()
  })

  it('renders Chinese labels', async () => {
    const fake = createFakeCollections([])
    setApiCollectionApi(fake.api)
    render(<CollectionTree locale="zh-CN" />)

    expect(await screen.findByText('还没有保存的请求')).toBeDefined()
    expect(screen.getByText('集合')).toBeDefined()
  })
})

describe('CollectionTree open', () => {
  it('loads a saved request into the builder without sending it', async () => {
    const { container, fake } = (() => {
      const fake = createFakeCollections([WEATHER])
      setApiCollectionApi(fake.api)
      return { fake, ...render(<><RequestBuilder /><CollectionTree /></>) }
    })()

    fireEvent.click(await screen.findByText('Weather'))
    fireEvent.click(await screen.findByText('Create item'))

    const url = container.querySelector<HTMLInputElement>('[data-vibe-request-url="1"]')!
    const method = container.querySelector<HTMLSelectElement>('[data-vibe-request-method="1"]')!
    expect(url.value).toBe('https://api.example.com/items')
    expect(method.value).toBe('POST')
    expect(container.querySelector('[data-vibe-load-notice="1"]')?.textContent).toContain(
      'Loaded a saved request',
    )
    // Loading a draft is not a send: the fake Host saw a read, not an execution.
    expect(fake.read).toHaveBeenCalledWith('weather')
  })
})

describe('CollectionTree delete', () => {
  it('asks for a second click and explains what is deleted', async () => {
    const { fake, container } = mount()
    await screen.findByText('Weather')

    fireEvent.click(container.querySelector('[data-vibe-collection-delete="1"]')!)

    const dialog = container.querySelector('[data-vibe-collection-confirm="1"]')!
    expect(dialog).not.toBeNull()
    expect(dialog.textContent).toContain('Delete this collection?')
    expect(dialog.textContent).toContain('Weather')

    fireEvent.click(container.querySelector('[data-vibe-collection-cancel="1"]')!)
    expect(container.querySelector('[data-vibe-collection-confirm="1"]')).toBeNull()
    expect(fake.remove).not.toHaveBeenCalled()

    fireEvent.click(container.querySelector('[data-vibe-collection-delete="1"]')!)
    fireEvent.click(container.querySelector('[data-vibe-collection-confirm-delete="1"]')!)

    await waitFor(() => expect(fake.remove).toHaveBeenCalledWith('weather'))
    expect(await screen.findByText('No saved requests yet')).toBeDefined()
    expect(container.querySelector('[data-vibe-collection-confirm="1"]')).toBeNull()
  })

  it('keeps the dialog open and reports a failed delete', async () => {
    const fake = createFakeCollections([WEATHER], { failRemove: true })
    setApiCollectionApi(fake.api)
    const { container } = render(<CollectionTree />)
    await screen.findByText('Weather')

    fireEvent.click(container.querySelector('[data-vibe-collection-delete="1"]')!)
    fireEvent.click(container.querySelector('[data-vibe-collection-confirm-delete="1"]')!)

    expect(await screen.findByText('The collection could not be deleted.')).toBeDefined()
    expect(container.querySelector('[data-vibe-collection-confirm="1"]')).not.toBeNull()
    expect(screen.getByText('Weather')).toBeDefined()
  })
})
