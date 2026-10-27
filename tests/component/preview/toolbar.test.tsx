// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TargetCapabilities } from '../../../src/contracts/target'
import type { PreviewSessionSnapshot } from '../../../src/contracts/transport'
import { Toolbar, type ToolbarProps } from '../../../src/client/preview/Toolbar'

const CAPABILITIES: TargetCapabilities = {
  screencast: true,
  input: true,
  pick: false,
  sourceMap: false,
  console: true,
  network: true,
  screenshot: true,
}

function snapshot(overrides: Partial<PreviewSessionSnapshot> = {}): PreviewSessionSnapshot {
  return {
    status: 'ready',
    targetId: 'preview',
    kind: 'web',
    url: 'http://127.0.0.1:4320/',
    viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
    capabilities: CAPABILITIES,
    frame: null,
    fps: 15,
    quality: 60,
    ...overrides,
  }
}

function renderToolbar(overrides: Partial<ToolbarProps> = {}) {
  const handlers = {
    onKindChange: vi.fn(),
    onUrlChange: vi.fn(),
    onSubmit: vi.fn(),
    onStop: vi.fn(),
    onReload: vi.fn(),
    onViewportChange: vi.fn(),
    onOpenExternal: vi.fn(),
  }
  const props: ToolbarProps = {
    locale: 'en',
    snapshot: snapshot(),
    targets: [{ id: 'fake-target', kind: 'web' }],
    kind: 'web',
    url: 'http://127.0.0.1:4320/',
    busy: null,
    stats: null,
    ...handlers,
    ...overrides,
  }
  const view = render(<Toolbar {...props} />)
  return { ...view, handlers }
}

afterEach(() => {
  cleanup()
})

describe('preview toolbar (T025)', () => {
  it('starts from an idle session and disables live-only actions', () => {
    const { handlers } = renderToolbar({ snapshot: null })

    expect(screen.getByLabelText('Preview URL')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Open in browser' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('Viewport width')).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('submits the URL for navigation while live and offers live actions', () => {
    const { handlers } = renderToolbar()

    expect(screen.getByRole('button', { name: 'Go' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reload' })).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: 'Open in browser' })).toHaveProperty(
      'disabled',
      false,
    )
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveProperty('disabled', false)

    fireEvent.change(screen.getByLabelText('Preview URL'), {
      target: { value: 'http://localhost:5173/' },
    })
    expect(handlers.onUrlChange).toHaveBeenCalledWith('http://localhost:5173/')

    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(handlers.onReload).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(handlers.onStop).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }))
    expect(handlers.onOpenExternal).toHaveBeenCalledTimes(1)
  })

  it('applies a valid viewport and refuses out-of-range sizes', () => {
    const { handlers } = renderToolbar()
    const width = screen.getByLabelText('Viewport width') as HTMLInputElement
    const height = screen.getByLabelText('Viewport height') as HTMLInputElement

    expect(width.value).toBe('800')
    expect(height.value).toBe('600')

    fireEvent.change(width, { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(handlers.onViewportChange).toHaveBeenCalledWith({ width: 900, height: 600 })

    fireEvent.change(height, { target: { value: '10' } })
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveProperty('disabled', true)
    expect(screen.getByText('Width and height must be 64–7680.')).toBeTruthy()
  })

  it('only offers external open for loopback http(s) URLs', () => {
    renderToolbar({ snapshot: snapshot({ url: 'https://example.com/' }) })
    expect(screen.getByRole('button', { name: 'Open in browser' })).toHaveProperty(
      'disabled',
      true,
    )

    cleanup()
    renderToolbar({ snapshot: snapshot({ url: 'file:///C:/secret.html' }) })
    expect(screen.getByRole('button', { name: 'Open in browser' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('shows a failed session with actions disabled until restart completes', () => {
    renderToolbar({
      snapshot: snapshot({
        status: 'failed',
        lastError: {
          code: 'target_unavailable',
          message: 'preview target disconnected',
        },
      }),
    })

    expect(screen.getByText(/State:\s*Failed/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start' })).toHaveProperty('disabled', false)
    expect(screen.getByRole('button', { name: 'Reload' })).toHaveProperty('disabled', true)
  })
})
