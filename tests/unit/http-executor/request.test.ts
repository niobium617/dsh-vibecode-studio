/**
 * T035 request normalization: the wire shape becomes exactly what fetch is
 * given. These cases pin the acceptance surface — JSON/form/multipart bodies,
 * auth, query merging — plus the rejections that keep unsafe input out.
 */
import { describe, expect, it } from 'vitest'
import {
  HTTP_MAX_REDIRECTS_LIMIT,
  HTTP_RESPONSE_BYTES_MIN,
  HTTP_TIMEOUT_MAX_MS,
  HTTP_TIMEOUT_MIN_MS,
  type HttpRequestSpec,
} from '../../../src/contracts/api'
import type { StudioError } from '../../../src/contracts/errors'
import { normalizeHttpRequest } from '../../../src/host/api/request'

const BASE = 'http://127.0.0.1:8080'

function spec(overrides: Partial<HttpRequestSpec> = {}): HttpRequestSpec {
  return { method: 'GET', url: `${BASE}/api/items`, ...overrides }
}

function expectStudioError(run: () => unknown, code: string): StudioError {
  try {
    run()
  } catch (error) {
    const candidate = error as StudioError
    expect(candidate.code).toBe(code)
    return candidate
  }
  throw new Error('expected the call to throw')
}

