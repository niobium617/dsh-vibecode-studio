/**
 * T002 S2 client half: bridge the right-sidebar Studio tab to the public
 * composer `InputActions` face.
 *
 * A null-rendering component in `conversation.input.left` receives the
 * session-scoped `inputActions` and `sessionId`. The Studio tab lives outside
 * the conversation slot tree, so it reads those through a module-local bridge.
 *
 * Only public slot props and public input actions are used. We never import
 * the conversation store, never call `submit()`, and never call
 * `ctx.conversation.send()`. The optional screenshot attachment path
 * feature-detects `ctx.conversation.createDrafts`, which is not part of the
 * public `IConversation` type in 0.2.1-rc.2; if absent, the clipboard fallback
 * is the supported route.
 */
import * as React from 'react'

export const inject = ['slots', 'sidebarRight', 'sidebarRightTabs']

const ID = 'dsh-vibe-s2-spike'
const KIND = 'vibe-studio-s2'
const TEXT_MARKER = '[vibe-s2]'

type Phase = 'plain' | 'adjudicating' | 'claimed' | 'submitting' | 'unknown'

interface PublicInputActions {
  captureInsertion(): unknown
  insertText(text: string, span: unknown): boolean
  setDraft(text: string): void
  addAttachments(ids: readonly string[]): boolean
  removeAttachment?(id: string): void
}

interface InputSnapshot {
  draft: string
  phase: Phase
  attachmentIds: readonly string[]
}

interface BridgeSnapshot extends InputSnapshot {
  attached: boolean
  sessionId: string | null
}

const EMPTY_INPUT: InputSnapshot = { draft: '', phase: 'unknown', attachmentIds: [] }

function shapeInput(value: any): InputSnapshot {
  return {
    draft: typeof value?.draft === 'string' ? value.draft : '',
    phase: typeof value?.phase === 'string' ? value.phase as Phase : 'unknown',
    attachmentIds: Array.isArray(value?.attachmentIds) ? [...value.attachmentIds] : [],
  }
}

class ComposerBridge {
  private actions: PublicInputActions | null = null
  private sessionId: string | null = null
  private input: InputSnapshot = EMPTY_INPUT
  private cached: BridgeSnapshot = { attached: false, sessionId: null, ...EMPTY_INPUT }
  private readonly listeners = new Set<() => void>()

  attach(sessionId: string | null, actions: PublicInputActions | null): void {
    if (sessionId === null || actions === null) return
    if (this.sessionId === sessionId && this.actions === actions) return
    this.sessionId = sessionId
    this.actions = actions
    this.publish()
  }

  detach(sessionId: string | null, actions: PublicInputActions | null): void {
    if (this.sessionId !== sessionId || this.actions !== actions) return
    this.sessionId = null
    this.actions = null
    this.input = EMPTY_INPUT
    this.publish()
  }

  setInput(value: any): void {
    const next = shapeInput(value)
    if (
      next.draft === this.input.draft &&
      next.phase === this.input.phase &&
      next.attachmentIds.length === this.input.attachmentIds.length &&
      next.attachmentIds.every((id, index) => id === this.input.attachmentIds[index])
    ) return
    this.input = next
    this.publish()
  }

  snapshot = (): BridgeSnapshot => this.cached

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  current(): { actions: PublicInputActions; sessionId: string } | null {
    if (this.actions === null || this.sessionId === null) return null
    return { actions: this.actions, sessionId: this.sessionId }
  }

  private publish(): void {
    this.cached = {
      attached: this.actions !== null && this.sessionId !== null,
      sessionId: this.sessionId,
      ...this.input,
    }
    for (const listener of this.listeners) listener()
  }
}

const bridge = new ComposerBridge()
let lastAction: Record<string, unknown> | null = null

function record(action: string, detail: Record<string, unknown>): void {
  lastAction = { action, at: new Date().toISOString(), ...detail }
}

function requireBridge(): { actions: PublicInputActions; sessionId: string } | null {
  const current = bridge.current()
  if (current === null) record('error', { message: 'composer bridge is not attached; select a session first' })
  return current
}

