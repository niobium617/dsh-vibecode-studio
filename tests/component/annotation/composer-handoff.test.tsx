// @vitest-environment jsdom
/**
 * Composer handoff (T032): the S2 public route — `captureInsertion` +
 * `insertText` into the active session's composer, the `setDraft` fallback,
 * the clipboard fallback when no composer is attached, per-session isolation,
 * and the hard rule that nothing is ever submitted.
 *
 * No test touches the transport or the DSH conversation store: the slot props
 * are faked exactly as S2 described them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import * as React from 'react'
import {
  ComposerHandoffSlot,
  attachComposerHandoff,
  composerHandoffSnapshot,
  createComposerHandoffSender,
  detachComposerHandoff,
  handoffAnnotationText,
  resetComposerHandoff,
  setComposerHandoffInput,
  subscribeComposerHandoff,
  type ComposerInputActions,
} from '../../../src/client/inspect/handoff'
import { createElementAnnotation } from '../../../src/client/inspect/AnnotationQueue'
import { renderAnnotationText } from '../../../src/contracts/annotation'
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
  source: { framework: 'react', via: 'data-inspector-file', file: 'src/App.tsx', line: 12, column: 4 },
}

interface FakeActions {
  readonly actions: ComposerInputActions & { submit?: () => void }
  readonly inserted: Array<{ text: string; span: unknown }>
  readonly replaced: string[]
  readonly submitted: ReturnType<typeof vi.fn>
}

/** Mirrors the public `InputActions` subset from S2 §3.3. */
function fakeActions(
  options: {
    insertResult?: boolean
    throwOnInsert?: boolean
    withSetDraft?: boolean
  } = {},
): FakeActions {
  const inserted: Array<{ text: string; span: unknown }> = []
  const replaced: string[] = []
  const submitted = vi.fn()
  const actions: ComposerInputActions & { submit?: () => void } = {
    captureInsertion: vi.fn(() => ({ start: 0, end: 0 })),
    insertText: vi.fn((text: string, span: unknown) => {
      if (options.throwOnInsert === true) throw new Error('composer is busy')
      inserted.push({ text, span })
      return options.insertResult ?? true
    }),
    submit: submitted,
  }
  if (options.withSetDraft !== false) {
    actions.setDraft = vi.fn((text: string) => {
      replaced.push(text)
    })
  }
  return { actions, inserted, replaced, submitted }
}

function setClipboard(writeText: (text: string) => Promise<void>): ReturnType<typeof vi.fn> {
  const spy = vi.fn(writeText)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: spy },
  })
  return spy
}

beforeEach(() => {
  resetComposerHandoff()
})

afterEach(() => {
  cleanup()
  resetComposerHandoff()
  vi.restoreAllMocks()
  // @ts-expect-error the test may have defined a clipboard that jsdom lacks
  delete navigator.clipboard
})

describe('handoff without a composer', () => {
  it('copies the text to the clipboard and reports the fallback', async () => {
    const writeText = setClipboard(async () => {})

    const outcome = await handoffAnnotationText('Annotation a-1\n\nComment:\nBigger button')

    expect(outcome).toEqual({ placement: 'clipboard', sessionId: null })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0]![0]).toContain('Bigger button')
  })

  it('rejects an empty text and leaves the clipboard alone', async () => {
    const writeText = setClipboard(async () => {})
    await expect(handoffAnnotationText('   ')).rejects.toThrow('nothing to hand off')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('rejects when neither the composer nor the clipboard is available', async () => {
    await expect(handoffAnnotationText('keep me')).rejects.toThrow('clipboard unavailable')
  })
})

