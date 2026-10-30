/**
 * T048 DOM read path: `PreviewService.domSnapshot` drives one bounded
 * `Runtime.evaluate` in the live page and re-normalizes whatever comes back.
 * The page is untrusted, so every malformed answer must fail with a stable
 * code instead of an empty outline.
 */
import { describe, expect, it } from 'vitest'
import { utf8Bytes } from '../../../src/contracts/budget'
import {
  buildDomOutlineExpression,
  DOM_OUTLINE_MAX_BYTES,
  isDomSnapshotParams,
  parseDomOutlineResult,
} from '../../../src/host/preview/dom'
import { createPreviewService, type PreviewServiceOptions } from '../../../src/host/preview/route'
import type { ScreencastSource } from '../../../src/host/preview/screencast'
import { createTargetAdapterRegistry } from '../../../src/host/targets/registry'
import { createFakeAdapter } from '../../helpers/fake-adapter'

const URL = 'http://127.0.0.1:4320/'

function source(): ScreencastSource {
  return {
    async start() {},
    async stop() {},
    get active() {
      return false
    },
    fps: 15,
    quality: 60,
    stats: () => ({
      received: 0,
      published: 0,
      dropped: 0,
      rejected: 0,
      lastFrameAt: null,
    }),
  }
}

function harness(evaluateResult?: unknown) {
  const registry = createTargetAdapterRegistry()
  const adapter = createFakeAdapter({ evaluateResult })
  registry.register(adapter)
  const options: PreviewServiceOptions = {
    targets: registry,
    createSource: () => source(),
    createInput: () => ({
      dispatch: async () => ({ ts: 1, viewport: { width: 1280, height: 720 } }),
      async stop() {},
      get active() {
        return false
      },
    }),
    createConsole: () => ({
      async start() {},
      async stop() {},
      snapshot: () => ({ entries: [], lastSeq: 0, dropped: 0 }),
      clear: () => ({ cleared: 0, lastSeq: 0 }),
      stats: () => ({
        received: 0,
        stored: 0,
        dropped: 0,
        rejected: 0,
        lastSeq: 0,
        lastAt: null,
      }),
      get active() {
        return false
      },
    }),
    createNetwork: () => ({
      async start() {},
      async stop() {},
      snapshot: () => ({ entries: [], lastSeq: 0, dropped: 0 }),
      clear: () => ({ cleared: 0, lastSeq: 0 }),
      body: async () => ({
        id: 'none',
        status: null,
        mimeType: null,
        body: '',
        base64Encoded: false,
        truncated: false,
        bytes: 0,
      }),
      stats: () => ({
        received: 0,
        stored: 0,
        dropped: 0,
        rejected: 0,
        lastSeq: 0,
        lastAt: null,
      }),
      get active() {
        return false
      },
    }),
    createPicker: () => ({
      async install() {},
      async activate() {},
      async deactivate() {},
      reset() {},
      snapshot: () => ({ active: false, seq: 0, pick: null, ts: null }),
      async dispose() {},
      get active() {
        return false
      },
    }),
  }
  return { service: createPreviewService(options) }
}

const OUTLINE = 'body\n  main#app\n    h1 "Hello"'

describe('preview service domSnapshot (T048)', () => {
  it('reads one bounded outline from the live page', async () => {
    const { service } = harness({
      found: true,
      invalidSelector: false,
      nodeCount: 3,
      outline: OUTLINE,
      truncated: false,
    })
    await service.start({ url: URL })

    const snapshot = await service.domSnapshot()
    expect(snapshot).toEqual({
      selector: null,
      nodeCount: 3,
      outline: OUTLINE,
      truncated: false,
    })
    await service.stop()
  })

  it('refuses to read while the preview is closed', async () => {
    const { service } = harness()
    await expect(service.domSnapshot()).rejects.toMatchObject({ code: 'target_unavailable' })
  })

  it('rejects bad params and a bad selector as invalid_input', async () => {
    const { service } = harness({ found: false, invalidSelector: true })
    await service.start({ url: URL })
    await expect(service.domSnapshot({ selector: 42 } as never)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(service.domSnapshot({ selector: 'div[' })).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'selector' },
    })
    await service.stop()
  })

  it('reports a selector that matches nothing as not_found', async () => {
    const { service } = harness({ found: false, invalidSelector: false })
    await service.start({ url: URL })
    await expect(service.domSnapshot({ selector: '#missing' })).rejects.toMatchObject({
      code: 'not_found',
    })
    await service.stop()
  })

  it('fails with preview_failed when the page answers with junk', async () => {
    const { service } = harness('not an object')
    await service.start({ url: URL })
    await expect(service.domSnapshot()).rejects.toMatchObject({ code: 'preview_failed' })
    await service.stop()
  })

  it('clamps a hostile oversized answer to the byte cap', () => {
    const parsed = parseDomOutlineResult(
      { found: true, nodeCount: 999_999, outline: 'é'.repeat(4000), truncated: false },
      { maxBytes: 1024 },
    )
    expect(parsed.kind).toBe('ok')
    if (parsed.kind !== 'ok') return
    expect(utf8Bytes(parsed.snapshot.outline)).toBeLessThanOrEqual(1024)
    expect(parsed.snapshot.truncated).toBe(true)
    expect(parsed.snapshot.nodeCount).toBeLessThanOrEqual(400)
  })
})

describe('dom outline expression (T048)', () => {
  it('embeds the selector as a JSON literal and caps the page work', () => {
    const selector = 'div[data-q="a\\"b"]'
    const expression = buildDomOutlineExpression({ selector, maxBytes: 2048 })
    expect(expression).toContain('collectDomOutline')
    expect(expression).toContain(JSON.stringify(selector))
    expect(expression).toContain('"maxNodes":400')
    expect(expression).toContain('"maxBytes":2048')
  })

  it('accepts only string selectors and sane byte caps', () => {
    expect(isDomSnapshotParams({})).toBe(true)
    expect(isDomSnapshotParams({ selector: '#app' })).toBe(true)
    expect(isDomSnapshotParams({ selector: '' })).toBe(false)
    expect(isDomSnapshotParams({ selector: 'div\n' })).toBe(false)
    expect(isDomSnapshotParams({ selector: 7 })).toBe(false)
    expect(isDomSnapshotParams({ extra: true })).toBe(false)
    expect(isDomSnapshotParams({ maxBytes: DOM_OUTLINE_MAX_BYTES + 1 })).toBe(false)
    expect(isDomSnapshotParams({ maxBytes: 100 })).toBe(false)
  })

  it('strips control characters from a page-supplied outline', () => {
    const parsed = parseDomOutlineResult({
      found: true,
      nodeCount: 1,
      outline: 'body\u0000\n  main\u001b',
      truncated: false,
    })
    expect(parsed).toEqual({
      kind: 'ok',
      snapshot: { selector: null, nodeCount: 1, outline: 'body\n  main', truncated: false },
    })
    expect(buildDomOutlineExpression()).toContain('collectDomOutline')
  })
})
