/**
 * T052 `Vibe Studio` preset: the four Vibe tools register into the preset's own
 * tool layer (a fake registry stands in for `ctx.tools`), the T049 approval gate
 * rides along as a `tools/pre-execute` listener, and the shipped patch/package
 * wiring points at the rows this file asserts.
 *
 * What this cannot prove is the real Cordis mount (it needs an agent scope and
 * the host tree); `dsh --profile vibe-dev --dump-config` is the live evidence
 * that the composed tree still resolves, and the preset picker is the manual
 * check in `tasks/todo.md`.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Annotation } from '../../../src/contracts/annotation'
import type { ArtifactRef } from '../../../src/contracts/artifacts'
import type {
  PreviewConsoleSnapshot,
  PreviewNetworkSnapshot,
  PreviewSessionSnapshot,
} from '../../../src/contracts/transport'
import {
  apply,
  createVibeToolHandlers,
  previewToolConfig,
  VIBE_PRESET_ID,
  VIBE_PRESET_NAME,
  VIBE_PRESET_PATCH_ROW_ID,
  VIBE_TOOLS_PLUGIN_ID,
  VIBE_TOOLS_PLUGIN_NAME,
  type VibeAgentContext,
  type VibeAgentStudio,
  type VibeToolPreviewSource,
} from '../../../src/host/agent/preset'
import { VIBE_TOOL_NAMES } from '../../../src/host/agent/tools/definitions'
import type { VibeToolDefinition } from '../../../src/host/agent/tools/register'
import { Config, resolveConfig, type VibeStudioConfig } from '../../../src/host/config'

const READY: PreviewSessionSnapshot = {
  status: 'ready',
  targetId: 'fixture',
  kind: 'web',
  url: 'http://127.0.0.1:4320/',
  viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  capabilities: null,
  frame: null,
  fps: 15,
  quality: 60,
}

const EMPTY_CONSOLE: PreviewConsoleSnapshot = { entries: [], lastSeq: 0, dropped: 0 }
const EMPTY_NETWORK: PreviewNetworkSnapshot = { entries: [], lastSeq: 0, dropped: 0 }

const ANNOTATION: Annotation = {
  id: 'a1',
  targetId: 'fixture' as Annotation['targetId'],
  createdAt: '2026-10-30T10:00:00.000Z',
  source: 'manual',
  comment: 'Make this button bigger',
}

function previewStub(overrides: Partial<VibeToolPreviewSource> = {}): VibeToolPreviewSource {
  const screenshot = { bytes: new Uint8Array([1, 2, 3]), width: 640, height: 360 }
  return {
    status: () => READY,
    consoleList: () => EMPTY_CONSOLE,
    networkList: () => EMPTY_NETWORK,
    domSnapshot: async () => ({ selector: null, nodeCount: 0, outline: '', truncated: false }),
    reload: async () => READY,
    navigate: async () => READY,
    start: async () => READY,
    stop: async () => ({ ...READY, status: 'idle', targetId: null, kind: null, url: null }),
    captureScreenshot: async () => screenshot,
    ...overrides,
  } as VibeToolPreviewSource
}

interface StudioOptions {
  readonly config?: Partial<VibeStudioConfig>
  readonly preview?: VibeToolPreviewSource
  readonly saved?: number
  readonly screenshotRef?: ArtifactRef
}

function studioHarness(options: StudioOptions = {}) {
  const config = resolveConfig(Config(options.config ?? {}))
  const artifacts = {
    saveScreenshot: vi.fn(
      async (
        _bytes: Uint8Array,
        _options: { retentionDays: number; label?: string },
      ): Promise<ArtifactRef> =>
        options.screenshotRef ?? {
          id: 'shot-1',
          kind: 'screenshot',
          mimeType: 'image/png',
          bytes: 3,
          createdAt: '2026-10-30T10:00:00.000Z',
        },
    ),
  }
  const annotationHistory = {
    list: vi.fn(async () => ({ entries: [], total: options.saved ?? 0, skipped: 0 })),
    get: vi.fn(async () => ANNOTATION),
  }
  const preview = options.preview ?? previewStub()
  const studio: VibeAgentStudio = { config, preview, annotationHistory, artifacts }
  return { studio, config, preview, annotationHistory, artifacts }
}

/** Captures what `registerVibeTools` hands to `ctx.tools.register`. */
function registryHarness() {
  const definitions = new Map<string, VibeToolDefinition>()
  const disposers = new Map<string, ReturnType<typeof vi.fn>>()
  return {
    registry: {
      register(definition: VibeToolDefinition) {
        definitions.set(definition.name, definition)
        const dispose = vi.fn()
        disposers.set(definition.name, dispose)
        return dispose
      },
    },
    definitions,
    disposers,
    async run(name: string, args: Record<string, unknown> = {}) {
      const definition = definitions.get(name)
      if (!definition) throw new Error(`tool ${name} was not registered`)
      return (await definition.execute(args, {})) as Record<string, unknown>
    },
  }
}

