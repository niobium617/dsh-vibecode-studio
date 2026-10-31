/**
 * T049 `.vibe/artifacts`: screenshots are stored host-side and referenced by id
 * (FR-AGENT-09). The tests cover the round-trip, the sidecar contract, the size
 * caps, path containment (junctions included) and the error vocabulary callers
 * receive through `toArtifactStudioError`.
 */
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ArtifactStoreError,
  createArtifactStore,
  isArtifactId,
  MAX_ARTIFACT_BYTES,
  toArtifactStudioError,
  type ArtifactStore,
} from '../../../src/host/artifacts/store'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const NOW = new Date('2026-10-30T10:00:00.000Z')

let tempRoot: string
let projectDir: string
let store: ArtifactStore

beforeEach(async () => {
  const root = join(process.cwd(), '.tmp')
  await mkdir(root, { recursive: true })
  tempRoot = await mkdtemp(join(root, 'artifact-store-'))
  projectDir = join(tempRoot, 'project')
  await mkdir(projectDir)
  store = createArtifactStore(projectDir, { now: () => NOW })
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

describe('ArtifactStore.saveScreenshot', () => {
  it('writes the PNG and a sidecar, and returns the reference', async () => {
    const ref = await store.saveScreenshot(PNG, { retentionDays: 7, label: 'preview screenshot' })

    expect(store.dirPath).toBe(join(projectDir, '.vibe', 'artifacts'))
    expect(isArtifactId(ref.id)).toBe(true)
    expect(ref).toEqual({
      id: ref.id,
      kind: 'screenshot',
      mimeType: 'image/png',
      bytes: PNG.byteLength,
      createdAt: '2026-10-30T10:00:00.000Z',
      expiresAt: '2026-11-06T10:00:00.000Z',
      label: 'preview screenshot',
    })
    expect(new Uint8Array(await readFile(store.bytesPath(ref.id)))).toEqual(PNG)
    expect(JSON.parse(await readFile(store.metaPath(ref.id), 'utf8'))).toEqual({
      version: 1,
      artifact: ref,
    })
  })

  it('omits the label when none is given', async () => {
    const ref = await store.saveScreenshot(PNG, { retentionDays: 1 })
    expect('label' in ref).toBe(false)
  })

  it('refuses empty bytes and an unusable retention window', async () => {
    await expect(store.saveScreenshot(new Uint8Array(0), { retentionDays: 7 })).rejects.toMatchObject({
      code: 'invalid_artifact',
    })
    await expect(store.saveScreenshot(PNG, { retentionDays: 0 })).rejects.toMatchObject({
      code: 'invalid_artifact',
    })
    await expect(store.saveScreenshot(PNG, { retentionDays: Number.NaN })).rejects.toMatchObject({
      code: 'invalid_artifact',
    })
  })

  it('caps one artifact at MAX_ARTIFACT_BYTES', async () => {
    await expect(
      store.saveScreenshot(new Uint8Array(MAX_ARTIFACT_BYTES + 1), { retentionDays: 7 }),
    ).rejects.toMatchObject({ code: 'artifact_too_large' })
  })

  it('reports a missing project directory as project_missing', async () => {
    const ghost = createArtifactStore(join(tempRoot, 'ghost'))
    await expect(ghost.saveScreenshot(PNG, { retentionDays: 7 })).rejects.toMatchObject({
      code: 'project_missing',
    })
  })

  it('refuses artifact ids that would escape the directory', () => {
    for (const id of ['..', '../x', '', '.hidden', 'a/b']) {
      expect(() => store.bytesPath(id)).toThrow(ArtifactStoreError)
      expect(() => store.metaPath(id)).toThrow(ArtifactStoreError)
    }
  })

  it('rejects a .vibe junction that points outside the project', async () => {
    const outside = join(tempRoot, 'outside')
    await mkdir(outside)
    await symlink(outside, join(projectDir, '.vibe'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(store.saveScreenshot(PNG, { retentionDays: 7 })).rejects.toMatchObject({
      code: 'path_outside_project',
    })
  })

  it('rejects an artifacts junction that points outside the project', async () => {
    const outside = join(tempRoot, 'outside-artifacts')
    await mkdir(outside)
    await mkdir(join(projectDir, '.vibe'))
    await symlink(
      outside,
      join(projectDir, '.vibe', 'artifacts'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )

    await expect(store.saveScreenshot(PNG, { retentionDays: 7 })).rejects.toMatchObject({
      code: 'path_outside_project',
    })
    await expect(store.read('artifact-1')).rejects.toMatchObject({ code: 'path_outside_project' })
  })

  it('retries a locked rename and still commits', async () => {
    let calls = 0
    const retrying = createArtifactStore(projectDir, {
      now: () => NOW,
      renameFile: async (from, to) => {
        calls += 1
        if (calls === 1) {
          const error = new Error('file is locked') as NodeJS.ErrnoException
          error.code = 'EPERM'
          throw error
        }
        await rename(from, to)
      },
    })

    const ref = await retrying.saveScreenshot(PNG, { retentionDays: 7 })
    expect(calls).toBe(3)
    expect(await retrying.read(ref.id)).not.toBeNull()
  })

  it('surfaces a non-retryable rename failure as io', async () => {
    const failing = createArtifactStore(projectDir, {
      renameFile: async () => {
        const error = new Error('disk full') as NodeJS.ErrnoException
        error.code = 'ENOSPC'
        throw error
      },
    })
    await expect(failing.saveScreenshot(PNG, { retentionDays: 7 })).rejects.toMatchObject({
      code: 'io',
      message: expect.stringContaining('disk full'),
    })
  })
})

describe('ArtifactStore.read', () => {
  it('round-trips the reference and bytes', async () => {
    const ref = await store.saveScreenshot(PNG, { retentionDays: 7, label: 'shot' })
    await expect(store.read(ref.id)).resolves.toEqual({ ref, bytes: PNG })
  })

  it('returns null for unknown, malformed or missing artifacts', async () => {
    expect(await store.read('artifact-1')).toBeNull()
    expect(await store.read('../etc/passwd')).toBeNull()
    const ref = await store.saveScreenshot(PNG, { retentionDays: 7 })
    await rm(store.bytesPath(ref.id))
    expect(await store.read(ref.id)).toBeNull()
  })

  it('rejects a sidecar that describes another id or an older version', async () => {
    const ref = await store.saveScreenshot(PNG, { retentionDays: 7 })
    await writeFile(
      store.metaPath(ref.id),
      JSON.stringify({ version: 1, artifact: { ...ref, id: 'somebody-else' } }),
    )
    expect(await store.read(ref.id)).toBeNull()

    await writeFile(store.metaPath(ref.id), JSON.stringify({ version: 2, artifact: ref }))
    expect(await store.read(ref.id)).toBeNull()
  })

  it('returns null for an unreadable sidecar and a truncated image', async () => {
    const ref = await store.saveScreenshot(PNG, { retentionDays: 7 })
    await writeFile(store.metaPath(ref.id), '{not json')
    expect(await store.read(ref.id)).toBeNull()

    await writeFile(
      store.metaPath(ref.id),
      JSON.stringify({ version: 1, artifact: ref }),
    )
    await writeFile(store.bytesPath(ref.id), PNG.subarray(0, 4))
    expect(await store.read(ref.id)).toBeNull()
  })

  it('loses the artifact when only the bytes are written', async () => {
    const ref = await store.saveScreenshot(PNG, { retentionDays: 7 })
    await rm(store.metaPath(ref.id))
    expect(await store.read(ref.id)).toBeNull()
  })
})

describe('ArtifactStore construction', () => {
  it('requires a project directory', () => {
    expect(() => createArtifactStore('')).toThrow(ArtifactStoreError)
    expect(() => createArtifactStore('   ')).toThrow(ArtifactStoreError)
  })
})

describe('toArtifactStudioError', () => {
  function codeOf(error: unknown): string {
    return toArtifactStudioError(error).code
  }

  it('maps storage failures to stable Studio codes', () => {
    const cases: Array<[string, string]> = [
      ['invalid_project_path', 'invalid_config'],
      ['project_missing', 'invalid_config'],
      ['path_outside_project', 'permission_denied'],
      ['invalid_artifact', 'preview_failed'],
      ['artifact_too_large', 'preview_failed'],
      ['io', 'internal'],
    ]
    for (const [storeCode, studioCode] of cases) {
      const error = new ArtifactStoreError(
        storeCode as ConstructorParameters<typeof ArtifactStoreError>[0],
        `vibe-studio: ${storeCode}`,
      )
      const mapped = toArtifactStudioError(error)
      expect(mapped.code).toBe(studioCode)
      expect(mapped.message).toBe(`vibe-studio: ${storeCode}`)
    }
    expect(codeOf(new ArtifactStoreError('path_outside_project', 'vibe-studio: link'))).toBe(
      'permission_denied',
    )
  })

  it('keeps the reason for programmatic callers', () => {
    expect(
      toArtifactStudioError(new ArtifactStoreError('artifact_too_large', 'vibe-studio: too big')),
    ).toMatchObject({ details: { reason: 'artifact_too_large' } })
  })

  it('wraps unknown errors as internal', () => {
    expect(toArtifactStudioError(new Error('boom'))).toMatchObject({
      code: 'internal',
      message: expect.stringContaining('boom'),
    })
    expect(codeOf('not an error')).toBe('internal')
  })
})
