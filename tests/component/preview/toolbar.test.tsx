// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { TargetCapabilities } from '../../../src/contracts/target'
import type { PreviewSessionSnapshot } from '../../../src/contracts/transport'
import {
  Toolbar,
  VIEWPORT_PRESETS,
  type ToolbarProps,
} from '../../../src/client/preview/Toolbar'

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

function openMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: /More/ }))
}

afterEach(() => {
  cleanup()
})

describe('preview toolbar (U01 layout v2)', () => {
  it('shows a single status line and the address row while idle', () => {
    renderToolbar({ snapshot: null })

    const status = document.querySelector('[data-vibe-status]')
    expect(status?.getAttribute('data-state')).toBe('idle')
    expect(status?.textContent).toContain('Idle')
    expect(screen.getByLabelText('Preview URL')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy()

    // The viewport inputs no longer live on the preview page.
    expect(screen.queryByLabelText('Viewport width')).toBeNull()
    expect(screen.queryByLabelText('Viewport height')).toBeNull()
    // Reload only exists while live.
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  })

  it('keeps live-only actions disabled inside the More menu while idle', () => {
    const { handlers } = renderToolbar({ snapshot: null })
    openMenu()

    expect(screen.getByRole('menuitem', { name: '1280 × 800' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByRole('menuitem', { name: 'Open in browser' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByRole('menuitem', { name: 'Stop' })).toHaveProperty('disabled', true)
    expect(screen.queryByRole('menuitem', { name: 'Restart' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1)
    expect(handlers.onStop).not.toHaveBeenCalled()
  })

  it('navigates from the address row and exposes live actions in the menu', () => {
    const { handlers } = renderToolbar()

    const status = document.querySelector('[data-vibe-status]')
    expect(status?.getAttribute('data-state')).toBe('ready')
    expect(status?.textContent).toContain('Live · 15 fps')

    fireEvent.change(screen.getByLabelText('Preview URL'), {
      target: { value: 'http://localhost:5173/' },
    })
    expect(handlers.onUrlChange).toHaveBeenCalledWith('http://localhost:5173/')

    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(handlers.onReload).toHaveBeenCalledTimes(1)

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open in browser' }))
    expect(handlers.onOpenExternal).toHaveBeenCalledTimes(1)

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop' }))
    expect(handlers.onStop).toHaveBeenCalledTimes(1)
  })

  it('moves viewport presets into the menu and reports the chosen size', () => {
    const { handlers } = renderToolbar()
    openMenu()

    for (const preset of VIEWPORT_PRESETS) {
      expect(
        screen.getByRole('menuitem', { name: `${preset.width} × ${preset.height}` }),
      ).toHaveProperty('disabled', false)
    }

    fireEvent.click(screen.getByRole('menuitem', { name: '1440 × 900' }))
    expect(handlers.onViewportChange).toHaveBeenCalledWith({ width: 1440, height: 900 })
    // Choosing a preset closes the menu.
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('uses the measured stage for the fit-panel preset and clamps it', () => {
    const { handlers } = renderToolbar({
      stageSize: { width: 8000.6, height: 900.2 },
    })
    openMenu()

    const adaptive = screen.getByRole('menuitem', { name: 'Fit panel' })
    expect(adaptive).toHaveProperty('disabled', false)
    fireEvent.click(adaptive)
    expect(handlers.onViewportChange).toHaveBeenCalledWith({ width: 7680, height: 900 })
  })

  it('disables the fit-panel preset without a usable stage size', () => {
    renderToolbar({ stageSize: null })
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Fit panel' })).toHaveProperty(
      'disabled',
      true,
    )

    cleanup()
    // Too small to be a viewport; the Host would reject it.
    renderToolbar({ stageSize: { width: 520, height: 20 } })
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Fit panel' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('expands the status line into details without a second toolbar row', () => {
    renderToolbar({
      snapshot: snapshot({
        lastError: { code: 'target_unavailable', message: 'page closed' },
      }),
      stats: {
        mode: 'stream',
        frames: 42,
        lastSeq: 7,
        streamConnects: 1,
        pullRequests: 0,
        failures: 0,
        lastError: null,
      },
    })

    fireEvent.click(document.querySelector('[data-vibe-status]') as HTMLElement)
    const details = document.querySelector('[data-vibe-status-details]')
    expect(details).not.toBeNull()
    expect(details?.textContent).toContain('Stream')
    expect(details?.textContent).toContain('42')
    expect(details?.textContent).toContain('#7')
    expect(details?.textContent).toContain('page closed')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('[data-vibe-status-details]')).toBeNull()
  })

  it('only offers external open for loopback http(s) URLs', () => {
    renderToolbar({ snapshot: snapshot({ url: 'https://example.com/' }) })
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Open in browser' })).toHaveProperty(
      'disabled',
      true,
    )

    cleanup()
    renderToolbar({ snapshot: snapshot({ url: 'file:///C:/secret.html' }) })
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Open in browser' })).toHaveProperty(
      'disabled',
      true,
    )

    cleanup()
    renderToolbar({ snapshot: snapshot({ url: 'http://127.0.0.1:4320/' }) })
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Open in browser' })).toHaveProperty(
      'disabled',
      false,
    )
  })

  it('shows a failed session with a restart action and the last error', () => {
    const { handlers } = renderToolbar({
      snapshot: snapshot({
        status: 'failed',
        lastError: {
          code: 'target_unavailable',
          message: 'preview target disconnected',
        },
      }),
    })

    const status = document.querySelector('[data-vibe-status]')
    expect(status?.getAttribute('data-state')).toBe('failed')
    expect(status?.textContent).toContain('Failed')
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Start' })).toHaveProperty('disabled', false)

    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restart' }))
    expect(handlers.onSubmit).toHaveBeenCalledTimes(1)
  })

  it('only lists target selectors when the Host advertises several', () => {
    renderToolbar()
    openMenu()
    expect(screen.queryByLabelText('Target')).toBeNull()

    cleanup()
    renderToolbar({
      snapshot: null,
      targets: [
        { id: 'web', kind: 'web' },
        { id: 'desktop', kind: 'desktop' },
      ],
    })
    openMenu()
    expect(screen.getByLabelText('Target')).toBeTruthy()
  })
})

describe('preview toolbar (T027 picker)', () => {
  it('offers the pick toggle only while live and reports clicks', () => {
    const onPickToggle = vi.fn()
    renderToolbar({
      snapshot: snapshot({ capabilities: { ...CAPABILITIES, pick: true } }),
      canPick: true,
      onPickToggle,
    })

    const toggle = screen.getByRole('button', { name: 'Pick element' })
    expect(toggle).toHaveProperty('disabled', false)
    fireEvent.click(toggle)
    expect(onPickToggle).toHaveBeenCalledTimes(1)

    cleanup()
    // Idle sessions have nothing to pick.
    renderToolbar({ snapshot: null, canPick: true, onPickToggle })
    expect(screen.queryByRole('button', { name: 'Pick element' })).toBeNull()
  })

  it('disables the toggle when the target cannot pick and shows the pressed state', () => {
    renderToolbar({ canPick: false, picking: false, onPickToggle: vi.fn() })
    expect(screen.getByRole('button', { name: 'Pick element' })).toHaveProperty(
      'disabled',
      true,
    )

    cleanup()
    renderToolbar({ canPick: true, picking: true, onPickToggle: vi.fn() })
    const toggle = screen.getByRole('button', { name: 'Stop picking' })
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })
})
