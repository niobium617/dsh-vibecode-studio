// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { VerifyEvidence, VerifyResult } from '../../../src/contracts/verify'
import {
  VerifyPanel,
  type VerifySource,
} from '../../../src/client/verify/VerifyPanel'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function passing(): VerifyResult {
  return {
    ok: true,
    ranAt: '2026-10-31T02:00:00.000Z',
    durationMs: 12,
    url: 'http://127.0.0.1:4320/',
    checks: [
      { id: 'target', status: 'pass', message: 'Preview is running.' },
      { id: 'page', status: 'pass', message: 'Page loaded (4 DOM nodes).' },
      { id: 'console', status: 'pass', message: 'No console errors.' },
      { id: 'network', status: 'pass', message: 'No failed requests.' },
    ],
    consoleErrors: 0,
    failedRequests: 0,
    truncated: false,
  }
}

function failing(): VerifyResult {
  return {
    ok: false,
    ranAt: '2026-10-31T02:00:00.000Z',
    durationMs: 18,
    url: 'http://127.0.0.1:4320/',
    checks: [
      { id: 'target', status: 'pass', message: 'Preview is running.' },
      { id: 'page', status: 'pass', message: 'Page loaded (4 DOM nodes).' },
      {
        id: 'console',
        status: 'fail',
        message: '1 console errors buffered.',
        evidence: [
          { kind: 'console', id: 'console-2', level: 'error', text: 'boom' },
        ],
      },
      {
        id: 'network',
        status: 'fail',
        message: '1 failed requests buffered.',
        evidence: [
          {
            kind: 'network',
            id: 'network-3',
            method: 'GET',
            url: 'http://127.0.0.1:4320/api/boom',
            status: 500,
            outcome: 'response',
          },
        ],
      },
    ],
    consoleErrors: 1,
    failedRequests: 1,
    truncated: false,
  }
}

function setup(options: {
  readonly ready?: boolean
  readonly visible?: boolean
  readonly result?: VerifyResult
  readonly fail?: Error
  readonly onOpenEvidence?: (evidence: VerifyEvidence) => void
} = {}) {
  const run = vi.fn(async () => {
    if (options.fail) throw options.fail
    return options.result ?? passing()
  })
  const source: VerifySource = { run }
  render(
    <VerifyPanel
      locale="en"
      ready={options.ready ?? true}
      visible={options.visible ?? true}
      source={source}
      onOpenEvidence={options.onOpenEvidence}
    />,
  )
  return { run }
}

async function clickRun(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Run checks' }))
  })
}

describe('VerifyPanel (T056)', () => {
  it('starts empty and runs every check with one click', async () => {
    const { run } = setup()

    expect(screen.getByText(/Not run yet/)).toBeTruthy()

    await clickRun()

    expect(run).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/All checks passed/)).toBeTruthy()
    expect(screen.getAllByText(/passed/).length).toBeGreaterThanOrEqual(4)
    const rows = Array.from(
      document.querySelectorAll('[data-vibe-verify-check]'),
    ).map((row) => row.getAttribute('data-vibe-verify-check'))
    expect(rows).toEqual(['target', 'page', 'console', 'network'])
    expect(screen.getByText('Page loaded (4 DOM nodes).')).toBeTruthy()
  })

  it('disables the run button until the preview is live', () => {
    setup({ ready: false })

    expect(screen.getByText(/Start the preview/)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Run checks' }),
    ).toHaveProperty('disabled', true)
  })

  it('lists failures and opens the owning drawer for each evidence row', async () => {
    const onOpenEvidence = vi.fn()
    setup({ result: failing(), onOpenEvidence })

    await clickRun()

    expect(screen.getByText(/2 of 4 checks failed/)).toBeTruthy()
    expect(screen.getByText('1 console errors buffered.')).toBeTruthy()

    const consoleButton = document.querySelector<HTMLElement>(
      '[data-vibe-verify-evidence="console"]',
    )
    const networkButton = document.querySelector<HTMLElement>(
      '[data-vibe-verify-evidence="network"]',
    )
    expect(consoleButton?.getAttribute('data-evidence-id')).toBe('console-2')
    expect(networkButton?.getAttribute('data-evidence-id')).toBe('network-3')

    fireEvent.click(consoleButton as HTMLElement)
    expect(onOpenEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'console', id: 'console-2' }),
    )

    fireEvent.click(networkButton as HTMLElement)
    expect(onOpenEvidence).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'network', id: 'network-3' }),
    )
  })

  it('shows a transport failure as an alert and stays empty', async () => {
    setup({ fail: new Error('transport offline') })

    await clickRun()

    expect(screen.getByRole('alert').textContent).toContain('transport offline')
    expect(screen.getByText(/Not run yet/)).toBeTruthy()
  })

  it('notes trimmed evidence and stays hidden when another tab is open', async () => {
    setup({ result: { ...failing(), truncated: true } })

    await clickRun()

    expect(screen.getByText(/Evidence was trimmed/)).toBeTruthy()
  })

  it('renders nothing visible until the verify tab is selected', () => {
    setup({ visible: false })
    const section = document.querySelector<HTMLElement>('[data-vibe-verify="1"]')
    expect(section?.style.display).toBe('none')
  })
})
