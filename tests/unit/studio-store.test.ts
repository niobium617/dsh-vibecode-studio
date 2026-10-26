import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createDefaultStudioDocument,
  createStudioStore,
  DEFAULT_STUDIO_SETTINGS,
  MAX_STUDIO_FILE_BYTES,
  parseStudioSettings,
  StudioStoreError,
  type StudioDocument,
} from '../../src/host/studio/store'

let tempRoot: string
let projectDir: string

beforeEach(async () => {
  const root = join(process.cwd(), '.tmp')
  await mkdir(root, { recursive: true })
  tempRoot = await mkdtemp(join(root, 'studio-store-'))
  projectDir = join(tempRoot, 'project')
  await mkdir(projectDir)
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

async function writeRaw(value: unknown): Promise<string> {
  const dir = join(projectDir, '.vibe')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'studio.json')
  await writeFile(file, typeof value === 'string' ? value : JSON.stringify(value), 'utf8')
  return file
}

describe('StudioStore', () => {
  it('returns defaults when studio.json is missing', async () => {
    const store = createStudioStore(projectDir)
    const result = await store.read()

    expect(result.status).toBe('missing')
    expect(result.issues).toEqual([])
    expect(result.document).toEqual(createDefaultStudioDocument())
    expect(store.filePath).toBe(join(projectDir, '.vibe', 'studio.json'))
  })

  it('round-trips a document and normalizes origins', async () => {
    const store = createStudioStore(projectDir)
    await store.write({
      version: 1,
      settings: {
        allowedOrigins: ['http://localhost:3000/app', 'http://localhost:3000', 'https://Example.test:8443/'],
        retentionDays: 3,
        contextBudgetBytes: 16384,
        screenshotEnabled: false,
        logLevel: 'debug',
      },
    })

    const result = await store.read()
    expect(result.status).toBe('ok')
    expect(result.issues).toEqual([])
    expect(result.document.settings).toEqual({
      allowedOrigins: ['http://localhost:3000', 'https://example.test:8443'],
      retentionDays: 3,
      contextBudgetBytes: 16384,
      screenshotEnabled: false,
      logLevel: 'debug',
    })

    const text = await readFile(store.filePath, 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(JSON.parse(text)).toEqual(result.document)
    expect(await readdir(join(projectDir, '.vibe'))).toEqual(['studio.json'])
  })

  it('falls back to defaults for malformed JSON and keeps the file intact', async () => {
    const file = await writeRaw('{ not json')
    const result = await createStudioStore(projectDir).read()

    expect(result.status).toBe('invalid')
    expect(result.document).toEqual(createDefaultStudioDocument())
    expect(result.issues.join('\n')).toContain('not valid JSON')
    expect(await readFile(file, 'utf8')).toBe('{ not json')
  })

  it('recovers valid fields and reports invalid ones', async () => {
    await writeRaw({
      version: 1,
      settings: {
        allowedOrigins: ['http://localhost:3000', 'ftp://bad.example'],
        retentionDays: 0,
        contextBudgetBytes: 16384,
        screenshotEnabled: 'yes',
        logLevel: 'verbose',
      },
    })

    const result = await createStudioStore(projectDir).read()

    expect(result.status).toBe('invalid')
    expect(result.document.settings.allowedOrigins).toEqual(['http://localhost:3000'])
    expect(result.document.settings.retentionDays).toBe(7)
    expect(result.document.settings.contextBudgetBytes).toBe(16384)
    expect(result.document.settings.screenshotEnabled).toBe(true)
    expect(result.document.settings.logLevel).toBe('info')
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('allowedOrigins[1]'),
        expect.stringContaining('retentionDays'),
        expect.stringContaining('screenshotEnabled'),
        expect.stringContaining('logLevel'),
      ]),
    )
  })

  it('rejects unsupported document versions', async () => {
    await writeRaw({ version: 2, settings: DEFAULT_STUDIO_SETTINGS })
    const result = await createStudioStore(projectDir).read()

    expect(result.status).toBe('invalid')
    expect(result.document).toEqual(createDefaultStudioDocument())
    expect(result.issues.join('\n')).toContain('studio.json.version')
  })

  it('flags unknown settings keys', () => {
    const { settings, issues } = parseStudioSettings({ retentionDay: 5 })

    expect(settings).toEqual(DEFAULT_STUDIO_SETTINGS)
    expect(issues).toContain('settings.retentionDay: unknown key')
  })

  it('refuses to write an invalid document before touching the filesystem', async () => {
    const store = createStudioStore(projectDir)
    const invalid = {
      version: 1,
      settings: { ...DEFAULT_STUDIO_SETTINGS, retentionDays: 0 },
    } as StudioDocument

    await expect(store.write(invalid)).rejects.toBeInstanceOf(StudioStoreError)
    await expect(access(join(projectDir, '.vibe'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('falls back when studio.json exceeds the size limit', async () => {
    await writeRaw('x'.repeat(MAX_STUDIO_FILE_BYTES + 1))
    const result = await createStudioStore(projectDir).read()

    expect(result.status).toBe('invalid')
    expect(result.document).toEqual(createDefaultStudioDocument())
    expect(result.issues.join('\n')).toContain('exceeds')
  })

  it('rejects a .vibe junction that points outside the project', async () => {
    const outside = join(tempRoot, 'outside')
    await mkdir(outside)
    await symlink(outside, join(projectDir, '.vibe'), process.platform === 'win32' ? 'junction' : 'dir')
    const store = createStudioStore(projectDir)

    await expect(store.read()).rejects.toMatchObject({ code: 'path-outside-project' })
    await expect(store.write(createDefaultStudioDocument())).rejects.toMatchObject({
      code: 'path-outside-project',
    })
  })

  it('reports a missing project directory', async () => {
    const store = createStudioStore(join(tempRoot, 'absent'))

    await expect(store.read()).rejects.toMatchObject({ code: 'project-missing' })
    await expect(store.write(createDefaultStudioDocument())).rejects.toMatchObject({
      code: 'project-missing',
    })
  })
})