describe('handoff into the composer', () => {
  it('inserts at the caret through the public input actions, without replacing', async () => {
    const { actions, inserted, replaced } = fakeActions()
    attachComposerHandoff('session-a', actions)

    const outcome = await handoffAnnotationText('Annotation text')

    expect(outcome).toEqual({ placement: 'composer', sessionId: 'session-a' })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]!.text).toBe('Annotation text')
    expect(inserted[0]!.span).toEqual({ start: 0, end: 0 })
    expect(replaced).toHaveLength(0)
    expect(actions.setDraft).not.toHaveBeenCalled()
  })

  it('separates the note from text the user already drafted', async () => {
    const { actions, inserted } = fakeActions()
    attachComposerHandoff('session-a', actions)
    setComposerHandoffInput('session-a', { draft: 'existing note', phase: 'plain' })

    await handoffAnnotationText('Annotation text')

    expect(inserted[0]!.text).toBe('\n\nAnnotation text')
    expect(composerHandoffSnapshot().draft).toBe('existing note\n\nAnnotation text')
  })

  it('replaces the draft only when insertText is refused', async () => {
    const { actions, replaced, inserted } = fakeActions({ insertResult: false })
    attachComposerHandoff('session-a', actions)
    setComposerHandoffInput('session-a', { draft: 'existing note', phase: 'plain' })

    const outcome = await handoffAnnotationText('Annotation text')

    expect(outcome.placement).toBe('composer')
    expect(inserted).toHaveLength(1)
    expect(replaced).toEqual(['existing note\n\nAnnotation text'])
  })

  it('never submits the message on its own', async () => {
    const { actions, submitted, inserted } = fakeActions()
    attachComposerHandoff('session-a', actions)

    await handoffAnnotationText('Annotation text')
    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(submitted).not.toHaveBeenCalled()
    expect(inserted).toHaveLength(1)
    expect(composerHandoffSnapshot().phase).toBe('unknown')
  })

  it('falls back to the clipboard when the composer throws', async () => {
    const { actions } = fakeActions({ throwOnInsert: true })
    attachComposerHandoff('session-a', actions)
    const writeText = setClipboard(async () => {})

    const outcome = await handoffAnnotationText('Annotation text')

    expect(outcome).toEqual({ placement: 'clipboard', sessionId: null })
    expect(writeText).toHaveBeenCalledWith('Annotation text')
  })

  it('uses the clipboard when insertText is refused and setDraft is not exposed', async () => {
    const { actions } = fakeActions({ insertResult: false, withSetDraft: false })
    attachComposerHandoff('session-a', actions)
    const writeText = setClipboard(async () => {})

    const outcome = await handoffAnnotationText('Annotation text')

    expect(outcome.placement).toBe('clipboard')
    expect(writeText).toHaveBeenCalledWith('Annotation text')
  })
})

describe('session isolation', () => {
  it('retargets the handoff to the session that attached last', async () => {
    const first = fakeActions()
    const second = fakeActions()
    attachComposerHandoff('session-a', first.actions)
    attachComposerHandoff('session-b', second.actions)

    const outcome = await handoffAnnotationText('for b')

    expect(outcome.sessionId).toBe('session-b')
    expect(second.inserted).toHaveLength(1)
    expect(first.inserted).toHaveLength(0)
  })

  it('ignores a stale unmount from the session that was replaced', () => {
    const first = fakeActions()
    const second = fakeActions()
    attachComposerHandoff('session-a', first.actions)
    attachComposerHandoff('session-b', second.actions)

    // The old slot unmounts after the new one attached.
    expect(detachComposerHandoff('session-a', first.actions)).toBe(true)

    expect(composerHandoffSnapshot().sessionId).toBe('session-b')
    expect(composerHandoffSnapshot().attached).toBe(true)
  })

  it('falls back to the previous session when the active one detaches', async () => {
    const first = fakeActions()
    const second = fakeActions()
    attachComposerHandoff('session-a', first.actions)
    attachComposerHandoff('session-b', second.actions)
    detachComposerHandoff('session-b', second.actions)

    const outcome = await handoffAnnotationText('back to a')

    expect(outcome.sessionId).toBe('session-a')
    expect(first.inserted).toHaveLength(1)
  })

  it('keeps each session’s draft separate', () => {
    const first = fakeActions()
    const second = fakeActions()
    attachComposerHandoff('session-a', first.actions)
    setComposerHandoffInput('session-a', { draft: 'draft a', phase: 'plain' })
    attachComposerHandoff('session-b', second.actions)
    setComposerHandoffInput('session-b', { draft: 'draft b', phase: 'plain' })

    expect(composerHandoffSnapshot().draft).toBe('draft b')
    detachComposerHandoff('session-b', second.actions)
    expect(composerHandoffSnapshot().draft).toBe('draft a')
  })

  it('rejects a session id that cannot be attached', () => {
    const { actions } = fakeActions()
    expect(attachComposerHandoff('', actions)).toBe(false)
    expect(attachComposerHandoff('session-a', {} as ComposerInputActions)).toBe(false)
    expect(composerHandoffSnapshot().attached).toBe(false)
  })
})

