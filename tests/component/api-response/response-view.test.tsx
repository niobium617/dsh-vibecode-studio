/**
 * T039 response viewer: status/time/size are readable, JSON is prettified
 * until it gets expensive, and a 10 MB body renders one page at a time instead
 * of freezing the panel.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  RESPONSE_PAGE_BYTES,
  ResponseView,
  buildBodyContent,
  formatResponseBytes,
} from '../../../src/client/api/ResponseView'
import type { HttpExecutionResult, HttpResponseBody } from '../../../src/contracts/api'

afterEach(() => {
  cleanup()
})

function result(
  overrides: Partial<HttpExecutionResult> = {},
  body: Partial<HttpResponseBody> = {},
): HttpExecutionResult {
  return {
    status: 200,
    statusText: 'OK',
    url: 'https://api.example.com/items',
    redirects: [],
    headers: { 'content-type': 'application/json' },
    elapsedMs: 12,
    body: {
      text: '{"hello":"world"}',
      base64: '',
      bytes: 17,
      truncated: false,
      contentType: 'application/json',
      ...body,
    },
    ...overrides,
  }
}

function query(container: HTMLElement, selector: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(selector)
}

describe('ResponseView', () => {
  it('shows status, time and size, and renders JSON as a tree by default', () => {
    const { container } = render(<ResponseView result={result()} />)

    expect(query(container, '[data-vibe-response-status="1"]')?.textContent).toBe('HTTP 200 OK')
    expect(query(container, '[data-vibe-response-meta="1"]')?.textContent).toBe('12 ms · 17 B')
    expect(query(container, '[data-vibe-json-tree="1"]')).toBeTruthy()
    expect(query(container, '[data-vibe-response-mode="tree"]')).toBeTruthy()
  })

  it('switches from the tree to the prettified text', () => {
    const { container } = render(<ResponseView result={result()} />)

    fireEvent.click(query(container, '[data-vibe-response-mode="pretty"]')!)
    expect(query(container, '[data-vibe-response-body="1"]')?.textContent).toBe(
      '{\n  "hello": "world"\n}',
    )
  })

  it('switches to raw and keeps the original text', () => {
    const { container } = render(<ResponseView result={result()} />)

    fireEvent.click(query(container, '[data-vibe-response-mode="raw"]')!)
    expect(query(container, '[data-vibe-response-body="1"]')?.textContent).toBe('{"hello":"world"}')
  })

  it('shows a 5xx error status and the truncated badge', () => {
    const { container } = render(
      <ResponseView
        result={result(
          { status: 500, statusText: 'Internal Server Error' },
          { text: 'boom', bytes: 4, contentType: 'text/plain', truncated: true },
        )}
      />,
    )

    expect(query(container, '[data-vibe-response-status="1"]')?.textContent).toBe(
      'HTTP 500 Internal Server Error',
    )
    expect(query(container, '[data-vibe-response-body="1"]')?.textContent).toBe('boom')
    expect(query(container, '[data-vibe-response-truncated="1"]')?.textContent).toContain(
      'Truncated',
    )
  })

  it('renders a 10 MB body one page at a time', () => {
    const big = 'a'.repeat(10 * 1024 * 1024)
    const { container } = render(
      <ResponseView result={result({}, { text: big, bytes: big.length, contentType: 'text/plain' })} />,
    )

    const body = query(container, '[data-vibe-response-body="1"]')!
    expect(body.textContent!.length).toBe(RESPONSE_PAGE_BYTES)
    expect(query(container, '[data-vibe-response-meta="1"]')?.textContent).toContain('10.0 MB')
    expect(query(container, '[data-vibe-response-page="1"]')?.textContent).toBe('Page 1 of 160')

    fireEvent.click(query(container, '[data-vibe-response-page-next="1"]')!)
    expect(query(container, '[data-vibe-response-page="1"]')?.textContent).toBe('Page 2 of 160')
    expect(query(container, '[data-vibe-response-body="1"]')?.textContent!.length).toBe(
      RESPONSE_PAGE_BYTES,
    )

    fireEvent.click(query(container, '[data-vibe-response-page-prev="1"]')!)
    expect(query(container, '[data-vibe-response-page="1"]')?.textContent).toBe('Page 1 of 160')
  })

  it('explains binary and empty bodies instead of rendering them', () => {
    const binary = render(
      <ResponseView result={result({}, { text: null, bytes: 2048, contentType: 'image/png' })} />,
    )
    expect(
      binary.container.querySelector('[data-vibe-response-binary="1"]')?.textContent,
    ).toContain('2.0 KB')
    cleanup()

    const empty = render(<ResponseView result={result({}, { text: '', bytes: 0 })} />)
    expect(
      empty.container.querySelector('[data-vibe-response-empty-body="1"]')?.textContent,
    ).toBe('The response has no body.')
  })

  it('shows response headers, including the redaction note', () => {
    const { container } = render(
      <ResponseView
        result={result({ headers: { 'content-type': 'application/json', 'x-request-id': 'abc' } })}
      />,
    )

    fireEvent.click(query(container, '[data-vibe-response-tab="headers"]')!)
    const rows = container.querySelectorAll('[data-vibe-response-header="1"]')
    expect(rows.length).toBe(2)
    expect(container.textContent).toContain('x-request-id')
    expect(container.textContent).toContain('Sensitive values are redacted')
  })

  it('keeps oversized JSON raw and says why', () => {
    const bigJson = JSON.stringify({ blob: 'a'.repeat(300 * 1024) })
    const { container } = render(
      <ResponseView result={result({}, { text: bigJson, bytes: bigJson.length })} />,
    )

    expect(query(container, '[data-vibe-response-json-too-large="1"]')?.textContent).toContain(
      'too large to format',
    )
    expect(query(container, '[data-vibe-response-mode="pretty"]')).toBeNull()
    expect(query(container, '[data-vibe-response-body="1"]')?.textContent!.length).toBe(
      RESPONSE_PAGE_BYTES,
    )
  })

  it('renders zh-CN labels', () => {
    render(<ResponseView result={result()} locale="zh-CN" />)
    expect(screen.getByText('响应体')).toBeTruthy()
    expect(screen.getByText('响应头 (1)')).toBeTruthy()
    expect(screen.getByText('美化')).toBeTruthy()
  })
})

describe('buildBodyContent and helpers', () => {
  it('detects JSON from the body when the content type lies', () => {
    const content = buildBodyContent(
      result({}, { text: '[1,2]', bytes: 5, contentType: 'text/plain' }),
    )
    expect(content.kind).toBe('text')
    if (content.kind !== 'text') return
    expect(content.pretty).toBe('[\n  1,\n  2\n]')
  })

  it('formats byte sizes', () => {
    expect(formatResponseBytes(512)).toBe('512 B')
    expect(formatResponseBytes(2048)).toBe('2.0 KB')
    expect(formatResponseBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
