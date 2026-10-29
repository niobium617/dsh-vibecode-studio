/**
 * cURL import/export (FR-API-07, T046 rework).
 *
 * Parsing lives in the client because it is a pure text transform: no host
 * access, no network, and a pasted command never sends anything by itself. The
 * result is an editable `HttpRequestSpec` that still holds `{{placeholders}}`
 * untouched, so an exported command can be pasted back and a command copied
 * from DevTools never carries an expanded credential.
 *
 * Supported are the flags a browser or a hand-written request actually uses:
 * `-X/--request`, `-H/--header`, `-d` and friends, `--data-urlencode`, `-F`,
 * `-u/--user`, `-G/--get`, `-I/--head`, `-A`, `-e`, `-b`, `-m/--max-time`,
 * `--url`, plus shell line continuations. Flags that only affect transport
 * details this executor always applies (`-s`, `-L`, `-k`, `--compressed`, …)
 * are ignored. Anything that would silently change the request (proxies,
 * client certificates, uploads from disk) is rejected with a readable code.
 *
 * File parts (`-F name=@path`) cannot be read from the browser sandbox; the
 * importer rejects them instead of sending an empty file.
 */
import {
  HTTP_METHODS,
  HTTP_TIMEOUT_MAX_MS,
  HTTP_TIMEOUT_MIN_MS,
  isHttpRequestSpec,
  type HttpAuth,
  type HttpKeyValue,
  type HttpRequestSpec,
} from '../../contracts/api'

/** A pasted command is text in an input box, not a payload to store. */
export const CURL_INPUT_CHARS_MAX = 64 * 1024

export type CurlIssueCode =
  | 'empty'
  | 'too_long'
  | 'unterminated_quote'
  | 'missing_url'
  | 'extra_argument'
  | 'unknown_flag'
  | 'missing_value'
  | 'invalid_method'
  | 'invalid_user'
  | 'invalid_request'
  | 'conflicting_body'
  | 'body_not_allowed'
  | 'unsupported_file'
  | 'unsupported_flag'

export interface CurlIssue {
  readonly code: CurlIssueCode
  /** Flag or value the message can quote; never a credential-looking whole line. */
  readonly detail?: string
}

export type CurlParseResult =
  | { readonly ok: true; readonly spec: HttpRequestSpec }
  | { readonly ok: false; readonly issue: CurlIssue }

class CurlError extends Error {
  constructor(
    readonly code: CurlIssueCode,
    readonly detail?: string,
  ) {
    super(code)
  }
}

function fail(code: CurlIssueCode, detail?: string): never {
  throw new CurlError(code, detail)
}

/* -------------------------------------------------------------------------
 * Tokenizer
 *
 * Bash-style quoting (`'...'`, `"..."`, `$'...'`) covers DevTools output.
 * Windows cmd output wraps tokens in `^"..."^"`, so carets that escape a
 * quote or a line break are normalised before tokenising; a literal `^` in a
 * URL is left alone.
 * ---------------------------------------------------------------------- */

function normalizeCmd(input: string): string {
  if (!input.includes('^')) return input
  return input.replace(/\^"/g, '"').replace(/\^\r?\n/g, ' ')
}

function readAnsiC(input: string, start: number): { value: string; next: number } {
  let value = ''
  let index = start
  while (index < input.length) {
    const char = input[index]!
    if (char === "'") return { value, next: index + 1 }
    if (char !== '\\') {
      value += char
      index += 1
      continue
    }
    const escape = input[index + 1]
    if (escape === undefined) fail('unterminated_quote')
    switch (escape) {
      case 'n':
        value += '\n'
        index += 2
        break
      case 'r':
        value += '\r'
        index += 2
        break
      case 't':
        value += '\t'
        index += 2
        break
      case '\\':
      case "'":
      case '"':
        value += escape
        index += 2
        break
      case 'x': {
        const hex = input.slice(index + 2, index + 4)
        if (!/^[0-9A-Fa-f]{2}$/.test(hex)) fail('unterminated_quote')
        value += String.fromCharCode(Number.parseInt(hex, 16))
        index += 4
        break
      }
      case 'u': {
        const hex = input.slice(index + 2, index + 6)
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) fail('unterminated_quote')
        value += String.fromCharCode(Number.parseInt(hex, 16))
        index += 6
        break
      }
      default:
        value += escape
        index += 2
    }
  }
  return fail('unterminated_quote')
}

