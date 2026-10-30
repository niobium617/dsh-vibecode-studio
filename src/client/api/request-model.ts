/**
 * Editable request draft and its conversion to `HttpRequestSpec` (T038).
 *
 * The form keeps strings exactly as typed — empty rows, half-typed URLs and
 * invalid JSON all have to survive a render. `buildRequestSpec` is the only
 * place that decides what is sent, so validation messages and the wire shape
 * never drift apart. It is pure and DOM-free so the component tests can pin
 * the rules without a browser.
 */
import {
  HTTP_URL_CHARS_MAX,
  type HttpAuthKind,
  type HttpFilePart,
  type HttpKeyValue,
  type HttpMethod,
  type HttpRequestBody,
  type HttpRequestSpec,
} from '../../contracts/api'

export type BodyKind = HttpRequestBody['kind']
export type RequestSection = 'query' | 'headers' | 'body' | 'auth'

export interface KeyValueDraft {
  readonly name: string
  readonly value: string
  readonly enabled: boolean
}

export interface FileDraft {
  readonly field: string
  readonly fileName: string
  readonly contentType: string
  readonly base64: string
}

export interface RequestDraft {
  readonly method: HttpMethod
  readonly url: string
  readonly query: readonly KeyValueDraft[]
  readonly headers: readonly KeyValueDraft[]
  readonly bodyKind: BodyKind
  readonly bodyText: string
  readonly bodyContentType: string
  readonly fields: readonly KeyValueDraft[]
  readonly files: readonly FileDraft[]
  readonly authKind: HttpAuthKind
  readonly bearerToken: string
  readonly basicUsername: string
  readonly basicPassword: string
  readonly apiKeyName: string
  readonly apiKeyValue: string
  readonly apiKeyIn: 'header' | 'query'
}

export type RequestIssueCode =
  | 'url_missing'
  | 'url_invalid'
  | 'url_credentials'
  | 'row_name_missing'
  | 'header_invalid'
  | 'header_duplicate'
  | 'json_invalid'
  | 'auth_token_missing'
  | 'auth_key_name_missing'
  | 'file_field_missing'

export interface RequestIssue {
  readonly code: RequestIssueCode
  /** Dotted path of the offending field, e.g. `headers[2]`. */
  readonly field: string
}

export type DraftResult =
  | { readonly ok: true; readonly spec: HttpRequestSpec }
  | { readonly ok: false; readonly issues: readonly RequestIssue[] }

/** RFC 7230 token characters; the host rejects everything else. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

export function createKeyValue(name = '', value = ''): KeyValueDraft {
  return { name, value, enabled: true }
}

export function createRequestDraft(): RequestDraft {
  return {
    method: 'GET',
    url: '',
    query: [createKeyValue()],
    headers: [createKeyValue()],
    bodyKind: 'none',
    bodyText: '',
    bodyContentType: '',
    fields: [createKeyValue()],
    files: [],
    authKind: 'none',
    bearerToken: '',
    basicUsername: '',
    basicPassword: '',
    apiKeyName: '',
    apiKeyValue: '',
    apiKeyIn: 'header',
  }
}

export function setRow(
  rows: readonly KeyValueDraft[],
  index: number,
  patch: Partial<KeyValueDraft>,
): KeyValueDraft[] {
  return rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
}

export function removeRow(rows: readonly KeyValueDraft[], index: number): KeyValueDraft[] {
  return rows.filter((_, i) => i !== index)
}

export function appendRow(rows: readonly KeyValueDraft[]): KeyValueDraft[] {
  return [...rows, createKeyValue()]
}

export function setFile(
  files: readonly FileDraft[],
  index: number,
  patch: Partial<FileDraft>,
): FileDraft[] {
  return files.map((file, i) => (i === index ? { ...file, ...patch } : file))
}

export function removeFile(files: readonly FileDraft[], index: number): FileDraft[] {
  return files.filter((_, i) => i !== index)
}

/**
 * Rows that carry something: disabled rows are kept but never validated or
 * sent, and fully empty rows are dropped so the UI can keep a spare input.
 */
function collectRows(
  rows: readonly KeyValueDraft[],
  section: 'query' | 'headers' | 'fields',
  issues: RequestIssue[],
): HttpKeyValue[] {
  const kept: HttpKeyValue[] = []
  const seen = new Set<string>()
  rows.forEach((row, index) => {
    const name = row.name.trim()
    if (!row.enabled) {
      if (name !== '' || row.value !== '') kept.push({ name: row.name, value: row.value, enabled: false })
      return
    }
    if (name === '') {
      if (row.value !== '') issues.push({ code: 'row_name_missing', field: `${section}[${index}]` })
      return
    }
    if (section === 'headers') {
      if (!HEADER_NAME.test(name) || /[\r\n]/.test(row.value)) {
        issues.push({ code: 'header_invalid', field: `headers[${index}]` })
        return
      }
      const key = name.toLowerCase()
      if (seen.has(key)) {
        issues.push({ code: 'header_duplicate', field: `headers[${index}]` })
        return
      }
      seen.add(key)
    }
    kept.push({ name, value: row.value })
  })
  return kept
}

