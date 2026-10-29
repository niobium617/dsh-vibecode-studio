/**
 * Environment model and `{{variable}}` expansion (T036).
 *
 * An environment is a named set of variables layered over a request right
 * before it runs. Expansion is a single pass — a resolved value is never
 * re-scanned, so variables cannot reference each other in a chain — and it is
 * deliberately forgiving: a missing, disabled or unconfigured-secret variable
 * stays in place as `{{name}}` and is reported to the caller, so the UI can
 * point at the exact field instead of the request failing with "invalid URL".
 *
 * Secret variables hold a credential *name* in their `value`; this module
 * resolves it through {@link ApiSecretStore} only when a request executes.
 * `resolveHttpRequest()` therefore returns a spec that may contain plaintext
 * secrets and is host-only: never send its result across the unary wire. The
 * client-safe counterpart is `describeEnvironment()`.
 */
import {
  isApiEnvironment,
  isHttpRequestSpec,
  type ApiEnvironment,
  type ApiEnvironmentVariableView,
  type ApiEnvironmentView,
  type HttpAuth,
  type HttpFilePart,
  type HttpKeyValue,
  type HttpRequestBody,
  type HttpRequestSpec,
  type UnresolvedVariable,
} from '../../contracts/api'
import { studioError } from '../../contracts/errors'
import { isCredentialName, type ApiSecretStore, type CredentialDescription } from './secrets'

/** `{{name}}`; the inner grammar is the one environments validate against. */
const PLACEHOLDER_RE = /\{\{([A-Za-z_][A-Za-z0-9_.-]*)\}\}/g

function invalid(message: string, field: string): never {
  throw studioError('invalid_input', `vibe-studio: ${message}`, { field })
}

interface VariableSource {
  readonly value: string
  readonly secret: boolean
  readonly enabled: boolean
}

/**
 * Validates an environment: names fit `{{...}}`, are unique, and a secret's
 * value is a credential name rather than something that looks like a value.
 */
export function parseApiEnvironment(input: unknown): ApiEnvironment {
  if (!isApiEnvironment(input)) {
    invalid('an environment holds at most 200 variables, each with a valid name', 'variables')
  }

  const seen = new Set<string>()
  for (const [index, variable] of input.variables.entries()) {
    if (seen.has(variable.name)) {
      invalid(`duplicate variable "${variable.name}"`, `variables[${index}].name`)
    }
    seen.add(variable.name)
    if (variable.secret === true && !isCredentialName(variable.value)) {
      invalid(
        `secret variable "${variable.name}" must name a credential, not hold a value`,
        `variables[${index}].value`,
      )
    }
  }
  return input
}

function indexVariables(environment: ApiEnvironment | undefined): Map<string, VariableSource> {
  const variables = new Map<string, VariableSource>()
  if (!environment) return variables
  for (const variable of environment.variables) {
    variables.set(variable.name, {
      value: variable.value,
      secret: variable.secret === true,
      enabled: variable.enabled !== false,
    })
  }
  return variables
}

/** Expands placeholders in one request, recording what could not be resolved. */
class Expander {
  readonly unresolved: UnresolvedVariable[] = []
  private readonly reported = new Set<string>()
  private readonly secretValues = new Map<string, string | undefined>()

  constructor(
    private readonly variables: ReadonlyMap<string, VariableSource>,
    private readonly secrets: ApiSecretStore,
  ) {}

  async text(input: string, where: string): Promise<string> {
    if (!input.includes('{{')) return input
    let output = ''
    let cursor = 0
    for (const match of input.matchAll(PLACEHOLDER_RE)) {
      const start = match.index ?? 0
      output += input.slice(cursor, start)
      cursor = start + match[0].length
      output += await this.value(match[1]!, where)
    }
    return output + input.slice(cursor)
  }

  private report(name: string, where: string, reason: UnresolvedVariable['reason']): void {
    const key = `${where}\u0000${name}`
    if (this.reported.has(key)) return
    this.reported.add(key)
    this.unresolved.push({ name, where, reason })
  }

  /** Every plaintext secret resolved for this request, deduplicated. */
  resolvedSecretValues(): readonly string[] {
    const values = new Set<string>()
    for (const value of this.secretValues.values()) {
      if (value !== undefined && value !== '') values.add(value)
    }
    return [...values]
  }

  private async value(name: string, where: string): Promise<string> {
    const placeholder = `{{${name}}}`
    const variable = this.variables.get(name)
    if (!variable) {
      this.report(name, where, 'missing')
      return placeholder
    }
    if (!variable.enabled) {
      this.report(name, where, 'disabled')
      return placeholder
    }
    if (!variable.secret) return variable.value

    const ref = variable.value
    if (!this.secretValues.has(ref)) this.secretValues.set(ref, await this.secrets.resolve(ref))
    const secret = this.secretValues.get(ref)
    if (secret === undefined) {
      this.report(name, where, 'secret_not_configured')
      return placeholder
    }
    return secret
  }
}

export interface ResolveHttpRequestOptions {
  readonly environment?: ApiEnvironment
  readonly secrets: ApiSecretStore
}

export interface ResolvedHttpRequest {
  /** Host-only: may contain resolved secrets. Never return it to the client. */
  readonly request: HttpRequestSpec
  readonly unresolved: readonly UnresolvedVariable[]
  /**
   * Host-only: plaintext values of every secret this request resolved. The
   * service uses them to scrub the execution result before it crosses the
   * unary wire; never serialize this field into a response.
   */
  readonly secretValues: readonly string[]
}

