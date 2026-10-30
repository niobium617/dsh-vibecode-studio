/**
 * FR-API-07 panel: a pasted command fills the builder without sending, an
 * invalid command explains itself instead of partially applying, and the
 * current draft exports with placeholders still intact.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { CurlPanel } from '../../../src/client/api/CurlPanel'
import { RequestBuilder, type ApiSend, type ApiSendOutcome } from '../../../src/client/api/RequestBuilder'
import { draftFromRequestSpec, type RequestDraft } from '../../../src/client/api/request-model'
import type { HttpRequestSpec } from '../../../src/contracts/api'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function outcome(): ApiSendOutcome {
  return {
    result: {
      status: 200,
      statusText: 'OK',
      url: 'https://api.example.com/items',
      redirects: [],
      headers: {},
      elapsedMs: 5,
      body: { text: 'ok', base64: '', bytes: 2, truncated: false, contentType: 'text/plain' },
    },
    unresolved: [],
  }
}

function openPanel(container: HTMLElement): void {
  fireEvent.click(container.querySelector('[data-vibe-curl-toggle="1"]')!)
}

function paste(container: HTMLElement, text: string): void {
  fireEvent.change(container.querySelector('[data-vibe-curl-input="1"]')!, {
    target: { value: text },
  })
}

function output(container: HTMLElement): HTMLTextAreaElement {
  return container.querySelector<HTMLTextAreaElement>('[data-vibe-curl-output="1"]')!
}

describe('CurlPanel', () => {
  it('exports the current request and shows multipart files as losses', () => {
    const draft: RequestDraft = draftFromRequestSpec({
      method: 'POST',
      url: 'https://api.example.com/upload',
      auth: { kind: 'bearer', token: '{{token}}' },
      body: {
        kind: 'multipart',
        fields: [{ name: 'note', value: 'hi' }],
        files: [{ field: 'file', fileName: 'a.txt', base64: 'aGk=' }],
      },
    })
    const { container } = render(<CurlPanel draft={draft} onImport={() => {}} />)
    openPanel(container)

    expect(output(container).value).toContain('Authorization: Bearer {{token}}')
    expect(output(container).value).toContain('-F file=@a.txt')
    expect(container.querySelector('[data-vibe-curl-losses="1"]')?.textContent).toContain(
      'Attached files are not included',
    )
  })

  it('says so instead of exporting an incomplete request', () => {
    const { container } = render(<CurlPanel draft={draftFromRequestSpec({ method: 'GET', url: '' })} onImport={() => {}} />)
    openPanel(container)

    expect(output(container).value).toBe('')
    expect(output(container).placeholder).toContain('Complete the request')
    expect(
      container.querySelector<HTMLButtonElement>('[data-vibe-curl-copy="1"]')!.disabled,
    ).toBe(true)
  })

  it('copies the command and reports the result', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const { container } = render(
      <CurlPanel draft={draftFromRequestSpec({ method: 'GET', url: 'https://api.example.com/' })} onImport={() => {}} />,
    )
    openPanel(container)
    fireEvent.click(container.querySelector('[data-vibe-curl-copy="1"]')!)

    await waitFor(() =>
      expect(container.querySelector('[data-vibe-curl-copy-status="1"]')?.textContent).toBe(
        'Copied.',
      ),
    )
    expect(writeText).toHaveBeenCalledWith('curl https://api.example.com/')
  })

  it('explains a command it cannot read and imports nothing', () => {
    const onImport = vi.fn()
    const { container } = render(
      <CurlPanel draft={draftFromRequestSpec({ method: 'GET', url: '' })} onImport={onImport} />,
    )
    openPanel(container)
    paste(container, 'curl --nope https://x.test/')
    fireEvent.click(container.querySelector('[data-vibe-curl-import="1"]')!)

    expect(container.querySelector('[data-vibe-curl-issue="1"]')?.textContent).toContain('--nope')
    expect(onImport).not.toHaveBeenCalled()
  })

  it('fills the builder, keeps placeholders literal and sends nothing on import', async () => {
    const send = vi.fn<ApiSend>(async () => outcome())
    const { container } = render(<RequestBuilder send={send} />)
    openPanel(container)
    paste(
      container,
      "curl -X POST 'https://api.example.com/items' -H 'x-token: {{token}}' --data-raw '{\"name\":\"x\"}'",
    )
    fireEvent.click(container.querySelector('[data-vibe-curl-import="1"]')!)

    const url = container.querySelector<HTMLInputElement>('[data-vibe-request-url="1"]')!
    await waitFor(() => expect(url.value).toBe('https://api.example.com/items'))
    expect(container.querySelector('[data-vibe-load-notice="1"]')?.textContent).toContain(
      'Loaded a cURL command',
    )
    expect(send).not.toHaveBeenCalled()

    fireEvent.click(container.querySelector('[data-vibe-send="1"]')!)
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    const spec = send.mock.calls[0]![0] as HttpRequestSpec
    expect(spec).toMatchObject({
      method: 'POST',
      url: 'https://api.example.com/items',
      headers: [{ name: 'x-token', value: '{{token}}' }],
      body: { kind: 'json', text: '{"name":"x"}' },
    })
  })

  it('renders the zh-CN labels', () => {
    const { container } = render(
      <CurlPanel
        draft={draftFromRequestSpec({ method: 'GET', url: '' })}
        onImport={() => {}}
        locale="zh-CN"
      />,
    )
    openPanel(container)
    expect(container.querySelector('[data-vibe-curl-panel="1"]')?.textContent).toContain(
      '导入或导出 cURL 命令',
    )
  })
})