function readDoubleQuoted(input: string, start: number): { value: string; next: number } {
  let value = ''
  let index = start
  while (index < input.length) {
    const char = input[index]!
    if (char === '"') return { value, next: index + 1 }
    if (char === '\\') {
      const escape = input[index + 1]
      if (escape === undefined) fail('unterminated_quote')
      if (escape === '\n') {
        index += 2
        continue
      }
      if (escape === '\r' && input[index + 2] === '\n') {
        index += 3
        continue
      }
      // Bash only removes the backslash before these characters; before
      // anything else it is data (a Windows path, for example).
      if (escape === '"' || escape === '\\' || escape === '$' || escape === '`') {
        value += escape
      } else {
        value += `\\${escape}`
      }
      index += 2
      continue
    }
    value += char
    index += 1
  }
  return fail('unterminated_quote')
}

function tokenize(input: string): string[] {
  const text = normalizeCmd(input)
  const tokens: string[] = []
  let current = ''
  let hasToken = false
  let index = 0

  const finish = (): void => {
    if (!hasToken) return
    tokens.push(current)
    current = ''
    hasToken = false
  }

  while (index < text.length) {
    const char = text[index]!

    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
      finish()
      index += 1
      continue
    }

    if (char === '\\') {
      const next = text[index + 1]
      if (next === undefined) {
        hasToken = true
        current += '\\'
        index += 1
        continue
      }
      if (next === '\n') {
        index += 2
        continue
      }
      if (next === '\r' && text[index + 2] === '\n') {
        index += 3
        continue
      }
      hasToken = true
      current += next
      index += 2
      continue
    }

    if (char === '^') {
      const next = text[index + 1]
      if (next === '\n') {
        index += 2
        continue
      }
      if (next === '\r' && text[index + 2] === '\n') {
        index += 3
        continue
      }
      if (next === '"' || next === '^' || next === '&' || next === '|' || next === '<' || next === '>') {
        hasToken = true
        current += next
        index += 2
        continue
      }
    }

    if (char === "'") {
      const end = text.indexOf("'", index + 1)
      if (end < 0) fail('unterminated_quote')
      hasToken = true
      current += text.slice(index + 1, end)
      index = end + 1
      continue
    }

    if (char === '$' && text[index + 1] === "'") {
      const parsed = readAnsiC(text, index + 2)
      hasToken = true
      current += parsed.value
      index = parsed.next
      continue
    }

    if (char === '"') {
      const parsed = readDoubleQuoted(text, index + 1)
      hasToken = true
      current += parsed.value
      index = parsed.next
      continue
    }

    hasToken = true
    current += char
    index += 1
  }

  finish()
  return tokens
}

/* -------------------------------------------------------------------------
 * Flags
 * ---------------------------------------------------------------------- */

const SHORT_WITH_VALUE = new Set(['X', 'H', 'd', 'F', 'u', 'm', 'A', 'e', 'b'])

/** Flags that only toggle details this executor fixes or ignores. */
const IGNORED_LONG = new Set([
  'compressed',
  'silent',
  'show-error',
  'verbose',
  'location',
  'location-trusted',
  'include',
  'no-progress-meter',
  'globoff',
  'http1.0',
  'http1.1',
  'http2',
  'http2-prior-knowledge',
  'http3',
  'insecure',
  'fail',
  'fail-with-body',
  'no-buffer',
  'path-as-is',
  'tcp-nodelay',
  'raw',
  'disable',
  'ipv4',
  'ipv6',
  'progress-bar',
  'no-keepalive',
  'ssl',
  'no-alpn',
  'basic',
  'anyauth',
])

const IGNORED_SHORT = new Set(['s', 'S', 'v', 'L', 'k', 'i', 'g', '4', '6', '#'])

/** Rejected because ignoring them would silently change where/how data goes. */
const UNSUPPORTED_LONG = new Set([
  'proxy',
  'proxy-user',
  'cert',
  'key',
  'cacert',
  'capath',
  'resolve',
  'interface',
  'output',
  'output-dir',
  'remote-name',
  'upload-file',
  'request-target',
  'next',
  'config',
  'data-ascii-file',
  'cookie-jar',
  'ftp-ssl',
  'tlsv1.2',
  'tlsv1.3',
])

function valueOfFlag(tokens: readonly string[], index: number, flag: string): [string, number] {
  const value = tokens[index + 1]
  if (value === undefined) fail('missing_value', flag)
  return [value, index + 2]
}