describe('Vibe Studio preset handlers (T052)', () => {
  it('binds one handler per vibe tool name', () => {
    const { studio } = studioHarness()
    expect(Object.keys(createVibeToolHandlers(studio)).sort()).toEqual([...VIBE_TOOL_NAMES].sort())
  })

  it('reads live config for origins, screenshots and retention', () => {
    const { config } = studioHarness()
    expect(previewToolConfig(config)).toEqual({
      allowedOrigins: config.allowedOrigins,
      screenshotEnabled: config.screenshotEnabled,
      retentionDays: config.retentionDays,
    })
    // The settings service mutates the same object in place.
    config.retentionDays = 30
    expect(previewToolConfig(config).retentionDays).toBe(30)
  })

  it('vibe_status answers from the shared preview and annotation history', async () => {
    const { studio } = studioHarness({ saved: 3 })
    const harness = registryHarness()
    applyCtx(studio, harness.registry)

    const output = await harness.run('vibe_status')
    expect(output).toMatchObject({
      preview: { state: 'ready' },
      annotations: { saved: 3 },
    })
  })

  it('vibe_annotation_get reopens the stored annotation by id', async () => {
    const { studio } = studioHarness()
    const harness = registryHarness()
    applyCtx(studio, harness.registry)

    const output = await harness.run('vibe_annotation_get', { id: 'a1' })
    expect(output).toMatchObject({ id: 'a1', comment: 'Make this button bigger' })
  })

  it('vibe_preview screenshot stores bytes and returns only the artifact id', async () => {
    const { studio, artifacts, config } = studioHarness()
    const harness = registryHarness()
    applyCtx(studio, harness.registry)

    const output = await harness.run('vibe_preview', { action: 'screenshot' })
    expect(artifacts.saveScreenshot).toHaveBeenCalledTimes(1)
    expect(artifacts.saveScreenshot.mock.calls[0]?.[1]).toMatchObject({
      retentionDays: config.retentionDays,
    })
    expect(output.screenshot).toMatchObject({ artifactId: 'shot-1', width: 640, height: 360 })

    // Image bytes never reach the model: no base64 and no byte array in the result.
    const json = JSON.stringify(output)
    expect(json).not.toContain('AQID')
    expect(json).not.toContain('[1,2,3]')
  })
})

