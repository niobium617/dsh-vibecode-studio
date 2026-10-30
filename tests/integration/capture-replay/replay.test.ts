/**
 * T043 replay side: one captured row becomes an editable spec that matches
 * what the browser sent, non-idempotent methods are refused without an
 * explicit confirmation, and everything that cannot be reproduced is reported
 * instead of being silently faked.
 */
import { describe, expect, it } from 'vitest'
import {
  HTTP_HEADER_VALUE_CHARS_MAX,
  REPLAY_SAFE_METHODS,
  requiresReplayConfirmation,
  type HttpRequestSpec,
} from '../../../src/contracts/api'
import { MAX_CAPTURED_REQUEST_BODY_BYTES, type NetworkEntry } from '../../../src/contracts/telemetry'
import type { StudioError } from '../../../src/contracts/errors'
import { normalizeHttpRequest } from '../../../src/host/api/request'
import { prepareReplay } from '../../../src/host/api/replay'

function entry(overrides: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    id: 'network-1',
    method: 'GET',
    url: 'http://127.0.0.1:4320/api/items',
    status: 200,
    outcome: 'success',
    resourceType: 'XHR',
    startedAt: '2023-11-14T22:13:20.000Z',
    durationMs: 12,
    ...overrides,
  }
}

function failure(run: () => unknown): StudioError {
  try {
    run()
  } catch (error) {
    return error as StudioError
  }
  throw new Error('expected the call to throw')
}

function decodeBody(spec: HttpRequestSpec): string | null {
  const normalized = normalizeHttpRequest(spec)
  return normalized.body === null ? null : new TextDecoder().decode(normalized.body)
}

describe('prepareReplay fidelity', () => {
  it('keeps the captured URL bytes instead of URL-normalising them', () => {
    const url = 'http://127.0.0.1:4320/api/items?tag=a%20b&q=%2F'
    const result = prepareReplay(entry({ url }))

    expect(result.draft.url).toBe(url)
    expect(result.draft.method).toBe('GET')
    expect(result.draft.body).toBeUndefined()
    expect(result.requiresConfirmation).toBe(false)
  })

  it('reproduces a captured JSON POST through the executor normaliser', () => {
    const headers = { 'content-type': 'application/json', 'x-request-id': 'abc' }
    const body = '{"name":"book","price":12}'
    const result = prepareReplay(
      entry({
        method: 'POST',
        url: 'http://127.0.0.1:4320/api/items',
        requestHeaders: headers,
        requestBody: body,
      }),
      { confirm: true },
    )

    expect(result.draft.body).toEqual({ kind: 'json', text: body })
    expect(result.draft.headers).toEqual([
      { name: 'content-type', value: 'application/json' },
      { name: 'x-request-id', value: 'abc' },
    ])
    expect(result.requiresConfirmation).toBe(true)
    expect(result.warnings).toEqual([])
    expect(result.omittedHeaders).toEqual([])

    const normalized = normalizeHttpRequest(result.draft)
    expect(normalized.url).toBe('http://127.0.0.1:4320/api/items')
    expect(normalized.headers['content-type']).toBe('application/json')
    expect(normalized.headers['x-request-id']).toBe('abc')
    expect(new TextDecoder().decode(normalized.body!)).toBe(body)
  })

  it('keeps a non-JSON body as exact text with its captured content type', () => {
    const result = prepareReplay(
      entry({
        method: 'PUT',
        requestHeaders: { 'content-type': 'application/xml' },
        requestBody: '<item id="1"/>',
      }),
      { confirm: true },
    )

    expect(result.draft.body).toEqual({
      kind: 'text',
      text: '<item id="1"/>',
      contentType: 'application/xml',
    })
  })

  it('treats a JSON content type with an unparsable body as text', () => {
    const result = prepareReplay(
      entry({
        method: 'POST',
        requestHeaders: { 'content-type': 'application/json' },
        requestBody: '{"truncated":',
        requestBodyTruncated: true,
      }),
      { confirm: true },
    )

    expect(result.draft.body).toEqual({
      kind: 'text',
      text: '{"truncated":',
      contentType: 'application/json',
    })
    expect(result.warnings).toEqual(['body_truncated'])
  })

  it('accepts vendor JSON content types', () => {
    const result = prepareReplay(
      entry({
        method: 'POST',
        requestHeaders: { 'content-type': 'application/vnd.api+json; charset=utf-8' },
        requestBody: '{"data":1}',
      }),
      { confirm: true },
    )

    expect(result.draft.body).toEqual({ kind: 'json', text: '{"data":1}' })
  })

  it('drops a body on GET/HEAD and says so', () => {
    const result = prepareReplay(
      entry({ method: 'HEAD', requestBody: 'ignored', requestHeaders: {} }),
    )

    expect(result.draft.body).toBeUndefined()
    expect(result.requiresConfirmation).toBe(false)
    expect(result.warnings).toEqual(['body_dropped'])
  })
})

