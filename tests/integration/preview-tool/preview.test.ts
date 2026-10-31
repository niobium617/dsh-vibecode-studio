/**
 * T049 `vibe_preview`: the five actions against a fake preview service, with
 * the origin rules, the screenshot → artifact hand-off and the registered
 * definition (schema validation, stable error prefixes) exercised end to end.
 */
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ArtifactRef } from '../../../src/contracts/artifacts'
import type { PreviewSessionSnapshot } from '../../../src/contracts/transport'
import { createPreviewHandler, type PreviewToolConfig, type PreviewToolDeps } from '../../../src/host/agent/tools/preview'
import { createArtifactStore, type ArtifactStore } from '../../../src/host/artifacts/store'
import type { PreviewScreenshot } from '../../../src/host/preview/session'
import { createVibeToolDefinitions } from '../../../src/host/agent/tools/register'
import { studioError } from '../../../src/contracts/errors'
import { VIBE_TOOL_SPECS, validateToolArguments } from '../../../src/host/agent/tools/definitions'

const ORIGIN = 'http://127.0.0.1:4320'
const URL = `${ORIGIN}/`
const NEXT_URL = `${ORIGIN}/about`
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let tempRoot: string
let projectDir: string

beforeEach(async () => {
  const root = join(process.cwd(), '.tmp')
  await mkdir(root, { recursive: true })
  tempRoot = await mkdtemp(join(root, 'preview-tool-'))
  projectDir = join(tempRoot, 'project')
  await mkdir(projectDir)
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function readySession(url = URL): PreviewSessionSnapshot {
  return {
    status: 'ready',
    targetId: 'preview',
    kind: 'web',
    url,
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    capabilities: null,
    frame: null,
    fps: 15,
    quality: 60,
  }
}

function closedSession(): PreviewSessionSnapshot {
  return {
    status: 'idle',
    targetId: null,
    kind: null,
    url: null,
    viewport: null,
    capabilities: null,
    frame: null,
    fps: 15,
    quality: 60,
  }
}

const STUB_REF: ArtifactRef = {
  id: 'artifact-1',
  kind: 'screenshot',
  mimeType: 'image/png',
  bytes: PNG.byteLength,
  createdAt: '2026-10-30T10:00:00.000Z',
  expiresAt: '2026-11-06T10:00:00.000Z',
}

interface Options {
  readonly session?: PreviewSessionSnapshot
  readonly config?: Partial<PreviewToolConfig>
  readonly artifacts?: PreviewToolDeps['artifacts']
  readonly capture?: PreviewScreenshot
}

function harness(options: Options = {}) {
  const calls: string[] = []
  let current = options.session ?? readySession()
  // Mirrors `PreviewService.requireReady()`: page actions fail on a closed target.
  const requireReady = () => {
    if (current.status !== 'ready') {
      throw studioError('target_unavailable', 'vibe-studio: preview is not running')
    }
  }
  const saved: Array<{ bytes: Uint8Array; retentionDays: number; label?: string }> = []
  const config: PreviewToolConfig = {
    allowedOrigins: [ORIGIN, 'http://localhost:5173'],
    screenshotEnabled: true,
    retentionDays: 7,
    ...options.config,
  }
  const deps: PreviewToolDeps = {
    preview: {
      status: () => current,
      reload: async () => {
        requireReady()
        calls.push('reload')
        return current
      },
      navigate: async ({ url }) => {
        requireReady()
        calls.push(`navigate:${url}`)
        current = { ...current, url }
        return current
      },
      start: async (params) => {
        calls.push(`start:${params.url}`)
        current = readySession(params.url)
        return current
      },
      stop: async () => {
        calls.push('stop')
        current = closedSession()
        return current
      },
      captureScreenshot: async () => {
        requireReady()
        calls.push('capture')
        return options.capture ?? { bytes: PNG, width: 1280, height: 720 }
      },
    },
    artifacts:
      options.artifacts ??
      {
        saveScreenshot: async (bytes, saveOptions) => {
          saved.push({ bytes, retentionDays: saveOptions.retentionDays, ...(saveOptions.label === undefined ? {} : { label: saveOptions.label }) })
          return STUB_REF
        },
      },
    config: () => config,
  }
  return { handler: createPreviewHandler(deps), calls, saved, config }
}

describe('vibe_preview reload and navigate (T049)', () => {
  it('reloads the live page and reports the resulting state', async () => {
    const { handler, calls } = harness()
    const output = await handler({ action: 'reload' }, {})
    expect(calls).toEqual(['reload'])
    expect(output).toEqual({ action: 'reload', state: 'ready', url: URL, message: `Reloaded ${URL}.` })
  })

  it('navigates within the target origin', async () => {
    const { handler, calls } = harness()
    const output = await handler({ action: 'navigate', url: NEXT_URL }, {})
    expect(calls).toEqual([`navigate:${NEXT_URL}`])
    expect(output).toMatchObject({ action: 'navigate', state: 'ready', url: NEXT_URL })
    expect(output.message).toBe(`Navigated to ${NEXT_URL}.`)
  })

  it('refuses a URL outside the current origin, off loopback, or off the allow list', async () => {
    const { handler, calls } = harness()
    await expect(handler({ action: 'navigate', url: 'http://127.0.0.1:5173/' }, {})).rejects.toMatchObject({
      code: 'permission_denied',
      details: { origin: 'http://127.0.0.1:5173' },
    })
    await expect(handler({ action: 'navigate', url: 'http://example.com/' }, {})).rejects.toMatchObject({
      code: 'permission_denied',
      details: { host: 'example.com' },
    })
    await expect(handler({ action: 'navigate', url: 'file:///c:/secret.txt' }, {})).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'url' },
    })
    expect(calls).toEqual([])
  })

  it('rejects an origin that is missing from allowedOrigins', async () => {
    const { handler, calls } = harness({
      session: readySession('http://localhost:5173/'),
      config: { allowedOrigins: [ORIGIN] },
    })
    await expect(handler({ action: 'navigate', url: 'http://localhost:5173/x' }, {})).rejects.toMatchObject({
      code: 'permission_denied',
      details: { origin: 'http://localhost:5173' },
    })
    expect(calls).toEqual([])
  })

  it('validates the navigate arguments before touching the preview', async () => {
    const { handler, calls } = harness()
    await expect(handler({ action: 'navigate' }, {})).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'url' },
    })
    await expect(handler({ action: 'navigate', url: 'http://user:pw@127.0.0.1:4320/' }, {})).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'url' },
    })
    await expect(handler({ action: 'navigate', url: 'not a url' }, {})).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'url' },
    })
    await expect(handler({ action: 'reload', url: NEXT_URL }, {})).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'url' },
    })
    expect(calls).toEqual([])
  })

  it('reports a closed preview as target_unavailable', async () => {
    const { handler } = harness({ session: closedSession() })
    await expect(handler({ action: 'navigate', url: NEXT_URL }, {})).rejects.toMatchObject({
      code: 'target_unavailable',
    })
    await expect(handler({ action: 'reload' }, {})).rejects.toMatchObject({
      code: 'target_unavailable',
    })
  })
})

