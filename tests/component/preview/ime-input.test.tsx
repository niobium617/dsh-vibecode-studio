// @vitest-environment jsdom
import type { MutableRefObject } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { PreviewInputEvent } from '../../../src/contracts/transport'
import {
  ImeInput,
  compositionText,
  type ImeInputHandle,
} from '../../../src/client/preview/ImeInput'

interface HarnessProps {
  readonly push: (event: PreviewInputEvent) => void
  readonly active?: boolean
  readonly onFailure?: () => void
  readonly onCompositionStart?: () => void
  readonly handle?: MutableRefObject<ImeInputHandle | null>
}

function Harness({
  push,
  active = true,
  onFailure,
  onCompositionStart,
  handle,
}: HarnessProps) {
  return (
    <ImeInput
      ref={handle}
      push={push}
      active={active}
      onFailure={onFailure}
      onCompositionStart={onCompositionStart}
    />
  )
}

function setup(props: Partial<HarnessProps> = {}) {
  const push = vi.fn()
  const onFailure = vi.fn()
  const onCompositionStart = vi.fn()
  const view = render(
    <Harness
      push={push}
      onFailure={onFailure}
      onCompositionStart={onCompositionStart}
      {...props}
    />,
  )
  const textarea = view.container.querySelector(
    'textarea[data-vibe-ime="1"]',
  ) as HTMLTextAreaElement | null
  if (!textarea) throw new Error('composition textarea did not render')
  return { push, onFailure, onCompositionStart, textarea, view }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ImeInput', () => {
  it('forwards only the committed composition text and clears the box', () => {
    const { push, onCompositionStart, textarea } = setup()

    fireEvent.compositionStart(textarea)
    fireEvent.compositionUpdate(textarea, { data: '你' })
    fireEvent.compositionUpdate(textarea, { data: '你好' })
    expect(push).not.toHaveBeenCalled()
    expect(onCompositionStart).toHaveBeenCalledTimes(1)

    fireEvent.compositionEnd(textarea, { data: '你好，世界' })
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith({ kind: 'text', text: '你好，世界' })
    expect(textarea.value).toBe('')
  })

  it('keeps composing input inside the textarea until it ends', () => {
    const { push, textarea } = setup()

    fireEvent.compositionStart(textarea)
    textarea.value = '你好'
    fireEvent.input(textarea)
    expect(textarea.value).toBe('你好')
    expect(push).not.toHaveBeenCalled()

    fireEvent.compositionEnd(textarea, { data: '你好' })
    expect(textarea.value).toBe('')
    expect(push).toHaveBeenCalledWith({ kind: 'text', text: '你好' })
  })

  it('does not send or fail on a cancelled composition', () => {
    const { push, onFailure, textarea } = setup()

    fireEvent.compositionStart(textarea)
    fireEvent.compositionEnd(textarea, { data: '' })
    expect(push).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })

  it('reports over-long composition text instead of sending it', () => {
    const { push, onFailure, textarea } = setup()

    fireEvent.compositionStart(textarea)
    fireEvent.compositionEnd(textarea, { data: 'x'.repeat(1025) })
    expect(push).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it('drops composition state when deactivated and ignores later events', () => {
    const handle: MutableRefObject<ImeInputHandle | null> = { current: null }
    const push = vi.fn()
    const view = render(<Harness push={push} active handle={handle} />)
    const textarea = view.container.querySelector('textarea') as HTMLTextAreaElement

    fireEvent.compositionStart(textarea)
    textarea.value = 'stale'
    view.rerender(<Harness push={push} active={false} handle={handle} />)
    expect(textarea.value).toBe('')
    expect(handle.current?.isComposing()).toBe(false)

    fireEvent.compositionEnd(textarea, { data: '你好' })
    expect(push).not.toHaveBeenCalled()
  })

  it('forwards pasted plain text as one insert and blocks the default paste', () => {
    const { push, textarea } = setup()

    const dispatched = fireEvent.paste(textarea, {
      clipboardData: { getData: () => '你好，世界' },
    })
    expect(dispatched).toBe(false)
    expect(push).toHaveBeenCalledWith({ kind: 'text', text: '你好，世界' })
    expect(textarea.value).toBe('')
  })

  it('positions and focuses the composition box on click', () => {
    const handle: MutableRefObject<ImeInputHandle | null> = { current: null }
    const { textarea } = setup({ handle })

    act(() => handle.current?.focusAt(12.4, 34.6))
    expect(document.activeElement).toBe(textarea)
    expect(textarea.style.left).toBe('12px')
    expect(textarea.style.top).toBe('35px')

    act(() => handle.current?.reset())
    expect(handle.current?.isComposing()).toBe(false)
  })
})

describe('compositionText', () => {
  it('accepts bounded text and emoji surrogate pairs', () => {
    expect(compositionText('你好，世界', '')).toBe('你好，世界')
    expect(compositionText(null, '来自 value')).toBe('来自 value')
    expect(compositionText('😀', '')).toBe('😀')
    expect(compositionText('😀'.repeat(1024), '')).toBe('😀'.repeat(1024))
  })

  it('rejects empty, over-long and lone-surrogate text', () => {
    expect(compositionText('', '')).toBeNull()
    expect(compositionText(null, '')).toBeNull()
    expect(compositionText('😀'.repeat(1025), '')).toBeNull()
    expect(compositionText('\uD800', '')).toBeNull()
    expect(compositionText('a\uDC00b', '')).toBeNull()
  })
})
