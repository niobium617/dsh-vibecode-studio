/**
 * T037 history: one bounded, newest-first `.vibe/api/history.json`.
 * Covers search, clear, the 200-entry cap, redaction before disk, and bad
 * data reading as empty instead of failing the panel.
 */
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { API_HISTORY_ENTRIES_MAX, type HttpRequestSpec } from '../../../src/contracts'
import {
  API_HISTORY_FILE_NAME,
  API_HISTORY_VERSION,
  createApiHistoryStore,
  type ApiHistoryStore,
  type ApiHistoryStoreOptions,
} from '../../../src/host/api/history-store'

let tempRoot: string
let projectDir: string

beforeEach(async () => {
  const root = join(process.cwd(), '.tmp')
  await mkdir(root, { recursive: true })
  tempRoot = await mkdtemp(join(root, 'api-history-store-'))
  projectDir = join(tempRoot, 'project')
  await mkdir(projectDir)
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function spec(overrides: Partial<HttpRequestSpec> = {}): HttpRequestSpec {
  return { method: 'GET', url: 'https://api.example.com/v1/items', ...overrides }
}

function seededStore(overrides: ApiHistoryStoreOptions = {}): ApiHistoryStore {
  let seq = 0
  return createApiHistoryStore(projectDir, {
    now: () => new Date('2026-10-29T12:00:00.000Z'),
    nextId: () => `entry-${(seq += 1)}`,
    ...overrides,
  })
}

function historyFile(): string {
  return join(projectDir, '.vibe', 'api', API_HISTORY_FILE_NAME)
}

describe('ApiHistoryStore', () => {
  it('appends entries newest-first and lists them with response details', async () => {
    const store = seededStore()
    await store.append(spec({ url: 'https://api.example.com/a' }), { status: 200, elapsedMs: 12 })
    await store.append(spec({ method: 'POST', url: 'https://api.example.com/b' }), { status: 500 })

    const result = await store.list()
    expect(result.total).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.entries.map((entry) => entry.id)).toEqual(['entry-2', 'entry-1'])
    expect(result.entries[1]).toMatchObject({
      method: 'GET',
      url: 'https://api.example.com/a',
      status: 200,
      elapsedMs: 12,
      at: '2026-10-29T12:00:00.000Z',
    })

    const document: unknown = JSON.parse(await readFile(historyFile(), 'utf8'))
    expect(document).toMatchObject({ version: API_HISTORY_VERSION })
  })

  it('uses an explicit timestamp when given', async () => {
    const store = seededStore()
    const entry = await store.append(spec(), { at: new Date('2026-01-02T03:04:05.000Z') })
    expect(entry.at).toBe('2026-01-02T03:04:05.000Z')
  })

  it('redacts secrets before writing history', async () => {
    const store = seededStore()
    await store.append(
      spec({
        url: 'https://user:s3cret-token@api.example.com/v1?token=s3cret-token',
        headers: [{ name: 'Authorization', value: 'Bearer s3cret-token' }],
        body: { kind: 'json', text: JSON.stringify({ password: 's3cret-token' }) },
        auth: { kind: 'basic', username: 'ada', password: 's3cret-token' },
      }),
      { status: 201 },
    )

    const text = await readFile(historyFile(), 'utf8')
    expect(text).not.toContain('s3cret-token')
    const [entry] = (await store.list()).entries
    expect(entry?.request.auth).toEqual({ kind: 'basic', username: 'ada', password: 'REDACTED' })
    expect(entry?.url).not.toContain('s3cret-token')
  })

  it(`keeps only the newest ${API_HISTORY_ENTRIES_MAX} entries`, async () => {
    // Seeding the file directly keeps this a cap test rather than a
    // filesystem-latency test: 200 sequential appends exceed the default
    // timeout on Windows.
    const dir = join(projectDir, '.vibe', 'api')
    await mkdir(dir, { recursive: true })
    const seeded = Array.from({ length: API_HISTORY_ENTRIES_MAX }, (_, index) => ({
      id: `old-${index}`,
      at: '2026-10-29T00:00:00.000Z',
      method: 'GET',
      url: `https://api.example.com/old/${index}`,
      request: spec(),
    }))
    await writeFile(historyFile(), JSON.stringify({ version: API_HISTORY_VERSION, entries: seeded }))

    const store = seededStore()
    await store.append(spec({ url: 'https://api.example.com/newest' }))

    const result = await store.list({ limit: API_HISTORY_ENTRIES_MAX })
    expect(result.total).toBe(API_HISTORY_ENTRIES_MAX)
    expect(result.entries).toHaveLength(API_HISTORY_ENTRIES_MAX)
    expect(result.entries[0]?.url).toBe('https://api.example.com/newest')
    expect(result.entries.at(-1)?.url).toBe(
      `https://api.example.com/old/${API_HISTORY_ENTRIES_MAX - 2}`,
    )
    expect(result.entries.some((entry) => entry.url.endsWith(`/old/${API_HISTORY_ENTRIES_MAX - 1}`))).toBe(
      false,
    )
  })

  it('searches by method, URL and status, counting matches before the limit', async () => {
    const store = seededStore()
    await store.append(spec({ url: 'https://api.example.com/login' }), { status: 200 })
    await store.append(spec({ method: 'POST', url: 'https://api.example.com/items' }), { status: 201 })
    await store.append(spec({ url: 'https://api.example.com/logout' }), { status: 404 })

    expect((await store.list({ query: 'LOGIN' })).entries).toHaveLength(1)
    expect((await store.list({ query: 'post' })).total).toBe(1)
    expect((await store.list({ query: '404' })).entries[0]?.url).toContain('/logout')
    expect((await store.list({ query: '' })).total).toBe(3)

    const limited = await store.list({ limit: 1 })
    expect(limited.entries).toHaveLength(1)
    expect(limited.total).toBe(3)
  })

  it('clears history and reports whether a document existed', async () => {
    const store = seededStore()
    await store.append(spec())

    expect(await store.clear()).toBe(true)
    await expect(access(historyFile())).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await store.list()).toEqual({ entries: [], total: 0, skipped: 0 })
    expect(await store.clear()).toBe(false)
  })

  it('reads a corrupt document as empty and recovers on the next append', async () => {
    const dir = join(projectDir, '.vibe', 'api')
    await mkdir(dir, { recursive: true })
    await writeFile(historyFile(), '{ not json')

    const store = seededStore()
    expect(await store.list()).toEqual({ entries: [], total: 0, skipped: 0 })

    await store.append(spec({ url: 'https://api.example.com/after' }))
    const result = await store.list()
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]?.url).toBe('https://api.example.com/after')
  })

  it('skips and counts entries that fail schema validation', async () => {
    const dir = join(projectDir, '.vibe', 'api')
    await mkdir(dir, { recursive: true })
    await writeFile(
      historyFile(),
      JSON.stringify({
        version: API_HISTORY_VERSION,
        entries: [
          {
            id: 'valid-1',
            at: '2026-10-29T00:00:00.000Z',
            method: 'GET',
            url: 'https://api.example.com/ok',
            request: spec(),
          },
          { id: 'bad entry', at: 'nope' },
        ],
      }),
    )

    const result = await seededStore().list()
    expect(result.entries.map((entry) => entry.id)).toEqual(['valid-1'])
    expect(result.skipped).toBe(1)
  })

  it('rejects an invalid query or request instead of storing it', async () => {
    const store = seededStore()
    await expect(store.list({ limit: 0 })).rejects.toMatchObject({ code: 'invalid_data' })
    await expect(store.append({ method: 'GET' } as HttpRequestSpec)).rejects.toMatchObject({
      code: 'invalid_data',
    })
  })
})
