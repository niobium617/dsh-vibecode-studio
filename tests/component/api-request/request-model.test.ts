/**
 * T038 draft → wire spec: the form keeps everything a beginner types, but only
 * validated, enabled rows reach the Host. Issues point at the exact row.
 */
import { describe, expect, it } from 'vitest'
import {
  buildRequestSpec,
  createRequestDraft,
  fieldNameForFile,
  readFileAsBase64,
  type RequestDraft,
} from '../../../src/client/api/request-model'

function draft(overrides: Partial<RequestDraft> = {}): RequestDraft {
  return { ...createRequestDraft(), ...overrides }
}

function issueCodes(result: ReturnType<typeof buildRequestSpec>): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code)
}

describe('buildRequestSpec', () => {
  it('needs a URL before anything is sent', () => {
    const result = buildRequestSpec(draft())
    expect(result.ok).toBe(false)
    expect(issueCodes(result)).toEqual(['url_missing'])
  })

  it('builds a spec and drops empty rows while keeping disabled ones', () => {
    const result = buildRequestSpec(
      draft({
        method: 'POST',
        url: ' https://api.example.com/items ',
        query: [
          { name: 'q', value: 'hello world', enabled: true },
          { name: '', value: '', enabled: true },
          { name: 'off', value: '1', enabled: false },
        ],
        headers: [{ name: 'x-trace', value: 'abc', enabled: true }],
        bodyKind: 'json',
        bodyText: '{"hello":"world"}',
        authKind: 'bearer',
        bearerToken: '{{token}}',
      }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.method).toBe('POST')
    expect(result.spec.url).toBe('https://api.example.com/items')
    expect(result.spec.query).toEqual([
      { name: 'q', value: 'hello world' },
      { name: 'off', value: '1', enabled: false },
    ])
    expect(result.spec.headers).toEqual([{ name: 'x-trace', value: 'abc' }])
    expect(result.spec.body).toEqual({ kind: 'json', text: '{"hello":"world"}' })
    expect(result.spec.auth).toEqual({ kind: 'bearer', token: '{{token}}' })
  })

  it('rejects non-http URLs and credentials in the URL', () => {
    expect(issueCodes(buildRequestSpec(draft({ url: 'not a url' })))).toEqual(['url_invalid'])
    expect(issueCodes(buildRequestSpec(draft({ url: 'ftp://example.com/' })))).toEqual([
      'url_invalid',
    ])
    expect(issueCodes(buildRequestSpec(draft({ url: 'https://a:b@example.com/' })))).toEqual([
      'url_credentials',
    ])
  })

  it('points at the row that still needs a name', () => {
    const result = buildRequestSpec(
      draft({
        url: 'https://api.example.com/',
        query: [
          { name: 'ok', value: '1', enabled: true },
          { name: '', value: 'orphan', enabled: true },
        ],
        headers: [{ name: '', value: 'x', enabled: true }],
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues).toEqual([
      { code: 'row_name_missing', field: 'query[1]' },
      { code: 'row_name_missing', field: 'headers[0]' },
    ])
  })

  it('rejects malformed and duplicate header rows', () => {
    const malformed = buildRequestSpec(
      draft({
        url: 'https://api.example.com/',
        headers: [
          { name: 'bad name', value: '1', enabled: true },
          { name: 'x-ok', value: 'line\nbreak', enabled: true },
        ],
      }),
    )
    expect(issueCodes(malformed)).toEqual(['header_invalid', 'header_invalid'])

    const duplicate = buildRequestSpec(
      draft({
        url: 'https://api.example.com/',
        headers: [
          { name: 'X-Trace', value: '1', enabled: true },
          { name: 'x-trace', value: '2', enabled: true },
        ],
      }),
    )
    expect(issueCodes(duplicate)).toEqual(['header_duplicate'])
  })

  it('rejects an invalid JSON body but sends text as typed', () => {
    expect(
      issueCodes(
        buildRequestSpec(
          draft({ url: 'https://api.example.com/', bodyKind: 'json', bodyText: '{nope' }),
        ),
      ),
    ).toEqual(['json_invalid'])

    const text = buildRequestSpec(
      draft({
        url: 'https://api.example.com/',
        bodyKind: 'text',
        bodyText: '',
        bodyContentType: 'text/markdown',
      }),
    )
    expect(text.ok).toBe(true)
    if (!text.ok) return
    expect(text.spec.body).toEqual({ kind: 'text', text: '', contentType: 'text/markdown' })
  })

  it('requires auth values the host cannot guess', () => {
    expect(
      issueCodes(
        buildRequestSpec(draft({ url: 'https://api.example.com/', authKind: 'bearer' })),
      ),
    ).toEqual(['auth_token_missing'])

    const apiKey = buildRequestSpec(
      draft({
        url: 'https://api.example.com/',
        authKind: 'api-key',
        apiKeyName: 'X-API-Key',
        apiKeyValue: 'v',
        apiKeyIn: 'query',
      }),
    )
    expect(apiKey.ok).toBe(true)
    if (!apiKey.ok) return
    expect(apiKey.spec.auth).toEqual({
      kind: 'api-key',
      name: 'X-API-Key',
      value: 'v',
      in: 'query',
    })
  })

  it('builds multipart bodies and flags a file without a field name', () => {
    const missing = buildRequestSpec(
      draft({
        url: 'https://api.example.com/',
        bodyKind: 'multipart',
        fields: [{ name: 'note', value: 'hi', enabled: true }],
        files: [{ field: ' ', fileName: 'a.txt', contentType: 'text/plain', base64: 'YWJj' }],
      }),
    )
    expect(issueCodes(missing)).toEqual(['file_field_missing'])

    const ok = buildRequestSpec(
      draft({
        url: 'https://api.example.com/',
        bodyKind: 'multipart',
        fields: [{ name: 'note', value: 'hi', enabled: true }],
        files: [{ field: 'avatar', fileName: 'a.txt', contentType: '', base64: 'YWJj' }],
      }),
    )
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.spec.body).toEqual({
      kind: 'multipart',
      fields: [{ name: 'note', value: 'hi' }],
      files: [{ field: 'avatar', fileName: 'a.txt', base64: 'YWJj' }],
    })
  })
})

describe('file helpers', () => {
  it('reads a picked file as base64 and derives a field name', async () => {
    const file = new File(['abc'], 'avatar.png', { type: 'image/png' })
    await expect(readFileAsBase64(file)).resolves.toBe('YWJj')
    expect(fieldNameForFile('avatar.png')).toBe('avatar')
    expect(fieldNameForFile('no-extension')).toBe('no-extension')
  })
})
