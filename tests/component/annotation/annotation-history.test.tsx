// @vitest-environment jsdom
/**
 * Annotation history panel (T033): the list, search, reopen and delete flows
 * against a fake Host API. Reopening only fills the queue — the panel has no
 * sender at all, so nothing can be sent or submitted from here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  addAnnotationToQueue,
  annotationQueueSnapshot,
  clearAnnotationQueue,
  createElementAnnotation,
} from '../../../src/client/inspect/AnnotationQueue'
import { AnnotationHistory } from '../../../src/client/inspect/History'
import { setAnnotationHistoryApi, type AnnotationHistoryApi } from '../../../src/client/inspect/history-store'
import {
  toAnnotationHistoryEntry,
  type Annotation,
  type AnnotationHistoryQuery,
} from '../../../src/contracts/annotation'
import type { ElementContext } from '../../../src/contracts/inspect'

const ELEMENT: ElementContext = {
  selector: 'main > button.primary',
  unique: true,
  tag: 'button',
  id: null,
  classes: ['primary'],
  role: 'button',
  name: 'Save changes',
  text: 'Save changes',
  html: '<button class="primary">Save changes</button>',
  visible: true,
  box: { x: 10, y: 20, width: 120, height: 32 },
  source: {
    framework: 'react',
    via: 'data-inspector-file',
    file: 'src/components/SaveButton.tsx',
    line: 42,
    column: 7,
  },
}

function make(comment: string, id = 'ann-1', createdAt = '2026-10-26T12:00:00.000Z'): Annotation {
  return createElementAnnotation({ targetId: 'fixture', comment, element: ELEMENT, id, createdAt })
}

interface FakeHistory {
  readonly api: AnnotationHistoryApi
  readonly annotations: Annotation[]
  readonly list: ReturnType<typeof vi.fn>
  readonly read: ReturnType<typeof vi.fn>
  readonly save: ReturnType<typeof vi.fn>
  readonly remove: ReturnType<typeof vi.fn>
  readonly options: { skipped?: number; failList?: boolean }
}

function createFake(annotations: Annotation[], options: FakeHistory['options'] = {}): FakeHistory {
  const state = [...annotations]
  const list = vi.fn(async (query?: AnnotationHistoryQuery) => {
    if (options.failList) throw new Error('vibe-studio: cannot list annotations')
    const needle = (query?.query ?? '').trim().toLowerCase()
    const matched = state.filter(
      (annotation) => needle === '' || annotation.comment.toLowerCase().includes(needle),
    )
    return {
      entries: matched.map(toAnnotationHistoryEntry),
      total: matched.length,
      skipped: options.skipped ?? 0,
    }
  })
  const read = vi.fn(async (id: string) => {
    const found = state.find((annotation) => annotation.id === id)
    if (!found) throw new Error('not_found')
    return found
  })
  const save = vi.fn(async (annotation: Annotation) => ({ id: annotation.id }))
  const remove = vi.fn(async (id: string) => {
    const index = state.findIndex((annotation) => annotation.id === id)
    if (index < 0) return { id, removed: false }
    state.splice(index, 1)
    return { id, removed: true }
  })
  return {
    api: { list, read, save, remove },
    annotations: state,
    list,
    read,
    save,
    remove,
    options,
  }
}

function mount(fake: FakeHistory, locale?: 'en' | 'zh-CN'): void {
  setAnnotationHistoryApi(fake.api)
  render(<AnnotationHistory locale={locale} />)
}

async function findComment(text: string): Promise<HTMLElement> {
  return screen.findByText(text, { selector: '[data-vibe-history-comment]' })
}

beforeEach(() => {
  clearAnnotationQueue()
})

describe('AnnotationHistory list', () => {
  it('shows the empty state when nothing is stored', async () => {
    mount(createFake([]))

    expect(await screen.findByText('No saved annotations yet')).toBeDefined()
    expect(screen.queryByText('No matches')).toBeNull()
  })

  it('renders each entry with its comment, selector and source', async () => {
    const older = make('Make it bigger', 'ann-older', '2026-10-01T08:00:00.000Z')
    const newer = make('Change the colour', 'ann-newer', '2026-10-02T08:00:00.000Z')
    mount(createFake([older, newer]))

    await findComment('Change the colour')
    expect(screen.getByText('Make it bigger')).toBeDefined()
    expect(screen.getAllByText('main > button.primary')).toHaveLength(2)
    expect(screen.getAllByText('SaveButton.tsx:42')).toHaveLength(2)
    expect(screen.getByText('2')).toBeDefined()
    expect(screen.queryByText('Change the colour')).not.toBeNull()
  })

  it('reports unreadable files without failing the list', async () => {
    mount(createFake([make('Still readable')], { skipped: 2 }))

    await findComment('Still readable')
    expect(screen.getByText('2 unreadable annotation file(s) skipped.')).toBeDefined()
  })

  it('shows an error state and retries', async () => {
    const fake = createFake([make('Recovered')], { failList: true })
    mount(fake)

    expect(await screen.findByText('History unavailable')).toBeDefined()

    fake.options.failList = false
    fireEvent.click(screen.getByText('Retry'))

    await findComment('Recovered')
    expect(screen.queryByText('History unavailable')).toBeNull()
  })

  it('renders Chinese labels', async () => {
    mount(createFake([]), 'zh-CN')

    expect(await screen.findByText('还没有保存的标注')).toBeDefined()
    expect(screen.getByLabelText('搜索标注历史')).toBeDefined()
  })
})

describe('AnnotationHistory search', () => {
  it('sends the query to the Host and shows matches only', async () => {
    const fake = createFake([make('Make the button bigger'), make('Change the colour')])
    mount(fake)
    await findComment('Make the button bigger')

    fireEvent.change(screen.getByLabelText('Search annotation history'), {
      target: { value: 'colour' },
    })

    await waitFor(() => {
      expect(screen.queryByText('Make the button bigger')).toBeNull()
    })
    expect(screen.getByText('Change the colour')).toBeDefined()
    expect(fake.list).toHaveBeenLastCalledWith({ query: 'colour' })
  })

  it('offers to clear the search when nothing matches', async () => {
    const fake = createFake([make('Make the button bigger')])
    mount(fake)
    await findComment('Make the button bigger')

    const input = screen.getByLabelText('Search annotation history') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'zzz' } })

    expect(await screen.findByText('No matches')).toBeDefined()
    fireEvent.click(screen.getByText('Clear search'))

    await findComment('Make the button bigger')
    expect(input.value).toBe('')
    expect(fake.list).toHaveBeenLastCalledWith(undefined)
  })
})

describe('AnnotationHistory reopen', () => {
  it('puts the stored annotation back in the queue without sending it', async () => {
    const stored = make('Reopen me', 'ann-reopen')
    const fake = createFake([stored])
    mount(fake)
    await findComment('Reopen me')

    fireEvent.click(screen.getByText('Reopen'))

    expect(
      await screen.findByText('Reopened in the queue above. Nothing was sent.'),
    ).toBeDefined()
    expect(fake.read).toHaveBeenCalledWith('ann-reopen')
    expect(annotationQueueSnapshot()).toEqual([stored])
    expect(fake.save).not.toHaveBeenCalled()
  })

  it('reports a failed reopen and leaves the queue empty', async () => {
    const fake = createFake([make('Corrupt entry', 'ann-gone')])
    fake.read.mockRejectedValueOnce(new Error('not_found'))
    mount(fake)
    await findComment('Corrupt entry')

    fireEvent.click(screen.getByText('Reopen'))

    expect(await screen.findByText('Could not reopen this annotation.')).toBeDefined()
    expect(annotationQueueSnapshot()).toEqual([])
  })
})

describe('AnnotationHistory delete', () => {
  it('asks for a second click, then deletes and refreshes', async () => {
    const fake = createFake([make('Delete me', 'ann-delete')])
    mount(fake)
    await findComment('Delete me')

    fireEvent.click(screen.getByText('Delete'))
    expect(screen.getByText('Confirm delete')).toBeDefined()
    expect(fake.remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Confirm delete'))

    expect(await screen.findByText('Annotation deleted.')).toBeDefined()
    expect(fake.remove).toHaveBeenCalledWith('ann-delete')
    expect(await screen.findByText('No saved annotations yet')).toBeDefined()
    expect(screen.queryByText('Delete me')).toBeNull()
  })

  it('cancels the confirmation without deleting', async () => {
    const fake = createFake([make('Keep me', 'ann-keep')])
    mount(fake)
    await findComment('Keep me')

    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Cancel'))

    expect(screen.queryByText('Confirm delete')).toBeNull()
    expect(screen.getByText('Keep me')).toBeDefined()
    expect(fake.remove).not.toHaveBeenCalled()
  })

  it('reports an annotation that was already gone', async () => {
    const fake = createFake([make('Race me', 'ann-race')])
    fake.remove.mockResolvedValueOnce({ id: 'ann-race', removed: false })
    mount(fake)
    await findComment('Race me')

    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Confirm delete'))

    expect(await screen.findByText('That annotation was already gone.')).toBeDefined()
  })

  it('reports a failed delete and keeps the entry', async () => {
    const fake = createFake([make('Locked', 'ann-locked')])
    fake.remove.mockRejectedValueOnce(new Error('vibe-studio: cannot delete'))
    mount(fake)
    await findComment('Locked')

    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Confirm delete'))

    expect(await screen.findByText('Could not delete this annotation.')).toBeDefined()
    expect(screen.getByText('Locked')).toBeDefined()
    expect(screen.getByRole('alert')).toBeDefined()
  })

  it('keeps the panel independent from the queue contents', async () => {
    addAnnotationToQueue(make('Queued draft', 'ann-queued'))
    const fake = createFake([make('Archived', 'ann-archived')])
    mount(fake)

    await findComment('Archived')
    const list = screen.getByRole('list')
    expect(within(list).getByText('Archived')).toBeDefined()
    expect(within(list).queryByText('Queued draft')).toBeNull()
    expect(annotationQueueSnapshot()).toHaveLength(1)
  })
})