describe('vibe_preview start and stop (T049)', () => {
  it('starts a closed preview at an allowed loopback URL', async () => {
    const { handler, calls } = harness({ session: closedSession() })
    const output = await handler({ action: 'start', url: URL }, {})
    expect(calls).toEqual([`start:${URL}`])
    expect(output).toMatchObject({ action: 'start', state: 'ready', url: URL })
    expect(output.message).toBe(`Preview started at ${URL}.`)
  })

  it('does not silently move an already running preview', async () => {
    const { handler, calls } = harness()
    const output = await handler({ action: 'start', url: NEXT_URL }, {})
    expect(calls).toEqual([])
    expect(output.state).toBe('ready')
    expect(output.url).toBe(URL)
    expect(output.message).toContain('already running')
  })

  it('holds start to the same origin rules as navigate', async () => {
    const { handler, calls } = harness({ session: closedSession() })
    await expect(handler({ action: 'start' }, {})).rejects.toMatchObject({
      code: 'invalid_input',
      details: { field: 'url' },
    })
    await expect(handler({ action: 'start', url: 'http://10.0.0.5:3000/' }, {})).rejects.toMatchObject({
      code: 'permission_denied',
      details: { host: '10.0.0.5' },
    })
    await expect(handler({ action: 'start', url: 'http://localhost:9999/' }, {})).rejects.toMatchObject({
      code: 'permission_denied',
      details: { origin: 'http://localhost:9999' },
    })
    expect(calls).toEqual([])
  })

  it('stops the preview and reports the closed state', async () => {
    const { handler, calls } = harness()
    const output = await handler({ action: 'stop' }, {})
    expect(calls).toEqual(['stop'])
    expect(output).toEqual({ action: 'stop', state: 'closed', message: 'Preview stopped.' })
  })

  it('says so when stop runs on a closed preview', async () => {
    const { handler } = harness({ session: closedSession() })
    const output = await handler({ action: 'stop' }, {})
    expect(output.state).toBe('closed')
    expect(output.message).toBe('Preview was not running.')
  })

  it('rejects an unknown target id and accepts the preview id', async () => {
    const { handler, calls } = harness()
    await expect(handler({ action: 'reload', targetId: 'other' }, {})).rejects.toMatchObject({
      code: 'not_found',
      details: { field: 'targetId' },
    })
    await expect(handler({ action: 'reload', targetId: 'preview' }, {})).resolves.toMatchObject({
      action: 'reload',
    })
    const closed = harness({ session: closedSession() })
    expect(await closed.handler({ action: 'start', url: URL, targetId: 'preview' }, {})).toMatchObject({
      state: 'ready',
    })
    expect(calls).toEqual(['reload'])
  })
})

