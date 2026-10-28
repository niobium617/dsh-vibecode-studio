/**
 * IME bridge (T022).
 *
 * The canvas is a picture, so an input method needs a real editable element
 * to attach to. This off-screen textarea is invisible but focusable: clicks on
 * the preview focus it, the IME composes normally, and only the final
 * `compositionend` text is forwarded (as a `text` event the Host inserts with
 * `Input.insertText`). Intermediate composition text and IME key events never
 * reach the target. Pasting into the focused preview is forwarded the same
 * way, which doubles as the fallback when an IME misbehaves.
 *
 * The textarea must never use `display: none` or `visibility: hidden`; both
 * stop input methods from opening.
 */
import * as React from 'react'
import {
  isInsertableText,
  type PreviewInputEvent,
} from '../../contracts/transport'
import { createTranslator, type Locale } from '../i18n'

export interface ImeInputHandle {
  /** Move the (1 px) composition box to a layer-relative point and focus it. */
  focusAt(left: number, top: number): void
  blur(): void
  /** Drop any value and composition state; used when the preview stops. */
  reset(): void
  isComposing(): boolean
}

export interface ImeInputProps {
  readonly active?: boolean
  readonly push: (event: PreviewInputEvent) => void
  /** Local rejection (over-long or malformed composition/paste text). */
  readonly onFailure?: () => void
  /** Fired when a new composition starts; the panel clears its failure notice. */
  readonly onCompositionStart?: () => void
  readonly locale?: Locale
}

export const IME_TEXTAREA_STYLE: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1,
  height: 1,
  padding: 0,
  margin: 0,
  border: 'none',
  outline: 'none',
  resize: 'none',
  overflow: 'hidden',
  opacity: 0,
  color: 'transparent',
  background: 'transparent',
  caretColor: 'transparent',
  pointerEvents: 'none',
  zIndex: 1,
  userSelect: 'none',
}

/**
 * Text that may be inserted as one unit. Composition can end with `data` set
 * to the committed phrase; older engines only update `value`, so callers may
 * pass either.
 */
export function compositionText(data: string | null | undefined, value: string): string | null {
  const text = data ?? value
  if (text.length === 0) return null
  return isInsertableText(text) ? text : null
}

export const ImeInput = React.forwardRef<ImeInputHandle, ImeInputProps>(
  function ImeInput(props, ref) {
    const { active = true, locale } = props
    const t = React.useMemo(() => createTranslator(locale ?? 'en'), [locale])
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null)
    const composingRef = React.useRef(false)
    const pushRef = React.useRef(props.push)
    const failureRef = React.useRef(props.onFailure)
    const startRef = React.useRef(props.onCompositionStart)
    pushRef.current = props.push
    failureRef.current = props.onFailure
    startRef.current = props.onCompositionStart

    const clearValue = React.useCallback((): void => {
      const node = textareaRef.current
      if (node && node.value !== '') node.value = ''
    }, [])

    React.useImperativeHandle(
      ref,
      () => ({
        focusAt(left, top) {
          const node = textareaRef.current
          if (!node) return
          node.style.left = `${Math.max(0, Math.round(left))}px`
          node.style.top = `${Math.max(0, Math.round(top))}px`
          try {
            node.focus({ preventScroll: true })
          } catch {
            node.focus()
          }
        },
        blur() {
          textareaRef.current?.blur()
        },
        reset() {
          composingRef.current = false
          clearValue()
        },
        isComposing() {
          return composingRef.current
        },
      }),
      [clearValue],
    )

    React.useEffect(() => {
      if (active) return
      composingRef.current = false
      clearValue()
      textareaRef.current?.blur()
    }, [active, clearValue])

    const onCompositionStart = (): void => {
      if (!active) return
      composingRef.current = true
      startRef.current?.()
    }

    const onCompositionUpdate = (): void => {
      // Intermediate composition text is deliberately not forwarded.
    }

    const onCompositionEnd = (event: React.CompositionEvent<HTMLTextAreaElement>): void => {
      if (!composingRef.current) return
      composingRef.current = false
      const text = compositionText(event.data, event.currentTarget.value)
      clearValue()
      if (!active) return
      if (text === null) {
        // Cancelled composition (`data: ''`) is not a failure; over-long or
        // malformed text is.
        if ((event.data ?? '').length > 0) failureRef.current?.()
        return
      }
      pushRef.current({ kind: 'text', text })
    }

    const onInput = (event: React.FormEvent<HTMLTextAreaElement>): void => {
      // Non-composed characters already left through key events; keep the box
      // empty. Clearing mid-composition would break the IME.
      if (composingRef.current) return
      event.currentTarget.value = ''
    }

    const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
      const pasted = event.clipboardData?.getData('text/plain') ?? ''
      if (pasted.length === 0) return
      event.preventDefault()
      event.currentTarget.value = ''
      if (!active) return
      const text = compositionText(pasted, '')
      if (text === null) {
        failureRef.current?.()
        return
      }
      pushRef.current({ kind: 'text', text })
    }

    return (
      <textarea
        ref={textareaRef}
        data-vibe-ime="1"
        aria-label={t('preview.input.ime.label')}
        tabIndex={-1}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        style={IME_TEXTAREA_STYLE}
        onCompositionStart={onCompositionStart}
        onCompositionUpdate={onCompositionUpdate}
        onCompositionEnd={onCompositionEnd}
        onInput={onInput}
        onPaste={onPaste}
      />
    )
  },
)
