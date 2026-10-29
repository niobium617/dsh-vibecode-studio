/**
 * T045 assertions: the JSONPath subset, the four built-in checks, readable
 * failures, and the service seam that rejects a malformed list before anything
 * reaches the network. No user code is ever evaluated (SPEC FR-API-12).
 */
import { describe, expect, it } from 'vitest'
import {
  API_HTTP_SEND_METHOD,
  ApiService,
  UnaryRegistry,
  createApiSecretStore,
  createHttpExecutor,
  evaluateAssertions,
  findHeader,
  formatAssertionValue,
  parseJsonPath,
  registerApiMethods,
  type CredentialProviderLike,
  type UnaryDispatchResult,
} from '../../../src/host'
import {
  API_ASSERTIONS_MAX,
  isApiAssertion,
  type ApiAssertion,
  type HttpExecutionResult,
  type HttpRequestSpec,
} from '../../../src/contracts/api'

function response(
  overrides: {
    readonly status?: number
    readonly headers?: Record<string, string>
    readonly text?: string | null
    readonly elapsedMs?: number
  } = {},
): HttpExecutionResult {
  const text = overrides.text === undefined ? '{"ok":true}' : overrides.text
  return {
    status: overrides.status ?? 200,
    statusText: 'OK',
    url: 'http://127.0.0.1:3000/items',
    redirects: [],
    headers: overrides.headers ?? { 'content-type': 'application/json' },
    elapsedMs: overrides.elapsedMs ?? 12,
    body: {
      text,
      base64: '',
      bytes: text === null ? 0 : Buffer.byteLength(text),
      truncated: false,
      contentType: 'application/json',
    },
  }
}

describe('parseJsonPath', () => {
  it('reads the supported subset', () => {
    expect(parseJsonPath('$')).toEqual([])
    expect(parseJsonPath('$.data.items')).toEqual([
      { kind: 'key', key: 'data' },
      { kind: 'key', key: 'items' },
    ])
    expect(parseJsonPath("$.data['a b'].items[2]")).toEqual([
      { kind: 'key', key: 'data' },
      { kind: 'key', key: 'a b' },
      { kind: 'key', key: 'items' },
      { kind: 'index', index: 2 },
    ])
    expect(parseJsonPath('$["k\\"q"]')).toEqual([{ kind: 'key', key: 'k"q' }])
  })

  it('rejects anything outside the subset instead of guessing', () => {
    for (const bad of [
      '',
      'data',
      '$..items',
      '$.*',
      '$.data[',
      '$.data[]',
      '$.data[-1]',
      "$.data['x'",
      '$[1.5]',
      '$.data;drop',
    ]) {
      expect(parseJsonPath(bad), bad).toBeNull()
    }
  })
})

describe('formatAssertionValue and findHeader', () => {
  it('turns every JSON value into text a person can compare', () => {
    expect(formatAssertionValue('abc')).toBe('abc')
    expect(formatAssertionValue(null)).toBe('null')
    expect(formatAssertionValue(7)).toBe('7')
    expect(formatAssertionValue(false)).toBe('false')
    expect(formatAssertionValue({ a: 1 })).toBe('{"a":1}')
    expect(formatAssertionValue([1, 2])).toBe('[1,2]')
  })

  it('looks headers up case-insensitively', () => {
    expect(findHeader({ 'Content-Type': 'application/json' }, 'content-type')).toBe(
      'application/json',
    )
    expect(findHeader({ 'content-type': 'text/plain' }, ' X-Missing ')).toBeNull()
  })
})

describe('evaluateAssertions', () => {
  it('passes and fails each of the four kinds in submission order', () => {
    const assertions: ApiAssertion[] = [
      { kind: 'status', expected: 200 },
      { kind: 'header', name: 'content-type', expected: 'json', match: 'contains' },
      { kind: 'json', path: '$.ok', expected: 'true' },
      { kind: 'duration', maxMs: 100 },
      { kind: 'status', expected: 201 },
      { kind: 'duration', maxMs: 5 },
    ]

    expect(evaluateAssertions(assertions, response())).toEqual([
      { index: 0, passed: true, actual: '200' },
      { index: 1, passed: true, actual: 'application/json' },
      { index: 2, passed: true, actual: 'true' },
      { index: 3, passed: true, actual: '12 ms' },
      { index: 4, passed: false, actual: '200', failure: 'status_mismatch' },
      { index: 5, passed: false, actual: '12 ms', failure: 'duration_exceeded' },
    ])
  })

  it('names the reason a check failed', () => {
    const results = evaluateAssertions(
      [
        { kind: 'header', name: 'x-trace', expected: '1' },
        { kind: 'header', name: 'content-type', expected: 'text/plain' },
        { kind: 'json', path: '$.missing', expected: '1' },
        { kind: 'json', path: '$..bad', expected: '1' },
      ],
      response(),
    )

    expect(results.map((result) => [result.passed, result.actual, result.failure])).toEqual([
      [false, null, 'header_missing'],
      [false, 'application/json', 'value_mismatch'],
      [false, null, 'path_missing'],
      [false, null, 'path_syntax'],
    ])
  })

  it('fails a JSON check on a body that is not JSON', () => {
    const [onText] = evaluateAssertions(
      [{ kind: 'json', path: '$', expected: '1' }],
      response({ text: 'not json' }),
    )
    expect(onText).toMatchObject({ passed: false, actual: null, failure: 'body_not_json' })

    const [onNull] = evaluateAssertions(
      [{ kind: 'json', path: '$', expected: '1' }],
      response({ text: null }),
    )
    expect(onNull).toMatchObject({ passed: false, actual: null, failure: 'body_not_json' })
  })

  it('compares numbers, objects and contains with the same textual rule', () => {
    const body = '{"n":7,"list":[{"id":1},{"id":2}]}'
    const results = evaluateAssertions(
      [
        { kind: 'json', path: '$.n', expected: '7' },
        { kind: 'json', path: '$.list[1].id', expected: '2' },
        { kind: 'json', path: '$.list', expected: '"id":2', match: 'contains' },
        { kind: 'json', path: '$.list[5]', expected: '2' },
      ],
      response({ text: body }),
    )

    expect(results.map((result) => result.passed)).toEqual([true, true, true, false])
    expect(results[2]!.actual).toBe('[{"id":1},{"id":2}]')
    expect(results[3]!.failure).toBe('path_missing')
  })

  it('keeps a huge actual value readable instead of dumping it', () => {
    const [result] = evaluateAssertions(
      [{ kind: 'header', name: 'x-big', expected: 'short' }],
      response({ headers: { 'x-big': 'a'.repeat(900) } }),
    )
    expect(result!.actual).toHaveLength(500)
    expect(result!.actual!.endsWith('…')).toBe(true)
  })
})

