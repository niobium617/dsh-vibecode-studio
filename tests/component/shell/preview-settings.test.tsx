// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PreviewSessionSnapshot } from '../../../src/contracts/transport'
import {
  PreviewSettings,
  type PreviewSettingsApi,
} from '../../../src/client/shell/settings/PreviewSettings'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function snapshot(
  overrides: Partial<PreviewSessionSnapshot> = {},
): PreviewSessionSnapshot {
  return {
    status: 'ready',
    targetId: 'preview',
    kind: 'web',
    url: 'http://127.0.0.1:4320/',
    viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
    capabilities: {
      screencast: true,
      input: true,
      pick: false,
      sourceMap: false,
      console: true,
      network: true,
      screenshot: true,
    },
    frame: null,
    fps: 15,
    quality: 60,
    ...overrides,
  }
}

function fakeApi(
  initial: PreviewSessionSnapshot = snapshot(),
): PreviewSettingsApi & {
  status: ReturnType<typeof vi.fn>
  viewport: ReturnType<typeof vi.fn>
} {
  let current = initial
  return {
    status: vi.fn(async () => current),
    viewport: vi.fn(async (viewport: { width: number; height: number }) => {
      current = snapshot({
        viewport: { ...viewport, deviceScaleFactor: 1 },
      })
      return current
    }),
  } as PreviewSettingsApi & {
    status: ReturnType<typeof vi.fn>
    viewport: ReturnType<typeof vi.fn>
  }
}

function expand(): void {
  const details = document.querySelector<HTMLDetailsElement>('[data-settings-preview]')
  if (details === null) throw new Error('preview group missing')
  details.open = true
  fireEvent(details, new Event('toggle'))
}

describe('PreviewSettings (U01)', () => {
  it('stays collapsed without reading the Host', () => {
    const api = fakeApi()
    render(<PreviewSettings locale="en" api={api} />)

    expect(screen.getByText('Preview')).toBeTruthy()
    expect(api.status).not.toHaveBeenCalled()
  })

  it('loads the current viewport when opened', async () => {
    const api = fakeApi()
    render(<PreviewSettings locale="en" api={api} />)
    expand()

    await waitFor(() => expect(api.status).toHaveBeenCalledTimes(1))
    expect(await screen.findByLabelText('Preview viewport width')).toHaveProperty(
      'value',
      '800',
    )
    expect(screen.getByLabelText('Preview viewport height')).toHaveProperty('value', '600')
    expect(
      screen.getByRole('button', { name: 'Apply to preview' }),
    ).toHaveProperty('disabled', false)
  })

  it('applies a new size through the running session', async () => {
    const api = fakeApi()
    render(<PreviewSettings locale="en" api={api} />)
    expand()
    const width = await screen.findByLabelText('Preview viewport width')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apply to preview' })).toHaveProperty(
        'disabled',
        false,
      ),
    )

    fireEvent.change(width, { target: { value: '1024' } })
    fireEvent.change(screen.getByLabelText('Preview viewport height'), {
      target: { value: '768' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply to preview' }))

    await waitFor(() =>
      expect(api.viewport).toHaveBeenCalledWith({ width: 1024, height: 768 }),
    )
    expect(await screen.findByText('Applied to the running preview.')).toBeTruthy()
  })

  it('refuses out-of-range sizes without calling the Host', async () => {
    const api = fakeApi()
    render(<PreviewSettings locale="en" api={api} />)
    expand()

    const width = await screen.findByLabelText('Preview viewport width')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apply to preview' })).toHaveProperty(
        'disabled',
        false,
      ),
    )
    fireEvent.change(width, { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply to preview' }))

    expect(screen.getByText('Width and height must be 64–7680.')).toBeTruthy()
    expect(api.viewport).not.toHaveBeenCalled()
  })

  it('explains that a preview must be running first', async () => {
    const api = fakeApi(snapshot({ status: 'idle', url: null, viewport: null }))
    render(<PreviewSettings locale="en" api={api} />)
    expand()

    expect(await screen.findByText('Start a preview to change its viewport.')).toBeTruthy()
    expect(screen.getByLabelText('Preview viewport width')).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByRole('button', { name: 'Apply to preview' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('reports an unreachable Host instead of pretending it applied', async () => {
    const api = fakeApi()
    api.status.mockRejectedValue(new Error('preview is not running'))
    render(<PreviewSettings locale="en" api={api} />)
    expand()

    expect(
      await screen.findByText('Preview settings unavailable: preview is not running'),
    ).toBeTruthy()
  })
})
