/**
 * T053 stale marker: only a successful `write`/`edit` marks the running preview
 * as possibly outdated, and the hook never changes the tool result — it always
 * returns whatever the later listeners decided.
 */
import { describe, expect, it, vi } from 'vitest'
import { createStaleHook, EDITING_TOOL_NAMES } from '../../../src/host/agent/hooks/stale'

const ACCEPT = { kind: 'accept' as const }

function harness() {
  const markStale = vi.fn()
  const hook = createStaleHook({ markStale })
  return { markStale, hook }
}

describe('createStaleHook (T053)', () => {
  it('marks after a successful write or edit', async () => {
    for (const name of EDITING_TOOL_NAMES) {
      const { markStale, hook } = harness()
      await hook({ name }, { isError: false }, async () => ACCEPT)
      expect(markStale, name).toHaveBeenCalledTimes(1)
    }
    expect([...EDITING_TOOL_NAMES].sort()).toEqual(['edit', 'write'])
  })

  it('ignores read-only and shell tools', async () => {
    for (const name of ['read', 'read_image', 'glob', 'grep', 'bash', 'pwsh', 'vibe_status']) {
      const { markStale, hook } = harness()
      await hook({ name }, { isError: false }, async () => ACCEPT)
      expect(markStale, name).not.toHaveBeenCalled()
    }
  })

  it('does not mark when the tool failed', async () => {
    const { markStale, hook } = harness()
    await hook({ name: 'edit' }, { isError: true }, async () => ACCEPT)
    expect(markStale).not.toHaveBeenCalled()
  })

  it('does not mark when a later listener blocks the result', async () => {
    const { markStale, hook } = harness()
    const block = { kind: 'block' as const, feedback: [{ type: 'text', text: 'no' }] }
    await expect(hook({ name: 'write' }, { isError: false }, async () => block)).resolves.toBe(block)
    expect(markStale).not.toHaveBeenCalled()
  })

  it('runs the later listeners first and returns their decision unchanged', async () => {
    const { markStale, hook } = harness()
    const accepted = { kind: 'accept' as const, additionalContexts: [] }
    const order: string[] = []
    const next = async () => {
      order.push('next')
      expect(markStale).not.toHaveBeenCalled()
      return accepted
    }
    await expect(hook({ name: 'edit' }, { isError: false }, next)).resolves.toBe(accepted)
    expect(order).toEqual(['next'])
    expect(markStale).toHaveBeenCalledTimes(1)
  })

  it('marks nothing when a later listener throws', async () => {
    const { markStale, hook } = harness()
    await expect(
      hook({ name: 'edit' }, { isError: false }, async () => {
        throw new Error('later listener failed')
      }),
    ).rejects.toThrow('later listener failed')
    expect(markStale).not.toHaveBeenCalled()
  })
})
