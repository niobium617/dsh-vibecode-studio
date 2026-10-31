/**
 * T049 approval gate: `start`/`stop` are the only `vibe_preview` actions that
 * mutate the machine, so they are the only ones that answer `ask` from the
 * `tools/pre-execute` listener. Everything else must delegate with `next()` so
 * later gates (T053's guard) still get a say — an `allow` here would skip them.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createPreviewApprovalGate,
  PREVIEW_TOOL_NAME,
  previewApprovalDecision,
} from '../../../src/host/agent/tools/preview'

const ALLOW = { kind: 'allow' as const }

function nextSpy() {
  return vi.fn(async () => ALLOW)
}

describe('previewApprovalDecision (T049)', () => {
  it('asks before starting, naming the URL', () => {
    const decision = previewApprovalDecision({
      name: PREVIEW_TOOL_NAME,
      arguments: { action: 'start', url: 'http://127.0.0.1:4320/' },
    })
    expect(decision).toMatchObject({
      kind: 'ask',
      reason: 'vibe_preview start http://127.0.0.1:4320/',
    })
    expect(decision?.displayReason?.en).toBe('Start the Vibe Studio preview at http://127.0.0.1:4320/?')
    expect(decision?.displayReason?.['zh-CN']).toBe('是否启动 Vibe Studio 预览（http://127.0.0.1:4320/）？')
  })

  it('still asks for start without a URL', () => {
    const decision = previewApprovalDecision({ name: PREVIEW_TOOL_NAME, arguments: { action: 'start' } })
    expect(decision?.kind).toBe('ask')
    expect(decision?.reason).toBe('vibe_preview start')
    expect(decision?.displayReason?.en).toBe('Start the Vibe Studio preview?')
  })

  it('asks before stopping', () => {
    const decision = previewApprovalDecision({ name: PREVIEW_TOOL_NAME, arguments: { action: 'stop' } })
    expect(decision).toMatchObject({ kind: 'ask', reason: 'vibe_preview stop' })
    expect(decision?.displayReason).toEqual({
      en: 'Stop the Vibe Studio preview?',
      'zh-CN': '是否停止 Vibe Studio 预览？',
    })
  })

  it('never asks for read-only or same-session actions', () => {
    for (const action of ['reload', 'navigate', 'screenshot']) {
      expect(
        previewApprovalDecision({
          name: PREVIEW_TOOL_NAME,
          arguments: { action, url: 'http://127.0.0.1:4320/' },
        }),
      ).toBeNull()
    }
  })

  it('ignores other tools and malformed arguments', () => {
    expect(previewApprovalDecision({ name: 'vibe_status', arguments: { action: 'start' } })).toBeNull()
    expect(previewApprovalDecision({ name: PREVIEW_TOOL_NAME })).toBeNull()
    expect(previewApprovalDecision({ name: PREVIEW_TOOL_NAME, arguments: null })).toBeNull()
    expect(previewApprovalDecision({ name: PREVIEW_TOOL_NAME, arguments: ['start'] })).toBeNull()
    expect(previewApprovalDecision({ name: PREVIEW_TOOL_NAME, arguments: { action: 1 } })).toBeNull()
    expect(previewApprovalDecision({ name: PREVIEW_TOOL_NAME, arguments: { action: 'open' } })).toBeNull()
  })

  it('keeps the prompt text bounded and control-free', () => {
    const long = `http://127.0.0.1:4320/${'a'.repeat(400)}`
    const decision = previewApprovalDecision({ name: PREVIEW_TOOL_NAME, arguments: { action: 'start', url: long } })
    const shown = decision?.displayReason?.en ?? ''
    expect(shown.endsWith('?')).toBe(true)
    expect(shown.length).toBeLessThan(160)
    expect(shown).toContain('…')

    const dirty = previewApprovalDecision({
      name: PREVIEW_TOOL_NAME,
      arguments: { action: 'start', url: 'http://127.0.0.1:4320/\u0000\u001b[31m' },
    })
    expect(dirty?.displayReason?.en).not.toMatch(/[\u0000-\u001f]/)
  })
})

describe('createPreviewApprovalGate (T049)', () => {
  it('returns ask for start without consulting the later listeners', async () => {
    const next = nextSpy()
    const gate = createPreviewApprovalGate()
    const decision = await gate(
      { name: PREVIEW_TOOL_NAME, arguments: { action: 'start', url: 'http://127.0.0.1:4320/' } },
      next,
    )
    expect(decision.kind).toBe('ask')
    expect(next).not.toHaveBeenCalled()
  })

  it('returns ask for stop', async () => {
    const next = nextSpy()
    const gate = createPreviewApprovalGate()
    const decision = await gate({ name: PREVIEW_TOOL_NAME, arguments: { action: 'stop' } }, next)
    expect(decision).toMatchObject({ kind: 'ask', reason: 'vibe_preview stop' })
    expect(next).not.toHaveBeenCalled()
  })

  it('delegates every other call to next()', async () => {
    const gate = createPreviewApprovalGate()
    const cases = [
      { name: PREVIEW_TOOL_NAME, arguments: { action: 'reload' } },
      { name: PREVIEW_TOOL_NAME, arguments: { action: 'navigate', url: 'http://127.0.0.1:4320/x' } },
      { name: PREVIEW_TOOL_NAME, arguments: { action: 'screenshot' } },
      { name: 'vibe_observe', arguments: {} },
    ]
    for (const exec of cases) {
      const next = nextSpy()
      await expect(gate(exec, next)).resolves.toEqual(ALLOW)
      expect(next).toHaveBeenCalledTimes(1)
    }
  })

  it('propagates a deny from a later listener unchanged', async () => {
    const deny = { kind: 'deny' as const, reason: 'blocked by the stale guard' }
    const gate = createPreviewApprovalGate()
    await expect(
      gate({ name: PREVIEW_TOOL_NAME, arguments: { action: 'reload' } }, async () => deny),
    ).resolves.toBe(deny)
  })
})
