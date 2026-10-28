// @vitest-environment jsdom
/**
 * The queue lives on the Annotations tab while the bubble lives on the preview
 * page, so this checks the shell wiring: the tab renders the queue and carries
 * a count badge without changing its accessible name.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  addAnnotationToQueue,
  clearAnnotationQueue,
  createElementAnnotation,
} from '../../../src/client/inspect/AnnotationQueue'
import { setActiveTab } from '../../../src/client/shell/store'
import { StudioShell } from '../../../src/client/shell/StudioShell'
import type { ElementContext } from '../../../src/contracts/inspect'

const ELEMENT: ElementContext = {
  selector: 'button.save',
  unique: true,
  tag: 'button',
  id: null,
  classes: ['save'],
  role: 'button',
  name: 'Save',
  text: 'Save',
  html: '<button class="save">Save</button>',
  visible: true,
  box: { x: 0, y: 0, width: 80, height: 30 },
  source: null,
}

function queueOne(comment: string): void {
  act(() => {
    addAnnotationToQueue(
      createElementAnnotation({
        targetId: 'fixture',
        comment,
        element: ELEMENT,
        id: 'a-shell-1',
        createdAt: '2026-10-28T10:00:00.000Z',
      }),
    )
  })
}

beforeEach(() => {
  setActiveTab('preview')
  clearAnnotationQueue()
})

afterEach(() => {
  cleanup()
  setActiveTab('preview')
  clearAnnotationQueue()
})

describe('StudioShell × annotation queue', () => {
  it('shows the guiding empty state on the Annotations tab', () => {
    render(<StudioShell locale="en" />)
    fireEvent.click(screen.getByRole('tab', { name: 'Annotations' }))
    expect(screen.getByRole('tabpanel').id).toBe('vibe-studio-panel-annotations')
    expect(screen.getByText('No annotations yet')).toBeTruthy()
  })

  it('renders queued drafts and a count badge that stays out of the tab name', () => {
    queueOne('这按钮太靠右了')
    render(<StudioShell locale="en" />)

    const tab = screen.getByRole('tab', { name: 'Annotations' })
    expect(tab.getAttribute('aria-selected')).toBe('false')
    expect(document.querySelector('[data-vibe-annotation-count="1"]')?.textContent).toBe('1')

    fireEvent.click(tab)
    expect(screen.getByText('这按钮太靠右了')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send to chat' })).toBeTruthy()
  })
})
