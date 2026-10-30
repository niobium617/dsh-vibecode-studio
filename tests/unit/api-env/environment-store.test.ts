/**
 * T046 R4 `.vibe/api/environments` store: one file per environment, validated
 * before writing, atomically replaced, and never a secret value on disk. Bad
 * or foreign files are skipped by `list`, not thrown.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ApiEnvironment } from '../../../src/contracts/api'
import { ApiStoreError } from '../../../src/host'
import { createApiEnvironmentStore } from '../../../src/host/api/environment-store'

let tempRoot: string
let projectDir: string

beforeEach(async () => {
  const root = join(process.cwd(), '.tmp')
  await mkdir(root, { recursive: true })
  tempRoot = await mkdtemp(join(root, 'api-env-store-'))
  projectDir = join(tempRoot, 'project')
  await mkdir(projectDir)
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function environment(overrides: Partial<ApiEnvironment> = {}): ApiEnvironment {
  return {
    id: 'local',
    name: 'Local',
    variables: [
      { name: 'baseUrl', value: 'http://127.0.0.1:8080' },
      { name: 'token', value: 'API_TOKEN', secret: true },
    ],
    ...overrides,
  }
}

describe('ApiEnvironmentStore', () => {
  it('writes one file, reads it back and lists it by name', async () => {
    const store = createApiEnvironmentStore(projectDir)
    await store.save(environment())

    const text = await readFile(join(projectDir, '.vibe', 'api', 'environments', 'local.json'), 'utf8')
    expect(JSON.parse(text)).toEqual(environment())

    const found = await store.read('local')
    expect(found).toEqual(environment())

    await store.save(environment({ id: 'staging', name: 'Staging' }))
    const listed = await store.list()
    expect(listed.environments.map((item) => item.name)).toEqual(['Local', 'Staging'])
    expect(listed.skipped).toBe(0)
  })

  it('trims the name and keeps the credential reference, never a value', async () => {
    const store = createApiEnvironmentStore(projectDir)
    await store.save(environment({ name: '  Local  ' }))
    const text = await readFile(join(projectDir, '.vibe', 'api', 'environments', 'local.json'), 'utf8')
    expect(JSON.parse(text).name).toBe('Local')
    expect(text).toContain('"API_TOKEN"')
    expect(text).not.toContain('s3cret')
  })

  it('refuses an environment without a usable id', async () => {
    const store = createApiEnvironmentStore(projectDir)
    await expect(store.save(environment({ id: undefined }))).rejects.toBeInstanceOf(ApiStoreError)
    await expect(store.save(environment({ id: '../escape' }))).rejects.toBeInstanceOf(ApiStoreError)
  })

  it('refuses a secret row whose value is not a credential name', async () => {
    const store = createApiEnvironmentStore(projectDir)
    await expect(
      store.save(
        environment({
          variables: [{ name: 'token', value: 'not a credential name', secret: true }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'variables[0].value' } })
  })

  it('refuses duplicate and misplaced variable names', async () => {
    const store = createApiEnvironmentStore(projectDir)
    await expect(
      store.save(
        environment({
          variables: [
            { name: 'base', value: 'a' },
            { name: 'base', value: 'b' },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_input', details: { field: 'variables[1].name' } })
    await expect(
      store.save(environment({ variables: [{ name: 'has space', value: 'x' }] })),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('skips corrupt and foreign files instead of throwing', async () => {
    const store = createApiEnvironmentStore(projectDir)
    await store.save(environment())
    const dir = join(projectDir, '.vibe', 'api', 'environments')
    await writeFile(join(dir, 'broken.json'), '{nope', 'utf8')
    await writeFile(
      join(dir, 'other.json'),
      JSON.stringify({ id: 'local', name: 'Foreign', variables: [] }),
      'utf8',
    )

    expect(await store.read('broken')).toBeNull()
    expect(await store.read('other')).toBeNull()
    const listed = await store.list()
    expect(listed.environments.map((item) => item.id)).toEqual(['local'])
    expect(listed.skipped).toBe(2)
  })

  it('removes one file and reports whether it existed', async () => {
    const store = createApiEnvironmentStore(projectDir)
    await store.save(environment())
    expect(await store.remove('local')).toBe(true)
    expect(await store.remove('local')).toBe(false)
    expect(await store.read('local')).toBeNull()
  })
})