function ComposerBridgeSlot(props: any): null {
  const input = props.useInput((state: any) => state)
  React.useEffect(() => {
    bridge.attach(props.sessionId ?? null, props.inputActions ?? null)
    return () => bridge.detach(props.sessionId ?? null, props.inputActions ?? null)
  }, [props.sessionId, props.inputActions])
  React.useEffect(() => {
    bridge.setInput(input)
  }, [input])
  return null
}

function useBridge(): BridgeSnapshot {
  return React.useSyncExternalStore(bridge.subscribe, bridge.snapshot, bridge.snapshot)
}

function setDraft(text: string): Record<string, unknown> {
  const current = requireBridge()
  if (current === null) return { ok: false, error: 'bridge detached' }
  try {
    current.actions.setDraft(text)
    record('setDraft', { sessionId: current.sessionId, length: text.length })
    return { ok: true, sessionId: current.sessionId, length: text.length }
  } catch (error) {
    record('setDraft:error', { message: String(error) })
    return { ok: false, error: String(error) }
  }
}

function insertText(text: string): Record<string, unknown> {
  const current = requireBridge()
  if (current === null) return { ok: false, error: 'bridge detached' }
  try {
    const span = current.actions.captureInsertion()
    const inserted = current.actions.insertText(text, span)
    record('insertText', { sessionId: current.sessionId, inserted, length: text.length })
    return { ok: inserted, inserted, sessionId: current.sessionId, length: text.length, span }
  } catch (error) {
    record('insertText:error', { message: String(error) })
    return { ok: false, error: String(error) }
  }
}

function clearDraft(): Record<string, unknown> {
  return setDraft('')
}

async function screenshotFile(): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 200
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2d canvas unavailable')
  context.fillStyle = '#1f6feb'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#ffffff'
  context.font = '20px sans-serif'
  context.fillText('Vibe Studio S2', 24, 80)
  context.font = '14px sans-serif'
  context.fillText('screenshot fallback', 24, 110)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value === null ? reject(new Error('canvas.toBlob returned null')) : resolve(value), 'image/png')
  })
  return new File([blob], 'vibe-s2-screenshot.png', { type: 'image/png' })
}

async function attachScreenshot(ctx: any): Promise<Record<string, unknown>> {
  const current = requireBridge()
  if (current === null) return { ok: false, error: 'bridge detached' }
  const conversation = (typeof ctx.get === 'function' ? ctx.get('conversation') : ctx.conversation) as any
  if (conversation === null || typeof conversation?.createDrafts !== 'function') {
    record('attachScreenshot:unavailable', {})
    return {
      ok: false,
      supported: false,
      reason: 'ctx.conversation.createDrafts is not exposed in this DSH version',
    }
  }
  try {
    const file = await screenshotFile()
    const drafts = conversation.createDrafts(current.sessionId, [file], true)
    const ids = drafts.map((draft: any) => String(draft.id))
    const accepted = current.actions.addAttachments(ids)
    if (!accepted) {
      for (const id of ids) current.actions.removeAttachment?.(id)
    }
    record('attachScreenshot', { sessionId: current.sessionId, ids, accepted })
    return { ok: accepted, supported: true, ids, accepted, files: drafts.length }
  } catch (error) {
    record('attachScreenshot:error', { message: String(error) })
    return { ok: false, supported: true, error: String(error) }
  }
}

async function copyText(text: string): Promise<Record<string, unknown>> {
  try {
    if (navigator.clipboard?.writeText === undefined) throw new Error('clipboard.writeText unavailable')
    await navigator.clipboard.writeText(text)
    record('copyText', { length: text.length })
    return { ok: true, length: text.length }
  } catch (error) {
    record('copyText:error', { message: String(error) })
    return { ok: false, error: String(error) }
  }
}

