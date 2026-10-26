import { describe, expect, it } from 'vitest'
import {
  ANNOTATION_BUDGET_BYTES,
  DOM_SNIPPET_BYTES,
  ELEMENT_TEXT_CHARS,
  OBSERVE_BUDGET_BYTES,
  truncateChars,
  truncateUtf8,
  utf8Bytes,
} from '../../../src/contracts'

describe('context budget', () => {
  it('uses the documented byte limits', () => {
    expect(ANNOTATION_BUDGET_BYTES).toBe(4096)
    expect(OBSERVE_BUDGET_BYTES).toBe(8192)
    expect(DOM_SNIPPET_BYTES).toBe(2048)
    expect(ELEMENT_TEXT_CHARS).toBe(200)
  })

  it('counts UTF-8 bytes, not code units', () => {
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('你好')).toBe(6)
    expect(utf8Bytes('😀')).toBe(4)
  })

  it('truncates multibyte text without splitting a code point', () => {
    const value = '你好世界😀'
    const output = truncateUtf8(value, 10)

    expect(utf8Bytes(output)).toBeLessThanOrEqual(10)
    expect(output.startsWith('你好')).toBe(true)
    expect(output).not.toContain('�')
  })

  it('returns the original text when it fits', () => {
    expect(truncateUtf8('short', 32)).toBe('short')
    expect(truncateChars('你好', 2)).toBe('你好')
  })

  it('handles zero and suffix-size budgets', () => {
    expect(truncateUtf8('anything', 0)).toBe('')
    expect(truncateUtf8('anything', 2)).toBe('')
    expect(truncateChars('anything', 0)).toBe('')
    expect(truncateUtf8('anything', 3)).toBe('…')
  })

  it('truncates by code points for element text', () => {
    const output = truncateChars('😀😀😀', 2)
    expect(output).toBe('😀😀…')
    expect(Array.from(output)).toHaveLength(3)
  })
})
