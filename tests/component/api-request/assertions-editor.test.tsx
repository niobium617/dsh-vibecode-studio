/**
 * T045 assertions editor: rows become a declarative list on the wire, the
 * Host's verdict is shown per row, and a malformed row blocks the send instead
 * of silently disappearing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import {
  RequestBuilder,
  type ApiSend,
  type ApiSendOptions,
  type ApiSendOutcome,
} from '../../../src/client/api/RequestBuilder'
import type { ApiAssertionResult } from '../../../src/contracts/api'

afterEach(() => {
  cleanup()
})

function outcome(assertions?: readonly ApiAssertionResult[]): ApiSendOutcome {
  return {
    result: {
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.com/items',
      redirects: [],
      headers: { 'content-type': 'application/json' },
      elapsedMs: 12,
      body: {
        text: '{"ok":true}',
        base64: '',
        bytes: 11,
        truncated: false,
        contentType: 'application/json',
      },
    },
    unresolved: [],
    ...(assertions === undefined ? {} : { assertions }),
  }
}

function fakeSend(results: readonly ApiAssertionResult[]) {
  return vi.fn<ApiSend>(
    async (_spec, options?: ApiSendOptions) =>
      outcome(options?.assertions === undefined ? undefined : results),
  )
}

function rows(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-vibe-assertion="1"]'))
}

function ready(container: HTMLElement): void {
  fireEvent.change(container.querySelector('[data-vibe-request-url="1"]')!, {
    target: { value: 'https://api.example.com/items' },
  })
}

function addRow(container: HTMLElement): void {
  fireEvent.click(container.querySelector('[data-vibe-assertion-add="1"]')!)
}

describe('AssertionsEditor inside RequestBuilder', () => {
  it('sends a declarative status check and shows the Host verdict', async () => {
    const send = fakeSend([{ index: 0, passed: true, actual: '200' }])
    const { container } = render(<RequestBuilder send={send} />)
    ready(container)
    addRow(container)

    expect(rows(container)).toHaveLength(1)
    fireEvent.click(container.querySelector('[data-vibe-send="1"]')!)

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]![1]?.assertions).toEqual([{ kind: 'status', expected: 200 }])

    await waitFor(() =>
      expect(
        container.querySelector('[data-vibe-assertion-result="1"]')?.getAttribute('data-state'),
      ).toBe('pass'),
    )
    const summary = container.querySelector('[data-vibe-assertions-summary="1"]')!
    expect(summary.textContent).toBe('1/1 passed')
    expect(summary.getAttribute('data-state')).toBe('pass')
    expect(container.querySelector('[data-vibe-assertion-result="1"]')?.textContent).toBe(
      'Passed (got 200).',
    )
  })

  it('switches a row to a JSON check and builds the right document', async () => {
    const send = fakeSend([{ index: 0, passed: false, actual: 'false', failure: 'value_mismatch' }])
    const { container } = render(<RequestBuilder send={send} />)
    ready(container)
    addRow(container)

    const row = rows(container)[0]!
    fireEvent.change(row.querySelector('[data-vibe-assertion-kind="1"]')!, {
      target: { value: 'json' },
    })
    const next = rows(container)[0]!
    expect(next.querySelector('[data-vibe-assertion-path="1"]')).toHaveProperty('value', '$')
    fireEvent.change(next.querySelector('[data-vibe-assertion-path="1"]')!, {
      target: { value: '$.ok' },
    })
    fireEvent.change(next.querySelector('[data-vibe-assertion-expected="1"]')!, {
      target: { value: 'true' },
    })
    fireEvent.click(container.querySelector('[data-vibe-send="1"]')!)

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]![1]?.assertions).toEqual([
      { kind: 'json', path: '$.ok', expected: 'true', match: 'equals' },
    ])

    await waitFor(() =>
      expect(container.querySelector('[data-vibe-assertion-result="1"]')?.textContent).toBe(
        'Expected true, got false.',
      ),
    )
    expect(
      container.querySelector('[data-vibe-assertions-summary="1"]')?.getAttribute('data-state'),
    ).toBe('fail')
  })

  it('blocks the send on a malformed row and explains why', async () => {
    const send = fakeSend([])
    const { container } = render(<RequestBuilder send={send} />)
    ready(container)
    addRow(container)

    fireEvent.change(container.querySelector('[data-vibe-assertion-expected="1"]')!, {
      target: { value: 'abc' },
    })
    fireEvent.click(container.querySelector('[data-vibe-send="1"]')!)

    await waitFor(() =>
      expect(container.querySelector('[data-vibe-assertion-issue="1"]')?.textContent).toContain(
        'Status must be a 3-digit code',
      ),
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('drops stale verdicts when a row changes and localizes the failure', async () => {
    const send = fakeSend([
      { index: 0, passed: false, actual: '200', failure: 'status_mismatch' },
    ])
    const { container } = render(<RequestBuilder send={send} locale="zh-CN" />)
    ready(container)
    addRow(container)
    fireEvent.change(container.querySelector('[data-vibe-assertion-expected="1"]')!, {
      target: { value: '201' },
    })
    fireEvent.click(container.querySelector('[data-vibe-send="1"]')!)
    await waitFor(() =>
      expect(container.querySelector('[data-vibe-assertion-result="1"]')?.textContent).toBe(
        '期望状态码 201，实际 200。',
      ),
    )

    fireEvent.change(container.querySelector('[data-vibe-assertion-expected="1"]')!, {
      target: { value: '200' },
    })
    expect(container.querySelector('[data-vibe-assertion-result="1"]')).toBeNull()
    expect(container.querySelector('[data-vibe-assertions-summary="1"]')).toBeNull()
    expect(container.querySelector('[data-vibe-assertions-empty="1"]')).toBeNull()
  })

  it('removes a row and stops sending checks when none are left', async () => {
    const send = fakeSend([])
    const { container } = render(<RequestBuilder send={send} />)
    ready(container)
    addRow(container)
    fireEvent.click(container.querySelector('[data-vibe-assertion-remove="1"]')!)

    expect(rows(container)).toHaveLength(0)
    expect(container.querySelector('[data-vibe-assertions-empty="1"]')).not.toBeNull()

    fireEvent.click(container.querySelector('[data-vibe-send="1"]')!)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(send.mock.calls[0]![1]?.assertions).toBeUndefined()
  })
})
