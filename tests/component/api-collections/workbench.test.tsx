// @vitest-environment jsdom
/**
 * T044 acceptance: replay → Save → reopen the saved request costs three clicks.
 *
 * The replay click itself lives in the preview drawer (T043); this file starts
 * at the hand-off it performs and counts the two clicks the workbench adds.
 * Nothing is ever sent here — Save and reopen only touch `.vibe/api`, and the
 * fake Host proves that by counting its `add` calls.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiWorkbench } from '../../../src/client/api/ApiWorkbench'
import {
  resetApiCollectionStore,
  setApiCollectionApi,
} from '../../../src/client/api/collection-store'
import { resetDraftStore, openDraftInBuilder } from '../../../src/client/api/draft-store'
import { resetApiHistoryStore, setApiHistoryApi } from '../../../src/client/api/history-store'
import { TransportError } from '../../../src/client/transport'
import { createFakeCollections, createFakeHistory, spec } from './fakes'

const ITEMS = 'https://api.example.com/items'

beforeEach(() => {
  resetApiCollectionStore()
  resetApiHistoryStore()
  resetDraftStore()
})

afterEach(() => {
  cleanup()
})

function mountWorkbench() {
  const collections = createFakeCollections([])
  const history = createFakeHistory([])
  setApiCollectionApi(collections.api)
  setApiHistoryApi(history.api)
  const view = render(<ApiWorkbench />)
  const url = view.container.querySelector<HTMLInputElement>('[data-vibe-request-url="1"]')!
  return { collections, history, url, ...view }
}

/** The click T043's replay button performs once the Host returns a draft. */
function replayClick(): void {
  act(() => {
    openDraftInBuilder({
      spec: spec({ url: ITEMS }),
      source: 'replay',
      replay: {
        entryId: 'capture-1',
        method: 'GET',
        url: ITEMS,
        result: {
          draft: spec({ url: ITEMS }),
          requiresConfirmation: false,
          omittedHeaders: [],
          warnings: [],
        },
      },
    })
  })
}

describe('ApiWorkbench acceptance', () => {
  it('replay → Save → reopen takes three clicks', async () => {
    const { collections, container, url } = mountWorkbench()
    await waitFor(() => expect(collections.list).toHaveBeenCalled())
    expect(url.value).toBe('')

    // Click 1 — replay in the preview drawer hands the draft over.
    replayClick()
    expect(url.value).toBe(ITEMS)
    expect(container.querySelector('[data-vibe-replay-notice="1"]')).not.toBeNull()

    // Click 2 — Save appends to the default collection, which expands by itself.
    fireEvent.click(container.querySelector('[data-vibe-save="1"]')!)
    await waitFor(() => expect(collections.add).toHaveBeenCalledTimes(1))
    expect(collections.add.mock.calls[0]![0]).toEqual({
      collectionId: 'saved',
      collectionName: 'Saved requests',
      name: 'GET /items',
      request: { method: 'GET', url: ITEMS },
    })
    expect(await screen.findByText('Saved.')).toBeDefined()

    const savedRow = await waitFor(() => {
      const row = container.querySelector<HTMLElement>('[data-vibe-saved-request="1"]')
      expect(row).not.toBeNull()
      return row!
    })
    expect(savedRow.textContent).toBe('GET /items')

    // The user changes the form, then Click 3 — reopen the saved row.
    fireEvent.change(url, { target: { value: 'https://api.example.com/other' } })
    fireEvent.click(savedRow)

    expect(url.value).toBe(ITEMS)
    expect(container.querySelector('[data-vibe-load-notice="1"]')?.textContent).toContain(
      'Loaded a saved request',
    )
    // Three clicks, one save, and still no send.
    expect(collections.add).toHaveBeenCalledTimes(1)
  })

  it('reports a failed save and keeps the draft on screen', async () => {
    const { collections, container, url } = mountWorkbench()
    await waitFor(() => expect(collections.list).toHaveBeenCalled())
    collections.add.mockRejectedValueOnce(new Error('vibe-studio: cannot write collection'))

    replayClick()
    fireEvent.click(container.querySelector('[data-vibe-save="1"]')!)

    expect(await screen.findByText('This request could not be saved.')).toBeDefined()
    expect(url.value).toBe(ITEMS)
    expect(container.querySelector('[data-vibe-save-status="1"]')).toBeNull()
  })

  it('explains a full collection instead of a generic save failure', async () => {
    const { collections, container } = mountWorkbench()
    await waitFor(() => expect(collections.list).toHaveBeenCalled())
    collections.add.mockRejectedValueOnce(
      new TransportError('invalid_input', 'vibe-studio: this collection is full', {
        details: { reason: 'collection_full', limit: 200 },
      }),
    )

    replayClick()
    fireEvent.click(container.querySelector('[data-vibe-save="1"]')!)

    expect(
      await screen.findByText('This collection is full; remove a request before saving another.'),
    ).toBeDefined()
  })
})
