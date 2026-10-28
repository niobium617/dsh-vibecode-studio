/**
 * Composer handoff (T032): put a queued annotation into the chat draft without
 * ever sending it.
 *
 * S2 (`spikes/s2/REPORT.md` §3.2–3.3) proved the only public route: a
 * null-rendering slot in `conversation.input.left` receives the session-scoped
 * `inputActions`, and `captureInsertion()` + `insertText()` write at the caret
 * without submitting. `setDraft` is the replace fallback. `createDrafts` and
 * `ctx.conversation.send()` are deliberately not used — they are not public
 * API, and adding screenshot attachments would put the product on an internal
 * implementation detail.
 *
 * The bridge lives outside the conversation slot tree because the Studio tab is
 * a sidebar-right tab. Sessions are keyed by id and the most recently attached
 * one is active, so switching chats retargets the handoff instead of mixing
 * drafts. When no composer is attached (or the write fails) the text goes to
 * the clipboard — the S2 fallback — and the queue keeps the draft if even that
 * fails.
 */
import * as React from 'react'
import type { AnnotationSender } from './AnnotationQueue'
import { createTranslator, type Locale } from '../i18n'

/**
 * The public `InputActions` face used here (S2 §3.3). `submit`/`send` are not
 * part of it on purpose: nothing in this module can send a message.
 */
export interface ComposerInputActions {
  captureInsertion(): unknown
  insertText(text: string, span: unknown): boolean
  setDraft?(text: string): void
}

export interface ComposerHandoffSnapshot {
  readonly attached: boolean
  readonly sessionId: string | null
  readonly draft: string
  readonly phase: string
}

export type HandoffPlacement = 'composer' | 'clipboard'

export interface HandoffOutcome {
  readonly placement: HandoffPlacement
  /** Session whose composer received the text; null for the clipboard. */
  readonly sessionId: string | null
}

interface ComposerAttachment {
  readonly sessionId: string
  readonly actions: ComposerInputActions
  /** Mirrors `useInput().draft`; only used to pick the separator and fall back. */
  draft: string
  phase: string
}

const attachments = new Map<string, ComposerAttachment>()
let activeSessionId: string | null = null
let cached: ComposerHandoffSnapshot = {
  attached: false,
  sessionId: null,
  draft: '',
  phase: 'unknown',
}
const listeners = new Set<() => void>()

function isInputActions(value: unknown): value is ComposerInputActions {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Partial<ComposerInputActions>
  return (
    typeof candidate.captureInsertion === 'function' &&
    typeof candidate.insertText === 'function'
  )
}

function shapeInput(value: unknown): { draft: string; phase: string } {
  const record =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    draft: typeof record.draft === 'string' ? record.draft : '',
    phase: typeof record.phase === 'string' ? record.phase : 'unknown',
  }
}

function activeAttachment(): ComposerAttachment | null {
  return activeSessionId === null ? null : attachments.get(activeSessionId) ?? null
}

/** Stable until the next visible change, as `useSyncExternalStore` requires. */
export function composerHandoffSnapshot(): ComposerHandoffSnapshot {
  return cached
}

