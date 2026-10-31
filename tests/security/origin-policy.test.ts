/**
 * T059 origin audit (FR-SEC-01/02, SPEC §9 "localhost only").
 *
 * The guard runs before approval and before dispatch, so every denied case here
 * is a call that must never prompt the user and never touch a browser.
 */
import { describe, expect, it } from 'vitest'
import { isStudioError } from '../../src/contracts/errors'
import { isLoopbackHost } from '../../src/host/preview/url'
import {
  parseHttpUrl,
  requireAllowedOrigin,
  requireLoopback,
} from '../../src/host/agent/tools/preview'
import { previewGuardDecision } from '../../src/host/agent/hooks/guard'
import { isLocalPreviewUrl } from '../../src/client/preview/local-url'

const CONFIG = {
  allowedOrigins: ['http://127.0.0.1:4320'],
  screenshotEnabled: false,
  retentionDays: 7,
}

const deps = (overrides: Partial<typeof CONFIG> = {}, currentUrl: string | null = 'http://127.0.0.1:4320/') => ({
  config: () => ({ ...CONFIG, ...overrides }),
  currentUrl: () => currentUrl,
})

describe('loopback predicate', () => {
  it.each(['localhost', 'app.localhost', '127.0.0.1', '127.9.8.7', '::1', '[::1]'])(
    'treats %s as loopback',
    (host) => {
      expect(isLoopbackHost(host)).toBe(true)
    },
  )

  it.each([
    '0.0.0.0',
    'example.com',
    '127.0.0.1.evil.example',
    '10.0.0.1',
    '192.168.1.5',
    'localhost.evil.example',
  ])('does not treat %s as loopback', (host) => {
    expect(isLoopbackHost(host)).toBe(false)
  })

  it('the client offers the same loopback-only URLs', () => {
    for (const url of [
      'http://localhost:4320/',
      'http://app.localhost:4320/',
      'http://127.0.0.1:4320/',
      'https://127.0.0.1:4320/path?q=1',
    ]) {
      expect(isLocalPreviewUrl(url)).toBe(true)
    }
    for (const url of [
      'http://0.0.0.0:4320/',
      'http://example.com/',
      'file:///C:/Windows/System32/',
      'chrome://settings/',
      'devtools://devtools/bundled/inspector.html',
      'http://user:pass@127.0.0.1:4320/',
    ]) {
      expect(isLocalPreviewUrl(url)).toBe(false)
    }
  })
})

describe('URL parsing', () => {
  it.each([
    'file:///C:/Windows/System32/',
    'chrome://settings/',
    'devtools://devtools/bundled/inspector.html',
    'javascript:alert(1)',
    'data:text/html,<h1>x</h1>',
    'ftp://127.0.0.1/',
  ])('rejects the %s scheme', (url) => {
    try {
      parseHttpUrl(url, 'url')
      throw new Error('expected parseHttpUrl to reject')
    } catch (error) {
      expect(isStudioError(error)).toBe(true)
      if (isStudioError(error)) expect(error.code).toBe('invalid_input')
    }
  })

  it('rejects URL credentials and accepts a plain local URL', () => {
    expect(() => parseHttpUrl('http://user:pass@127.0.0.1/', 'url')).toThrow()
    expect(parseHttpUrl('http://127.0.0.1:4320/', 'url').origin).toBe('http://127.0.0.1:4320')
  })
})

describe('policy helpers', () => {
  it('requireLoopback refuses non-local hosts even when allow-listed', () => {
    const url = new URL('https://example.com/')
    try {
      requireLoopback(url)
      throw new Error('expected requireLoopback to throw')
    } catch (error) {
      expect(isStudioError(error)).toBe(true)
      if (isStudioError(error)) expect(error.code).toBe('permission_denied')
    }
  })

  it('requireAllowedOrigin compares exact origins', () => {
    expect(() =>
      requireAllowedOrigin(new URL('http://127.0.0.1:4320/'), CONFIG.allowedOrigins),
    ).not.toThrow()
    expect(() =>
      requireAllowedOrigin(new URL('http://127.0.0.1:4321/'), CONFIG.allowedOrigins),
    ).toThrow()
  })
})

describe('pre-execute guard', () => {
  const call = (arguments_: Record<string, unknown>, name = 'vibe_preview') => ({
    name,
    arguments: arguments_,
  })

  it('allows a start inside the local allowlist', () => {
    expect(previewGuardDecision(call({ action: 'start', url: 'http://127.0.0.1:4320/' }), deps())).toBeNull()
  })

  it('denies a non-local start before approval, even if allow-listed', () => {
    const decision = previewGuardDecision(
      call({ action: 'start', url: 'https://example.com/' }),
      deps({ allowedOrigins: ['https://example.com'] }),
    )
    expect(decision?.kind).toBe('deny')
    expect(decision?.reason).toMatch(/not local/i)
  })

  it('denies a local origin outside allowedOrigins', () => {
    const decision = previewGuardDecision(
      call({ action: 'start', url: 'http://127.0.0.1:4321/' }),
      deps(),
    )
    expect(decision?.kind).toBe('deny')
    expect(decision?.reason).toMatch(/allowedOrigins/)
  })

  it('denies a cross-origin navigate but allows a same-origin one', () => {
    expect(
      previewGuardDecision(call({ action: 'navigate', url: 'http://127.0.0.1:4321/x' }), deps())
        ?.kind,
    ).toBe('deny')
    expect(
      previewGuardDecision(call({ action: 'navigate', url: 'http://127.0.0.1:4320/x' }), deps()),
    ).toBeNull()
  })

  it('denies screenshots while the setting is off', () => {
    expect(previewGuardDecision(call({ action: 'screenshot' }), deps())?.kind).toBe('deny')
    expect(
      previewGuardDecision(call({ action: 'screenshot' }), deps({ screenshotEnabled: true })),
    ).toBeNull()
  })

  it('leaves malformed calls and other tools to normal validation', () => {
    expect(previewGuardDecision(call({ action: 'start', url: 'not a url' }), deps())).toBeNull()
    expect(previewGuardDecision(call({ action: 'stop' }), deps())).toBeNull()
    expect(
      previewGuardDecision(call({ action: 'start', url: 'https://example.com/' }, 'other_tool'), deps()),
    ).toBeNull()
  })
})
