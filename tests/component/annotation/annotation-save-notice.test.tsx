// @vitest-environment jsdom
/**
 * Save notice (T034 rework): the confirmation after a bubble saves now carries
 * "Send to chat", so pick → save → send is three clicks. The notice must never
 * send on its own, must keep the draft queued when the handoff fails, and must
 * hand over the same rendered text as the queue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AnnotationSaveNotice } from '../../../src/client/inspect/AnnotationSaveNotice'
import {
  addAnnotationToQueue,
  annotationQueueSnapshot,
  clearAnnotationQueue,
  createElementAnnotation,
} from '../../../src/client/inspect/AnnotationQueue'
import { renderAnnotationText, type Annotation } from '../../../src/contracts/annotation'
import { clearAllAnnotationStatuses } from '../../../src/client/inspect/annotation-status'
import { ANNOTATION_BUDGET_BYTES, utf8Bytes } from '../../../src/contracts/budget'
import type { ElementContext } from '../../../src/contracts/inspect'

const ELEMENT: ElementContext = {
  selector: '[data-testid="save"]',
  unique: true,
  tag: 'button',
  id: null,
  classes: ['primary'],
  role: 'button',
  name: 'Save',
  text: 'Save',
  html: '<button>Save</button>',
  visible: true,
  box: { x: 10, y: 10, width: 80, height: 30 },
  source: {
    framework: 'react',
    via: 'data-inspector-file',
    file: 'src/App.tsx',
    line: 12,
    column: 4,
  },
}

function add(comment: string, id = 'a-test-1'): Annotation {
  const annotation = createElementAnnotation({ targetId: 'fixture', comment, element: ELEMENT, id })
  addAnnotationToQueue(annotation)
  return annotation
}

function noticeText(): string {
  return document.querySelector('[data-vibe-annotation-notice-text="1"]')?.textContent ?? ''
}

beforeEach(() => {
  clearAnnotationQueue()
  clearAllAnnotationStatuses()
})

afterEach(() => {
  cleanup()
  clearAnnotationQueue()
  clearAllAnnotationStatuses()
  vi.restoreAllMocks()
})

describe('AnnotationSaveNotice', () => {
  it('shows the saved notice and sends nothing on its own', async () => {
    const annotation = add('Make it bigger')
    const send = vi.fn(async () => {})
    const onViewQueue = vi.fn()
    render(
      <AnnotationSaveNotice
        locale="en"
        annotation={annotation}
        persisted
        onViewQueue={onViewQueue}
        send={send}
      />,
    )

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    expect(send).not.toHaveBeenCalled()
    expect(noticeText()).toBe('Added to the annotation queue')
    expect(screen.getByRole('button', { name: 'Send to chat' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View queue' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'View queue' }))
    expect(onViewQueue).toHaveBeenCalledTimes(1)
    expect(annotationQueueSnapshot()).toHaveLength(1)
  })

  it('sends the rendered annotation, clears the queue and hides the send action', async () => {
    const annotation = add('Make it bigger')
    const send = vi.fn(async () => 'Inserted into the chat draft — not sent.')
    render(
      <AnnotationSaveNotice
        locale="en"
        annotation={annotation}
        persisted
        onViewQueue={() => {}}
        send={send}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }))
    })

    expect(send).toHaveBeenCalledTimes(1)
    const [sent, text] = send.mock.calls[0] as unknown as [Annotation, string]
    expect(sent.id).toBe(annotation.id)
    expect(text).toBe(renderAnnotationText(annotation))
    expect(utf8Bytes(text)).toBeLessThanOrEqual(ANNOTATION_BUDGET_BYTES)
    expect(annotationQueueSnapshot()).toEqual([])
    expect(noticeText()).toBe('Inserted into the chat draft — not sent.')
    expect(screen.queryByRole('button', { name: 'Send to chat' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View queue' })).toBeTruthy()
  })

  it('falls back to the clipboard message when the sender reports nothing', async () => {
    const annotation = add('Copy me')
    const send = vi.fn(async () => {})
    render(
      <AnnotationSaveNotice
        locale="en"
        annotation={annotation}
        persisted
        onViewQueue={() => {}}
        send={send}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }))
    })

    expect(noticeText()).toBe('Copied to the clipboard — paste it into the chat.')
    expect(annotationQueueSnapshot()).toEqual([])
  })

  it('keeps the draft queued, warns, and offers a retry when sending fails', async () => {
    const annotation = add('Keep me')
    const send = vi.fn(async () => {
      throw new Error('composer refused')
    })
    render(
      <AnnotationSaveNotice
        locale="en"
        annotation={annotation}
        persisted
        onViewQueue={() => {}}
        send={send}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }))
    })

    expect(noticeText()).toBe('Could not send this annotation. Try again.')
    expect(annotationQueueSnapshot()).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Send to chat' })).toBeTruthy()
  })

  it('disables the send action while a send is in flight', async () => {
    const annotation = add('Slow send')
    let release: () => void = () => {}
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    render(
      <AnnotationSaveNotice
        locale="en"
        annotation={annotation}
        persisted
        onViewQueue={() => {}}
        send={send}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sending…' })).toBeTruthy())
    const sending = screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement
    expect(sending.disabled).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)

    await act(async () => {
      release()
    })
    expect(annotationQueueSnapshot()).toEqual([])
  })

  it('still reports the queue entry when the history write failed', () => {
    const annotation = add('History offline')
    render(
      <AnnotationSaveNotice
        locale="en"
        annotation={annotation}
        persisted={false}
        onViewQueue={() => {}}
        send={vi.fn(async () => {})}
      />,
    )

    expect(noticeText()).toBe('Added to the queue, but could not save it to history.')
    expect(screen.getByRole('button', { name: 'Send to chat' })).toBeTruthy()
  })

  it('reports a direct send from the bubble without offering another one (U02)', async () => {
    const annotation = add('Sent already')
    render(
      <AnnotationSaveNotice
        locale="en"
        annotation={annotation}
        persisted
        onViewQueue={() => {}}
        send={vi.fn(async () => {})}
        sent
        initialMessage="Inserted into the chat draft — nothing was sent."
      />,
    )

    expect(noticeText()).toBe('Inserted into the chat draft — nothing was sent.')
    expect(screen.queryByRole('button', { name: 'Send to chat' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View queue' })).toBeTruthy()
  })

  it('picks up a direct send that resolves after the notice mounts', () => {
    const annotation = add('Slow direct send')
    const send = vi.fn(async () => {})
    const view = render(
      <AnnotationSaveNotice
        locale="en"
        annotation={annotation}
        persisted
        onViewQueue={() => {}}
        send={send}
      />,
    )

    expect(noticeText()).toBe('Added to the annotation queue')
    view.rerender(
      <AnnotationSaveNotice
        locale="en"
        annotation={annotation}
        persisted
        onViewQueue={() => {}}
        send={send}
        sent
        initialMessage="Inserted into the chat draft — nothing was sent."
      />,
    )

    expect(noticeText()).toBe('Inserted into the chat draft — nothing was sent.')
    expect(screen.queryByRole('button', { name: 'Send to chat' })).toBeNull()
  })

  it('keeps the retry button when a direct send failed', () => {
    const annotation = add('Direct send failed')
    render(
      <AnnotationSaveNotice
        locale="en"
        annotation={annotation}
        persisted
        onViewQueue={() => {}}
        send={vi.fn(async () => {})}
        initialMessage="Could not send this annotation. Try again."
      />,
    )

    expect(noticeText()).toBe('Could not send this annotation. Try again.')
    expect(screen.getByRole('button', { name: 'Send to chat' })).toBeTruthy()
    expect(annotationQueueSnapshot()).toHaveLength(1)
  })

  it('renders in Chinese', () => {
    const annotation = add('按钮太小')
    render(
      <AnnotationSaveNotice
        locale="zh-CN"
        annotation={annotation}
        persisted
        onViewQueue={() => {}}
        send={vi.fn(async () => {})}
      />,
    )

    expect(noticeText()).toBe('已加入标注队列')
    expect(screen.getByRole('button', { name: '发送到对话' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '查看队列' })).toBeTruthy()
  })
})
