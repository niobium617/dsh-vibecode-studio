// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  PreviewTabs,
  type PreviewTabsProps,
} from '../../../src/client/preview/PreviewTabs'

afterEach(() => {
  cleanup()
})

function renderTabs(overrides: Partial<PreviewTabsProps> = {}) {
  const onToggle = vi.fn()
  render(
    <PreviewTabs
      locale="en"
      ready
      console={{ available: true, count: 3 }}
      network={{ available: true, count: 5 }}
      open={null}
      onToggle={onToggle}
      {...overrides}
    />,
  )
  return { onToggle }
}

describe('PreviewTabs (U01)', () => {
  it('shows both tabs with their live counts before the drawers open', () => {
    renderTabs()
    expect(screen.getByRole('tab', { name: 'Console (3)' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Network (5)' })).toBeTruthy()
    expect(screen.getByRole('tablist', { name: 'Preview drawers' })).toBeTruthy()
  })

  it('marks the selected tab and toggles on click', () => {
    const { onToggle } = renderTabs({ open: 'network' })
    expect(
      screen.getByRole('tab', { name: 'Network (5)' }).getAttribute('aria-selected'),
    ).toBe('true')
    expect(
      screen.getByRole('tab', { name: 'Console (3)' }).getAttribute('aria-selected'),
    ).toBe('false')

    fireEvent.click(screen.getByRole('tab', { name: 'Console (3)' }))
    expect(onToggle).toHaveBeenCalledWith('console')
  })

  it('disables a tab until the session is ready and the target supports it', () => {
    renderTabs({ ready: false })
    expect(screen.getByRole('tab', { name: 'Console (3)' })).toHaveProperty('disabled', true)

    cleanup()
    renderTabs({ network: { available: false, count: 0 } })
    expect(screen.getByRole('tab', { name: 'Network (0)' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByRole('tab', { name: 'Console (3)' })).toHaveProperty(
      'disabled',
      false,
    )
  })
})
