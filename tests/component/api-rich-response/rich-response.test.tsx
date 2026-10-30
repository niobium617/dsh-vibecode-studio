/**
 * T040 rich response bodies: collapsible JSON tree with node/depth caps,
 * sandboxed HTML preview, image data URIs and binary download. Response bodies
 * are untrusted, so every value must land as text and the preview must stay
 * inert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  HtmlPreview,
  HTML_PREVIEW_CSP,
} from '../../../src/client/api/HtmlPreview'
import {
  ImagePreview,
  imageDataUri,
  isImageContentType,
} from '../../../src/client/api/ImagePreview'
import {
  JSON_TREE_INITIAL_DEPTH,
  JsonTree,
  buildJsonTree,
} from '../../../src/client/api/JsonTree'
import {
  downloadResponseBody,
  responseFileExtension,
  ResponseView,
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
    headers: {},
    elapsedMs: 12,
    body: {
      text: '{}',
      base64: '',
      bytes: 2,
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

describe('buildJsonTree', () => {
  it('caps the node budget and reports the truncation', () => {
    const model = buildJsonTree(
      { items: Array.from({ length: 50 }, (_, index) => index) },
      { maxNodes: 10 },
    )

    expect(model.nodes).toBe(10)
    expect(model.truncated).toBe(true)
    expect(model.depthLimited).toBe(false)
    expect(model.root.kind).toBe('object')
  })

  it('stops at the depth cap and flags it', () => {
    const model = buildJsonTree({ a: { b: { c: 1 } } }, { maxDepth: 1 })

    expect(model.depthLimited).toBe(true)
    const root = model.root
    if (root.kind !== 'object') throw new Error('expected object root')
    const a = root.children[0]!.node
    if (a.kind !== 'object') throw new Error('expected object child')
    expect(a.deep).toBe(true)
    expect(a.children).toHaveLength(0)
    expect(a.omitted).toBe(1)
  })
})

describe('JsonTree', () => {
  it('collapses below the initial depth and toggles open', () => {
    const { container } = render(<JsonTree text='{"a":{"b":{"c":1}}}' />)

    expect(container.textContent).not.toContain('c:1')
    const toggles = container.querySelectorAll('[data-vibe-json-toggle="1"]')
    // root, then `a`, then the collapsed `b`
    expect(toggles).toHaveLength(JSON_TREE_INITIAL_DEPTH + 1)
    const inner = toggles[toggles.length - 1]!
    expect(inner.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(inner)
    expect(inner.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('c:1')
  })

  it('renders JSON strings as text, never as markup', () => {
    const payload = JSON.stringify({ v: '<img src=x onerror="window.__xss=1">' })
    const { container } = render(<JsonTree text={payload} />)

    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x')
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
  })

  it('reports node and depth limits, and invalid JSON', () => {
    const big = JSON.stringify(Array.from({ length: 4000 }, (_, index) => index))
    const bigTree = render(<JsonTree text={big} />)
    expect(query(bigTree.container, '[data-vibe-json-truncated="1"]')).toBeTruthy()
    cleanup()

    const depthTree = render(<JsonTree text='{"a":{"b":{"c":1}}}' maxDepth={1} />)
    expect(query(depthTree.container, '[data-vibe-json-depth="1"]')).toBeTruthy()
    cleanup()

    const invalid = render(<JsonTree text="{oops" />)
    expect(query(invalid.container, '[data-vibe-json-invalid="1"]')?.textContent).toContain(
      'not valid JSON',
    )
  })

  it('uses zh-CN text for the limit notes', () => {
    const { container } = render(<JsonTree text="{oops" locale="zh-CN" />)
    expect(container.textContent).toContain('不是有效 JSON')
  })
})

describe('HtmlPreview', () => {
  it('renders untrusted HTML in an inert sandboxed frame', () => {
    const html = '<h1>Hi</h1><script>window.__xss = 1</script>'
    const { container } = render(<HtmlPreview html={html} />)

    const frame = query(container, '[data-vibe-html-frame="1"]') as HTMLIFrameElement | null
    expect(frame).toBeTruthy()
    expect(frame!.getAttribute('sandbox')).toBe('')
    expect(frame!.getAttribute('csp')).toBe(HTML_PREVIEW_CSP)
    expect(frame!.getAttribute('srcdoc')).toContain('<h1>Hi</h1>')
    expect(query(container, '[data-vibe-html-note="1"]')?.textContent).toContain('disabled')
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()
    // The markup stays inside `srcDoc`; the panel document gains no script.
    expect(document.querySelectorAll('script')).toHaveLength(0)
  })
})

describe('ImagePreview', () => {
  it('turns an image body into a data URI and renders it', () => {
    const image = result({}, { text: null, base64: 'AQID', bytes: 3, contentType: 'image/png' })

    expect(isImageContentType('image/PNG; charset=binary')).toBe(true)
    expect(isImageContentType('application/pdf')).toBe(false)
    expect(imageDataUri(image)).toBe('data:image/png;base64,AQID')

    const { container } = render(<ImagePreview result={image} />)
    const img = query(container, '[data-vibe-response-image-src="1"]') as HTMLImageElement | null
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AQID')
    expect(img?.getAttribute('alt')).toBe('Response image preview')
  })

  it('declines types outside the allowlist', () => {
    const pdf = result({}, { text: null, base64: 'AQID', bytes: 3, contentType: 'application/pdf' })
    const { container } = render(<ImagePreview result={pdf} locale="zh-CN" />)

    expect(query(container, '[data-vibe-response-image-src="1"]')).toBeNull()
    expect(query(container, '[data-vibe-response-image-unsupported="1"]')?.textContent).toBe(
      '该图片类型无法内联渲染。',
    )
  })
})

describe('downloadResponseBody', () => {
  const created: Blob[] = []
  let clicked: { download: string; href: string } | null = null
  const createObjectURL = vi.fn((blob: Blob) => {
    created.push(blob)
    return 'blob:mock'
  })
  const revokeObjectURL = vi.fn()
  let clickSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    created.length = 0
    clicked = null
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked = { download: this.download, href: this.href }
      })
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
  })

  afterEach(() => {
    clickSpy.mockRestore()
    vi.useRealTimers()
  })

  it('maps known content types to file extensions', () => {
    expect(responseFileExtension('application/json')).toBe('.json')
    expect(responseFileExtension('image/png; charset=binary')).toBe('.png')
    expect(responseFileExtension('application/octet-stream')).toBe('.bin')
    expect(responseFileExtension(undefined)).toBe('.bin')
  })

  it('downloads the exact bytes through an object URL', () => {
    vi.useFakeTimers()
    downloadResponseBody(
      { text: null, base64: 'AQID', bytes: 3, truncated: false, contentType: 'image/png' },
      'avatar',
    )

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(created[0]!.type).toBe('image/png')
    expect(created[0]!.size).toBe(3)
    expect(clicked).toEqual({ download: 'avatar.png', href: 'blob:mock' })
    // The anchor must not leak into the document after the click.
    expect(document.querySelectorAll('a')).toHaveLength(0)

    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('does nothing for an empty body', () => {
    downloadResponseBody({ text: '', base64: '', bytes: 0, truncated: false, contentType: null })
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})

describe('ResponseView rich bodies', () => {
  it('previews HTML in the sandbox by default and keeps raw text available', () => {
    const html = '<h1>Hi</h1><script>window.__xss = 1</script>'
    const { container } = render(
      <ResponseView
        result={result({}, { text: html, bytes: html.length, contentType: 'text/html' })}
      />,
    )

    expect(query(container, '[data-vibe-response-mode="html"]')).toBeTruthy()
    const frame = query(container, '[data-vibe-html-frame="1"]')
    expect(frame?.getAttribute('sandbox')).toBe('')
    expect(container.textContent).not.toContain('<h1>Hi</h1>')
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined()

    fireEvent.click(query(container, '[data-vibe-response-mode="raw"]')!)
    expect(query(container, '[data-vibe-html-frame="1"]')).toBeNull()
    expect(query(container, '[data-vibe-response-body="1"]')?.textContent).toBe(html)
  })

  it('renders image responses inline', () => {
    const { container } = render(
      <ResponseView
        result={result({}, { text: null, base64: 'AQID', bytes: 3, contentType: 'image/png' })}
      />,
    )

    const img = query(container, '[data-vibe-response-image-src="1"]') as HTMLImageElement | null
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,AQID')
    expect(query(container, '[data-vibe-response-binary-note="1"]')).toBeNull()
  })

  it('offers a download for binary types it cannot preview', () => {
    const { container } = render(
      <ResponseView
        result={result({}, { text: null, base64: 'AQID', bytes: 3, contentType: 'application/pdf' })}
      />,
    )

    expect(query(container, '[data-vibe-response-binary-note="1"]')?.textContent).toContain('3 B')
    expect(query(container, '[data-vibe-response-download="1"]')?.textContent).toBe('Download')
  })

  it('falls back to the note when a truncated image cannot be trusted', () => {
    const { container } = render(
      <ResponseView
        result={result(
          {},
          { text: null, base64: 'AQID', bytes: 9000, truncated: true, contentType: 'image/png' },
        )}
      />,
    )

    expect(query(container, '[data-vibe-response-image-src="1"]')).toBeNull()
    expect(query(container, '[data-vibe-response-binary-note="1"]')).toBeTruthy()
    expect(query(container, '[data-vibe-response-download="1"]')).toBeTruthy()
  })

  it('switches back to the tree from pretty mode', () => {
    const { container } = render(<ResponseView result={result({}, { text: '{"a":1}', bytes: 7 })} />)

    fireEvent.click(query(container, '[data-vibe-response-mode="pretty"]')!)
    expect(query(container, '[data-vibe-json-tree="1"]')).toBeNull()
    fireEvent.click(query(container, '[data-vibe-response-mode="tree"]')!)
    expect(query(container, '[data-vibe-json-tree="1"]')).toBeTruthy()
    expect(screen.getByText('a')).toBeTruthy()
  })
})
