import { describe, expect, it } from 'vitest'
import {
  REDACTED,
  isSensitiveKey,
  redactHeaders,
  redactJsonBody,
  redactUrl,
} from '../../../src/contracts'

describe('redaction', () => {
  it('matches sensitive keys case-insensitively', () => {
    expect(isSensitiveKey('Authorization')).toBe(true)
    expect(isSensitiveKey('set-cookie')).toBe(true)
    expect(isSensitiveKey('X-Api-Key')).toBe(true)
    expect(isSensitiveKey('access_token')).toBe(true)
    expect(isSensitiveKey('content-type')).toBe(false)
    expect(isSensitiveKey('x-request-id')).toBe(false)
  })

  it('redacts sensitive headers and keeps the rest', () => {
    expect(
      redactHeaders({
        Authorization: 'Bearer abc',
        Cookie: 'sid=1',
        'Set-Cookie': 'sid=2',
        'X-Api-Key': 'k',
        'Content-Type': 'application/json',
      }),
    ).toEqual({
      Authorization: REDACTED,
      Cookie: REDACTED,
      'Set-Cookie': REDACTED,
      'X-Api-Key': REDACTED,
      'Content-Type': 'application/json',
    })
  })

  it('redacts sensitive query values, credentials and repeated keys', () => {
    const output = redactUrl('https://user:pass@example.test/path?token=abc&q=1&token=xyz&api_key=k#frag')
    const url = new URL(output)

    expect(url.username).toBe('')
    expect(url.password).toBe('')
    expect(url.searchParams.getAll('token')).toEqual([REDACTED, REDACTED])
    expect(url.searchParams.get('q')).toBe('1')
    expect(url.searchParams.get('api_key')).toBe(REDACTED)
    expect(url.hash).toBe('#frag')
  })

  it('leaves invalid URLs untouched', () => {
    expect(redactUrl('not a url')).toBe('not a url')
  })

  it('redacts nested JSON bodies without mutating the input', () => {
    const input = {
      user: { name: 'Ada', password: 'secret', nested: { accessToken: 't' } },
      items: [{ apiKey: 'k' }, { label: 'safe' }],
    }
    const output = redactJsonBody(input) as Record<string, unknown>

    expect(output).toEqual({
      user: { name: 'Ada', password: REDACTED, nested: { accessToken: REDACTED } },
      items: [{ apiKey: REDACTED }, { label: 'safe' }],
    })
    expect(input.user.password).toBe('secret')
  })
})