const credentials: CredentialProviderLike = {
  resolve: async () => undefined,
  describe: async () => ({ configured: false, writable: false, source: 'file' }),
  set: async () => undefined,
  unset: async () => undefined,
}

interface FetchCall {
  readonly url: string
}

function setup(): { service: ApiService; registry: UnaryRegistry; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push({ url: String(url) })
    return new Response('{"ok":true}', {
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  const registry = new UnaryRegistry()
  const service = new ApiService({
    secrets: createApiSecretStore({ credentials }),
    executor: createHttpExecutor({ fetchImpl }),
  })
  registerApiMethods(registry, service)
  return { service, registry, calls }
}

const REQUEST: HttpRequestSpec = { method: 'GET', url: 'http://127.0.0.1:3000/items' }

function valueOf<T>(result: UnaryDispatchResult): T {
  if (!result.body.ok) throw new Error(`unexpected failure: ${result.body.error.code}`)
  return result.body.value as T
}

describe('api.http.send assertions', () => {
  it('rejects a malformed list before the request is sent', async () => {
    const { service, calls } = setup()
    const tooMany = Array.from({ length: API_ASSERTIONS_MAX + 1 }, () => ({
      kind: 'status',
      expected: 200,
    }))

    for (const assertions of ['nope', [{ kind: 'status', expected: 99 }], tooMany]) {
      await expect(service.send({ request: REQUEST, assertions })).rejects.toMatchObject({
        code: 'invalid_input',
        details: { field: 'assertions' },
      })
    }
    expect(calls).toHaveLength(0)
  })

  it('returns one result per check and omits the field when none were sent', async () => {
    const { registry, calls } = setup()

    const withChecks = await registry.dispatch(
      API_HTTP_SEND_METHOD,
      {
        request: REQUEST,
        assertions: [
          { kind: 'status', expected: 200 },
          { kind: 'json', path: '$.ok', expected: 'true' },
        ],
      },
      { request: new Request('http://127.0.0.1/api/vibe/request'), signal: new AbortController().signal },
    )
    const checked = valueOf<{ assertions: Array<{ passed: boolean }> }>(withChecks)
    expect(checked.assertions.map((result) => result.passed)).toEqual([true, true])

    const withoutChecks = await registry.dispatch(
      API_HTTP_SEND_METHOD,
      { request: REQUEST },
      { request: new Request('http://127.0.0.1/api/vibe/request'), signal: new AbortController().signal },
    )
    expect(valueOf<Record<string, unknown>>(withoutChecks)).not.toHaveProperty('assertions')
    expect(calls).toHaveLength(2)
  })
})

describe('isApiAssertion', () => {
  it('accepts the four shapes and rejects everything else', () => {
    expect(
      [
        { kind: 'status', expected: 204 },
        { kind: 'duration', maxMs: 0 },
        { kind: 'header', name: 'x', expected: '' },
        { kind: 'json', path: '$', expected: '1', match: 'contains' },
      ].every(isApiAssertion),
    ).toBe(true)

    for (const bad of [
      null,
      [],
      { kind: 'status' },
      { kind: 'status', expected: 600 },
      { kind: 'status', expected: 200.5 },
      { kind: 'duration', maxMs: -1 },
      { kind: 'header', name: '', expected: 'x' },
      { kind: 'header', name: 'x', expected: 'y', match: 'regex' },
      { kind: 'json', path: '', expected: 'y' },
      { kind: 'json', path: '$', expected: 'x'.repeat(1001) },
      { kind: 'script', source: 'return true' },
    ]) {
      expect(isApiAssertion(bad), JSON.stringify(bad)).toBe(false)
    }
  })
})
