// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { resetShellStore } from '../../../src/client/shell/store'
import { StudioShell } from '../../../src/client/shell/StudioShell'

beforeEach(() => {
  resetShellStore()
})

afterEach(() => {
  cleanup()
})

/**
 * The preview page has its own drawer tablist (U01), so shell assertions scope
 * to the shell's tablist instead of every `role=tab` on the page.
 */
function shellTabs(): HTMLElement[] {
  return within(screen.getByRole('tablist', { name: 'Vibe Studio' })).getAllByRole('tab')
}

function tabNames(): (string | null)[] {
  return shellTabs().map((tab) => tab.textContent)
}

describe('StudioShell', () => {
  it('renders all internal tabs with Preview selected and no repeated header', () => {
    render(<StudioShell locale="en" />)

    // DSH labels the pane itself; an in-pane title/subtitle would repeat it.
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByText('Preview, inspect and annotate the running app')).toBeNull()
    expect(tabNames()).toEqual(['Preview', 'Inspect', 'Annotations', 'API', 'Settings'])

    const selected = shellTabs().filter(
      (tab) => tab.getAttribute('aria-selected') === 'true',
    )
    expect(selected).toHaveLength(1)
    expect(selected[0]?.textContent).toBe('Preview')

    expect(screen.getByRole('tabpanel').id).toBe('vibe-studio-panel-preview')
    expect(screen.getByLabelText('Preview URL')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy()
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

    expect(screen.queryByText('预览、检查并标注正在运行的应用')).toBeNull()
    expect(tabNames()).toEqual(['预览', '检查', '标注', 'API', '设置'])
    expect(screen.getByLabelText('预览地址')).toBeTruthy()
  })
})
