// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { resetShellStore } from '../../../src/client/shell/store'
import { StudioShell } from '../../../src/client/shell/StudioShell'

beforeEach(() => {
  resetShellStore()
})

afterEach(() => {
  cleanup()
})

function tabNames(): (string | null)[] {
  return screen.getAllByRole('tab').map((tab) => tab.textContent)
}

describe('StudioShell', () => {
  it('renders the header and all internal tabs with Preview selected', () => {
    render(<StudioShell locale="en" />)

    expect(screen.getByRole('heading', { name: 'Vibe Studio' })).toBeTruthy()
    expect(tabNames()).toEqual(['Preview', 'Inspect', 'Annotations', 'API', 'Settings'])

    const selected = screen.getAllByRole('tab').filter(
      (tab) => tab.getAttribute('aria-selected') === 'true',
    )
    expect(selected).toHaveLength(1)
    expect(selected[0]?.textContent).toBe('Preview')

    expect(screen.getByRole('tabpanel').id).toBe('vibe-studio-panel-preview')
    expect(
      screen.getByText('No preview target yet. Start a local app and open it here.'),
    ).toBeTruthy()
  })

  it('switches internal pages and updates the panel', () => {
    render(<StudioShell locale="en" />)

    fireEvent.click(screen.getByRole('tab', { name: 'Inspect' }))

    expect(screen.getByRole('tab', { name: 'Inspect' }).getAttribute('aria-selected')).toBe(
      'true',
    )
    expect(screen.getByRole('tabpanel').id).toBe('vibe-studio-panel-inspect')
    expect(
      screen.getByText('Pick an element in the preview to inspect its source.'),
    ).toBeTruthy()
  })

  it('keeps the selected page after the pane unmounts and remounts', () => {
    const first = render(<StudioShell locale="en" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Annotations' }))
    first.unmount()

    render(<StudioShell locale="en" />)

    expect(
      screen.getByRole('tab', { name: 'Annotations' }).getAttribute('aria-selected'),
    ).toBe('true')
    expect(screen.getByRole('tabpanel').id).toBe('vibe-studio-panel-annotations')
  })

  it('renders translated labels for zh-CN', () => {
    render(<StudioShell locale="zh-CN" />)

    expect(screen.getByRole('heading', { name: 'Vibe Studio' })).toBeTruthy()
    expect(tabNames()).toEqual(['预览', '检查', '标注', 'API', '设置'])
    expect(screen.getByText('暂无内容')).toBeTruthy()
  })
})