function buildBody(draft: RequestDraft, issues: RequestIssue[]): HttpRequestBody | undefined {
  switch (draft.bodyKind) {
    case 'none':
      return undefined
    case 'json':
      try {
        JSON.parse(draft.bodyText)
      } catch {
        issues.push({ code: 'json_invalid', field: 'body' })
        return undefined
      }
      return { kind: 'json', text: draft.bodyText }
    case 'text':
      return draft.bodyContentType.trim() === ''
        ? { kind: 'text', text: draft.bodyText }
        : { kind: 'text', text: draft.bodyText, contentType: draft.bodyContentType.trim() }
    case 'form':
      return { kind: 'form', fields: collectRows(draft.fields, 'fields', issues) }
    case 'multipart': {
      const files: HttpFilePart[] = []
      draft.files.forEach((file, index) => {
        if (file.field.trim() === '') {
          issues.push({ code: 'file_field_missing', field: `files[${index}]` })
          return
        }
        files.push({
          field: file.field.trim(),
          fileName: file.fileName,
          ...(file.contentType === '' ? {} : { contentType: file.contentType }),
          base64: file.base64,
        })
      })
      return { kind: 'multipart', fields: collectRows(draft.fields, 'fields', issues), files }
    }
  }
}

function buildAuth(draft: RequestDraft, issues: RequestIssue[]) {
  switch (draft.authKind) {
    case 'none':
      return undefined
    case 'bearer':
      if (draft.bearerToken.trim() === '') {
        issues.push({ code: 'auth_token_missing', field: 'auth.token' })
        return undefined
      }
      return { kind: 'bearer' as const, token: draft.bearerToken }
    case 'basic':
      return {
        kind: 'basic' as const,
        username: draft.basicUsername,
        password: draft.basicPassword,
      }
    case 'api-key':
      if (draft.apiKeyName.trim() === '') {
        issues.push({ code: 'auth_key_name_missing', field: 'auth.name' })
        return undefined
      }
      return {
        kind: 'api-key' as const,
        name: draft.apiKeyName.trim(),
        value: draft.apiKeyValue,
        in: draft.apiKeyIn,
      }
  }
}

/** Validate the draft; returns either the wire spec or every issue found. */
export function buildRequestSpec(draft: RequestDraft): DraftResult {
  const issues: RequestIssue[] = []
  const url = draft.url.trim()
  if (url === '') {
    issues.push({ code: 'url_missing', field: 'url' })
  } else if (url.length > HTTP_URL_CHARS_MAX) {
    issues.push({ code: 'url_invalid', field: 'url' })
  } else {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        issues.push({ code: 'url_invalid', field: 'url' })
      } else if (parsed.username !== '' || parsed.password !== '') {
        issues.push({ code: 'url_credentials', field: 'url' })
      }
    } catch {
      issues.push({ code: 'url_invalid', field: 'url' })
    }
  }

  const query = collectRows(draft.query, 'query', issues)
  const headers = collectRows(draft.headers, 'headers', issues)
  const body = buildBody(draft, issues)
  const auth = buildAuth(draft, issues)

  if (issues.length > 0) return { ok: false, issues }

  const spec: HttpRequestSpec = {
    method: draft.method,
    url,
    ...(query.length === 0 ? {} : { query }),
    ...(headers.length === 0 ? {} : { headers }),
    ...(body === undefined ? {} : { body }),
    ...(auth === undefined ? {} : { auth }),
  }
  return { ok: true, spec }
}

function draftRows(entries: readonly HttpKeyValue[] | undefined): KeyValueDraft[] {
  if (entries === undefined || entries.length === 0) return [createKeyValue()]
  return entries.map((entry) => ({
    name: entry.name,
    value: entry.value,
    enabled: entry.enabled !== false,
  }))
}

/**
 * Reverse of `buildRequestSpec` for a spec that came from somewhere else
 * (capture replay, imported collections). Values are copied as-is: an empty
 * spare row is only added when the spec has none.
 */
export function draftFromRequestSpec(spec: HttpRequestSpec): RequestDraft {
  const base = createRequestDraft()
  const body = spec.body
  let bodyKind: BodyKind = 'none'
  let bodyText = ''
  let bodyContentType = ''
  let fields: readonly KeyValueDraft[] = base.fields
  let files: readonly FileDraft[] = base.files

  switch (body?.kind) {
    case 'json':
      bodyKind = 'json'
      bodyText = body.text
      break
    case 'text':
      bodyKind = 'text'
      bodyText = body.text
      bodyContentType = body.contentType ?? ''
      break
    case 'form':
      bodyKind = 'form'
      fields = draftRows(body.fields)
      break
    case 'multipart':
      bodyKind = 'multipart'
      fields = draftRows(body.fields)
      files = body.files.map((file) => ({
        field: file.field,
        fileName: file.fileName,
        contentType: file.contentType ?? '',
        base64: file.base64,
      }))
      break
    case 'none':
    case undefined:
      break
  }

  const auth = spec.auth
  return {
    ...base,
    method: spec.method,
    url: spec.url,
    query: draftRows(spec.query),
    headers: draftRows(spec.headers),
    bodyKind,
    bodyText,
    bodyContentType,
    fields,
    files: [...files],
    authKind: auth?.kind ?? 'none',
    bearerToken: auth?.kind === 'bearer' ? auth.token : '',
    basicUsername: auth?.kind === 'basic' ? auth.username : '',
    basicPassword: auth?.kind === 'basic' ? auth.password : '',
    apiKeyName: auth?.kind === 'api-key' ? auth.name : '',
    apiKeyValue: auth?.kind === 'api-key' ? auth.value : '',
    apiKeyIn: auth?.kind === 'api-key' ? auth.in : 'header',
  }
}

/** Read one picked file into base64; the unary transport never sees a Buffer. */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('file could not be read'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma === -1 ? '' : result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

/** Default multipart field name: the file name without its extension. */
export function fieldNameForFile(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  return base === '' ? fileName : base
}