describe('Vibe Studio preset mount (T052)', () => {
  it('registers four tools and one tools/pre-execute listener', () => {
    const { studio } = studioHarness()
    const harness = registryHarness()
    const mount = applyCtx(studio, harness.registry)

    expect([...harness.definitions.keys()].sort()).toEqual([...VIBE_TOOL_NAMES].sort())
    expect(mount.listenerEvents()).toEqual(['tools/pre-execute'])
  })

  it('asks for approval on start and delegates every other action', async () => {
    const { studio } = studioHarness()
    const harness = registryHarness()
    const mount = applyCtx(studio, harness.registry)
    const listener = mount.listener()

    const next = vi.fn(async () => ({ kind: 'allow' as const }))
    const asked = await listener({ name: 'vibe_preview', arguments: { action: 'start' } }, next)
    expect(asked).toMatchObject({ kind: 'ask', reason: 'vibe_preview start' })
    expect(next).not.toHaveBeenCalled()

    await listener({ name: 'vibe_preview', arguments: { action: 'reload' } }, next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('fails loudly when the host service is absent', () => {
    const ctx: VibeAgentContext = {
      tools: { register: vi.fn(() => vi.fn()) },
      get: () => undefined,
      on: vi.fn(() => vi.fn()),
    }
    expect(() => apply(ctx)).toThrow(/vibeStudio/)
  })

  it('disposes its tools and listener together', () => {
    const { studio } = studioHarness()
    const harness = registryHarness()
    const mount = applyCtx(studio, harness.registry)
    const dispose = mount.dispose()

    dispose()
    for (const disposer of harness.disposers.values()) expect(disposer).toHaveBeenCalledTimes(1)
    expect(mount.listenerDisposed()).toBe(true)
  })
})

/** `tools/pre-execute` listener shape the preset registers. */
type PreviewApprovalListener = Parameters<VibeAgentContext['on']>[1]

/** Fake Cordis context: a tool registry, `get('vibeStudio')` and `on()`. */
function applyCtx(studio: VibeAgentStudio, tools: VibeAgentContext['tools']) {
  const listeners: Array<{ event: string; listener: PreviewApprovalListener }> = []
  const ctx: VibeAgentContext = {
    tools,
    get: (name) => (name === 'vibeStudio' ? studio : undefined),
    on: (event, listener) => {
      listeners.push({ event, listener })
      return () => {
        const index = listeners.findIndex((entry) => entry.listener === listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
  }
  const dispose = apply(ctx)
  return {
    dispose: () => dispose,
    listener: (): PreviewApprovalListener => {
      const entry = listeners[0]
      if (!entry) throw new Error('no tools/pre-execute listener was registered')
      return entry.listener
    },
    listenerEvents: () => listeners.map((entry) => entry.event),
    listenerDisposed: () => listeners.length === 0,
  }
}

/* ------------------------------------------------------------------ */
/* Shipped wiring                                                      */
/* ------------------------------------------------------------------ */

const root = process.cwd()

function patchText(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('Vibe Studio preset patch (T052)', () => {
  const preset = patchText('presets/vibe-studio/cordis.patch.yml')

  it('declares one selectable preset row', () => {
    expect(preset).toMatch(new RegExp(`- id: ${VIBE_PRESET_PATCH_ROW_ID}\\s*\\n\\s+name: '@deepseek-ai/dsh-agent-preset'`))
    expect(preset).toMatch(new RegExp(`id: ${VIBE_PRESET_ID}\\s*\\n\\s+name: ${VIBE_PRESET_NAME}`))
    expect(preset).toMatch(/order: 5/)
  })

  it('carries the minimal everyday tool set plus the vibe tools', () => {
    const rows: ReadonlyArray<readonly [rowId: string, pluginName: string]> = [
      ['persona', '@deepseek-ai/dsh-persona'],
      ['agent-instructions', '@deepseek-ai/dsh-agent-instructions'],
      ['time-context', '@deepseek-ai/dsh-time-context'],
      ['tool-bash', '@deepseek-ai/dsh-tool-bash'],
      ['tool-pwsh', '@deepseek-ai/dsh-tool-pwsh'],
      ['tool-fs', '@deepseek-ai/dsh-tool-fs'],
      ['tool-fs-search', '@deepseek-ai/dsh-tool-fs-search'],
      ['tool-jobs', '@deepseek-ai/dsh-tool-jobs'],
      ['skill-filesystem', '@deepseek-ai/dsh-skill-filesystem'],
      ['tool-skill', '@deepseek-ai/dsh-tool-skill'],
      ['plan-mode', '@deepseek-ai/dsh-plan-mode'],
      ['compaction-basic', '@deepseek-ai/dsh-compaction-basic'],
      ['command-compact', '@deepseek-ai/dsh-command-compact'],
      ['tool-result-pruner', '@deepseek-ai/dsh-compaction-tool-result-pruner'],
      ['tool-ask-user', '@deepseek-ai/dsh-tool-ask-user'],
      ['tool-todo', '@deepseek-ai/dsh-tool-todo'],
      ['tool-web', '@deepseek-ai/dsh-tool-web'],
      [VIBE_TOOLS_PLUGIN_ID, VIBE_TOOLS_PLUGIN_NAME],
    ]
    for (const [rowId, pluginName] of rows) {
      expect(preset, `${rowId} row`).toMatch(
        new RegExp(`- id: ${escapeRegExp(rowId)}\\s*\\n\\s+name: '?${escapeRegExp(pluginName)}'?`),
      )
    }
  })

  it('keeps goal, schedule, delegation and plugin-management rows out', () => {
    for (const name of [
      'dsh-tool-goal',
      'dsh-command-goal',
      'dsh-tool-schedule',
      'dsh-tool-subagent',
      'dsh-tool-workflow',
      'dsh-plugin-manager',
      'dsh-tool-present',
    ]) {
      expect(preset).not.toContain(name)
    }
  })
})

describe('Vibe Studio bundle wiring (T052)', () => {
  const manifest = JSON.parse(patchText('package.json')) as {
    exports: Record<string, string>
    files: string[]
    dsh: { bundle: { patch: string | string[] } }
  }

  it('applies the host patch before the preset patch', () => {
    expect(manifest.dsh.bundle.patch).toEqual([
      './cordis.patch.yml',
      './presets/vibe-studio/cordis.patch.yml',
    ])
  })

  it('ships the agent entry and the presets directory', () => {
    expect(manifest.exports['./agent']).toBe('./lib/agent.js')
    expect(manifest.exports['.']).toBe('./lib/index.js')
    expect(manifest.files).toContain('presets')
    expect(manifest.files).toContain('lib')
  })

  it('leaves the host patch free of agent-preset rows', () => {
    const host = patchText('cordis.patch.yml')
    expect(host).not.toContain('dsh-agent-preset')
    expect(host).toContain('id: vibe-studio')
    expect(host).toContain('id: vibe-skill-bundled')
  })

  it('ships exactly one preset today', () => {
    expect(readdirSync(join(root, 'presets')).sort()).toEqual(['vibe-studio'])
  })
})
