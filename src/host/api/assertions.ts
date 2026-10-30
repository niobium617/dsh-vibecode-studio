/**
 * Declarative response assertions (T045).
 *
 * The workbench never runs user code (SPEC FR-API-12): an assertion is a small
 * data document, and this module is the only place that reads it. JSONPath is
 * a deliberately tiny subset — `$` followed by `.key`, `['key']` or `[0]`
 * steps — so a typo fails one assertion with a readable reason instead of
 * turning the panel into a script host. Comparison is textual: a string
 * resolves to its raw value, numbers/booleans/null to their literal, and
 * objects/arrays to compact JSON, which is what a beginner can see in the
 * response tree.
 */
import {
  API_ASSERTION_ACTUAL_CHARS_MAX,
  type ApiAssertion,
  type ApiAssertionFailure,
  type ApiAssertionMatch,
  type ApiAssertionResult,
  type HttpExecutionResult,
} from '../../contracts/api'

export type JsonPathSegment =
  | { readonly kind: 'key'; readonly key: string }
  | { readonly kind: 'index'; readonly index: number }

const KEY_CHARS = /[A-Za-z0-9_$-]/

/**
 * Parses the supported JSONPath subset, or returns null when the expression is
 * outside it. Every step is collected up front so evaluation can never throw
 * on a malformed path.
 */
export function parseJsonPath(path: string): readonly JsonPathSegment[] | null {
  if (!path.startsWith('$')) return null
  const segments: JsonPathSegment[] = []
  let index = 1
  while (index < path.length) {
    const char = path[index]
    if (char === '.') {
      index += 1
      const start = index
      while (index < path.length && KEY_CHARS.test(path[index] ?? '')) index += 1
      if (index === start) return null
      segments.push({ kind: 'key', key: path.slice(start, index) })
      continue
    }
    if (char === '[') {
      index += 1
      if (index >= path.length) return null
      const quote = path[index]
      if (quote === '"' || quote === "'") {
        index += 1
        let key = ''
        while (index < path.length && path[index] !== quote) {
          if (path[index] === '\\') {
            index += 1
            if (index >= path.length) return null
          }
          key += path[index]
          index += 1
        }
        if (index >= path.length || path[index] !== quote) return null
        index += 1
        if (index >= path.length || path[index] !== ']') return null
        index += 1
        segments.push({ kind: 'key', key })
        continue
      }
      const start = index
      while (index < path.length && (path[index] ?? '') >= '0' && (path[index] ?? '') <= '9') {
        index += 1
      }
      if (index === start || path[index] !== ']') return null
      const parsed = Number(path.slice(start, index))
      if (!Number.isSafeInteger(parsed)) return null
      index += 1
      segments.push({ kind: 'index', index: parsed })
      continue
    }
    return null
  }
  return segments
}

/** Case-insensitive header lookup; the executor keeps the wire spelling. */
export function findHeader(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | null {
  const wanted = name.trim().toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value
  }
  return null
}

/** Text a person can compare by eye; objects become compact JSON. */
export function formatAssertionValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  const json = JSON.stringify(value)
  return json ?? String(value)
}

function clip(text: string): string {
  return text.length <= API_ASSERTION_ACTUAL_CHARS_MAX
    ? text
    : `${text.slice(0, API_ASSERTION_ACTUAL_CHARS_MAX - 1)}…`
}

function matches(actual: string, expected: string, match: ApiAssertionMatch | undefined): boolean {
  return match === 'contains' ? actual.includes(expected) : actual === expected
}

function resolvePath(
  root: unknown,
  segments: readonly JsonPathSegment[],
): { readonly found: boolean; readonly value: unknown } {
  let current: unknown = root
  for (const segment of segments) {
    if (segment.kind === 'key') {
      if (current === null || typeof current !== 'object' || Array.isArray(current)) {
        return { found: false, value: undefined }
      }
      if (!Object.hasOwn(current, segment.key)) return { found: false, value: undefined }
      current = (current as Record<string, unknown>)[segment.key]
      continue
    }
    if (!Array.isArray(current) || segment.index >= current.length) {
      return { found: false, value: undefined }
    }
    current = current[segment.index]
  }
  return { found: true, value: current }
}

function failed(index: number, failure: ApiAssertionFailure, actual: string | null): ApiAssertionResult {
  return { index, passed: false, actual, failure }
}

function passed(index: number, actual: string | null): ApiAssertionResult {
  return { index, passed: true, actual }
}

function evaluateAssertion(
  assertion: ApiAssertion,
  index: number,
  result: HttpExecutionResult,
): ApiAssertionResult {
  switch (assertion.kind) {
    case 'status': {
      const actual = String(result.status)
      return result.status === assertion.expected
        ? passed(index, actual)
        : failed(index, 'status_mismatch', actual)
    }
    case 'duration': {
      const actual = `${result.elapsedMs} ms`
      return result.elapsedMs <= assertion.maxMs
        ? passed(index, actual)
        : failed(index, 'duration_exceeded', actual)
    }
    case 'header': {
      const value = findHeader(result.headers, assertion.name)
      if (value === null) return failed(index, 'header_missing', null)
      const actual = clip(value)
      return matches(value, assertion.expected, assertion.match)
        ? passed(index, actual)
        : failed(index, 'value_mismatch', actual)
    }
    case 'json': {
      const text = result.body.text
      if (text === null) return failed(index, 'body_not_json', null)
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return failed(index, 'body_not_json', null)
      }
      const segments = parseJsonPath(assertion.path)
      if (segments === null) return failed(index, 'path_syntax', null)
      const resolved = resolvePath(parsed, segments)
      if (!resolved.found) return failed(index, 'path_missing', null)
      const value = formatAssertionValue(resolved.value)
      const actual = clip(value)
      return matches(value, assertion.expected, assertion.match)
        ? passed(index, actual)
        : failed(index, 'value_mismatch', actual)
    }
  }
}

/**
 * Evaluates every assertion against one finished response, in submission
 * order. Results always line up with the input list; a malformed path fails
 * its own assertion and never aborts the rest.
 */
export function evaluateAssertions(
  assertions: readonly ApiAssertion[],
  result: HttpExecutionResult,
): readonly ApiAssertionResult[] {
  return assertions.map((assertion, index) => evaluateAssertion(assertion, index, result))
}
