/**
 * FR-API-04 through the service seam (T046 R4): environments are saved under
 * `.vibe/api/environments`, a secret row stores a credential *name*, the view
 * only reports `configured`, and a send can name a saved environment instead
 * of shipping the document. Stores run against a real temp `.vibe/api`.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  API_ENV_GET_METHOD,
  API_ENV_LIST_METHOD,
  API_ENV_REMOVE_METHOD,
  API_ENV_SAVE_METHOD,
  API_HTTP_SEND_METHOD,
  type ApiEnvironmentDetail,
  type ApiEnvironmentSummaries,
  type HttpRequestSpec,
} from '../../../src/contracts/api'
import type { StudioError } from '../../../src/contracts/errors'
import {
  ApiService,
  UnaryRegistry,
  createApiEnvironmentStore,
  createApiSecretStore,
  createHttpExecutor,
  registerApiMethods,
  type ApiEnvironmentStore,
  type CredentialProviderLike,
  type UnaryDispatchResult,
} from '../../../src/host'

let tempRoot: string
let projectDir: string
let environments: ApiEnvironmentStore

const SECRET = 's3cret-token'

const credentials: CredentialProviderLike = {
  resolve: async (ref) => (ref === 'API_TOKEN' ? { value: SECRET, source: 'file' } : undefined),
  describe: async (ref) =>
    ref === 'API_TOKEN'
      ? { configured: true, writable: true, source: 'file' }
      : { configured: false, writable: false },
  set: async () => undefined,
  unset: async () => undefined,
}

beforeEach(async () => {
  const root = join(process.cwd(), '.tmp')
  await mkdir(root, { recursive: true })
  tempRoot = await mkdtemp(join(root, 'api-service-env-'))
  projectDir = join(tempRoot, 'project')
  await mkdir(projectDir)
  environments = createApiEnvironmentStore(projectDir)
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function fakeFetch(): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(String(url))
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
  return { fetchImpl, calls }
}

function setup(options: { readonly environments?: ApiEnvironmentStore | null } = {}) {
  const registry = new UnaryRegistry()
  const { fetchImpl } = fakeFetch()
  const store = options.environments === undefined ? environments : options.environments
  const service = new ApiService({
    secrets: createApiSecretStore({ credentials }),
    executor: createHttpExecutor({ fetchImpl }),
    ...(store === null ? {} : { environments: store }),
  })
  registerApiMethods(registry, service)
  return { registry, service }
}

function context(signal = new AbortController().signal) {
  return { request: new Request('http://127.0.0.1/api/vibe/request'), signal }
}

function valueOf<T>(result: UnaryDispatchResult): T {
  if (!result.body.ok) throw new Error(`unexpected failure: ${result.body.error.code}`)
  return result.body.value as T
}

async function failureOf(promise: Promise<unknown>): Promise<StudioError> {
  try {
    await promise
  } catch (error) {
    return error as StudioError
  }
  throw new Error('expected the call to fail')
}

function environment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Local',
    variables: [
      { name: 'baseUrl', value: 'https://api.example.com' },
      { name: 'token', value: 'API_TOKEN', secret: true },
    ],
    ...overrides,
  }
}

describe('api.env.*', () => {
  it('saves an environment, assigns a slug id and reports configured secrets', async () => {
    const { registry } = setup()
    const saved = valueOf<ApiEnvironmentDetail>(
      await registry.dispatch(API_ENV_SAVE_METHOD, { environment: environment() }, context()),
    )

    expect(saved.environment.id).toBe('local')
    expect(saved.environment.name).toBe('Local')
    expect(saved.view.variables).toMatchObject([
      { name: 'baseUrl', secret: false, value: 'https://api.example.com' },
      { name: 'token', secret: true, configured: true, source: 'file' },
    ])
    // The secret row carries a description, never the value.
    expect(JSON.stringify(saved)).not.toContain(SECRET)

    const onDisk = await readFile(join(projectDir, '.vibe', 'api', 'environments', 'local.json'), 'utf8')
    expect(onDisk).toContain('"API_TOKEN"')
    expect(onDisk).not.toContain(SECRET)

    const listed = valueOf<ApiEnvironmentSummaries>(
      await registry.dispatch(API_ENV_LIST_METHOD, undefined, context()),
    )
    expect(listed.environments).toEqual([
      { id: 'local', name: 'Local', variableCount: 2, secretCount: 1 },
    ])
    expect(listed.skipped).toBe(0)
  })

  it('reads one saved environment with its view', async () => {
    const { registry } = setup()
    await registry.dispatch(API_ENV_SAVE_METHOD, { environment: environment() }, context())

    const detail = valueOf<ApiEnvironmentDetail>(
      await registry.dispatch(API_ENV_GET_METHOD, { id: 'local' }, context()),
    )
    expect(detail.environment.variables).toHaveLength(2)
    expect(detail.view.variables[1]).toMatchObject({ configured: true })
  })

  it('creates a suffixed id for a second environment with the same name', async () => {
    const { registry } = setup()
    const first = valueOf<ApiEnvironmentDetail>(
      await registry.dispatch(API_ENV_SAVE_METHOD, { environment: environment() }, context()),
    )
    const second = valueOf<ApiEnvironmentDetail>(
      await registry.dispatch(API_ENV_SAVE_METHOD, { environment: environment() }, context()),
    )
    expect(first.environment.id).toBe('local')
    expect(second.environment.id).toBe('local-2')
  })

  it('replaces an environment that already has an id', async () => {
    const { registry } = setup()
    await registry.dispatch(API_ENV_SAVE_METHOD, { environment: environment() }, context())
    const updated = valueOf<ApiEnvironmentDetail>(
      await registry.dispatch(
        API_ENV_SAVE_METHOD,
        {
          environment: environment({ id: 'local', name: 'Local edited', variables: [] }),
        },
        context(),
      ),
    )
    expect(updated.environment.id).toBe('local')
    expect(updated.environment.name).toBe('Local edited')
    expect(updated.environment.variables).toEqual([])

    const listed = valueOf<ApiEnvironmentSummaries>(
      await registry.dispatch(API_ENV_LIST_METHOD, undefined, context()),
    )
    expect(listed.environments).toHaveLength(1)
  })

  it('refuses a secret row that holds a value instead of a credential name', async () => {
    const { service } = setup()
    const error = await failureOf(
      service.saveEnvironment({
        environment: {
          name: 'Local',
          variables: [{ name: 'token', value: 'raw-secret-value', secret: true }],
        },
      }),
    )
    expect(error.code).toBe('invalid_input')
    expect(error.details?.field).toBe('variables[0].value')
    await expect(
      readFile(join(projectDir, '.vibe', 'api', 'environments', 'local.json'), 'utf8'),
    ).rejects.toThrow()
  })

  it('removes an environment and reports whether a file was deleted', async () => {
    const { registry } = setup()
    await registry.dispatch(API_ENV_SAVE_METHOD, { environment: environment() }, context())
    const removed = valueOf<{ removed: boolean }>(
      await registry.dispatch(API_ENV_REMOVE_METHOD, { id: 'local' }, context()),
    )
    expect(removed.removed).toBe(true)
    const again = valueOf<{ removed: boolean }>(
      await registry.dispatch(API_ENV_REMOVE_METHOD, { id: 'local' }, context()),
    )
    expect(again.removed).toBe(false)
  })

  it('counts an unreadable file as skipped instead of failing the list', async () => {
    const { registry } = setup()
    await registry.dispatch(API_ENV_SAVE_METHOD, { environment: environment() }, context())
    await writeFile(join(projectDir, '.vibe', 'api', 'environments', 'broken.json'), '{nope', 'utf8')

    const listed = valueOf<ApiEnvironmentSummaries>(
      await registry.dispatch(API_ENV_LIST_METHOD, undefined, context()),
    )
    expect(listed.environments).toHaveLength(1)
    expect(listed.skipped).toBe(1)
  })

  it('reports environment storage as unavailable when the Host has no store', async () => {
    const { service } = setup({ environments: null })
    const error = await failureOf(service.listEnvironments())
    expect(error.code).toBe('internal')
    expect(error.details?.reason).toBe('unavailable')
  })
})

describe('api.http.send with environmentId', () => {
  const request: HttpRequestSpec = {
    method: 'GET',
    url: '{{baseUrl}}/items',
    headers: [{ name: 'authorization', value: 'Bearer {{token}}' }],
  }

  it('loads the saved environment host-side and expands it', async () => {
    const { registry } = setup()
    await registry.dispatch(API_ENV_SAVE_METHOD, { environment: environment() }, context())

    const result = valueOf<{ result: { status: number }; unresolved: unknown[] }>(
      await registry.dispatch(
        API_HTTP_SEND_METHOD,
        { request, environmentId: 'local' },
        context(),
      ),
    )
    expect(result.result.status).toBe(200)
    expect(result.unresolved).toEqual([])
  })

  it('fails with not_found for an unknown environment id', async () => {
    const { service } = setup()
    const error = await failureOf(service.send({ request, environmentId: 'missing' }))
    expect(error.code).toBe('not_found')
    expect(error.details?.reason).toBe('not_found')
  })

  it('refuses to combine an inline environment with an id', async () => {
    const { service } = setup()
    const error = await failureOf(
      service.send({
        request,
        environmentId: 'local',
        environment: { name: 'Inline', variables: [] },
      }),
    )
    expect(error.code).toBe('invalid_input')
    expect(error.details?.field).toBe('environmentId')
  })

  it('rejects an unusable environment id before touching storage', async () => {
    const { service } = setup()
    const error = await failureOf(service.send({ request, environmentId: '../escape' }))
    expect(error.code).toBe('invalid_input')
    expect(error.details?.field).toBe('environmentId')
  })
})
