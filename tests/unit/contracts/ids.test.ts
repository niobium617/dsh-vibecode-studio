import { describe, expect, it } from 'vitest'
import {
  asSessionId,
  asTargetId,
  hasCapability,
  isSessionId,
  isStudioError,
  isTargetId,
  studioError,
  type TargetCapabilities,
} from '../../../src/contracts'

describe('branded ids', () => {
  it('accepts URL-safe ids', () => {
    expect(isTargetId('web-local')).toBe(true)
    expect(isSessionId('session_1')).toBe(true)
    expect(asTargetId('web-local')).toBe('web-local')
    expect(asSessionId('session.1')).toBe('session.1')
  })

  it('rejects empty, spaced, oversized or prefixed ids', () => {
    for (const value of ['', 'has space', '-leading', 'x'.repeat(65)]) {
      expect(isTargetId(value)).toBe(false)
      expect(() => asTargetId(value)).toThrow(/invalid target id/)
    }
  })
})

describe('studio errors', () => {
  it('keeps a stable code, message and optional details', () => {
    const plain = studioError('timeout', 'preview timed out')
    const detailed = studioError('invalid_input', 'bad input', { field: 'url' })

    expect(isStudioError(plain)).toBe(true)
    expect(plain).toEqual({ code: 'timeout', message: 'preview timed out' })
    expect(detailed.details).toEqual({ field: 'url' })
  })

  it('rejects unknown shapes', () => {
    expect(isStudioError(null)).toBe(false)
    expect(isStudioError({ code: 'unknown', message: 'x' })).toBe(false)
    expect(isStudioError({ code: 'internal' })).toBe(false)
    expect(isStudioError({ code: 'internal', message: 'x', details: null })).toBe(false)
  })
})

describe('target capabilities', () => {
  it('reads a capability flag', () => {
    const capabilities: TargetCapabilities = {
      screencast: true,
      input: false,
      pick: true,
      sourceMap: false,
      console: true,
      network: false,
      screenshot: true,
    }

    expect(hasCapability(capabilities, 'screencast')).toBe(true)
    expect(hasCapability(capabilities, 'input')).toBe(false)
  })
})
