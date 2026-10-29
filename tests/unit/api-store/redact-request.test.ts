/**
 * T037 storage redaction: the copy of a request written to `.vibe/api` must
 * never carry a literal secret. Structural fields survive so the panel can
 * still show *what* was configured.
 */
import { describe, expect, it } from 'vitest'
import {
  REDACTED,
  isHttpRequestSpec,
  redactHttpRequest,
  type HttpRequestSpec,
} from '../../../src/contracts'

const SECRET = 's3cret-value'

function spec(overrides: Partial<HttpRequestSpec> = {}): HttpRequestSpec {
  return { method: 'POST', url: 'https://api.example.com/v1/items', ...overrides }
}

describe('redactHttpRequest', () => {
  it('masks auth values but keeps their kind', () => {
    expect(redactHttpRequest(spec({ auth: { kind: 'bearer', token: SECRET } })).auth).toEqual({
      kind: 'bearer',
      token: REDACTED,
    })
    expect(
      redactHttpRequest(spec({ auth: { kind: 'basic', username: 'ada', password: SECRET } })).auth,
    ).toEqual({ kind: 'basic', username: 'ada', password: REDACTED })
    expect(
      redactHttpRequest(
        spec({ auth: { kind: 'api-key', name: 'X-Key', value: SECRET, in: 'query' } }),
      ).auth,
    ).toEqual({ kind: 'api-key', name: 'X-Key', value: REDACTED, in: 'query' })
  })

  it('masks sensitive header and query rows, keeping enabled flags', () => {
    const result = redactHttpRequest(
      spec({
        headers: [
          { name: 'Authorization', value: `Bearer ${SECRET}` },
          { name: 'Accept', value: 'application/json', enabled: false },
        ],
        query: [
          { name: 'api_key', value: SECRET },
          { name: 'q', value: 'shoes' },
        ],
      }),
    )
    expect(result.headers).toEqual([
      { name: 'Authorization', value: REDACTED },
      { name: 'Accept', value: 'application/json', enabled: false },
    ])
    expect(result.query).toEqual([
      { name: 'api_key', value: REDACTED },
      { name: 'q', value: 'shoes' },
    ])
  })

  it('strips URL credentials and sensitive query parameters', () => {
    const result = redactHttpRequest(
      spec({ url: `https://user:${SECRET}@api.example.com/v1?token=${SECRET}&q=ok` }),
    )
    expect(result.url).not.toContain(SECRET)
    expect(result.url).toContain('q=ok')
    expect(result.url.startsWith('https://api.example.com/v1')).toBe(true)
  })

  it('redacts JSON body keys recursively but leaves other body kinds readable', () => {
    const json = redactHttpRequest(
      spec({ body: { kind: 'json', text: JSON.stringify({ secret: SECRET, nested: { password: SECRET, id: 7 } }) } }),
    )
    expect(json.body).toEqual({
      kind: 'json',
      text: JSON.stringify({ secret: REDACTED, nested: { password: REDACTED, id: 7 } }),
    })

    const plain = redactHttpRequest(spec({ body: { kind: 'text', text: 'hello', contentType: 'text/plain' } }))
    expect(plain.body).toEqual({ kind: 'text', text: 'hello', contentType: 'text/plain' })

    const broken = redactHttpRequest(spec({ body: { kind: 'json', text: `{not json ${SECRET}` } }))
    expect(broken.body).toEqual({ kind: 'json', text: `{not json ${SECRET}` })
  })

  it('masks form fields and drops multipart file bytes', () => {
    const result = redactHttpRequest(
      spec({
        body: {
          kind: 'multipart',
          fields: [{ name: 'api_key', value: SECRET }],
          files: [{ field: 'avatar', fileName: 'a.png', contentType: 'image/png', base64: SECRET }],
        },
      }),
    )
    expect(result.body).toEqual({
      kind: 'multipart',
      fields: [{ name: 'api_key', value: REDACTED }],
      files: [{ field: 'avatar', fileName: 'a.png', contentType: 'image/png', base64: '' }],
    })
  })

  it('keeps the result a valid request and free of plaintext secrets', () => {
    const result = redactHttpRequest(
      spec({
        url: `https://user:${SECRET}@api.example.com/v1?access_token=${SECRET}`,
        headers: [{ name: 'cookie', value: SECRET }],
        body: { kind: 'json', text: JSON.stringify({ token: SECRET }) },
        auth: { kind: 'bearer', token: SECRET },
        timeoutMs: 5000,
      }),
    )
    expect(isHttpRequestSpec(result)).toBe(true)
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(result.timeoutMs).toBe(5000)
  })
})
