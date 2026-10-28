/**
 * T033 annotation history: the list/search/get/save/remove views over the T030
 * `.vibe/annotations` store. Acceptance is covered directly — entries survive a
 * new service instance (restart), corrupt files are skipped instead of breaking
 * the list, and removal deletes the file.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ANNOTATION_HISTORY_COMMENT_PREVIEW_CHARS,
  ANNOTATION_HISTORY_LIMIT_MAX,
  ANNOTATION_HISTORY_QUERY_MAX_CHARS,
  type AnnotationHistoryResult,
  type Annotation,
} from '../../../src/contracts'
import {
  ANNOTATION_HISTORY_GET_METHOD,
  ANNOTATION_HISTORY_LIST_METHOD,
  ANNOTATION_HISTORY_REMOVE_METHOD,
  ANNOTATION_HISTORY_SAVE_METHOD,
} from '../../../src/contracts/transport'
import { createAnnotationStore } from '../../../src/host/inspect/annotation-store'
import {
  AnnotationHistoryService,
  createAnnotationHistoryService,
  registerAnnotationHistoryMethods,
} from '../../../src/host/inspect/history'
import { UnaryRegistry, type UnaryDispatchResult } from '../../../src/host/transport'
import { annotationFixture } from '../contracts/fixtures'

let tempRoot: string
let projectDir: string
let service: AnnotationHistoryService

beforeEach(async () => {
  const root = join(process.cwd(), '.tmp')
  await mkdir(root, { recursive: true })
  tempRoot = await mkdtemp(join(root, 'annotation-history-'))
  projectDir = join(tempRoot, 'project')
  await mkdir(projectDir)
  service = createAnnotationHistoryService({ projectDir })
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function annotation(id: string, overrides: Partial<Annotation> = {}): Annotation {
  return annotationFixture({ id, ...overrides })
}

async function saveAll(...annotations: Annotation[]): Promise<void> {
  for (const item of annotations) await service.save(item)
}

function successValue<T>(result: UnaryDispatchResult): T {
  if (result.body.ok !== true) throw new Error('expected a successful envelope')
  return result.body.value as T
}

const callContext = {
  request: new Request('http://127.0.0.1/api/vibe/request'),
  signal: new AbortController().signal,
}

describe('AnnotationHistoryService.list', () => {
  it('returns summaries newest first without the full element context', async () => {
    await saveAll(
      annotation('ann-older', { createdAt: '2026-10-01T08:00:00.000Z' }),
      annotation('ann-newer', { createdAt: '2026-10-03T08:00:00.000Z' }),
      annotation('ann-middle', { createdAt: '2026-10-02T08:00:00.000Z' }),
    )

    const result = await service.list()

    expect(result.total).toBe(3)
    expect(result.skipped).toBe(0)
    expect(result.entries.map((entry) => entry.id)).toEqual([
      'ann-newer',
      'ann-middle',
      'ann-older',
    ])
    expect(result.entries[0]).toEqual({
      id: 'ann-newer',
      targetId: 'web-local',
      createdAt: '2026-10-03T08:00:00.000Z',
      source: 'element',
      comment: 'Tighten the spacing to 16px.',
      selector: 'main > button.primary',
      tag: 'button',
      sourceFile: 'src/components/SaveButton.tsx',
      sourceLine: 42,
    })
    expect(result.entries[0]).not.toHaveProperty('element')
  })

  it('keeps a new service over the same directory in sync (restart)', async () => {
    await service.save(annotation('ann-keep'))

    const restarted = createAnnotationHistoryService({ projectDir })
    const result = await restarted.list()

    expect(result.entries.map((entry) => entry.id)).toEqual(['ann-keep'])
    await expect(restarted.get({ id: 'ann-keep' })).resolves.toMatchObject({
      comment: 'Tighten the spacing to 16px.',
    })
  })

  it('truncates long comments in the preview', async () => {
    await service.save(annotation('ann-long', { comment: '調整 '.repeat(400) }))

    const result = await service.list()
    const [entry] = result.entries

    expect(entry?.comment).toHaveLength(ANNOTATION_HISTORY_COMMENT_PREVIEW_CHARS + 1)
    expect(entry?.comment.endsWith('…')).toBe(true)
    // The stored file keeps the full comment.
    await expect(service.get({ id: 'ann-long' })).resolves.toMatchObject({
      comment: '調整 '.repeat(400),
    })
  })

  it('returns an empty page for a fresh project', async () => {
    await expect(service.list()).resolves.toEqual({ entries: [], total: 0, skipped: 0 })
  })

  it('honours limit while reporting the pre-limit total', async () => {
    await saveAll(
      annotation('ann-a', { createdAt: '2026-10-01T00:00:00.000Z' }),
      annotation('ann-b', { createdAt: '2026-10-02T00:00:00.000Z' }),
      annotation('ann-c', { createdAt: '2026-10-03T00:00:00.000Z' }),
    )

    const result = await service.list({ limit: 2 })

    expect(result.entries.map((entry) => entry.id)).toEqual(['ann-c', 'ann-b'])
    expect(result.total).toBe(3)
  })

  it('skips unreadable files instead of failing the list', async () => {
    await service.save(annotation('ann-good'))
    const dir = join(projectDir, '.vibe', 'annotations')
    await writeFile(join(dir, 'ann-broken.json'), '{ not json', 'utf8')
    await writeFile(join(dir, 'ann-empty.json'), '', 'utf8')
    await writeFile(join(dir, 'ann-foreign.json'), JSON.stringify({ hello: 'world' }), 'utf8')
    await writeFile(join(dir, 'not an annotation.json'), 'ignored', 'utf8')

    const result: AnnotationHistoryResult = await service.list()

    expect(result.entries.map((entry) => entry.id)).toEqual(['ann-good'])
    expect(result.total).toBe(1)
    expect(result.skipped).toBe(3)
  })

  it('rejects an oversized file without failing siblings', async () => {
    await service.save(annotation('ann-good'))
    const dir = join(projectDir, '.vibe', 'annotations')
    await writeFile(join(dir, 'ann-huge.json'), 'x'.repeat(70 * 1024), 'utf8')

    const result = await service.list()

    expect(result.entries.map((entry) => entry.id)).toEqual(['ann-good'])
    expect(result.skipped).toBe(1)
  })

  it('rejects malformed queries with invalid_input', async () => {
    await expect(service.list({ query: 'x'.repeat(ANNOTATION_HISTORY_QUERY_MAX_CHARS + 1) }))
      .rejects.toMatchObject({ code: 'invalid_input' })
    await expect(service.list({ limit: 0 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(service.list({ limit: ANNOTATION_HISTORY_LIMIT_MAX + 1 })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(service.list({ limit: 1.5 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(service.list({ query: 42 })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(service.list({ surprise: true })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(service.list('nope')).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('maps a .vibe link leaving the project to permission_denied', async () => {
    const outside = join(tempRoot, 'outside')
    await mkdir(outside)
    await symlink(outside, join(projectDir, '.vibe'), process.platform === 'win32' ? 'junction' : 'dir')

    // Saving first creates the linked directory, so the follow-up list has a
    // real path to resolve instead of a missing one.
    await expect(service.save(annotation('ann-1'))).rejects.toMatchObject({
      code: 'permission_denied',
    })
    await expect(service.list()).rejects.toMatchObject({ code: 'permission_denied' })
  })
})

describe('AnnotationHistoryService search', () => {
  beforeEach(async () => {
    await saveAll(
      annotation('ann-spacing', {
        createdAt: '2026-10-01T00:00:00.000Z',
        comment: 'Tighten the spacing to 16px.',
      }),
      annotation('ann-color', {
        createdAt: '2026-10-02T00:00:00.000Z',
        comment: '把按钮颜色改成蓝色。',
        element: {
          ...annotationFixture().element!,
          selector: 'aside > div.toolbar',
          tag: 'div',
          name: 'Toolbar',
          text: 'Toolbar actions',
          source: {
            framework: 'react',
            via: 'data-inspector',
            file: 'src/components/Toolbar.tsx',
            line: 7,
            column: 3,
          },
        },
      }),
      annotation('ann-manual', {
        createdAt: '2026-10-03T00:00:00.000Z',
        source: 'manual',
        comment: 'General polish pass.',
        element: undefined,
      }),
    )
  })

  it('matches comments case-insensitively', async () => {
    const result = await service.list({ query: 'SPACING' })
    expect(result.entries.map((entry) => entry.id)).toEqual(['ann-spacing'])
    expect(result.total).toBe(1)
  })

  it('matches selectors, tags and source files', async () => {
    await expect(service.list({ query: 'toolbar' })).resolves.toMatchObject({
      entries: [{ id: 'ann-color' }],
      total: 1,
    })
    await expect(service.list({ query: 'aside > div' })).resolves.toMatchObject({
      entries: [{ id: 'ann-color' }],
    })
    await expect(service.list({ query: 'Toolbar.tsx' })).resolves.toMatchObject({
      entries: [{ id: 'ann-color' }],
    })
  })

  it('matches Chinese text and the annotation id', async () => {
    await expect(service.list({ query: '按钮颜色' })).resolves.toMatchObject({
      entries: [{ id: 'ann-color' }],
    })
    await expect(service.list({ query: 'ann-manual' })).resolves.toMatchObject({
      entries: [{ id: 'ann-manual' }],
    })
  })

  it('returns no entries when nothing matches', async () => {
    await expect(service.list({ query: 'nonexistent-needle' })).resolves.toEqual({
      entries: [],
      total: 0,
      skipped: 0,
    })
  })

  it('treats a blank query as unfiltered', async () => {
    const result = await service.list({ query: '   ' })
    expect(result.total).toBe(3)
  })
})

describe('AnnotationHistoryService.get and save', () => {
  it('returns the full annotation for reopening', async () => {
    const stored = annotation('ann-open')
    await service.save(stored)

    await expect(service.get({ id: 'ann-open' })).resolves.toEqual(stored)
  })

  it('answers not_found for missing, unknown or corrupt ids', async () => {
    await expect(service.get({ id: 'ann-missing' })).rejects.toMatchObject({ code: 'not_found' })

    await service.save(annotation('ann-corrupt'))
    await writeFile(join(projectDir, '.vibe', 'annotations', 'ann-corrupt.json'), 'nope', 'utf8')
    await expect(service.get({ id: 'ann-corrupt' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('rejects unusable ids and payloads with invalid_input', async () => {
    await expect(service.get({})).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(service.get({ id: '../escape' })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(service.get({ id: 'ann-1', extra: true })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(service.save({ id: 'ann-1' })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('rejects an annotation over the 64 KiB file cap', async () => {
    await expect(
      service.save(annotation('ann-fat', { comment: 'x'.repeat(70 * 1024) })),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('replaces an existing file with the same id', async () => {
    await service.save(annotation('ann-1', { comment: 'First.' }))
    await expect(service.save(annotation('ann-1', { comment: 'Second.' }))).resolves.toEqual({
      id: 'ann-1',
    })

    const result = await service.list()
    expect(result.total).toBe(1)
    expect(result.entries[0]?.comment).toBe('Second.')
  })
})

describe('AnnotationHistoryService.remove', () => {
  it('deletes the file and drops it from the next list', async () => {
    await saveAll(annotation('ann-drop'), annotation('ann-keep', { createdAt: '2026-10-27T00:00:00.000Z' }))

    await expect(service.remove({ id: 'ann-drop' })).resolves.toEqual({
      id: 'ann-drop',
      removed: true,
    })
    await expect(service.get({ id: 'ann-drop' })).rejects.toMatchObject({ code: 'not_found' })

    const result = await service.list()
    expect(result.entries.map((entry) => entry.id)).toEqual(['ann-keep'])
  })

  it('reports removed: false for an unknown id', async () => {
    await expect(service.remove({ id: 'ann-missing' })).resolves.toEqual({
      id: 'ann-missing',
      removed: false,
    })
  })

  it('keeps the deletion across a new service (restart)', async () => {
    await service.save(annotation('ann-drop'))
    await service.remove({ id: 'ann-drop' })

    const restarted = createAnnotationHistoryService({ projectDir })
    await expect(restarted.list()).resolves.toMatchObject({ entries: [], total: 0 })
  })

  it('rejects unusable ids with invalid_input', async () => {
    await expect(service.remove({})).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(service.remove({ id: 'a/b' })).rejects.toMatchObject({ code: 'invalid_input' })
  })
})

describe('annotation history unary methods', () => {
  it('registers the four methods and serves the envelopes', async () => {
    const registry = new UnaryRegistry()
    const dispose = registerAnnotationHistoryMethods(registry, service)

    expect(registry.has(ANNOTATION_HISTORY_LIST_METHOD)).toBe(true)
    expect(registry.has(ANNOTATION_HISTORY_GET_METHOD)).toBe(true)
    expect(registry.has(ANNOTATION_HISTORY_SAVE_METHOD)).toBe(true)
    expect(registry.has(ANNOTATION_HISTORY_REMOVE_METHOD)).toBe(true)

    const saved = successValue<{ id: string }>(
      await registry.dispatch(ANNOTATION_HISTORY_SAVE_METHOD, annotation('ann-wire'), callContext),
    )
    expect(saved).toEqual({ id: 'ann-wire' })

    const listed = successValue<AnnotationHistoryResult>(
      await registry.dispatch(ANNOTATION_HISTORY_LIST_METHOD, undefined, callContext),
    )
    expect(listed.total).toBe(1)

    const read = successValue<Annotation>(
      await registry.dispatch(ANNOTATION_HISTORY_GET_METHOD, { id: 'ann-wire' }, callContext),
    )
    expect(read.id).toBe('ann-wire')

    const removed = successValue<{ id: string; removed: boolean }>(
      await registry.dispatch(ANNOTATION_HISTORY_REMOVE_METHOD, { id: 'ann-wire' }, callContext),
    )
    expect(removed.removed).toBe(true)

    dispose()
    expect(registry.has(ANNOTATION_HISTORY_LIST_METHOD)).toBe(false)
    expect(registry.has(ANNOTATION_HISTORY_SAVE_METHOD)).toBe(false)
  })

  it('returns HTTP-shaped errors for bad params and missing ids', async () => {
    const registry = new UnaryRegistry()
    registerAnnotationHistoryMethods(registry, service)

    const badList = await registry.dispatch(ANNOTATION_HISTORY_LIST_METHOD, { limit: 0 }, callContext)
    expect(badList.status).toBe(400)
    expect(badList.body).toMatchObject({ ok: false, error: { code: 'invalid_input' } })

    const missing = await registry.dispatch(
      ANNOTATION_HISTORY_GET_METHOD,
      { id: 'ann-missing' },
      callContext,
    )
    expect(missing.status).toBe(404)
    expect(missing.body).toMatchObject({ ok: false, error: { code: 'not_found' } })
  })

  it('shares the project directory with a store built by the caller', async () => {
    const injected = createAnnotationHistoryService({
      projectDir,
      store: createAnnotationStore(projectDir),
    })
    await injected.save(annotation('ann-injected'))

    const result = await service.list()
    expect(result.entries.map((entry) => entry.id)).toEqual(['ann-injected'])
  })

  it('refuses to build without a project directory', () => {
    expect(() => new AnnotationHistoryService({ projectDir: '  ' })).toThrow(/projectDir/)
  })
})
