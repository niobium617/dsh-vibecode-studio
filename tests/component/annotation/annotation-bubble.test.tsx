// @vitest-environment jsdom
/**
 * Annotation bubble (T031): placement next to the picked element and the
 * pick → type → save editor. Saving only hands the comment to the caller.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  ANNOTATION_COMMENT_MAX_CHARS,
  BUBBLE_HEIGHT,
  BUBBLE_WIDTH,
  AnnotationBubble,
  placeBubble,
  type BubbleGeometry,
} from '../../../src/client/inspect/AnnotationBubble'
import type { ElementContext } from '../../../src/contracts/inspect'

const ELEMENT: ElementContext = {
  selector: '[data-testid="save"]',
  unique: true,
  tag: 'button',
  id: null,
  classes: ['primary', 'large'],
  role: 'button',
  name: 'Save',
  text: 'Save',
  html: '<button>Save</button>',
  visible: true,
  box: { x: 200, y: 200, width: 120, height: 40 },
  source: null,
}

const FRAME = { left: 10, top: 20, width: 500, height: 300 }

function geometry(box: ElementContext['box'], frame = FRAME): BubbleGeometry {
  return { box, viewport: { width: 1000, height: 600 }, frame }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('placeBubble', () => {
  it('scales the element box into the frame and sits below it', () => {
    const placement = placeBubble(geometry({ x: 200, y: 200, width: 120, height: 40 }))
    // scaleX = 500 / 1000 = 0.5; scaleY = 300 / 600 = 0.5
    expect(placement.left).toBe(110)
    // bottom = 20 + (240 * 0.5) = 140, then + 6 gap
    expect(placement.top).toBe(146)
    expect(placement.side).toBe('below')
  })

  it('stays inside the frame near the right edge', () => {
    const placement = placeBubble(geometry({ x: 900, y: 100, width: 80, height: 20 }))
    // 10 + 450 would overflow: clamp to 10 + 500 - width - 4
    expect(placement.left).toBe(FRAME.left + FRAME.width - BUBBLE_WIDTH - 4)
  })

  it('flips above the element when there is no room below', () => {
    const placement = placeBubble(geometry({ x: 100, y: 560, width: 80, height: 40 }))
    // above = 20 + 560 * 0.5 - height - 6 = 290 - height - 6
    expect(placement.side).toBe('above')
    expect(placement.top).toBe(FRAME.top + 560 / 2 - BUBBLE_HEIGHT - 6)
  })

  it('keeps the bubble inside a frame smaller than itself', () => {
    const placement = placeBubble(
      geometry({ x: 0, y: 0, width: 10, height: 10 }, { left: 0, top: 0, width: 120, height: 120 }),
    )
    expect(placement.left).toBe(4)
    expect(placement.top).toBe(4)
    expect(placement.side).toBe('below')
  })

  it('treats a zero-size viewport as one pixel instead of dividing by zero', () => {
    const placement = placeBubble({
      box: { x: 0, y: 0, width: 10, height: 10 },
      viewport: { width: 0, height: 0 },
      frame: FRAME,
    })
    expect(Number.isFinite(placement.left)).toBe(true)
    expect(Number.isFinite(placement.top)).toBe(true)
  })
})

describe('AnnotationBubble', () => {
  it('renders the element anchor and a focused comment box', () => {
    render(
      <AnnotationBubble
        locale="en"
        element={ELEMENT}
        placement={{ left: 12, top: 34, side: 'below' }}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    )

    const bubble = screen.getByRole('group', { name: 'Annotate this element' })
    expect(bubble.getAttribute('data-vibe-annotation-bubble')).toBe('1')
    expect(bubble.getAttribute('data-side')).toBe('below')
    expect((bubble as HTMLElement).style.left).toBe('12px')
    expect((bubble as HTMLElement).style.top).toBe('34px')
    expect(bubble.textContent).toContain('button.primary.large')

    const input = screen.getByRole('textbox', { name: 'What should change? e.g. Make this button bigger' })
    expect(input.getAttribute('maxlength')).toBe(String(ANNOTATION_COMMENT_MAX_CHARS))
    expect(document.activeElement).toBe(input)
    expect(screen.getByRole('button', { name: 'Add to queue' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('refuses to save an empty comment and explains why', () => {
    const onSave = vi.fn()
    render(
      <AnnotationBubble
        locale="en"
        element={ELEMENT}
        placement={{ left: 0, top: 0, side: 'below' }}
        onSave={onSave}
        onCancel={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('Write a comment first.')

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves the trimmed comment and clears the warning while typing', () => {
    const onSave = vi.fn()
    render(
      <AnnotationBubble
        locale="en"
        element={ELEMENT}
        placement={{ left: 0, top: 0, side: 'below' }}
        onSave={onSave}
        onCancel={() => {}}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }))
    expect(screen.getByRole('status')).toBeTruthy()

    fireEvent.change(input, { target: { value: '  Make this button bigger  ' } })
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }))
    expect(onSave).toHaveBeenCalledWith('Make this button bigger')
  })

  it('saves on Ctrl+Enter and cancels on Escape', () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(
      <AnnotationBubble
        locale="en"
        element={ELEMENT}
        placement={{ left: 0, top: 0, side: 'below' }}
        onSave={onSave}
        onCancel={onCancel}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Space it out' } })
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
    expect(onSave).toHaveBeenCalledWith('Space it out')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('cancels from the secondary button without saving', () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(
      <AnnotationBubble
        locale="en"
        element={ELEMENT}
        placement={{ left: 0, top: 0, side: 'below' }}
        onSave={onSave}
        onCancel={onCancel}
      />,
    )

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ignored' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('speaks Chinese when the panel locale is zh-CN', () => {
    render(
      <AnnotationBubble
        locale="zh-CN"
        element={ELEMENT}
        placement={{ left: 0, top: 0, side: 'below' }}
        onSave={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('group', { name: '标注这个元素' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '加入标注队列' })).toBeTruthy()
  })
})
