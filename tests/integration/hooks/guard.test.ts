/**
 * T053 overreach guard: `vibe_preview` never reaches an approval prompt or a
 * browser for targets outside the policy. The guard lives in the preset scope,
 * so standard sessions never see it; these tests cover the decision table and
 * that everything it does not deny still delegates with `next()`.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createPreviewGuard,
  previewGuardDecision,
  type PreviewGuardDeps,
} from '../../../src/host/agent/hooks/guard'

const PREVIEW = 'vibe_preview'

function deps(overrides: Partial<PreviewGuardDeps> = {}): PreviewGuardDeps {
  const config = {
    allowedOrigins: ['http://localhost', 'http://127.0.0.1'],
    screenshotEnabled: true,
    retentionDays: 7,
  }
  return {
    config: () => config,
    currentUrl: () => null,
    ...overrides,
  }
}

function exec(action: string, url?: string): { name: string; arguments: unknown } {
  return { name: PREVIEW, arguments: url === undefined ? { action } : { action, url } }
}

describe('previewGuardDecision (T053)', () => {
  it('denies start and navigate to a non-loopback host', () => {
    for (const action of ['start', 'navigate']) {
      const decision = previewGuardDecision(exec(action, 'http://example.com/'), deps())
      expect(decision).toMatchObject({ kind: 'deny', info: { code: 'permission_denied' } })
      expect(decision?.reason).toContain('not local')
    }
  })

  it('denies a loopback origin that is not in allowedOrigins', () => {
    const decision = previewGuardDecision(exec('start', 'http://127.0.0.1:4320/'), deps())
    expect(decision?.kind).toBe('deny')
    expect(decision?.reason).toContain('http://127.0.0.1:4320')
    expect(decision?.reason).toContain('allowedOrigins')
  })

  it('allows a loopback URL inside allowedOrigins', () => {
    expect(previewGuardDecision(exec('start', 'http://127.0.0.1/'), deps())).toBeNull()
  })

  it('denies a cross-origin navigate from a live page', () => {
    const decision = previewGuardDecision(
      exec('navigate', 'http://localhost:4320/other'),
      deps({
        config: () => ({
          allowedOrigins: ['http://127.0.0.1:4320', 'http://localhost:4320'],
          screenshotEnabled: true,
          retentionDays: 7,
        }),
        currentUrl: () => 'http://127.0.0.1:4320/',
      }),
    )
    expect(decision?.kind).toBe('deny')
    expect(decision?.reason).toContain('http://127.0.0.1:4320')
  })

  it('allows a same-origin navigate and any navigate while closed', () => {
    const live = deps({
      config: () => ({
        allowedOrigins: ['http://127.0.0.1:4320'],
        screenshotEnabled: true,
        retentionDays: 7,
      }),
      currentUrl: () => 'http://127.0.0.1:4320/page',
    })
    expect(previewGuardDecision(exec('navigate', 'http://127.0.0.1:4320/next'), live)).toBeNull()
    // No live page: origins still apply, but the tool reports target_unavailable
    // instead of the guard inventing a cross-origin denial.
    const closed = deps({
      config: () => ({
        allowedOrigins: ['http://127.0.0.1:4320'],
        screenshotEnabled: true,
        retentionDays: 7,
      }),
    })
    expect(previewGuardDecision(exec('navigate', 'http://127.0.0.1:4320/next'), closed)).toBeNull()
  })

  it('denies screenshots while the setting is off and follows live config', () => {
    const off = deps({
      config: () => ({ allowedOrigins: [], screenshotEnabled: false, retentionDays: 7 }),
    })
    expect(previewGuardDecision(exec('screenshot'), off)).toMatchObject({
      kind: 'deny',
      reason: 'vibe-studio: screenshots are disabled in settings',
    })
    expect(previewGuardDecision(exec('screenshot'), deps())).toBeNull()
  })

  it('leaves malformed calls to the schema and the tool body', () => {
    const cases = [
      { name: 'vibe_status', arguments: { action: 'screenshot' } },
      { name: PREVIEW, arguments: null },
      { name: PREVIEW, arguments: ['start'] },
      { name: PREVIEW, arguments: { action: 1 } },
      { name: PREVIEW, arguments: { action: 'open' } },
      // navigate without a URL, a non-string URL and an unparsable URL are the
      // tool's `invalid_input`, not policy.
      { name: PREVIEW, arguments: { action: 'navigate' } },
      { name: PREVIEW, arguments: { action: 'navigate', url: 42 } },
      { name: PREVIEW, arguments: { action: 'navigate', url: 'not a url' } },
      { name: PREVIEW, arguments: { action: 'start', url: 'file:///etc/passwd' } },
    ]
    for (const call of cases) {
      expect(previewGuardDecision(call, deps()), JSON.stringify(call)).toBeNull()
    }
  })

  it('never denies reload or stop', () => {
    expect(previewGuardDecision(exec('reload'), deps())).toBeNull()
    expect(previewGuardDecision(exec('stop'), deps())).toBeNull()
  })
})

describe('createPreviewGuard (T053)', () => {
  it('returns a deny without consulting later listeners', async () => {
    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    const guard = createPreviewGuard(deps())
    const decision = await guard(exec('start', 'http://example.com/'), next)
    expect(decision).toMatchObject({ kind: 'deny' })
    expect(next).not.toHaveBeenCalled()
  })

  it('delegates non-overreach calls so the approval gate still runs', async () => {
    const guard = createPreviewGuard(deps())
    const calls = [
      exec('reload'),
      exec('screenshot'),
      { name: PREVIEW, arguments: { action: 'start', url: 'http://127.0.0.1/' } },
      { name: 'vibe_observe', arguments: {} },
    ]
    for (const call of calls) {
      const next = vi.fn(async () => ({ kind: 'ask' as const, reason: 'approve?' }))
      await expect(guard(call, next)).resolves.toMatchObject({ kind: 'ask' })
      expect(next).toHaveBeenCalledTimes(1)
    }
  })

  it('propagates a later deny unchanged', async () => {
    const deny = { kind: 'deny' as const, reason: 'later listener' }
    const guard = createPreviewGuard(deps())
    await expect(guard(exec('reload'), async () => deny)).resolves.toBe(deny)
  })
})