export function subscribeComposerHandoff(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function publish(): void {
  const active = activeAttachment()
  const next: ComposerHandoffSnapshot =
    active === null
      ? { attached: false, sessionId: null, draft: '', phase: 'unknown' }
      : {
          attached: true,
          sessionId: active.sessionId,
          draft: active.draft,
          phase: active.phase,
        }
  if (
    next.attached === cached.attached &&
    next.sessionId === cached.sessionId &&
    next.draft === cached.draft &&
    next.phase === cached.phase
  ) {
    return
  }
  cached = next
  for (const listener of [...listeners]) listener()
}

/**
 * Binds one session's composer. The latest attach wins, which is what the
 * visible conversation slot does when the user switches chats (S2 §4). A
 * repeated attach for the same session keeps its draft/phase copies.
 */
export function attachComposerHandoff(
  sessionId: string,
  actions: ComposerInputActions,
): boolean {
  if (sessionId.length === 0 || !isInputActions(actions)) return false
  const existing = attachments.get(sessionId)
  attachments.set(sessionId, {
    sessionId,
    actions,
    draft: existing?.draft ?? '',
    phase: existing?.phase ?? 'unknown',
  })
  activeSessionId = sessionId
  publish()
  return true
}

/**
 * Unbinds a session. `actions` guards against a stale unmount (the old slot
 * unmounting after the new session already attached) clearing the live one.
 */
export function detachComposerHandoff(
  sessionId: string,
  actions?: ComposerInputActions,
): boolean {
  const entry = attachments.get(sessionId)
  if (entry === undefined) return false
  if (actions !== undefined && entry.actions !== actions) return false
  attachments.delete(sessionId)
  if (activeSessionId === sessionId) {
    const remaining = [...attachments.keys()]
    activeSessionId = remaining.length > 0 ? remaining[remaining.length - 1]! : null
  }
  publish()
  return true
}

/** Mirrors the composer's own input state for the separator and fallbacks. */
export function setComposerHandoffInput(sessionId: string, input: unknown): void {
  const entry = attachments.get(sessionId)
  if (entry === undefined) return
  const next = shapeInput(input)
  entry.draft = next.draft
  entry.phase = next.phase
  publish()
}

/** Tests and a future teardown use this; the slot lifecycle does not call it. */
export function resetComposerHandoff(): void {
  attachments.clear()
  activeSessionId = null
  publish()
}

export function activeComposerSession(): string | null {
  return activeAttachment()?.sessionId ?? null
}

async function copyTextToClipboard(text: string): Promise<void> {
  const clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard
  if (clipboard == null || typeof clipboard.writeText !== 'function') {
    throw new Error('clipboard unavailable')
  }
  await clipboard.writeText(text)
}

/**
 * Writes at the caret; a separator keeps two annotations readable when the
 * user already typed something. `insertText` inserts rather than replaces, so
 * an explicit `false` falls back to a whole-draft replace. A throw is treated
 * as an unusable composer: replacing from our mirrored draft could clobber the
 * user's own text, so the caller falls back to the clipboard instead.
 */
function insertIntoComposer(attachment: ComposerAttachment, text: string): void {
  const separator = attachment.draft.trim().length > 0 ? '\n\n' : ''
  const payload = `${separator}${text}`
  const span = attachment.actions.captureInsertion()
  const accepted = attachment.actions.insertText(payload, span)
  if (accepted === false) {
    if (typeof attachment.actions.setDraft !== 'function') {
      throw new Error('composer refused the draft')
    }
    attachment.actions.setDraft(`${attachment.draft}${separator}${text}`)
  }
  // The composer re-reports through `useInput`; this keeps rapid double-sends
  // from adding a second separator in the same tick.
  attachment.draft = `${attachment.draft}${payload}`
  publish()
}

/**
 * Hands the rendered annotation to the active composer, never sending it.
 * Throws only when neither the composer nor the clipboard accepted the text, so
 * the queue keeps the draft instead of losing it.
 */
export async function handoffAnnotationText(text: string): Promise<HandoffOutcome> {
  if (text.trim().length === 0) throw new Error('nothing to hand off')
  const attachment = activeAttachment()
  if (attachment === null) {
    await copyTextToClipboard(text)
    return { placement: 'clipboard', sessionId: null }
  }
  try {
    insertIntoComposer(attachment, text)
  } catch {
    await copyTextToClipboard(text)
    return { placement: 'clipboard', sessionId: null }
  }
  return { placement: 'composer', sessionId: attachment.sessionId }
}

/** The queue's real sender: the composer when attached, the clipboard otherwise. */
export function createComposerHandoffSender(locale: Locale = 'en'): AnnotationSender {
  const t = createTranslator(locale)
  return async (_annotation, text) => {
    const outcome = await handoffAnnotationText(text)
    return t(outcome.placement === 'composer' ? 'annotation.item.inserted' : 'annotation.item.sent')
  }
}

export interface ComposerHandoffSlotProps {
  readonly sessionId?: string | null
  readonly inputActions?: unknown
  readonly useInput?: (selector: (state: unknown) => unknown) => unknown
}

const noInput = (): unknown => null

/**
 * Null-rendering slot in `conversation.input.left` (S2 §3.2): it only forwards
 * the public props to the bridge. `useInput` is read through a stable hook so
 * the hook order never changes if an older host omits it.
 */
export function ComposerHandoffSlot(props: ComposerHandoffSlotProps): null {
  const useInput = typeof props.useInput === 'function' ? props.useInput : noInput
  const input = useInput((state: unknown) => state)
  const sessionId =
    typeof props.sessionId === 'string' && props.sessionId.length > 0 ? props.sessionId : null
  const actions = props.inputActions

  React.useEffect(() => {
    if (sessionId === null || !isInputActions(actions)) return
    attachComposerHandoff(sessionId, actions)
    return () => {
      detachComposerHandoff(sessionId, actions)
    }
  }, [sessionId, actions])

  React.useEffect(() => {
    if (sessionId !== null) setComposerHandoffInput(sessionId, input)
  }, [sessionId, input])

  return null
}