describe('bridge state', () => {
  it('publishes a stable snapshot and notifies only on real changes', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeComposerHandoff(listener)
    const { actions } = fakeActions()
    const empty = composerHandoffSnapshot()
    expect(composerHandoffSnapshot()).toBe(empty)

    attachComposerHandoff('session-a', actions)
    const attached = composerHandoffSnapshot()
    expect(attached).toEqual({
      attached: true,
      sessionId: 'session-a',
      draft: '',
      phase: 'unknown',
    })
    expect(listener).toHaveBeenCalledTimes(1)

    setComposerHandoffInput('session-a', { draft: '', phase: 'unknown' })
    expect(composerHandoffSnapshot()).toBe(attached)
    expect(listener).toHaveBeenCalledTimes(1)

    setComposerHandoffInput('session-a', { draft: 'hello', phase: 'plain' })
    expect(composerHandoffSnapshot().draft).toBe('hello')
    expect(listener).toHaveBeenCalledTimes(2)

    detachComposerHandoff('session-a', actions)
    expect(composerHandoffSnapshot()).toEqual({
      attached: false,
      sessionId: null,
      draft: '',
      phase: 'unknown',
    })
    expect(listener).toHaveBeenCalledTimes(3)

    unsubscribe()
    attachComposerHandoff('session-a', actions)
    expect(listener).toHaveBeenCalledTimes(3)
  })
})

describe('ComposerHandoffSlot', () => {
  it('attaches the scoped session and mirrors the composer input state', () => {
    const { actions } = fakeActions()
    const view = render(
      React.createElement(ComposerHandoffSlot, {
        sessionId: 'session-a',
        inputActions: actions,
        useInput: () => ({ draft: 'Hi there', phase: 'plain', attachmentIds: [] }),
      }),
    )

    expect(composerHandoffSnapshot()).toEqual({
      attached: true,
      sessionId: 'session-a',
      draft: 'Hi there',
      phase: 'plain',
    })

    view.unmount()
    expect(composerHandoffSnapshot().attached).toBe(false)
  })

  it('does nothing on its own — mounting never writes or submits', async () => {
    const { actions, inserted, replaced, submitted } = fakeActions()
    render(
      React.createElement(ComposerHandoffSlot, {
        sessionId: 'session-a',
        inputActions: actions,
        useInput: () => ({ draft: '', phase: 'plain' }),
      }),
    )

    await new Promise((resolve) => setTimeout(resolve, 25))

    expect(inserted).toHaveLength(0)
    expect(replaced).toHaveLength(0)
    expect(submitted).not.toHaveBeenCalled()
    expect(actions.insertText).not.toHaveBeenCalled()
  })

  it('ignores props that are not public input actions', () => {
    render(
      React.createElement(ComposerHandoffSlot, {
        sessionId: 'session-a',
        inputActions: { insertText: () => true },
        useInput: () => ({ draft: 'x', phase: 'plain' }),
      }),
    )

    expect(composerHandoffSnapshot().attached).toBe(false)
  })
})

describe('createComposerHandoffSender', () => {
  function annotation(): ReturnType<typeof createElementAnnotation> {
    return createElementAnnotation({
      targetId: 'fixture',
      comment: 'Make the button bigger',
      element: ELEMENT,
      id: 'a-send-1',
      createdAt: '2026-10-28T10:00:00.000Z',
    })
  }

  it('reports where the note landed in the active chat draft', async () => {
    const { actions, inserted } = fakeActions()
    attachComposerHandoff('session-a', actions)
    const send = createComposerHandoffSender('en')
    const note = annotation()

    const message = await send(note, renderAnnotationText(note))

    expect(inserted).toHaveLength(1)
    expect(inserted[0]!.text).toContain('Make the button bigger')
    expect(message).toBe('Inserted into the chat draft — nothing was sent.')
  })

  it('reports the clipboard fallback when no composer is attached', async () => {
    const writeText = setClipboard(async () => {})
    const send = createComposerHandoffSender('zh-CN')
    const note = annotation()

    const message = await send(note, renderAnnotationText(note))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(message).toBe('已复制到剪贴板，粘贴到对话即可。')
  })
})