/**
 * Expands `{{name}}` in every textual field of `request` — URL, query, header
 * names and values, body text/field names, file metadata, and auth fields.
 * File bytes and base64 payloads are left untouched. Unresolved placeholders
 * stay literal and are listed once per field; nothing throws for a missing
 * variable, because a preview needs to show the user what to fill in.
 */
export async function resolveHttpRequest(
  request: unknown,
  options: ResolveHttpRequestOptions,
): Promise<ResolvedHttpRequest> {
  if (!isHttpRequestSpec(request)) {
    invalid('resolveHttpRequest expects a valid request spec', 'request')
  }
  const environment = options.environment ? parseApiEnvironment(options.environment) : undefined
  const expander = new Expander(indexVariables(environment), options.secrets)

  const url = await expander.text(request.url, 'url')
  const query = request.query ? await expandRows(expander, request.query, 'query') : undefined
  const headers = request.headers ? await expandRows(expander, request.headers, 'headers') : undefined
  const body = request.body ? await expandBody(expander, request.body) : undefined
  const auth = request.auth ? await expandAuth(expander, request.auth) : undefined

  const resolved: HttpRequestSpec = {
    ...request,
    url,
    ...(query === undefined ? {} : { query }),
    ...(headers === undefined ? {} : { headers }),
    ...(body === undefined ? {} : { body }),
    ...(auth === undefined ? {} : { auth }),
  }
  return {
    request: resolved,
    unresolved: expander.unresolved,
    secretValues: expander.resolvedSecretValues(),
  }
}

async function expandRows(
  expander: Expander,
  rows: readonly HttpKeyValue[],
  prefix: string,
): Promise<readonly HttpKeyValue[]> {
  const output: HttpKeyValue[] = []
  for (const [index, row] of rows.entries()) {
    const name = await expander.text(row.name, `${prefix}[${index}].name`)
    const value = await expander.text(row.value, `${prefix}[${index}].value`)
    output.push(row.enabled === undefined ? { name, value } : { name, value, enabled: row.enabled })
  }
  return output
}

async function expandBody(expander: Expander, body: HttpRequestBody): Promise<HttpRequestBody> {
  switch (body.kind) {
    case 'none':
      return { kind: 'none' }
    case 'json':
      return { kind: 'json', text: await expander.text(body.text, 'body.text') }
    case 'text': {
      const text = await expander.text(body.text, 'body.text')
      if (body.contentType === undefined) return { kind: 'text', text }
      const contentType = await expander.text(body.contentType, 'body.contentType')
      return { kind: 'text', text, contentType }
    }
    case 'form':
      return { kind: 'form', fields: await expandRows(expander, body.fields, 'body.fields') }
    case 'multipart': {
      const fields = await expandRows(expander, body.fields, 'body.fields')
      const files: HttpFilePart[] = []
      for (const [index, file] of body.files.entries()) {
        const field = await expander.text(file.field, `body.files[${index}].field`)
        const fileName = await expander.text(file.fileName, `body.files[${index}].fileName`)
        if (file.contentType === undefined) {
          files.push({ field, fileName, base64: file.base64 })
        } else {
          files.push({
            field,
            fileName,
            contentType: await expander.text(file.contentType, `body.files[${index}].contentType`),
            base64: file.base64,
          })
        }
      }
      return { kind: 'multipart', fields, files }
    }
    default:
      return body
  }
}

async function expandAuth(expander: Expander, auth: HttpAuth): Promise<HttpAuth> {
  switch (auth.kind) {
    case 'none':
      return { kind: 'none' }
    case 'bearer':
      return { kind: 'bearer', token: await expander.text(auth.token, 'auth.token') }
    case 'basic':
      return {
        kind: 'basic',
        username: await expander.text(auth.username, 'auth.username'),
        password: await expander.text(auth.password, 'auth.password'),
      }
    case 'api-key':
      return {
        kind: 'api-key',
        name: await expander.text(auth.name, 'auth.name'),
        value: await expander.text(auth.value, 'auth.value'),
        in: auth.in,
      }
    default:
      return auth
  }
}

/**
 * Client-safe view of an environment. Secret rows carry only what
 * `ctx.credentials.describe()` reports; a describe failure reads as
 * "not configured" rather than failing the whole panel.
 */
export async function describeEnvironment(
  environment: ApiEnvironment,
  secrets: ApiSecretStore,
): Promise<ApiEnvironmentView> {
  const parsed = parseApiEnvironment(environment)
  const variables: ApiEnvironmentVariableView[] = []

  for (const variable of parsed.variables) {
    const enabled = variable.enabled !== false
    if (variable.secret !== true) {
      variables.push({ name: variable.name, secret: false, enabled, value: variable.value })
      continue
    }
    let info: CredentialDescription = { configured: false, writable: false }
    try {
      info = await secrets.describe(variable.value)
    } catch {
      // A credential store that cannot describe a reference is reported as
      // unconfigured; the panel still renders every other variable.
    }
    variables.push({
      name: variable.name,
      secret: true,
      enabled,
      configured: info.configured,
      writable: info.writable,
      ...(info.source === undefined ? {} : { source: info.source }),
    })
  }

  return parsed.name === undefined ? { variables } : { name: parsed.name, variables }
}

/** Names of every secret reference an environment would resolve. */
export function secretReferences(environment: ApiEnvironment): readonly string[] {
  return environment.variables
    .filter((variable) => variable.secret === true)
    .map((variable) => variable.value)
}
