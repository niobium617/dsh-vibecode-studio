/**
 * G4 follow-up: the unary outcome is the last place a resolved secret can
 * leave the host. These cases pin the two layers — exact secret replacement
 * (any query key, path, encoded form) and `redactUrl` for literal sensitive
 * keys — plus the invariants that placeholders and the body survive.
 */
import { describe, expect, it } from 'vitest'
import type { HttpExecutionResult } from '../../../src/contracts/api'
import { redactExecutionResult } from '../../../src/host/api/result-redaction'

const BODY = { text: 'ok', base64: '', bytes: 2, truncated: false, contentType: 'text/plain' }

function result(overrides: Partial<HttpExecutionResult> = {}): HttpExecutionResult {
  return {
    status: 200,
    statusText: 'OK',
    url: 'https://api.example.com/items',
    redirects: [],
    headers: {},
    elapsedMs: 1,
    body: BODY,
    ...overrides,
  }
}

describe('redactExecutionResult', () => {
  it('scrubs a resolved secret from a non-sensitive query key', () => {
    const output = redactExecutionResult(
      result({ url: 'https://api.example.com/items?session=s3cret-token' }),
      ['s3cret-token'],
    )

    expect(output.url).toBe('https://api.example.com/items?session=REDACTED')
    expect(output.body).toBe(BODY)
  })

  it('scrubs the percent-encoded and plus-for-space forms', () => {
    const output = redactExecutionResult(
      result({
        url: 'https://api.example.com/items?a=p%40ss+word%26%3Dx&b=p%40ss%20word%26%3Dx',
      }),
      ['p@ss word&=x'],
    )

    expect(output.url).toBe('https://api.example.com/items?a=REDACTED&b=REDACTED')
  })

  it('scrubs a secret used as a path segment', () => {
    const output = redactExecutionResult(
      result({ url: 'https://api.example.com/keys/s3cret-token/items' }),
      ['s3cret-token'],
    )

    expect(output.url).toBe('https://api.example.com/keys/REDACTED/items')
  })

  it('replaces the longest overlapping secret as a whole', () => {
    const output = redactExecutionResult(
      result({ url: 'https://api.example.com/?a=abcdef' }),
      ['abc', 'abcdef'],
    )

    expect(output.url).toBe('https://api.example.com/?a=REDACTED')
  })

  it('scrubs every redirect hop but keeps its status', () => {
    const output = redactExecutionResult(
      result({
        url: 'https://api.example.com/next?session=s3cret-token',
        redirects: [
          {
            status: 302,
            url: 'https://api.example.com/start?token=s3cret-token',
            location: 'https://api.example.com/next?session=s3cret-token',
          },
        ],
      }),
      ['s3cret-token'],
    )

    expect(output.url).toBe('https://api.example.com/next?session=REDACTED')
    expect(output.redirects).toEqual([
      {
        status: 302,
        url: 'https://api.example.com/start?token=REDACTED',
        location: 'https://api.example.com/next?session=REDACTED',
      },
    ])
  })

  it('still masks literal sensitive keys and keeps placeholders when no secret resolved', () => {
    const output = redactExecutionResult(
      result({
        url: 'https://api.example.com/?api_key=typed&next={{missing}}&q=plain',
      }),
      [],
    )

    expect(output.url).toBe(
      'https://api.example.com/?api_key=REDACTED&next={{missing}}&q=plain',
    )
  })

  it('leaves a URL that cannot be parsed for URL rules unchanged apart from exact matches', () => {
    const output = redactExecutionResult(result({ url: 'not a url s3cret-token' }), ['s3cret-token'])

    expect(output.url).toBe('not a url REDACTED')
  })
})
