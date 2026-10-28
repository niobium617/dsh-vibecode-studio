// @vitest-environment jsdom
/**
 * Picker UI (T027): the toggle, the picked-element card and the polling hook.
 * The Host source is injected, so these tests never touch the transport.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import {
  PICK_POLL_ACTIVE_MS,
  PICK_POLL_IDLE_MS,
  PickCard,
  PickToggle,
  usePicker,
  type PickSource,
} from '../../../src/client/inspect/Picker'
import type { ElementContext } from '../../../src/contracts/inspect'
import type { PickSnapshot } from '../../../src/contracts/transport'

const PICK: ElementContext = {
  selector: '[data-testid="save"]',
  unique: true,
  tag: 'button',
  id: null,
  classes: ['primary', 'large'],
  role: null,
  text: '',
  html: '',
  box: { x: 10, y: 20, width: 100, height: 30 },
  source: null,
}

const OTHER: ElementContext = { ...PICK, selector: '#other', unique: false, classes: [] }

function idle(): PickSnapshot {
  return { active: false, seq: 0, pick: null, ts: null }
}

function fakeSource() {
  let current = idle()
  const calls: string[] = []
  const source: PickSource = {
    async start() {
      calls.push('start')
      current = { ...current, active: true }
      return current
    },
    async stop() {
      calls.push('stop')
      current = { ...current, active: false }
      return current
    },
    async status() {
      calls.push('status')
      return current
    },
  }
  return {
    source,
    calls,
    set(next: PickSnapshot) {
      current = next
    },
    count(name: string): number {
      return calls.filter((entry) => entry === name).length
    },
  }
}

interface HarnessProps {
  readonly enabled: boolean
  readonly source: PickSource
  onError?(error: unknown): void
}

function Harness({ enabled, source, onError }: HarnessProps): React.ReactElement {
  const picker = usePicker({ enabled, source, onError })
  return (
    <div>
      <PickToggle
        locale="en"
        picking={picker.picking}
        available={enabled}
        disabled={picker.busy}
        onToggle={picker.toggle}
      />
      {picker.pick ? (
        <PickCard locale="en" pick={picker.pick} onClose={picker.dismiss} />
      ) : null}
    </div>
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function toggleButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Pick element|Stop picking/ }) as HTMLButtonElement
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PickToggle', () => {
  it('labels the button by mode and explains an unavailable target', () => {
    render(
      <PickToggle locale="en" picking={false} available={true} onToggle={() => {}} />,
    )
    const button = screen.getByRole('button', { name: 'Pick element' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.getAttribute('title')).toContain('Alt+Click')

    cleanup()
    render(<PickToggle locale="en" picking={true} available={true} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: 'Stop picking' })).toBeTruthy()

    cleanup()
    render(<PickToggle locale="en" picking={false} available={false} onToggle={() => {}} />)
    const unavailable = screen.getByRole('button', { name: 'Pick element' }) as HTMLButtonElement
    expect(unavailable.disabled).toBe(true)
    expect(unavailable.getAttribute('title')).toContain('unavailable')
  })

  it('reports the toggle and respects the disabled prop', () => {
    const onToggle = vi.fn()
    render(<PickToggle locale="en" picking={false} available={true} onToggle={onToggle} />)
    fireEvent.click(toggleButton())
    expect(onToggle).toHaveBeenCalledTimes(1)

    cleanup()
    render(
      <PickToggle locale="en" picking={false} available={true} disabled onToggle={onToggle} />,
    )
    fireEvent.click(toggleButton())
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('PickCard', () => {
  it('shows the selector, the uniqueness badge and the box', () => {
    const onClose = vi.fn()
    render(<PickCard locale="en" pick={PICK} onClose={onClose} />)

    expect(document.querySelector('[data-vibe-pick-selector="1"]')?.textContent).toBe(PICK.selector)
    expect(document.querySelector('[data-vibe-pick-unique="1"]')?.textContent).toBe('unique')
    const card = document.querySelector('[data-vibe-pick-card="1"]') as HTMLElement
    expect(card.textContent).toContain('button.primary.large')
    expect(card.textContent).toContain('10, 20 · 100×30')

    fireEvent.click(screen.getByRole('button', { name: 'Hide picked element' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('marks a non-unique selector instead of hiding that detail', () => {
    render(<PickCard locale="en" pick={OTHER} onClose={() => {}} />)
    expect(document.querySelector('[data-vibe-pick-unique="0"]')?.textContent).toBe('not unique')
  })
})

describe('usePicker', () => {
  it('polls slowly while off and fast while picking, surfacing the last pick', async () => {
    const fake = fakeSource()
    render(<Harness enabled={true} source={fake.source} />)
    await settle()
    expect(fake.count('status')).toBe(1)
    expect(toggleButton().getAttribute('aria-pressed')).toBe('false')

    await advance(PICK_POLL_IDLE_MS)
    expect(fake.count('status')).toBe(2)

    fake.set({ active: true, seq: 1, pick: PICK, ts: 1 })
    await advance(PICK_POLL_IDLE_MS)
    expect(toggleButton().getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('group', { name: 'Picked element' })).toBeTruthy()

    const before = fake.count('status')
    await advance(PICK_POLL_ACTIVE_MS)
    expect(fake.count('status')).toBe(before + 1)
  })

  it('starts and stops the Host mode from the same button', async () => {
    const fake = fakeSource()
    render(<Harness enabled={true} source={fake.source} />)
    await settle()

    await act(async () => {
      fireEvent.click(toggleButton())
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fake.calls).toContain('start')
    expect(toggleButton().getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      fireEvent.click(toggleButton())
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(fake.calls).toContain('stop')
    expect(toggleButton().getAttribute('aria-pressed')).toBe('false')
  })

  it('hides a dismissed pick until a newer one arrives', async () => {
    const fake = fakeSource()
    fake.set({ active: true, seq: 1, pick: PICK, ts: 1 })
    render(<Harness enabled={true} source={fake.source} />)
    await settle()
    expect(screen.getByRole('group', { name: 'Picked element' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Hide picked element' }))
    expect(screen.queryByRole('group', { name: 'Picked element' })).toBeNull()

    // The same pick polled again must stay hidden; a new seq shows the card.
    await advance(PICK_POLL_ACTIVE_MS)
    expect(screen.queryByRole('group', { name: 'Picked element' })).toBeNull()

    fake.set({ active: true, seq: 2, pick: OTHER, ts: 2 })
    await advance(PICK_POLL_ACTIVE_MS)
    expect(document.querySelector('[data-vibe-pick-selector="1"]')?.textContent).toBe('#other')
  })

  it('reports a failed start and re-reads the Host state', async () => {
    const fake = fakeSource()
    fake.source.start = async () => {
      fake.calls.push('start')
      throw new Error('picker refused')
    }
    const onError = vi.fn()
    render(<Harness enabled={true} source={fake.source} onError={onError} />)
    await settle()

    await act(async () => {
      fireEvent.click(toggleButton())
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0]![0] as Error).message).toBe('picker refused')
    expect(fake.count('status')).toBeGreaterThanOrEqual(2)
    expect(toggleButton().getAttribute('aria-pressed')).toBe('false')
  })

  it('stops polling and drops the card outside a live session', async () => {
    const fake = fakeSource()
    fake.set({ active: true, seq: 1, pick: PICK, ts: 1 })
    const view = render(<Harness enabled={true} source={fake.source} />)
    await settle()
    expect(screen.getByRole('group', { name: 'Picked element' })).toBeTruthy()

    view.rerender(<Harness enabled={false} source={fake.source} />)
    await settle()
    expect(screen.queryByRole('group', { name: 'Picked element' })).toBeNull()

    const calls = fake.count('status')
    await advance(PICK_POLL_IDLE_MS * 2)
    expect(fake.count('status')).toBe(calls)
    expect(toggleButton().disabled).toBe(true)
  })
})