function splitUrl(raw: string): { url: string; query: HttpKeyValue[] } {
  const hash = raw.indexOf('#')
  const fragment = hash < 0 ? '' : raw.slice(hash)
  const withoutHash = hash < 0 ? raw : raw.slice(0, hash)
  const mark = withoutHash.indexOf('?')
  if (mark < 0) return { url: raw, query: [] }

  const base = withoutHash.slice(0, mark) + fragment
  const query: HttpKeyValue[] = []
  for (const pair of withoutHash.slice(mark + 1).split('&')) {
    if (pair === '') continue
    const equals = pair.indexOf('=')
    const name = equals < 0 ? pair : pair.slice(0, equals)
    const value = equals < 0 ? '' : pair.slice(equals + 1)
    query.push({ name: decodeComponent(name), value: decodeComponent(value) })
  }
  return { url: base, query }
}

function decodeComponent(value: string): string {
  const plus = value.replace(/\+/g, ' ')
  try {
    return decodeURIComponent(plus)
  } catch {
    return plus
  }
}

function headerEntry(raw: string): HttpKeyValue {
  const colon = raw.indexOf(':')
  if (colon < 0) {
    const semicolon = raw.endsWith(';') ? raw.slice(0, -1) : raw
    return { name: semicolon.trim(), value: '' }
  }
  return { name: raw.slice(0, colon).trim(), value: raw.slice(colon + 1).trim() }
}

function parseBasicAuthorization(value: string): HttpAuth | null {
  const match = /^Basic\s+(\S+)$/i.exec(value)
  if (match === null) return null
  try {
    const decoded = atob(match[1]!)
    const colon = decoded.indexOf(':')
    if (colon < 0) return null
    return { kind: 'basic', username: decoded.slice(0, colon), password: decoded.slice(colon + 1) }
  } catch {
    return null
  }
}

function parseBearerAuthorization(value: string): HttpAuth | null {
  const match = /^Bearer\s+(.+)$/i.exec(value)
  return match === null ? null : { kind: 'bearer', token: match[1]!.trim() }
}

