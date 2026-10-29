/**
 * T037 collections: `.vibe/api/collections/<id>.json`, one file per collection.
 * Covers the acceptance list — save/reopen/copy/delete — plus redaction,
 * schema rejection, size caps, bad files and a `.vibe` junction that leaves
 * the project.
 */
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isApiCollection,
  type ApiCollection,
  type HttpRequestSpec,
} from '../../../src/contracts'
import {
  createApiCollectionStore,
  type ApiCollectionStore,
} from '../../../src/host/api/collection-store'

let tempRoot: string
let projectDir: string
let store: ApiCollectionStore

beforeEach(async () => {
  const root = join(process.cwd(), '.tmp')
  await mkdir(root, { recursive: true })
  tempRoot = await mkdtemp(join(root, 'api-collection-store-'))
  projectDir = join(tempRoot, 'project')
  await mkdir(projectDir)
  store = createApiCollectionStore(projectDir)
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function spec(overrides: Partial<HttpRequestSpec> = {}): HttpRequestSpec {
  return { method: 'GET', url: 'https://api.example.com/v1/items', ...overrides }
}

function collectionFixture(overrides: Partial<ApiCollection> = {}): ApiCollection {
  return {
    id: 'weather-api',
    name: 'Weather',
    requests: [{ id: 'list-items', name: 'List items', request: spec() }],
    folders: [
      {
        id: 'folder-1',
        name: 'Write',
        requests: [{ id: 'create-item', name: 'Create', request: spec({ method: 'POST' }) }],
      },
    ],
    ...overrides,
  }
}

describe('ApiCollectionStore', () => {
  it('round-trips a collection through .vibe/api/collections', async () => {
    const collection = collectionFixture()
    await store.save(collection)

    expect(store.dirPath).toBe(join(projectDir, '.vibe', 'api', 'collections'))
    expect(await store.read('weather-api')).toEqual(collection)

    const file = await readFile(join(store.dirPath, 'weather-api.json'), 'utf8')
    const parsed: unknown = JSON.parse(file)
    expect(isApiCollection(parsed)).toBe(true)
  })

  it('lists collections by name and counts unreadable files as skipped', async () => {
    await store.save(collectionFixture({ id: 'b-collection', name: 'Beta' }))
    await store.save(collectionFixture({ id: 'a-collection', name: 'Alpha' }))
    await writeFile(join(store.dirPath, 'broken.json'), '{ not json')
    await writeFile(join(store.dirPath, 'bad~name.json'), '{}')

    const result = await store.list()
    expect(result.collections.map((entry) => entry.name)).toEqual(['Alpha', 'Beta'])
    expect(result.skipped).toBe(1)
  })

  it('redacts secrets on the way to disk but keeps the structure', async () => {
    await store.save(
      collectionFixture({
        requests: [
          {
            id: 'secret-request',
            name: 'Secret',
            request: spec({
              method: 'POST',
              url: 'https://user:s3cret-token@api.example.com/v1',
              headers: [{ name: 'Authorization', value: 'Bearer s3cret-token' }],
              body: { kind: 'json', text: JSON.stringify({ password: 's3cret-token' }) },
              auth: { kind: 'bearer', token: 's3cret-token' },
            }),
          },
        ],
        folders: undefined,
      }),
    )

    const file = await readFile(join(store.dirPath, 'weather-api.json'), 'utf8')
    expect(file).not.toContain('s3cret-token')
    const stored = await store.read('weather-api')
    expect(stored?.requests?.[0]?.request.auth).toEqual({ kind: 'bearer', token: 'REDACTED' })
    expect(stored?.requests?.[0]?.request.url).not.toContain('s3cret-token')
  })

  it('does not persist multipart file bytes', async () => {
    await store.save(
      collectionFixture({
        folders: undefined,
        requests: [
          {
            id: 'upload',
            name: 'Upload',
            request: spec({
              method: 'POST',
              body: {
                kind: 'multipart',
                fields: [],
                files: [{ field: 'file', fileName: 'a.bin', base64: 'AAECAwQ=' }],
              },
            }),
          },
        ],
      }),
    )
    const stored = await store.read('weather-api')
    expect(stored?.requests?.[0]?.request.body).toEqual({
      kind: 'multipart',
      fields: [],
      files: [{ field: 'file', fileName: 'a.bin', base64: '' }],
    })
  })

  it('rejects an invalid collection before touching the filesystem', async () => {
    await expect(
      store.save({ id: 'no-name', name: '', requests: [] } as ApiCollection),
    ).rejects.toMatchObject({ code: 'invalid_data' })
    await expect(
      store.save({ id: 'bad id', name: 'Bad', requests: [] } as ApiCollection),
    ).rejects.toMatchObject({ code: 'invalid_data' })
    expect(await store.list()).toEqual({ collections: [], skipped: 0 })
  })

  it('refuses a collection over the file size cap', async () => {
    const huge = collectionFixture({
      folders: undefined,
      requests: [
        {
          id: 'huge',
          name: 'Huge',
          request: spec({ body: { kind: 'text', text: 'x'.repeat(300 * 1024) } }),
        },
      ],
    })
    await expect(store.save(huge)).rejects.toMatchObject({ code: 'too_large' })
  })

  it('copies a collection with fresh ids and leaves the source alone', async () => {
    await store.save(collectionFixture())
    const copy = await store.duplicate('weather-api', { id: 'weather-copy' })

    expect(copy.id).toBe('weather-copy')
    expect(copy.name).toBe('Weather copy')
    expect(copy.requests?.[0]?.id).not.toBe('list-items')
    expect(copy.folders?.[0]?.id).not.toBe('folder-1')
    expect(copy.folders?.[0]?.requests[0]?.id).not.toBe('create-item')
    expect(await store.read('weather-copy')).toEqual(copy)
    expect(await store.read('weather-api')).toEqual(collectionFixture())
  })

  it('reports a missing source when copying', async () => {
    await expect(store.duplicate('nope')).rejects.toMatchObject({ code: 'not_found' })
  })

  it('removes one collection and reports whether a file went away', async () => {
    await store.save(collectionFixture())
    expect(await store.remove('weather-api')).toBe(true)
    expect(await store.remove('weather-api')).toBe(false)
    expect(await store.read('weather-api')).toBeNull()
  })

  it('treats unusable ids as absent', async () => {
    expect(await store.read('..')).toBeNull()
    expect(await store.remove('bad id')).toBe(false)
    let thrown: unknown
    try {
      store.filePath('../escape')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({ name: 'ApiStoreError', code: 'invalid_id' })
  })

  it('rejects a .vibe junction that points outside the project', async () => {
    const outside = join(tempRoot, 'outside')
    await mkdir(outside)
    await symlink(outside, join(projectDir, '.vibe'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(store.save(collectionFixture())).rejects.toMatchObject({
      code: 'path_outside_project',
    })
    await expect(store.list()).rejects.toMatchObject({ code: 'path_outside_project' })
  })
})
