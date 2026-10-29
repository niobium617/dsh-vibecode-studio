/**
 * T036 environments: `{{var}}` expansion covers every textual request field,
 * unresolved placeholders are reported per field instead of failing, and the
 * client-safe describe view never carries a secret value.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ApiEnvironment, HttpRequestSpec } from '../../../src/contracts/api'
import type { StudioError } from '../../../src/contracts/errors'
import {
  describeEnvironment,
  parseApiEnvironment,
  resolveHttpRequest,
  secretReferences,
} from '../../../src/host/api/environment'
import { createApiSecretStore, type CredentialProviderLike } from '../../../src/host/api/secrets'

function environment(overrides: Partial<ApiEnvironment> = {}): ApiEnvironment {
  return {
    name: 'Local',
    variables: [
      { name: 'baseUrl', value: 'http://127.0.0.1:8080' },
      { name: 'team', value: 'core' },
      { name: 'token', value: 'API_TOKEN', secret: true },
    ],
    ...overrides,
  }
}

function secrets(overrides: Partial<CredentialProviderLike> = {}) {
  return createApiSecretStore({
    credentials: {
      resolve: vi.fn(async () => ({ value: 's3cret', source: 'file' })),
      describe: vi.fn(async () => ({ configured: true, writable: true, source: 'file' })),
      set: vi.fn(async () => undefined),
      unset: vi.fn(async () => undefined),
      ...overrides,
    },
  })
}

function request(overrides: Partial<HttpRequestSpec> = {}): HttpRequestSpec {
  return { method: 'GET', url: '{{baseUrl}}/items', ...overrides }
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

describe('parseApiEnvironment', () => {
  it('accepts a well-formed environment and rejects bad names or secrets', () => {
    expect(parseApiEnvironment(environment()).variables).toHaveLength(3)

    expectStudioError(
      () =>
        parseApiEnvironment({
          variables: [
            { name: 'a', value: '1' },
            { name: 'a', value: '2' },
          ],
        }),
      'invalid_input',
    )
    expectStudioError(
      () => parseApiEnvironment({ variables: [{ name: 'bad name', value: '1' }] }),
      'invalid_input',
    )
    expectStudioError(
      () => parseApiEnvironment({ variables: [{ name: 'token', value: 'plain-text', secret: true }] }),
      'invalid_input',
    )
    expectStudioError(() => parseApiEnvironment({ variables: 'nope' }), 'invalid_input')
  })
})

describe('resolveHttpRequest', () => {
  it('expands URL, query, headers, body and auth fields', async () => {
    const resolved = await resolveHttpRequest(
      request({
        method: 'POST',
        url: '{{baseUrl}}/items/{{team}}',
        query: [{ name: 'scope', value: '{{team}}' }],
        headers: [{ name: 'X-Team', value: '{{team}}' }],
        body: { kind: 'json', text: '{"team":"{{team}}","token":"{{token}}"}' },
        auth: { kind: 'bearer', token: '{{token}}' },
      }),
      { environment: environment(), secrets: secrets() },
    )

    expect(resolved.unresolved).toEqual([])
    expect(resolved.request.url).toBe('http://127.0.0.1:8080/items/core')
    expect(resolved.request.query).toEqual([{ name: 'scope', value: 'core' }])
    expect(resolved.request.headers).toEqual([{ name: 'X-Team', value: 'core' }])
    expect(resolved.request.body).toEqual({
      kind: 'json',
      text: '{"team":"core","token":"s3cret"}',
    })
    expect(resolved.request.auth).toEqual({ kind: 'bearer', token: 's3cret' })
  })

  it('reports missing, disabled and unconfigured-secret placeholders in place', async () => {
    const env = environment({
      variables: [
        { name: 'baseUrl', value: 'http://127.0.0.1:8080' },
        { name: 'team', value: 'core', enabled: false },
        { name: 'token', value: 'API_TOKEN', secret: true },
      ],
    })
    const resolved = await resolveHttpRequest(
      request({
        url: '{{baseUrl}}/{{team}}/{{missing}}',
        headers: [{ name: 'Authorization', value: 'Bearer {{token}}' }],
      }),
      { environment: env, secrets: secrets({ resolve: async () => undefined }) },
    )

    expect(resolved.request.url).toBe('http://127.0.0.1:8080/{{team}}/{{missing}}')
    expect(resolved.request.headers).toEqual([
      { name: 'Authorization', value: 'Bearer {{token}}' },
    ])
    expect(resolved.unresolved).toEqual([
      { name: 'team', where: 'url', reason: 'disabled' },
      { name: 'missing', where: 'url', reason: 'missing' },
      { name: 'token', where: 'headers[0].value', reason: 'secret_not_configured' },
    ])
  })

  it('reports each unresolved placeholder once per field', async () => {
    const resolved = await resolveHttpRequest(
      request({ url: '{{nope}}/{{nope}}/{{nope}}' }),
      { secrets: secrets() },
    )
    expect(resolved.unresolved).toEqual([{ name: 'nope', where: 'url', reason: 'missing' }])
  })

  it('resolves a secret reference once per request and never re-scans values', async () => {
    const resolve = vi.fn(async () => ({ value: 's3cret', source: 'file' }))
    const seam = createApiSecretStore({
      credentials: {
        resolve,
        describe: async () => ({ configured: true, writable: true }),
        set: async () => undefined,
        unset: async () => undefined,
      },
    })
    const resolved = await resolveHttpRequest(
      request({
        url: '{{baseUrl}}',
        headers: [
          { name: 'Authorization', value: 'Bearer {{token}}' },
          { name: 'X-Echo', value: '{{token}}' },
        ],
      }),
      { environment: environment(), secrets: seam },
    )

    expect(resolved.unresolved).toEqual([])
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolved.request.headers).toEqual([
      { name: 'Authorization', value: 'Bearer s3cret' },
      { name: 'X-Echo', value: 's3cret' },
    ])

    const nested = await resolveHttpRequest(
      request({ url: '{{baseUrl}}/{{team}}' }),
      {
        environment: environment({
          variables: [
            { name: 'baseUrl', value: 'http://host/{{team}}' },
            { name: 'team', value: 'core' },
          ],
        }),
        secrets: secrets(),
      },
    )
    expect(nested.request.url).toBe('http://host/{{team}}/core')
  })

  it('expands multipart metadata but leaves file bytes alone', async () => {
    const base64 = Buffer.from('file body').toString('base64')
    const resolved = await resolveHttpRequest(
      request({
        method: 'POST',
        body: {
          kind: 'multipart',
          fields: [{ name: 'team', value: '{{team}}' }],
          files: [
            { field: 'upload', fileName: '{{team}}.txt', contentType: 'text/{{team}}', base64 },
          ],
        },
      }),
      { environment: environment(), secrets: secrets() },
    )

    expect(resolved.request.body).toEqual({
      kind: 'multipart',
      fields: [{ name: 'team', value: 'core' }],
      files: [{ field: 'upload', fileName: 'core.txt', contentType: 'text/core', base64 }],
    })
  })

  it('rejects a request spec that is not a valid spec', async () => {
    await expect(
      resolveHttpRequest({ method: 'FETCH', url: 'x' }, { secrets: secrets() }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('counts every placeholder in an environment with no variables as missing', async () => {
    const resolved = await resolveHttpRequest(request({ url: '{{baseUrl}}/{{other}}' }), {
      secrets: secrets(),
    })
    expect(resolved.unresolved).toEqual([
      { name: 'baseUrl', where: 'url', reason: 'missing' },
      { name: 'other', where: 'url', reason: 'missing' },
    ])
  })
})

describe('describeEnvironment', () => {
  it('returns plain values but only describe facts for secrets', async () => {
    const view = await describeEnvironment(environment(), secrets())

    expect(view.name).toBe('Local')
    expect(view.variables[0]).toEqual({
      name: 'baseUrl',
      secret: false,
      enabled: true,
      value: 'http://127.0.0.1:8080',
    })
    const secret = view.variables[2]!
    expect(secret).toEqual({
      name: 'token',
      secret: true,
      enabled: true,
      configured: true,
      writable: true,
      source: 'file',
    })
    expect('value' in secret).toBe(false)
    expect(JSON.stringify(view)).not.toContain('s3cret')
  })

  it('marks secrets unconfigured when the store cannot describe them', async () => {
    const view = await describeEnvironment(
      environment(),
      secrets({
        describe: async () => {
          throw new Error('store offline')
        },
      }),
    )
    expect(view.variables[2]).toEqual({
      name: 'token',
      secret: true,
      enabled: true,
      configured: false,
      writable: false,
    })
  })

  it('lists disabled variables as disabled', async () => {
    const view = await describeEnvironment(
      environment({
        variables: [{ name: 'team', value: 'core', enabled: false }],
      }),
      secrets(),
    )
    expect(view.variables[0]?.enabled).toBe(false)
  })

  it('exposes the credential references an environment uses', () => {
    expect(secretReferences(environment())).toEqual(['API_TOKEN'])
  })
})
