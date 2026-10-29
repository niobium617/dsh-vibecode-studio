// @vitest-environment jsdom
/**
 * Annotation queue (T031): model/store behaviour, the side-panel list, the
 * edit/cancel/send actions and the clipboard fallback sender. The handoff is
 * injected, so no test touches the transport or the composer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  AnnotationQueue,
  addAnnotationToQueue,
  annotationQueueSnapshot,
  clearAnnotationQueue,
  createElementAnnotation,
  removeQueuedAnnotation,
  sendQueuedAnnotation,
  subscribeAnnotationQueue,
  updateQueuedAnnotation,
} from '../../../src/client/inspect/AnnotationQueue'
import {
  isAnnotation,
  renderAnnotationText,
  type Annotation,
} from '../../../src/contracts/annotation'
import { ANNOTATION_BUDGET_BYTES, utf8Bytes } from '../../../src/contracts/budget'
import type { ElementContext } from '../../../src/contracts/inspect'
import {
  clearAllAnnotationStatuses,
  getAnnotationStatus,
  setAnnotationStatus,
} from '../../../src/client/inspect/annotation-status'

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

function make(comment: string, id = 'a-test-1', createdAt = '2026-10-28T10:00:00.000Z'): Annotation {
  return createElementAnnotation({ targetId: 'fixture', comment, element: ELEMENT, id, createdAt })
}

function add(comment: string, id?: string): Annotation {
  const annotation = make(comment, id)
  addAnnotationToQueue(annotation)
  return annotation
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
  // @ts-expect-error the test may have defined a clipboard that jsdom lacks
  delete navigator.clipboard
})

describe('createElementAnnotation', () => {
  it('builds a contract-valid annotation from a pick', () => {
    const annotation = make('  Make it bigger  ')
    expect(isAnnotation(annotation)).toBe(true)
    expect(annotation.source).toBe('element')
    expect(annotation.comment).toBe('Make it bigger')
    expect(annotation.targetId).toBe('fixture')
    expect(annotation.element).toBe(ELEMENT)
    expect(annotation.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
    expect(Number.isNaN(Date.parse(annotation.createdAt))).toBe(false)
  })

  it('generates distinct ids for consecutive annotations', () => {
    const first = createElementAnnotation({ targetId: 'fixture', comment: 'one', element: ELEMENT })
    const second = createElementAnnotation({
      targetId: 'fixture',
      comment: 'two',
      element: ELEMENT,
    })
    expect(first.id).not.toBe(second.id)
  })

  it('rejects an invalid target id before it reaches the queue', () => {
    expect(() =>
      createElementAnnotation({ targetId: '../escape', comment: 'x', element: ELEMENT }),
    ).toThrow()
  })
})

describe('annotation queue store', () => {
  it('prepends new drafts and notifies subscribers on every mutation', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeAnnotationQueue(listener)

    add('first', 'a-1')
    expect(annotationQueueSnapshot().map((entry) => entry.id)).toEqual(['a-1'])

    add('second', 'a-2')
    expect(annotationQueueSnapshot().map((entry) => entry.id)).toEqual(['a-2', 'a-1'])
    expect(listener).toHaveBeenCalledTimes(2)

    expect(updateQueuedAnnotation('a-1', '  edited  ')).toBe(true)
    expect(annotationQueueSnapshot().find((entry) => entry.id === 'a-1')!.comment).toBe('edited')

    expect(removeQueuedAnnotation('a-2')).toBe(true)
    expect(removeQueuedAnnotation('a-2')).toBe(false)
    expect(annotationQueueSnapshot().map((entry) => entry.id)).toEqual(['a-1'])
    expect(listener).toHaveBeenCalledTimes(4)

    unsubscribe()
    add('third', 'a-3')
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('rejects empty comments and malformed annotations', () => {
    add('keep me', 'a-1')
    expect(updateQueuedAnnotation('a-1', '   ')).toBe(false)
    expect(updateQueuedAnnotation('missing', 'nope')).toBe(false)
    expect(addAnnotationToQueue({ ...make('bad', 'a-2'), targetId: 'not valid!' } as Annotation)).toBe(
      false,
    )
    expect(annotationQueueSnapshot().map((entry) => entry.id)).toEqual(['a-1'])
  })
})

describe('AnnotationQueue', () => {
  it('shows a guiding empty state', () => {
    render(<AnnotationQueue locale="en" />)
    expect(screen.getByText('No annotations yet')).toBeTruthy()
    expect(screen.getByText('Annotations you add in the preview will appear here.')).toBeTruthy()
    expect(document.querySelector('[data-vibe-annotation-list="1"]')).toBeNull()
    expect(document.querySelector('[data-vibe-annotation-hint="1"]')).toBeNull()
  })

  it('lists drafts newest first with the element, source and comment', () => {
    add('first note', 'a-1')
    add('second note', 'a-2')
    render(<AnnotationQueue locale="en" />)

    const items = [...document.querySelectorAll('[data-vibe-annotation-item]')]
    expect(items.map((item) => item.getAttribute('data-vibe-annotation-item'))).toEqual([
      'a-2',
      'a-1',
    ])
    expect(items[0]!.textContent).toContain('second note')
    expect(items[0]!.textContent).toContain('[data-testid="save"]')
    expect(items[0]!.textContent).toContain('App.tsx:12')
    expect(document.querySelector('[data-vibe-annotation-hint="1"]')?.textContent).toContain(
      'never submits',
    )
  })

  it('edits a draft and keeps the old comment when the edit is cancelled', () => {
    add('original', 'a-1')
    render(<AnnotationQueue locale="en" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const input = screen.getByRole('textbox', { name: /What should change/ })
    expect((input as HTMLTextAreaElement).value).toBe('original')

    fireEvent.change(input, { target: { value: '  revised  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(document.querySelector('[data-vibe-annotation-comment="1"]')?.textContent).toBe(
      'revised',
    )
    expect(annotationQueueSnapshot()[0]!.comment).toBe('revised')

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: /What should change/ }), {
      target: { value: 'discarded' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(annotationQueueSnapshot()[0]!.comment).toBe('revised')
  })

  it('refuses an empty edit and explains why', () => {
    add('original', 'a-1')
    render(<AnnotationQueue locale="en" />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: /What should change/ }), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByRole('status').textContent).toBe('The comment cannot be empty.')
    expect(annotationQueueSnapshot()[0]!.comment).toBe('original')
  })

  it('removes a draft and returns to the empty state', () => {
    add('throw me away', 'a-1')
    render(<AnnotationQueue locale="en" />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(annotationQueueSnapshot()).toEqual([])
    expect(screen.getByText('No annotations yet')).toBeTruthy()
  })

  it('renders a notice inside the card, right of Remove, not under the list (U02)', () => {
    add('notice me', 'a-1')
    setAnnotationStatus('a-1', { kind: 'success', message: 'Reopened in the queue above.' })
    render(<AnnotationQueue locale="en" />)

    const item = document.querySelector('[data-vibe-annotation-item="a-1"]')
    const status = document.querySelector('[data-vibe-annotation-status="success"]')
    expect(item?.contains(status)).toBe(true)
    expect(status?.textContent).toBe('Reopened in the queue above.')

    const remove = item?.querySelector('[data-vibe-annotation-remove="1"]')
    // Same action row, after the Remove button.
    expect(remove?.parentElement).toBe(status?.parentElement)
    expect(
      remove!.compareDocumentPosition(status!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    // No stray line under the list: the footer only holds the hint.
    const list = document.querySelector('[data-vibe-annotation-list="1"]')
    expect(list?.parentElement?.querySelector('[data-vibe-annotation-status]')).toBe(status)
  })

  it('clears the matching history notice when a draft is removed (U02)', () => {
    add('drop me', 'a-1')
    setAnnotationStatus('a-1', { kind: 'success', message: 'Reopened in the queue above.' })
    render(<AnnotationQueue locale="en" />)

    expect(screen.getByText('Reopened in the queue above.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(getAnnotationStatus('a-1')).toBeNull()
    expect(screen.queryByText('Reopened in the queue above.')).toBeNull()
  })

  it('never sends on its own — only a click sends', async () => {
    add('wait for me', 'a-1')
    const send = vi.fn(async () => {})
    render(<AnnotationQueue locale="en" send={send} />)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25))
    })

    expect(send).not.toHaveBeenCalled()
    expect(annotationQueueSnapshot()).toHaveLength(1)
    expect(screen.getByText('wait for me')).toBeTruthy()
  })

  it('sends the rendered annotation and clears it from the queue', async () => {
    const annotation = add('Make it bigger', 'a-1')
    const send = vi.fn(async () => 'Sent to the chat draft.')
    render(<AnnotationQueue locale="en" send={send} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }))
    })

    expect(send).toHaveBeenCalledTimes(1)
    const [sent, text] = send.mock.calls[0] as unknown as [Annotation, string]
    expect(sent.id).toBe(annotation.id)
    expect(text).toBe(renderAnnotationText(annotation))
    expect(text).toContain('Make it bigger')
    expect(utf8Bytes(text)).toBeLessThanOrEqual(ANNOTATION_BUDGET_BYTES)
    expect(annotationQueueSnapshot()).toEqual([])
    // A successful send releases the notice for both lists (U02): the history
    // card must stop saying "reopened, not sent" once this draft is sent.
    expect(getAnnotationStatus(annotation.id)).toBeNull()
    expect(document.querySelector('[data-vibe-annotation-status]')).toBeNull()
  })

  it('reports the fallback message to the caller when the sender reports nothing', async () => {
    const annotation = add('Copy me', 'a-1')
    let result: Awaited<ReturnType<typeof sendQueuedAnnotation>> | null = null

    await act(async () => {
      result = await sendQueuedAnnotation(annotation, async () => {}, {
        sent: 'Copied to the clipboard — paste it into the chat.',
        failed: 'Could not send this annotation. Try again.',
      })
    })

    // The message still reaches the save notice (U02), even though a success
    // clears the inline notice shared by the queue and history cards.
    expect(result).toEqual({
      ok: true,
      message: 'Copied to the clipboard — paste it into the chat.',
    })
    expect(getAnnotationStatus('a-1')).toBeNull()
    expect(annotationQueueSnapshot()).toEqual([])
  })

  it('keeps the draft and warns when sending fails', async () => {
    add('Keep me', 'a-1')
    const send = vi.fn(async () => {
      throw new Error('composer refused')
    })
    render(<AnnotationQueue locale="en" send={send} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }))
    })

    expect(screen.getByRole('alert').textContent).toBe(
      'Could not send this annotation. Try again.',
    )
    expect(
      document.querySelector(
        '[data-vibe-annotation-item="a-1"] [data-vibe-annotation-status="error"]',
      ),
    ).toBeTruthy()
    expect(annotationQueueSnapshot()).toHaveLength(1)
    expect(screen.getByText('Keep me')).toBeTruthy()
  })

  it('disables the item actions while a send is in flight', async () => {
    add('Slow send', 'a-1')
    let release: () => void = () => {}
    const send = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    render(<AnnotationQueue locale="en" send={send} />)

    fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sending…' })).toBeTruthy())
    const sending = screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement
    expect(sending.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Edit' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    await act(async () => {
      release()
    })
    expect(annotationQueueSnapshot()).toEqual([])
  })

  it('copies the rendered annotation with the built-in clipboard sender', async () => {
    add('Clipboard please', 'a-1')
    const writeText = vi.fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<AnnotationQueue locale="en" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }))
    })

    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = writeText.mock.calls[0]![0] as string
    expect(copied).toContain('Clipboard please')
    expect(utf8Bytes(copied)).toBeLessThanOrEqual(ANNOTATION_BUDGET_BYTES)
    expect(annotationQueueSnapshot()).toEqual([])
    expect(getAnnotationStatus('a-1')).toBeNull()
  })

  it('keeps the draft when the clipboard is unavailable', async () => {
    add('No clipboard', 'a-1')
    render(<AnnotationQueue locale="en" />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to chat' }))
    })

    expect(screen.getByRole('alert').textContent).toBe(
      'Could not send this annotation. Try again.',
    )
    expect(annotationQueueSnapshot()).toHaveLength(1)
  })

  it('keeps queued drafts across a remount (preview tab → annotations tab)', () => {
    const first = render(<AnnotationQueue locale="en" />)
    expect(screen.getByText('No annotations yet')).toBeTruthy()
    first.unmount()

    add('Survives the tab switch', 'a-1')

    render(<AnnotationQueue locale="en" />)
    expect(screen.getByText('Survives the tab switch')).toBeTruthy()
  })

  it('renders the queue in Chinese', () => {
    add('按钮太小', 'a-1')
    render(<AnnotationQueue locale="zh-CN" />)
    expect(screen.getByRole('button', { name: '发送到对话' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '编辑' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '移除' })).toBeTruthy()
    expect(screen.getByText(/不会替你提交/)).toBeTruthy()
  })
})