async function copyScreenshot(): Promise<Record<string, unknown>> {
  try {
    if (navigator.clipboard?.write === undefined) throw new Error('clipboard.write unavailable')
    if (typeof ClipboardItem === 'undefined') throw new Error('ClipboardItem unavailable')
    const file = await screenshotFile()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': file })])
    record('copyScreenshot', { bytes: file.size })
    return { ok: true, bytes: file.size }
  } catch (error) {
    record('copyScreenshot:error', { message: String(error) })
    return { ok: false, error: String(error) }
  }
}

function sampleNote(): string {
  return [
    `${TEXT_MARKER} Vibe Studio handoff test`,
    '',
    '- route: /checkout',
    '- selector: button.primary',
    '- note: 请把主按钮改成品牌色，并保留键盘焦点样式。',
  ].join('\n')
}

function Panel(): React.ReactElement {
  const state = useBridge()
  const [message, setMessage] = React.useState('')
  const note = sampleNote()
  const run = async (label: string, action: () => Record<string, unknown> | Promise<Record<string, unknown>>): Promise<void> => {
    const result = await action()
    setMessage(`${label}: ${JSON.stringify(result)}`)
  }
  return (
    <div style={{ padding: 12, font: '13px/1.45 system-ui, sans-serif', display: 'grid', gap: 8 }}>
      <strong>Vibe Studio S2 · composer handoff</strong>
      <div>
        bridge: {state.attached ? `attached · ${state.sessionId}` : 'detached'} · phase: {state.phase} · attachments: {state.attachmentIds.length}
      </div>
      <div style={{ whiteSpace: 'pre-wrap', background: 'rgba(127,127,127,.12)', padding: 8, borderRadius: 6, maxHeight: 110, overflow: 'auto' }}>
        {state.draft || '(draft empty)'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <button onClick={() => void run('setDraft', () => setDraft(note))}>Replace draft</button>
        <button onClick={() => void run('insertText', () => insertText(`\n${TEXT_MARKER} appended note`))}>Insert at caret</button>
        <button onClick={() => void run('clear', clearDraft)}>Clear</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <button onClick={() => void run('attachScreenshot', () => (globalThis as any).__vibeS2.attachScreenshot())}>Attach screenshot</button>
        <button onClick={() => void run('copyText', () => copyText(note))}>Copy text</button>
        <button onClick={() => void run('copyScreenshot', copyScreenshot)}>Copy screenshot</button>
      </div>
      <div style={{ opacity: 0.75, whiteSpace: 'pre-wrap' }}>{message || 'No action yet. Nothing is sent automatically.'}</div>
    </div>
  )
}

export function apply(ctx: any): void {
  const panel = React.createElement(Panel)

  ctx.effect(() => ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: ID,
    order: 20,
    inject: (sessionId: string) => ({ sessionId }),
  }, ComposerBridgeSlot)), 'vibe-s2: composer bridge')

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID,
    kind: KIND,
    title: () => 'Vibe Studio S2',
    guide: [{
      id: 'vibe-studio-s2',
      title: () => 'Vibe Studio S2',
      description: () => 'Composer handoff spike',
      order: 11,
    }],
    keepMounted: true,
  }), 'vibe-s2: tab type')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: ID,
  }, () => panel)), 'vibe-s2: tab body')

  const debug = {
    openTab: (): unknown => {
      try {
        ctx.sidebarRight.openTab(KIND)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: String(error) }
      }
    },
    closeActiveTab: (): unknown => {
      try {
        const tab = ctx.sidebarRight.active()
        if (tab == null) return null
        ctx.sidebarRight.close(tab.id)
        return tab.id
      } catch (error) {
        return { error: String(error) }
      }
    },
    status: (): unknown => ({ bridge: bridge.snapshot(), lastAction }),
    setDraft,
    insertText,
    clearDraft,
    attachScreenshot: (): Promise<Record<string, unknown>> => attachScreenshot(ctx),
    copyText,
    copyScreenshot,
    note: sampleNote(),
    version: 's2-1',
  }
  ;(globalThis as any).__vibeS2 = debug
  ctx.effect(() => () => {
    if ((globalThis as any).__vibeS2 === debug) delete (globalThis as any).__vibeS2
  }, 'vibe-s2: debug surface')
}