/** `a=1&b=2`; returns null when the text is not a plain urlencoded pair list. */
function parseFormFields(joined: string): HttpKeyValue[] | null {
  if (joined.trim() === '' || /^[[{]/.test(joined.trim())) return null
  const fields: HttpKeyValue[] = []
  for (const pair of joined.split('&')) {
    if (pair === '') continue
    const equals = pair.indexOf('=')
    if (equals < 0) return null
    fields.push({ name: decodeComponent(pair.slice(0, equals)), value: decodeComponent(pair.slice(equals + 1)) })
  }
  return fields.length === 0 ? null : fields
}

function chooseBody(
  raw: readonly string[],
  form: readonly HttpKeyValue[],
  contentType: string | undefined,
): HttpRequestSpec['body'] | undefined {
  if (raw.length > 0 && form.length > 0) fail('conflicting_body')
  if (raw.length === 0 && form.length === 0) return undefined

  const joined = raw.join('&')
  const lower = (contentType ?? '').toLowerCase()

  if (raw.length > 0 && lower.startsWith('application/json')) {
    try {
      JSON.parse(joined)
      return { kind: 'json', text: joined }
    } catch {
      // Curl does not validate JSON; keep the bytes and the declared type.
      return { kind: 'text', text: joined, contentType: contentType ?? 'application/json' }
    }
  }

  if (raw.length > 0 && (!lower || lower.startsWith('application/x-www-form-urlencoded'))) {
    const fields = parseFormFields(joined)
    if (fields !== null) return { kind: 'form', fields }
  }

  if (form.length > 0) return { kind: 'form', fields: form }

  if (raw.length > 0 && /^[[{]/.test(joined.trim())) {
    try {
      JSON.parse(joined)
      return { kind: 'json', text: joined }
    } catch {
      // Falls through to text; the body is still exactly what curl would send.
    }
  }

  return {
    kind: 'text',
    text: joined,
    contentType: contentType ?? 'application/x-www-form-urlencoded',
  }
}

function timeoutOf(value: string, current: number | undefined): number | undefined {
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) return current
  const ms = Math.round(seconds * 1000)
  return ms >= HTTP_TIMEOUT_MIN_MS && ms <= HTTP_TIMEOUT_MAX_MS ? ms : current
}

function decodeUrlEncoded(raw: string, bare = false): HttpKeyValue {
  const equals = raw.indexOf('=')
  if (equals < 0) {
    if (bare) return { name: decodeComponent(raw), value: '' }
    fail('missing_value', '--data-urlencode')
  }
  return {
    name: decodeComponent(raw.slice(0, equals)),
    value: decodeComponent(raw.slice(equals + 1)),
  }
}

/** Parses one pasted command into an editable spec. Never sends anything. */
export function parseCurl(input: string): CurlParseResult {
  const text = input.trim()
  if (text === '') return { ok: false, issue: { code: 'empty' } }
  if (text.length > CURL_INPUT_CHARS_MAX) {
    return { ok: false, issue: { code: 'too_long', detail: String(CURL_INPUT_CHARS_MAX) } }
  }

  try {
    const tokens = tokenize(text)
    if (tokens.length === 0) fail('empty')
    const program = tokens[0]!.replace(/\\/g, '/').split('/').pop() ?? tokens[0]!
    if (!/^curl(?:\.exe)?$/i.test(program)) fail('unknown_flag', tokens[0]!)

    let url: string | undefined
    let method: string | undefined
    let head = false
    let getMode = false
    let auth: HttpAuth | undefined
    let timeoutMs: number | undefined
    const headers: HttpKeyValue[] = []
    const rawData: string[] = []
    const encodedData: HttpKeyValue[] = []
    const formFields: HttpKeyValue[] = []

    const addHeader = (entry: HttpKeyValue): void => {
      const lower = entry.name.toLowerCase()
      const existing = headers.findIndex((header) => header.name.toLowerCase() === lower)
      if (existing >= 0) headers.splice(existing, 1)
      headers.push(entry)
    }

    let index = 1
    while (index < tokens.length) {
      let token = tokens[index]!
      index += 1

      if (!token.startsWith('-') || token === '-') {
        if (url !== undefined) fail('extra_argument', token)
        url = token
        continue
      }

      let attached: string | undefined
      if (token.startsWith('--')) {
        const equals = token.indexOf('=')
        if (equals > 2) {
          attached = token.slice(equals + 1)
          token = token.slice(0, equals)
        }
        const name = token.slice(2)
        if (IGNORED_LONG.has(name)) continue
        if (UNSUPPORTED_LONG.has(name)) fail('unsupported_flag', `--${name}`)

        // `--flag=value` and `--flag value` share one reader.
        const take = (): string => {
          if (attached !== undefined) {
            const taken = attached
            attached = undefined
            return taken
          }
          const [taken, next] = valueOfFlag(tokens, index - 1, token)
          index = next
          return taken
        }

        switch (name) {
          case 'request':
            method = take()
            break
          case 'header':
            addHeader(headerEntry(take()))
            break
          case 'data':
          case 'data-ascii':
          case 'data-binary': {
            const data = take()
            if (data.startsWith('@')) fail('unsupported_file', `--${name}`)
            rawData.push(data)
            break
          }
          case 'data-raw':
            rawData.push(take())
            break
          case 'data-urlencode':
            encodedData.push(decodeUrlEncoded(take()))
            break
          case 'form':
            formFields.push(parseForm(take()))
            break
          case 'form-string':
            formFields.push(parseForm(take(), true))
            break
          case 'user':
            auth = parseUser(take())
            break
          case 'get':
            getMode = true
            break
          case 'head':
            head = true
            break
          case 'url':
            if (url !== undefined) fail('extra_argument', '--url')
            url = take()
            break
          case 'user-agent':
            addHeader({ name: 'user-agent', value: take() })
            break
          case 'referer':
            addHeader({ name: 'referer', value: take() })
            break
          case 'cookie': {
            const cookie = take()
            if (cookie.startsWith('@')) fail('unsupported_file', '--cookie')
            addHeader({ name: 'cookie', value: cookie })
            break
          }
          case 'max-time':
            timeoutMs = timeoutOf(take(), timeoutMs)
            break
          default:
            fail('unknown_flag', token)
        }
        continue
      }

      // Short flags, including attached values (`-XPOST`, `-H'name: value'`).
      const short = token.slice(1)
      if (short.length === 0) fail('unknown_flag', token)
      const first = short[0]!
      if (SHORT_WITH_VALUE.has(first)) {
        const takeShort = (): string => {
          if (short.length > 1) return short.slice(1)
          const [taken, next] = valueOfFlag(tokens, index - 1, `-${first}`)
          index = next
          return taken
        }
        switch (first) {
          case 'X':
            method = takeShort()
            break
          case 'H':
            addHeader(headerEntry(takeShort()))
            break
          case 'd': {
            const data = takeShort()
            if (data.startsWith('@')) fail('unsupported_file', '-d')
            rawData.push(data)
            break
          }
          case 'F':
            formFields.push(parseForm(takeShort()))
            break
          case 'u':
            auth = parseUser(takeShort())
            break
          case 'A':
            addHeader({ name: 'user-agent', value: takeShort() })
            break
          case 'e':
            addHeader({ name: 'referer', value: takeShort() })
            break
          case 'b': {
            const cookie = takeShort()
            if (cookie.startsWith('@')) fail('unsupported_file', '-b')
            addHeader({ name: 'cookie', value: cookie })
            break
          }
          case 'm':
            timeoutMs = timeoutOf(takeShort(), timeoutMs)
            break
          default:
            fail('unknown_flag', `-${first}`)
        }
        continue
      }
      if (short === 'G') {
        getMode = true
        continue
      }
      if (short === 'I') {
        head = true
        continue
      }
      if ([...short].every((flag) => IGNORED_SHORT.has(flag))) continue
      fail('unknown_flag', token)
    }

    if (url === undefined) fail('missing_url')
    if (getMode && formFields.length > 0) fail('conflicting_body')
    if (getMode && encodedData.length === 0 && rawData.length === 0) {
      // `-G` alone is a GET with no extra query; nothing to move.
    }

    const split = splitUrl(url)
    const query = [...split.query]
    if (getMode) {
      for (const entry of rawData) {
        for (const pair of entry.split('&')) {
          const parsed = decodeUrlEncoded(pair, true)
          query.push(parsed)
        }
      }
      query.push(...encodedData)
    }

    // `Authorization: Bearer …` and `Basic …` become the auth field so the
    // panel shows them in one place and the executor applies them once.
    const authorization = headers.find(
      (header) => header.name.toLowerCase() === 'authorization',
    )
    if (authorization !== undefined && auth === undefined) {
      const parsed =
        parseBearerAuthorization(authorization.value) ??
        parseBasicAuthorization(authorization.value)
      if (parsed !== null) {
        auth = parsed
        headers.splice(headers.indexOf(authorization), 1)
      }
    }

    const contentType = headers.find(
      (header) => header.name.toLowerCase() === 'content-type',
    )?.value

    let body: HttpRequestSpec['body'] | undefined
    if (getMode) {
      body = undefined
    } else if (formFields.length > 0) {
      body = { kind: 'multipart', fields: formFields, files: [] }
    } else {
      body = chooseBody(rawData, encodedData, contentType)
    }

    const resolvedMethod = (method ?? (head ? 'HEAD' : body === undefined ? 'GET' : 'POST')).toUpperCase()
    if (!(HTTP_METHODS as readonly string[]).includes(resolvedMethod)) {
      fail('invalid_method', resolvedMethod)
    }
    if (body !== undefined && (resolvedMethod === 'GET' || resolvedMethod === 'HEAD')) {
      fail('body_not_allowed', resolvedMethod)
    }

    const spec: HttpRequestSpec = {
      method: resolvedMethod as HttpRequestSpec['method'],
      url: split.url,
      ...(query.length === 0 ? {} : { query }),
      ...(headers.length === 0 ? {} : { headers }),
      ...(body === undefined ? {} : { body }),
      ...(auth === undefined ? {} : { auth }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    }

    if (!isHttpRequestSpec(spec)) fail('invalid_request')
    return { ok: true, spec }
  } catch (error) {
    if (error instanceof CurlError) {
      return {
        ok: false,
        issue: error.detail === undefined ? { code: error.code } : { code: error.code, detail: error.detail },
      }
    }
    return { ok: false, issue: { code: 'invalid_request' } }
  }
}

function parseUser(value: string): HttpAuth {
  const colon = value.indexOf(':')
  if (colon < 0) return { kind: 'basic', username: value, password: '' }
  const username = value.slice(0, colon)
  const password = value.slice(colon + 1)
  if (username === '') fail('invalid_user')
  return { kind: 'basic', username, password }
}

function parseForm(value: string, literal = false): HttpKeyValue {
  const equals = value.indexOf('=')
  if (equals <= 0) fail('missing_value', '-F')
  const name = value.slice(0, equals)
  const rest = value.slice(equals + 1)
  if (!literal && (rest.startsWith('@') || rest.startsWith('<'))) fail('unsupported_file', name)
  const semicolon = rest.indexOf(';')
  return { name, value: semicolon < 0 ? rest : rest.slice(0, semicolon) }
}

/* -------------------------------------------------------------------------
 * Export
 * ---------------------------------------------------------------------- */

/** One place to change if the export ever needs warnings; it is UI-only. */
export interface CurlExport {
  readonly command: string
  /** Parts of the request the text form cannot carry (multipart bytes). */
  readonly losses: readonly ('multipart_file' | 'file_name')[]
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function restorePlaceholders(value: string): string {
  return value.replace(/%7B%7B([A-Za-z_][A-Za-z0-9_.-]*)%7D%7D/gi, '{{$1}}')
}

function encodePair(name: string, value: string): string {
  return `${restorePlaceholders(encodeURIComponent(name))}=${restorePlaceholders(encodeURIComponent(value))}`
}

/** The URL exactly as curl should receive it, placeholders intact. */
export function curlUrl(spec: HttpRequestSpec): string {
  const query: HttpKeyValue[] = [...(spec.query ?? [])]
  if (spec.auth?.kind === 'api-key' && spec.auth.in === 'query') {
    query.push({ name: spec.auth.name, value: spec.auth.value })
  }
  const enabled = query.filter((entry) => entry.enabled !== false)
  if (enabled.length === 0) return spec.url

  const hash = spec.url.indexOf('#')
  const base = hash < 0 ? spec.url : spec.url.slice(0, hash)
  const fragment = hash < 0 ? '' : spec.url.slice(hash)
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}${enabled.map((entry) => encodePair(entry.name, entry.value)).join('&')}${fragment}`
}

/**
 * Renders a spec as a bash-compatible command. Placeholders are preserved on
 * purpose: exporting must never turn `{{token}}` into its resolved value.
 */
export function toCurl(spec: HttpRequestSpec): CurlExport {
  const parts: string[] = ['curl']
  const method = spec.method.toUpperCase()
  if (method !== 'GET') parts.push('-X', method)

  parts.push(shellQuote(curlUrl(spec)))

  const headerNames = new Set<string>()
  for (const header of spec.headers ?? []) {
    if (header.enabled === false || header.name.trim() === '') continue
    // The executor manages these and would reject an imported command that
    // repeats them; exporting them would only produce a request that cannot run.
    const lower = header.name.trim().toLowerCase()
    if (['content-length', 'connection', 'host', 'expect', 'transfer-encoding'].includes(lower)) continue
    headerNames.add(lower)
    parts.push('-H', shellQuote(`${header.name.trim()}: ${header.value}`))
  }

  const auth = spec.auth
  if (auth?.kind === 'bearer' && !headerNames.has('authorization')) {
    parts.push('-H', shellQuote(`Authorization: Bearer ${auth.token}`))
  } else if (auth?.kind === 'basic') {
    parts.push('-u', shellQuote(`${auth.username}:${auth.password}`))
  } else if (auth?.kind === 'api-key' && auth.in === 'header' && !headerNames.has(auth.name.toLowerCase())) {
    parts.push('-H', shellQuote(`${auth.name}: ${auth.value}`))
  }

  const losses: Array<'multipart_file' | 'file_name'> = []
  const body = spec.body
  if (body !== undefined && body.kind !== 'none') {
    switch (body.kind) {
      case 'json':
        if (!headerNames.has('content-type')) {
          parts.push('-H', shellQuote('Content-Type: application/json'))
        }
        parts.push('--data-raw', shellQuote(body.text))
        break
      case 'text':
        if (body.contentType !== undefined && !headerNames.has('content-type')) {
          parts.push('-H', shellQuote(`Content-Type: ${body.contentType}`))
        }
        parts.push('--data-raw', shellQuote(body.text))
        break
      case 'form':
        for (const field of body.fields) {
          if (field.enabled === false) continue
          parts.push('--data-urlencode', shellQuote(`${field.name}=${field.value}`))
        }
        break
      case 'multipart':
        for (const field of body.fields) {
          if (field.enabled === false) continue
          parts.push('-F', shellQuote(`${field.name}=${field.value}`))
        }
        for (const file of body.files) {
          losses.push('multipart_file')
          if (file.fileName.trim() === '' || /[\r\n]/.test(file.fileName)) {
            losses.push('file_name')
            continue
          }
          parts.push('-F', shellQuote(`${file.field}=@${file.fileName}`))
        }
        break
    }
  }

  return { command: parts.join(' '), losses: [...new Set(losses)] }
}