describe('vibe_preview screenshot (T049)', () => {
  it('stores the PNG and returns only its artifact id', async () => {
    const { handler, saved } = harness()
    const output = await handler({ action: 'screenshot' }, {})

    expect(saved).toEqual([{ bytes: PNG, retentionDays: 7, label: 'preview screenshot' }])
    expect(output).toMatchObject({
      action: 'screenshot',
      state: 'ready',
      url: URL,
      screenshot: { artifactId: 'artifact-1', width: 1280, height: 720, bytes: PNG.byteLength },
    })
    // FR-AGENT-09: no image payload of any kind in the tool result.
    const text = JSON.stringify(output)
    expect(text).not.toContain(Buffer.from(PNG).toString('base64'))
    expect(text.length).toBeLessThan(1024)
  })

  it('honours the live screenshot switch without capturing', async () => {
    const { handler, calls } = harness({ config: { screenshotEnabled: false } })
    await expect(handler({ action: 'screenshot' }, {})).rejects.toMatchObject({
      code: 'permission_denied',
    })
    expect(calls).toEqual([])
  })

  it('omits dimensions when the adapter does not report a viewport', async () => {
    const { handler } = harness({
      capture: { bytes: PNG, width: null, height: null },
    })
    const output = await handler({ action: 'screenshot' }, {})
    expect(output.screenshot).toEqual({ artifactId: 'artifact-1', bytes: PNG.byteLength })
  })

  it('writes a real artifact under .vibe/artifacts and reads it back', async () => {
    let store: ArtifactStore | undefined
    const handler = createPreviewHandler({
      preview: {
        status: () => readySession(),
        reload: async () => readySession(),
        navigate: async ({ url }) => readySession(url),
        start: async (params) => readySession(params.url),
        stop: async () => closedSession(),
        captureScreenshot: async () => ({ bytes: PNG, width: 1280, height: 720 }),
      },
      artifacts: {
        saveScreenshot: (bytes, saveOptions) => store!.saveScreenshot(bytes, saveOptions),
      },
      config: () => ({ allowedOrigins: [ORIGIN], screenshotEnabled: true, retentionDays: 3 }),
    })

    store = createArtifactStore(projectDir, { now: () => new Date('2026-10-30T10:00:00.000Z') })
    const output = await handler({ action: 'screenshot' }, {})
    const id = output.screenshot?.artifactId
    expect(id).toBeTruthy()
    if (!id) return

    const onDisk = await readFile(store.bytesPath(id))
    expect(new Uint8Array(onDisk)).toEqual(PNG)
    const read = await store.read(id)
    expect(read?.ref).toMatchObject({
      id,
      kind: 'screenshot',
      mimeType: 'image/png',
      bytes: PNG.byteLength,
      createdAt: '2026-10-30T10:00:00.000Z',
      expiresAt: '2026-11-02T10:00:00.000Z',
    })
  })
})

describe('vibe_preview through the registered definition (T049)', () => {
  const spec = VIBE_TOOL_SPECS.find((entry) => entry.name === 'vibe_preview')

  it('produces an output that matches the declared schema', async () => {
    expect(spec).toBeDefined()
    const { handler } = harness()
    const definitions = createVibeToolDefinitions({ vibe_preview: handler })
    const definition = definitions.find((entry) => entry.name === 'vibe_preview')
    expect(definition).toBeDefined()
    if (!definition || !spec) return

    const value = await definition.execute({ action: 'navigate', url: NEXT_URL }, {})
    expect(validateToolArguments(spec.outputSchema, value)).toEqual([])
    const rendered = definition.output.render({}, value)
    expect(JSON.parse(rendered[0].text)).toMatchObject({ action: 'navigate', state: 'ready' })
  })

  it('rejects a malformed action and a permission failure with stable prefixes', async () => {
    const { handler } = harness()
    const definitions = createVibeToolDefinitions({ vibe_preview: handler })
    const definition = definitions.find((entry) => entry.name === 'vibe_preview')
    if (!definition) throw new Error('vibe_preview missing')

    await expect(definition.execute({ action: 'open' }, {})).rejects.toMatchObject({
      code: 'invalid_input',
    })
    await expect(
      definition.execute({ action: 'navigate', url: 'http://example.com/' }, {}),
    ).rejects.toMatchObject({
      code: 'permission_denied',
      message: expect.stringContaining('permission_denied: vibe-studio:'),
    })
  })
})