describe('normalizeHttpRequest', () => {
  it('applies defaults and merges query rows after the URL query', () => {
    const request = normalizeHttpRequest(
      spec({
        url: `${BASE}/api/items?page=1`,
        query: [
          { name: 'q', value: 'a b' },
          { name: 'tag', value: 'x&y' },
          { name: 'off', value: 'ignored', enabled: false },
        ],
      }),
    )

    expect(request.method).toBe('GET')
    expect(request.url).toBe(`${BASE}/api/items?page=1&q=a+b&tag=x%26y`)
    expect(request.body).toBeNull()
    expect(request.timeoutMs).toBe(30_000)
    expect(request.redirect).toBe('follow')
    expect(request.maxRedirects).toBe(5)
    expect(request.maxResponseBytes).toBe(4 * 1024 * 1024)
  })

  it('rejects non-http schemes and credential URLs', () => {
    const scheme = expectStudioError(
      () => normalizeHttpRequest(spec({ url: 'ftp://example.com/file' })),
      'invalid_input',
    )
    expect(scheme.details?.field).toBe('url')

    const credentials = expectStudioError(
      () => normalizeHttpRequest(spec({ url: 'http://user:pass@example.com/' })),
      'invalid_input',
    )
    expect(credentials.message).toContain('auth field')
  })

  it('blocks cloud metadata hosts with permission_denied', () => {
    const linkLocal = expectStudioError(
      () => normalizeHttpRequest(spec({ url: 'http://169.254.169.254/latest/meta-data/' })),
      'permission_denied',
    )
    expect(linkLocal.details?.reason).toBe('blocked_host')

    expectStudioError(
      () => normalizeHttpRequest(spec({ url: 'http://metadata.google.internal/computeMetadata/' })),
      'permission_denied',
    )
  })

  it('validates header names, values, duplicates and executor-owned headers', () => {
    expectStudioError(
      () => normalizeHttpRequest(spec({ headers: [{ name: 'Bad Header', value: 'x' }] })),
      'invalid_input',
    )
    expectStudioError(
      () => normalizeHttpRequest(spec({ headers: [{ name: 'X-Test', value: 'a\r\nB: c' }] })),
      'invalid_input',
    )
    expectStudioError(
      () => normalizeHttpRequest(spec({ headers: [{ name: 'Host', value: 'evil.test' }] })),
      'invalid_input',
    )
    expectStudioError(
      () =>
        normalizeHttpRequest(
          spec({
            headers: [
              { name: 'X-Test', value: 'a' },
              { name: 'x-test', value: 'b' },
            ],
          }),
        ),
      'invalid_input',
    )
  })

  it('skips disabled headers and keeps their casing', () => {
    const request = normalizeHttpRequest(
      spec({
        headers: [
          { name: 'X-Trace', value: 'on' },
          { name: 'X-Skip', value: 'nope', enabled: false },
        ],
      }),
    )
    expect(request.headers).toEqual({ 'X-Trace': 'on' })
  })

  it('applies bearer, basic and api-key auth', () => {
    const bearer = normalizeHttpRequest(spec({ auth: { kind: 'bearer', token: 'abc' } }))
    expect(bearer.headers.Authorization).toBe('Bearer abc')

    const basic = normalizeHttpRequest(
      spec({ auth: { kind: 'basic', username: 'user', password: 'pa:ss' } }),
    )
    expect(basic.headers.Authorization).toBe(
      `Basic ${Buffer.from('user:pa:ss', 'utf8').toString('base64')}`,
    )

    const headerKey = normalizeHttpRequest(
      spec({ auth: { kind: 'api-key', name: 'X-Api-Key', value: 'k1', in: 'header' } }),
    )
    expect(headerKey.headers['X-Api-Key']).toBe('k1')

    const queryKey = normalizeHttpRequest(
      spec({ auth: { kind: 'api-key', name: 'api_key', value: 'k2', in: 'query' } }),
    )
    expect(queryKey.url).toBe(`${BASE}/api/items?api_key=k2`)
  })

  it('refuses to overwrite an explicit Authorization header', () => {
    const error = expectStudioError(
      () =>
        normalizeHttpRequest(
          spec({
            headers: [{ name: 'Authorization', value: 'Basic abc' }],
            auth: { kind: 'bearer', token: 'abc' },
          }),
        ),
      'invalid_input',
    )
    expect(error.details?.field).toBe('auth')
  })

  it('encodes a JSON body and sets content-type when absent', () => {
    const request = normalizeHttpRequest(
      spec({
        method: 'POST',
        body: { kind: 'json', text: '{"hello":"世界"}' },
      }),
    )
    expect(request.headers['Content-Type']).toBe('application/json')
    expect(new TextDecoder().decode(request.body ?? new Uint8Array())).toBe('{"hello":"世界"}')
  })

  it('rejects malformed JSON and keeps an explicit content-type', () => {
    expectStudioError(
      () => normalizeHttpRequest(spec({ method: 'POST', body: { kind: 'json', text: '{' } })),
      'invalid_input',
    )

    const request = normalizeHttpRequest(
      spec({
        method: 'POST',
        headers: [{ name: 'Content-Type', value: 'application/vnd.test+json' }],
        body: { kind: 'text', text: '{}' },
      }),
    )
    expect(request.headers['Content-Type']).toBe('application/vnd.test+json')
  })

  it('defaults text bodies to UTF-8 text and honours an override', () => {
    const plain = normalizeHttpRequest(spec({ method: 'POST', body: { kind: 'text', text: 'hi' } }))
    expect(plain.headers['Content-Type']).toBe('text/plain; charset=utf-8')

    const custom = normalizeHttpRequest(
      spec({
        method: 'POST',
        body: { kind: 'text', text: 'hi', contentType: 'text/csv' },
      }),
    )
    expect(custom.headers['Content-Type']).toBe('text/csv')
  })

  it('encodes urlencoded forms and skips disabled fields', () => {
    const request = normalizeHttpRequest(
      spec({
        method: 'POST',
        body: {
          kind: 'form',
          fields: [
            { name: 'a', value: '1 2' },
            { name: 'b', value: '&=' },
            { name: 'c', value: 'no', enabled: false },
          ],
        },
      }),
    )
    expect(request.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(new TextDecoder().decode(request.body ?? new Uint8Array())).toBe('a=1+2&b=%26%3D')
  })

  it('builds a deterministic multipart body with fields and files', () => {
    const request = normalizeHttpRequest(
      spec({
        method: 'POST',
        body: {
          kind: 'multipart',
          fields: [{ name: 'note', value: 'hello' }],
          files: [
            {
              field: 'file',
              fileName: 'a.txt',
              contentType: 'text/plain',
              base64: Buffer.from('hello file').toString('base64'),
            },
          ],
        },
      }),
      { boundary: 'BOUNDARY' },
    )

    expect(request.headers['Content-Type']).toBe('multipart/form-data; boundary=BOUNDARY')
    const text = new TextDecoder().decode(request.body ?? new Uint8Array())
    expect(text).toBe(
      '--BOUNDARY\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n' +
        '--BOUNDARY\r\nContent-Disposition: form-data; name="file"; filename="a.txt"\r\n' +
        'Content-Type: text/plain\r\n\r\nhello file\r\n--BOUNDARY--\r\n',
    )
  })

  it('rejects invalid multipart files and part names', () => {
    expectStudioError(
      () =>
        normalizeHttpRequest(
          spec({
            method: 'POST',
            body: {
              kind: 'multipart',
              fields: [],
              files: [{ field: 'f', fileName: 'a.bin', base64: 'not base64!' }],
            },
          }),
        ),
      'invalid_input',
    )
    expectStudioError(
      () =>
        normalizeHttpRequest(
          spec({
            method: 'POST',
            body: { kind: 'multipart', fields: [{ name: 'bad"name', value: 'x' }], files: [] },
          }),
        ),
      'invalid_input',
    )
  })

  it('refuses bodies on GET and HEAD', () => {
    expectStudioError(
      () => normalizeHttpRequest(spec({ method: 'GET', body: { kind: 'json', text: '{}' } })),
      'invalid_input',
    )
    expectStudioError(
      () => normalizeHttpRequest(spec({ method: 'HEAD', body: { kind: 'text', text: 'x' } })),
      'invalid_input',
    )
  })

  it('enforces timeout, redirect and response byte bounds', () => {
    expectStudioError(
      () => normalizeHttpRequest(spec({ timeoutMs: HTTP_TIMEOUT_MIN_MS - 1 })),
      'invalid_input',
    )
    expectStudioError(
      () => normalizeHttpRequest(spec({ timeoutMs: HTTP_TIMEOUT_MAX_MS + 1 })),
      'invalid_input',
    )
    expectStudioError(
      () => normalizeHttpRequest(spec({ maxRedirects: HTTP_MAX_REDIRECTS_LIMIT + 1 })),
      'invalid_input',
    )
    expectStudioError(
      () => normalizeHttpRequest(spec({ maxResponseBytes: HTTP_RESPONSE_BYTES_MIN - 1 })),
      'invalid_input',
    )
    expectStudioError(
      () =>
        normalizeHttpRequest({
          method: 'TRACE' as HttpRequestSpec['method'],
          url: BASE,
        }),
      'invalid_input',
    )
  })
})
