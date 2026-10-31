// @vitest-environment jsdom
/**
 * T059 prompt-injection audit (SPEC §9 "page content is untrusted data").
 *
 * The fixture is a hostile page; the real extractors run over it under jsdom
 * (they are the same self-contained functions serialized into a live page).
 * Every path that carries page content to the model must keep it inside one
 * untrusted-content wrapper, and no page text may close that wrapper early.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  collectDomOutline,
  parseDomOutlineResult,
  type DomSnapshot,
} from '../../src/host/preview/dom'
import {
  extractDomContext,
  normalizeElementText,
} from '../../src/host/inspect/dom'
import {
  renderAnnotationText,
  wrapUntrustedPageContent,
} from '../../src/contracts'
import { asTargetId, type Annotation, type ElementContext } from '../../src/contracts'

// Under the jsdom environment `import.meta.url` is an http URL, so the fixture
// is resolved from the repository root (vitest runs with cwd = repo root).
const FIXTURE = resolve('fixtures/security-injection/index.html')

const CLOSING = /<\/untrusted-page-content>/g

function closingTags(value: string): number {
  return value.match(CLOSING)?.length ?? 0
}

function fixtureBody(): string {
  const parsed = new DOMParser().parseFromString(readFileSync(FIXTURE, 'utf8'), 'text/html')
  return parsed.body.innerHTML
}

function outlineOf(): DomSnapshot {
  const result = collectDomOutline({
    selector: null,
    maxNodes: 400,
    maxDepth: 14,
    maxTextChars: 80,
    maxBytes: 4096,
  })
  const parsed = parseDomOutlineResult(result)
  if (parsed.kind !== 'ok') throw new Error(`unexpected outline result: ${parsed.kind}`)
  return parsed.snapshot
}

function elementContextOf(selector: string): ElementContext {
  const element = document.querySelector(selector)
  if (!element) throw new Error(`fixture is missing ${selector}`)
  const context = extractDomContext(element)
  return {
    selector,
    unique: true,
    tag: element.tagName.toLowerCase(),
    id: element.id || null,
    classes: Array.from(element.classList),
    role: null,
    name: '',
    text: context.text,
    html: context.html,
    visible: context.visible,
    box: { x: 0, y: 0, width: 10, height: 10 },
    source: null,
  }
}

beforeEach(() => {
  document.body.innerHTML = fixtureBody()
})

describe('DOM outline extraction', () => {
  it('captures visible hostile text but skips hidden, aria-hidden and script content', () => {
    const outline = outlineOf().outline

    expect(outline).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS')
    expect(outline).toContain('vibe_preview')
    expect(outline).not.toContain('Hidden instruction')
    expect(outline).not.toContain('ARIA-hidden instruction')
    expect(outline).not.toContain('Script text must never reach')
    expect(outline).not.toContain('window.__injected')
  })

  it('cannot be closed early by page text, including spaced and uppercase forms', () => {
    const wrapped = wrapUntrustedPageContent(outlineOf().outline)
    const inner = wrapped.slice(wrapped.indexOf('>') + 1, wrapped.lastIndexOf('</'))

    expect(closingTags(wrapped)).toBe(1)
    expect(wrapped.startsWith('<untrusted-page-content>')).toBe(true)
    expect(wrapped.endsWith('</untrusted-page-content>')).toBe(true)
    // Everything the page supplied is now inert text, not a tag.
    expect(inner).not.toMatch(/<\s*\/?\s*untrusted-page-content/i)
    // The page's own closing tags survive as escaped text in the outline.
    expect(inner).toContain('&lt;/')
  })

  it('keeps the untrusted notice separate from the content', () => {
    // The notice is host prose; the wrapper only carries page data.
    const wrapped = wrapUntrustedPageContent('hello')
    expect(wrapped).toBe('<untrusted-page-content>\nhello\n</untrusted-page-content>')
  })
})

describe('element extraction', () => {
  it('extracts visible text and strips script content', () => {
    const context = elementContextOf('main#app')

    expect(context.text).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS')
    expect(context.html).not.toContain('<script')
    expect(context.html).not.toContain('window.__injected')
  })

  it('wraps an annotated element so page text cannot break the boundary', () => {
    const annotation: Annotation = {
      id: 'ann-injection',
      targetId: asTargetId('web-local'),
      createdAt: '2026-10-31T00:00:00.000Z',
      source: 'element',
      comment: 'Make the heading smaller.',
      element: elementContextOf('p.breakout'),
    }
    const rendered = renderAnnotationText(annotation)
    const wrappedStart = rendered.indexOf('<untrusted-page-content')
    const wrapped = rendered.slice(wrappedStart)
    // Skip the host's own opening/closing tags; only page-supplied text is judged.
    const inner = wrapped.slice(wrapped.indexOf('>') + 1, wrapped.lastIndexOf('</'))

    expect(closingTags(wrapped)).toBe(1)
    expect(rendered.indexOf('Make the heading smaller.')).toBeLessThan(wrappedStart)
    expect(inner).toContain('&lt;/untrusted-page-content')
    expect(inner).not.toMatch(/<\s*\/?\s*untrusted-page-content\s*>/i)
  })
})

describe('normalization caps', () => {
  it('strips control characters from page text', () => {
    // Controls become spaces (not deletions) so adjacent words stay separated,
    // and the whitespace collapse then yields single spaces.
    expect(normalizeElementText('a\u0000b\u001fc')).toBe('a b c')
  })
})
