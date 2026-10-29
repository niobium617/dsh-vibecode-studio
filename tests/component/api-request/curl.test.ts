/**
 * FR-API-07: a pasted cURL command becomes an editable draft, and a draft
 * becomes a command that parses back to the same request. Placeholders must
 * survive both directions untouched.
 */
import { describe, expect, it } from 'vitest'
import { CURL_INPUT_CHARS_MAX, parseCurl, toCurl } from '../../../src/client/api/curl'
import type { HttpRequestSpec } from '../../../src/contracts/api'

function parsed(input: string): HttpRequestSpec {
  const result = parseCurl(input)
  if (!result.ok) throw new Error(`expected a spec, got ${result.issue.code}`)
  return result.spec
}

describe('parseCurl', () => {
  it('parses a browser-style command with continuations and a JSON body', () => {
    const spec = parsed(
      [
        "curl 'https://api.example.com/items?page=2&q=a+b' \\",
        "  -H 'accept: application/json' \\",
        "  -H 'content-type: application/json' \\",
        `  --data-raw '{"name":"x"}'`,
      ].join('\n'),
    )

    expect(spec.method).toBe('POST')
    expect(spec.url).toBe('https://api.example.com/items')
    expect(spec.query).toEqual([
      { name: 'page', value: '2' },
      { name: 'q', value: 'a b' },
    ])
    expect(spec.headers).toEqual([
      { name: 'accept', value: 'application/json' },
      { name: 'content-type', value: 'application/json' },
    ])
    expect(spec.body).toEqual({ kind: 'json', text: '{"name":"x"}' })
  })

  it('maps an explicit method, bearer auth and max-time', () => {
    const spec = parsed(
      "curl -X PUT --url https://api.example.com/items/1 -H 'Authorization: Bearer {{token}}' -m 5",
    )

    expect(spec.method).toBe('PUT')
    expect(spec.auth).toEqual({ kind: 'bearer', token: '{{token}}' })
    expect(spec.timeoutMs).toBe(5000)
    expect(spec.headers).toBeUndefined()
  })

  it('maps -u to basic auth and decodes a Basic header', () => {
    expect(parsed("curl https://api.example.com/ -u 'user:p@ss'").auth).toEqual({
      kind: 'basic',
      username: 'user',
      password: 'p@ss',
    })
    expect(
      parsed("curl https://api.example.com/ -H 'Authorization: Basic dXNlcjpwQHNz'").auth,
    ).toEqual({ kind: 'basic', username: 'user', password: 'p@ss' })
  })

  it('keeps urlencoded data as form fields and joins repeated -d with &', () => {
    const spec = parsed("curl https://api.example.com/ -d 'a=1' -d 'b=hello+world'")

    expect(spec.method).toBe('POST')
    expect(spec.body).toEqual({
      kind: 'form',
      fields: [
        { name: 'a', value: '1' },
        { name: 'b', value: 'hello world' },
      ],
    })
  })

  it('accepts --data-urlencode and multipart fields', () => {
    expect(parsed("curl https://api.example.com/ --data-urlencode 'q=a b'").body).toEqual({
      kind: 'form',
      fields: [{ name: 'q', value: 'a b' }],
    })
    expect(parsed("curl https://api.example.com/ -F 'note=hi' -F 'tag=x'").body).toEqual({
      kind: 'multipart',
      fields: [
        { name: 'note', value: 'hi' },
        { name: 'tag', value: 'x' },
      ],
      files: [],
    })
  })

  it('moves data into the query with -G and supports -I', () => {
    const get = parsed("curl -G https://api.example.com/items -d 'a=1&b=two'")
    expect(get.method).toBe('GET')
    expect(get.body).toBeUndefined()
    expect(get.query).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: 'two' },
    ])

    expect(parsed('curl -I https://api.example.com/').method).toBe('HEAD')
  })

  it('reads Windows cmd quoting and caret continuations', () => {
    const spec = parsed('curl ^"https://api.example.com/a^" ^\n -H ^"x-test: y^"')

    expect(spec.url).toBe('https://api.example.com/a')
    expect(spec.headers).toEqual([{ name: 'x-test', value: 'y' }])
  })

  it('rejects unsafe or unreadable input with a stable code', () => {
    expect(parseCurl('   ').ok).toBe(false)
    expect(parseCurl('wget https://x.test/')).toMatchObject({ ok: false, issue: { code: 'unknown_flag' } })
    expect(parseCurl("curl 'https://x.test/")).toMatchObject({
      ok: false,
      issue: { code: 'unterminated_quote' },
    })
    expect(parseCurl('curl --nope https://x.test/')).toMatchObject({
      ok: false,
      issue: { code: 'unknown_flag', detail: '--nope' },
    })
    expect(parseCurl('curl -H "a: b"')).toMatchObject({
      ok: false,
      issue: { code: 'missing_url' },
    })
    expect(parseCurl('curl https://x.test/ -F "file=@/tmp/a.txt"')).toMatchObject({
      ok: false,
      issue: { code: 'unsupported_file' },
    })
    expect(parseCurl("curl -X GET https://x.test/ -d 'a=1'")).toMatchObject({
      ok: false,
      issue: { code: 'body_not_allowed' },
    })
    expect(parseCurl(`curl ${'x'.repeat(CURL_INPUT_CHARS_MAX)}`)).toMatchObject({
      ok: false,
      issue: { code: 'too_long' },
    })
    expect(parseCurl('curl -X FLY https://x.test/')).toMatchObject({
      ok: false,
      issue: { code: 'invalid_method', detail: 'FLY' },
    })
  })

  it('does not re-scan a resolved value into the spec', () => {
    // Placeholders are data here; the parser never resolves them.
    const spec = parsed("curl 'https://api.example.com/{{path}}' -H 'x-token: {{token}}'")
    expect(spec.url).toBe('https://api.example.com/{{path}}')
    expect(spec.headers).toEqual([{ name: 'x-token', value: '{{token}}' }])
  })
})

