/**
 * T038 request builder: a beginner can type a URL, send, and read what
 * happened. The transport is injected, so every test asserts the exact spec
 * that would cross the unary wire — and validation never reaches the wire.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RequestBuilder, type ApiSend, type ApiSendOutcome } from '../../../src/client/api/RequestBuilder'
import { TransportError } from '../../../src/client/transport'
import type { HttpRequestSpec } from '../../../src/contracts/api'

afterEach(() => {
  cleanup()
})

function outcome(status = 200): ApiSendOutcome {
  return {
    result: {
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      url: 'https://api.example.com/items',
      redirects: [],
      headers: { 'content-type': 'application/json' },
      elapsedMs: 12,
      body: { text: '{"ok":true}', base64: 'eyJvayI6dHJ1ZX0=', bytes: 4, truncated: false, contentType: 'application/json' },
    },
    unresolved: [],
  }
}

function fields(container: HTMLElement) {
  return {
    url: container.querySelector<HTMLInputElement>('[data-vibe-request-url="1"]')!,
    method: container.querySelector<HTMLSelectElement>('[data-vibe-request-method="1"]')!,
    send: container.querySelector<HTMLButtonElement>('[data-vibe-send="1"]')!,
    cancel: () => container.querySelector<HTMLButtonElement>('[data-vibe-cancel="1"]'),
  }
}

function section(container: HTMLElement, id: string): void {
  fireEvent.click(container.querySelector(`[data-vibe-section="${id}"]`)!)
}

describe('RequestBuilder', () => {
  it('sends method, URL, query and headers as one spec', async () => {
    const send = vi.fn<ApiSend>(async () => outcome())
    const { container } = render(<RequestBuilder send={send} />)
    const f = fields(container)

    fireEvent.change(f.method, { target: { value: 'POST' } })
    fireEvent.change(f.url, { target: { value: 'https://api.example.com/items' } })

    const queryRow = container.querySelector('[data-vibe-row="query"]')!
    fireEvent.change(queryRow.querySelector('[data-vibe-row-name="1"]')!, { target: { value: 'q' } })
    fireEvent.change(queryRow.querySelector('[data-vibe-row-value="1"]')!, {
      target: { value: 'hello' },
    })

    section(container, 'headers')
    const headerRow = container.querySelector('[data-vibe-row="headers"]')!
    fireEvent.change(headerRow.querySelector('[data-vibe-row-name="1"]')!, {
      target: { value: 'x-trace' },
    })
    fireEvent.change(headerRow.querySelector('[data-vibe-row-value="1"]')!, {
      target: { value: 'abc' },
    })

    fireEvent.click(f.send)

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    const spec = send.mock.calls[0]![0] as HttpRequestSpec
    expect(spec).toEqual({
      method: 'POST',
      url: 'https://api.example.com/items',
      query: [{ name: 'q', value: 'hello' }],
      headers: [{ name: 'x-trace', value: 'abc' }],
    })
    await waitFor(() =>
      expect(container.querySelector('[data-vibe-response-status="1"]')?.textContent).toBe(
        'HTTP 200 OK',
      ),
    )
    expect(container.querySelector('[data-vibe-response-meta="1"]')?.textContent).toBe(
      '12 ms · 4 B',
    )
  })

  it('blocks a send until the URL is valid and points at the field', async () => {
    const send = vi.fn<ApiSend>(async () => outcome())
    const { container } = render(<RequestBuilder send={send} />)

    fireEvent.change(fields(container).url, { target: { value: 'example.com' } })
    fireEvent.click(fields(container).send)

    await waitFor(() =>
      expect(container.querySelector('[data-vibe-request-issues="1"]')?.textContent).toContain(
        'Use an absolute http:// or https:// URL.',
      ),
    )
    expect(send).not.toHaveBeenCalled()
  })

  it('shows a readable message for a send failure', async () => {
    const send = vi.fn<ApiSend>(async () => {
      throw new TransportError('timeout', 'request timed out')
    })
    const { container } = render(<RequestBuilder send={send} />)
    fireEvent.change(fields(container).url, { target: { value: 'https://api.example.com/' } })
    fireEvent.click(fields(container).send)

    await waitFor(() =>
      expect(container.querySelector('[data-vibe-request-error="1"]')?.textContent).toContain(
        'The request timed out.',
      ),
    )
  })

  it('cancels an in-flight request with the caller signal', async () => {
    let observed: AbortSignal | undefined
    const send: ApiSend = (_spec, options) =>
      new Promise((_resolve, reject) => {
        observed = options?.signal
        observed?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    const { container } = render(<RequestBuilder send={send} />)

    fireEvent.change(fields(container).url, { target: { value: 'https://api.example.com/slow' } })
    fireEvent.click(fields(container).send)

    await waitFor(() => expect(fields(container).cancel()).toBeTruthy())
    fireEvent.click(fields(container).cancel()!)

    await waitFor(() => expect(observed?.aborted).toBe(true))
    await waitFor(() =>
      expect(container.querySelector('[data-vibe-request-status="1"]')?.textContent).toContain(
        'Cancelled.',
      ),
    )
  })

  it('adds a picked file to a multipart body', async () => {
    const send = vi.fn<ApiSend>(async () => outcome())
    const { container } = render(<RequestBuilder send={send} />)
    fireEvent.change(fields(container).url, { target: { value: 'https://api.example.com/upload' } })

    section(container, 'body')
    fireEvent.change(container.querySelector('[data-vibe-body-kind="1"]')!, {
      target: { value: 'multipart' },
    })
    const fieldRow = container.querySelector('[data-vibe-rows="fields"] [data-vibe-row="fields"]')!
    fireEvent.change(fieldRow.querySelector('[data-vibe-row-name="1"]')!, {
      target: { value: 'note' },
    })
    fireEvent.change(fieldRow.querySelector('[data-vibe-row-value="1"]')!, {
      target: { value: 'hi' },
    })

    const fileInput = container.querySelector<HTMLInputElement>('[data-vibe-file-input="1"]')!
    const file = new File(['abc'], 'avatar.png', { type: 'image/png' })
    fireEvent.change(fileInput, { target: { files: [file] } })

    await waitFor(() => expect(container.querySelector('[data-vibe-file="1"]')).toBeTruthy())
    fireEvent.click(fields(container).send)

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    const spec = send.mock.calls[0]![0] as HttpRequestSpec
    expect(spec.body).toEqual({
      kind: 'multipart',
      fields: [{ name: 'note', value: 'hi' }],
      files: [{ field: 'avatar', fileName: 'avatar.png', contentType: 'image/png', base64: 'YWJj' }],
    })
  })

  it('renders the zh-CN labels', () => {
    const { container } = render(<RequestBuilder send={vi.fn<ApiSend>(async () => outcome())} locale="zh-CN" />)
    expect(screen.getByText('发送')).toBeTruthy()
    expect(screen.getByText('查询参数')).toBeTruthy()
    expect(fields(container).url.placeholder).toContain('https://')
  })
})