describe('prepareReplay confirmation gate', () => {
  it('refuses an unconfirmed DELETE without producing a draft', () => {
    const error = failure(() =>
      prepareReplay(entry({ method: 'DELETE' }), { confirm: false }),
    )

    expect(error.code).toBe('permission_denied')
    expect(error.details).toMatchObject({
      reason: 'confirmation_required',
      method: 'DELETE',
    })
  })

  it.each(['GET', 'HEAD', 'OPTIONS'])('replays %s without confirmation', (method) => {
    const result = prepareReplay(entry({ method }), { confirm: false })

    expect(result.requiresConfirmation).toBe(false)
    expect(requiresReplayConfirmation(method)).toBe(false)
  })

  it.each(['DELETE', 'PUT', 'PATCH', 'POST'])('requires confirmation for %s', (method) => {
    expect(requiresReplayConfirmation(method)).toBe(true)
    expect(() => prepareReplay(entry({ method }))).toThrowError(/needs confirmation/)
    expect(prepareReplay(entry({ method }), { confirm: true }).requiresConfirmation).toBe(true)
  })

  it('keeps REPLAY_SAFE_METHODS limited to read-only methods', () => {
    expect([...REPLAY_SAFE_METHODS]).toEqual(['GET', 'HEAD', 'OPTIONS'])
  })
})

describe('prepareReplay header filtering', () => {
  it('keeps replayable headers and reports every real name it had to drop', () => {
    const result = prepareReplay(
      entry({
        method: 'POST',
        requestHeaders: {
          ':path': '/api/items',
          host: '127.0.0.1:4320',
          authorization: 'REDACTED',
          cookie: 'session=abc',
          'x-test': 'line\r\nbreak',
          'content-encoding': 'gzip',
          'x-dup': '1',
          'X-Dup': '2',
          'x-number': 42 as unknown as string,
          'x-ok': 'yes',
        },
        requestBody: 'hello',
      }),
      { confirm: true },
    )

    expect(result.draft.headers).toEqual([
      { name: 'cookie', value: 'session=abc' },
      { name: 'x-dup', value: '1' },
      { name: 'x-ok', value: 'yes' },
    ])
    expect(result.omittedHeaders).toEqual([
      'host',
      'authorization',
      'x-test',
      'content-encoding',
      'X-Dup',
      'x-number',
    ])
    expect(result.warnings).toEqual(['headers_omitted'])
  })

  it('drops an oversize header value', () => {
    const result = prepareReplay(
      entry({
        requestHeaders: { 'x-big': 'a'.repeat(HTTP_HEADER_VALUE_CHARS_MAX + 1) },
      }),
    )

    expect(result.draft.headers).toBeUndefined()
    expect(result.omittedHeaders).toEqual(['x-big'])
  })

  it('keeps placeholder values that carry no secret', () => {
    const result = prepareReplay(
      entry({ requestHeaders: { authorization: 'Bearer {{token}}' } }),
    )

    expect(result.draft.headers).toEqual([{ name: 'authorization', value: 'Bearer {{token}}' }])
    expect(result.omittedHeaders).toEqual([])
  })
})

describe('prepareReplay warnings', () => {
  it('reports redacted query values and flags in a stable order', () => {
    const result = prepareReplay(
      entry({
        method: 'POST',
        url: 'http://127.0.0.1:4320/api/items?token=REDACTED',
        requestHeaders: { host: '127.0.0.1:4320' },
        requestBody: '{"name":',
        requestBodyTruncated: true,
      }),
      { confirm: true },
    )

    expect(result.warnings).toEqual(['body_truncated', 'url_redacted', 'headers_omitted'])
  })

  it('reports a body the browser never handed over', () => {
    const result = prepareReplay(
      entry({
        method: 'POST',
        requestHeaders: { 'content-type': 'application/json' },
        requestBodyUnavailable: true,
      }),
      { confirm: true },
    )

    expect(result.draft.body).toBeUndefined()
    expect(result.warnings).toEqual(['body_unavailable'])
  })
})

describe('prepareReplay rejects unsendable rows', () => {
  it('rejects an unsupported method', () => {
    const error = failure(() => prepareReplay(entry({ method: 'TRACE' })))
    expect(error.code).toBe('invalid_input')
    expect(error.details).toMatchObject({ field: 'entry.method' })
  })

  it.each([
    ['', 'empty'],
    ['not a url', 'unparsable'],
    ['ftp://127.0.0.1/file', 'non-http'],
    ['http://user:pass@127.0.0.1/api', 'credentials'],
  ])('rejects the %s URL (%s)', (url) => {
    const error = failure(() => prepareReplay(entry({ url })))
    expect(error.code).toBe('invalid_input')
    expect(error.details).toMatchObject({ field: 'entry.url' })
  })

  it('rejects a body above the capture budget', () => {
    const error = failure(() =>
      prepareReplay(
        entry({ method: 'POST', requestBody: 'x'.repeat(MAX_CAPTURED_REQUEST_BODY_BYTES + 1) }),
        { confirm: true },
      ),
    )
    expect(error.code).toBe('invalid_input')
    expect(error.details).toMatchObject({ field: 'entry.requestBody' })
  })

  it('rejects a non-object entry', () => {
    const error = failure(() => prepareReplay(null))
    expect(error.code).toBe('invalid_input')
    expect(error.details).toMatchObject({ field: 'entry' })
  })

  it('never returns a sendable spec for a confirmed row without a draft body', () => {
    // A confirmed replay is still only a draft: the spec has no execution.
    const result = prepareReplay(entry({ method: 'DELETE' }), { confirm: true })
    expect(Object.keys(result).sort()).toEqual([
      'draft',
      'omittedHeaders',
      'requiresConfirmation',
      'warnings',
    ])
    expect(decodeBody(result.draft)).toBeNull()
  })
})