describe('toCurl', () => {
  it('round-trips a request including query, headers, auth and JSON body', () => {
    const spec: HttpRequestSpec = {
      method: 'POST',
      url: 'https://api.example.com/items',
      query: [{ name: 'q', value: '{{query}}' }],
      headers: [{ name: 'accept', value: 'application/json' }],
      auth: { kind: 'bearer', token: '{{token}}' },
      body: { kind: 'json', text: '{"name":"it\'s"}' },
    }

    const exported = toCurl(spec)
    expect(exported.losses).toEqual([])
    const back = parsed(exported.command)

    expect(back.method).toBe('POST')
    expect(back.url).toBe('https://api.example.com/items')
    expect(back.query).toEqual([{ name: 'q', value: '{{query}}' }])
    expect(back.auth).toEqual({ kind: 'bearer', token: '{{token}}' })
    expect(back.body).toEqual({ kind: 'json', text: '{"name":"it\'s"}' })
    expect(back.headers).toEqual([
      { name: 'accept', value: 'application/json' },
      { name: 'Content-Type', value: 'application/json' },
    ])
  })

  it('puts an api-key sent in the query into the URL and basic auth into -u', () => {
    const command = toCurl({
      method: 'GET',
      url: 'https://api.example.com/items',
      auth: { kind: 'api-key', name: 'api_key', value: '{{key}}', in: 'query' },
    }).command

    expect(command).toContain('api_key={{key}}')
    const back = parsed(command)
    expect(back.query).toEqual([{ name: 'api_key', value: '{{key}}' }])
    expect(back.auth).toBeUndefined()

    const basic = toCurl({
      method: 'GET',
      url: 'https://api.example.com/',
      auth: { kind: 'basic', username: 'u', password: 'p' },
    }).command
    expect(parsed(basic).auth).toEqual({ kind: 'basic', username: 'u', password: 'p' })
  })

  it('exports form fields as --data-urlencode and never invents a secret', () => {
    const command = toCurl({
      method: 'PUT',
      url: 'https://api.example.com/items/1',
      body: {
        kind: 'form',
        fields: [
          { name: 'a', value: '1' },
          { name: 'b', value: 'x y' },
        ],
      },
    }).command

    expect(command).toContain('--data-urlencode a=1')
    expect(command).toContain("--data-urlencode 'b=x y'")
    expect(parsed(command).body).toEqual({
      kind: 'form',
      fields: [
        { name: 'a', value: '1' },
        { name: 'b', value: 'x y' },
      ],
    })
  })

  it('reports multipart files it cannot carry and skips executor-owned headers', () => {
    const exported = toCurl({
      method: 'POST',
      url: 'https://api.example.com/upload',
      headers: [
        { name: 'Host', value: 'other.example' },
        { name: 'x-trace', value: '1' },
      ],
      body: {
        kind: 'multipart',
        fields: [{ name: 'note', value: 'hi' }],
        files: [{ field: 'file', fileName: 'a.txt', base64: 'aGk=' }],
      },
    })

    expect(exported.losses).toEqual(['multipart_file'])
    expect(exported.command).not.toContain('other.example')
    expect(exported.command).toContain('-F file=@a.txt')
  })
})
