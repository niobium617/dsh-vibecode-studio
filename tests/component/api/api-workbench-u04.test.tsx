// @vitest-environment jsdom
/**
 * U04 review layout: one core row, the response underneath, everything else
 * folded. Beginner is the default, the choice is remembered, and the loopback
 * sample URL fills only an untouched empty request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ApiWorkbench } from '../../../src/client/api/ApiWorkbench'
import { resetApiCollectionStore, setApiCollectionApi } from '../../../src/client/api/collection-store'
import { openDraftInBuilder, resetDraftStore } from '../../../src/client/api/draft-store'
import { resetApiEnvironmentStore } from '../../../src/client/api/environment-store'
import { resetApiHistoryStore, setApiHistoryApi } from '../../../src/client/api/history-store'
import { API_UI_MODE_STORAGE_KEY } from '../../../src/client/api/ui-mode'
import { createFakeCollections, createFakeHistory, spec } from '../api-collections/fakes'

const SAMPLE = { url: 'http://127.0.0.1:4325/sample', method: 'GET' as const }

function stubTransport(value: unknown = SAMPLE): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: unknown, _init?: RequestInit) => {
      return new Response(JSON.stringify({ ok: true, value }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }),
  )
}

function mount() {
  setApiCollectionApi(createFakeCollections([]).api)
  setApiHistoryApi(createFakeHistory([]).api)
  const view = render(<ApiWorkbench />)
  const url = view.container.querySelector<HTMLInputElement>('[data-vibe-request-url="1"]')!
  return { url, ...view }
}

beforeEach(() => {
  resetApiCollectionStore()
  resetApiHistoryStore()
  resetApiEnvironmentStore()
  resetDraftStore()
  window.localStorage.clear()
  stubTransport()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ApiWorkbench U04 layout', () => {
  it('opens in beginner mode with cURL and result checks folded away', () => {
    const { container } = mount()
    expect(
      container.querySelector('[data-vibe-mode="beginner"]')?.getAttribute('aria-pressed'),
    ).toBe('true')
    expect(container.querySelector('[data-vibe-curl="1"]')).toBeNull()
    expect(container.querySelector('[data-vibe-assertions="1"]')).toBeNull()
    expect(container.querySelector('[data-vibe-more-config="1"]')).not.toBeNull()
    expect(container.querySelector('[data-vibe-response-area="1"]')).not.toBeNull()
  })

  it('remembers the professional choice across mounts', () => {
    const first = mount()
    fireEvent.click(first.container.querySelector('[data-vibe-mode="pro"]')!)
    expect(first.container.querySelector('[data-vibe-curl="1"]')).not.toBeNull()
    expect(first.container.querySelector('[data-vibe-assertions="1"]')).not.toBeNull()
    expect(window.localStorage.getItem(API_UI_MODE_STORAGE_KEY)).toBe('pro')
    cleanup()

    const second = mount()
    expect(
      second.container.querySelector('[data-vibe-mode="pro"]')?.getAttribute('aria-pressed'),
    ).toBe('true')
    expect(second.container.querySelector('[data-vibe-curl="1"]')).not.toBeNull()
  })

  it('keeps secondary panels in a closed drawer until asked', () => {
    const { container } = mount()
    const drawer = container.querySelector<HTMLElement>('[data-vibe-drawer="1"]')!
    expect(drawer.style.display).toBe('none')
    expect(drawer.textContent).toContain('Saved requests')
    expect(drawer.textContent).toContain('History')
    expect(drawer.textContent).toContain('Environment')

    fireEvent.click(container.querySelector('[data-vibe-tools-toggle="1"]')!)
    expect(drawer.style.display).not.toBe('none')
    fireEvent.click(container.querySelector('[data-vibe-drawer-close="1"]')!)
    expect(drawer.style.display).toBe('none')
  })

  it('fills an untouched URL with the loopback sample', async () => {
    const { container, url } = mount()
    await waitFor(() => expect(url.value).toBe(SAMPLE.url))
    expect(container.querySelector('[data-vibe-response-empty="1"]')?.textContent).toContain(
      'Press Send',
    )
  })

  it('never overwrites a URL that was already handed to the form', () => {
    const { url } = mount()
    act(() => {
      openDraftInBuilder({ spec: spec({ url: 'https://api.example.com/items' }), source: 'collection' })
    })
    expect(url.value).toBe('https://api.example.com/items')
    expect(screen.getByText('Loaded a saved request. Nothing is sent until you press Send.')).toBeTruthy()
  })
})
