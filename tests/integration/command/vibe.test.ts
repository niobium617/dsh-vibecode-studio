/**
 * T050 `/vibe`: one status glance plus one next step, inside 2 KB, with no
 * side effects and no work done for an argument it does not accept.
 */
import { describe, expect, it } from 'vitest'
import { utf8Bytes } from '../../../src/contracts/budget'
import { studioError } from '../../../src/contracts/errors'
import type { ConsoleEntry, NetworkEntry } from '../../../src/contracts/telemetry'
import type { PreviewSessionSnapshot } from '../../../src/contracts/transport'
import {
  createVibeCommand,
  registerVibeCommand,
  renderVibeStatus,
  VIBE_COMMAND_BUDGET_BYTES,
  VIBE_COMMAND_NAME,
  VIBE_COMMAND_USAGE,
  type VibeCommandDefinition,
  type VibeCommandRegistry,
  type VibeCommandResult,
} from '../../../src/host/agent/commands/vibe'
import { createStatusHandler } from '../../../src/host/agent/tools/status'
import { Config, apply } from '../../../src/host/index'
import { createFakeHost } from '../../helpers/fake-host'

function snapshot(overrides: Partial<PreviewSessionSnapshot> = {}): PreviewSessionSnapshot {
  return {
    status: 'ready',
    targetId: 'fixture',
    kind: 'web',
    url: 'http://127.0.0.1:4320/',
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    capabilities: null,
    frame: null,
    fps: 30,
    quality: 60,
    ...overrides,
  } satisfies PreviewSessionSnapshot
}

function consoleEntry(id: string, level: ConsoleEntry['level']): ConsoleEntry {
  return { id, level, text: 'boom', timestamp: '2026-10-30T10:00:00.000Z' }
}

function networkEntry(id: string, status: number): NetworkEntry {
  return {
    id,
    method: 'GET',
    url: `http://127.0.0.1:4320/api/${id}`,
    status,
    outcome: 'success',
    resourceType: 'fetch',
    startedAt: '2026-10-30T10:00:00.000Z',
    durationMs: 8,
  }
}

interface Options {
  readonly session?: PreviewSessionSnapshot
  readonly console?: readonly ConsoleEntry[]
  readonly network?: readonly NetworkEntry[]
  readonly saved?: number
}

function harness(options: Options = {}) {
  const calls = { status: 0, console: 0, network: 0, annotations: 0 }
  const annotationQueries: unknown[] = []
  const deps = {
    preview: {
      status: () => {
        calls.status += 1
        return options.session ?? snapshot()
      },
      consoleList: () => {
        calls.console += 1
        return { entries: options.console ?? [], lastSeq: 0, dropped: 0 }
      },
      networkList: () => {
        calls.network += 1
        return { entries: options.network ?? [], lastSeq: 0, dropped: 0 }
      },
    },
    annotations: {
      list: async (params?: unknown) => {
        calls.annotations += 1
        annotationQueries.push(params)
        return { total: options.saved ?? 0 }
      },
    },
  }
  return { deps, calls, annotationQueries }
}

function textOf(result: VibeCommandResult): string {
  expect(result.kind).toBe('success')
  return result.kind === 'success' ? (result.text ?? '') : ''
}

describe('/vibe command', () => {
  it('registers under the documented name with a description', () => {
    const { deps } = harness()
    const definition = createVibeCommand(deps)
    expect(definition.name).toBe(VIBE_COMMAND_NAME)
    expect(definition.description.length).toBeGreaterThan(0)
    expect(definition.recordInput).toBe(false)
  })

  it('reports a closed preview and points at starting it', async () => {
    const { deps } = harness({
      session: snapshot({
        status: 'idle',
        targetId: null,
        kind: null,
        url: null,
        viewport: null,
        fps: 0,
      }),
    })
    const result = await createVibeCommand(deps).handler({ rawInput: '' })
    const text = textOf(result)
    expect(text).toContain('预览：未启动')
    expect(text).toContain('vibe_preview start')
    expect(text).toContain('已保存标注 0')
  })

  it('reports a failed preview and points at restarting it', async () => {
    const { deps } = harness({ session: snapshot({ status: 'failed' }) })
    const text = textOf(await createVibeCommand(deps).handler({ rawInput: '' }))
    expect(text).toContain('预览：启动失败')
    expect(text).toContain('重启预览')
  })

  it('lets console errors win over annotations in the next step', async () => {
    const { deps } = harness({
      console: [consoleEntry('c1', 'error'), consoleEntry('c2', 'error')],
      saved: 4,
    })
    const text = textOf(await createVibeCommand(deps).handler({ rawInput: '' }))
    expect(text).toContain('控制台错误 2')
    expect(text).toContain('vibe_observe')
    expect(text).toContain('console')
    expect(text).not.toContain('vibe_annotation_get')
  })

  it('falls back to failed requests when only the network is broken', async () => {
    const { deps } = harness({ network: [networkEntry('n1', 500)] })
    const text = textOf(await createVibeCommand(deps).handler({ rawInput: '' }))
    expect(text).toContain('网络失败 1')
    expect(text).toContain('network')
  })

  it('points at saved annotations when the page is healthy', async () => {
    const { deps } = harness({ saved: 3 })
    const text = textOf(await createVibeCommand(deps).handler({ rawInput: '' }))
    expect(text).toContain('vibe_annotation_get')
    expect(text).toContain('已保存标注 3')
  })

  it('marks a stale page and points at reloading before reading errors (T053)', async () => {
    const { deps } = harness({
      session: snapshot({ stale: true }),
      console: [consoleEntry('c1', 'error')],
    })
    const text = textOf(await createVibeCommand(deps).handler({ rawInput: '' }))
    expect(text).toContain('可能过期（文件已改动）')
    expect(text).toContain('刷新')
    // Errors from an outdated page may already be fixed; reload comes first.
    expect(text).not.toContain('vibe_observe')
  })

  it('reads only status, buffers and one annotation count', async () => {
    const { deps, calls, annotationQueries } = harness({ saved: 1 })
    await createVibeCommand(deps).handler({ rawInput: '' })
    expect(calls).toEqual({ status: 1, console: 1, network: 1, annotations: 1 })
    expect(annotationQueries).toEqual([{ limit: 1 }])
  })

  it('does no work at all when given an argument it does not accept', async () => {
    const { deps, calls } = harness()
    const result = await createVibeCommand(deps).handler({ rawInput: ' preview' })
    expect(result).toEqual({ kind: 'error', text: VIBE_COMMAND_USAGE })
    expect(calls).toEqual({ status: 0, console: 0, network: 0, annotations: 0 })
  })

  it('keeps the reply inside the 2 KB budget and clips an oversized URL', async () => {
    const longUrl = `http://127.0.0.1:4320/${'segment/'.repeat(600)}`
    const { deps } = harness({ session: snapshot({ url: longUrl }) })
    const text = textOf(await createVibeCommand(deps).handler({ rawInput: '' }))
    expect(utf8Bytes(text)).toBeLessThanOrEqual(VIBE_COMMAND_BUDGET_BYTES)
    expect(text).toContain('…')
    expect(text).not.toContain(longUrl)
  })

  it('renders the same text a caller can render directly', async () => {
    const { deps } = harness({ saved: 2 })
    const text = textOf(await createVibeCommand(deps).handler({ rawInput: '' }))
    expect(text).toBe(renderVibeStatus(await createStatusHandler(deps)({}, {})))
  })

  it('returns a bounded error result when the status read throws', async () => {
    const { deps } = harness()
    const broken = {
      ...deps,
      preview: {
        ...deps.preview,
        status: () => {
          throw studioError('preview_failed', 'CDP session detached')
        },
      },
    }
    const result = await createVibeCommand(broken).handler({ rawInput: '' })
    expect(result.kind).toBe('error')
    if (result.kind === 'error') {
      expect(result.text).toContain('preview_failed')
      expect(utf8Bytes(result.text)).toBeLessThanOrEqual(VIBE_COMMAND_BUDGET_BYTES)
    }
  })
})

describe('/vibe registration', () => {
  function fakeRegistry() {
    const registered: VibeCommandDefinition[] = []
    const registry: VibeCommandRegistry = {
      register(definition) {
        registered.push(definition)
        return () => {
          const index = registered.indexOf(definition)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    }
    return { registry, registered }
  }

  it('registers exactly one definition and the disposer removes it', () => {
    const { deps } = harness()
    const { registry, registered } = fakeRegistry()
    const dispose = registerVibeCommand(registry, deps)
    expect(registered.map((definition) => definition.name)).toEqual([VIBE_COMMAND_NAME])
    dispose()
    expect(registered).toEqual([])
  })

  it('is wired into apply() when the host exposes a command registry', () => {
    const host = createFakeHost()
    const { registry, registered } = fakeRegistry()
    Object.assign(host.ctx, { commands: registry })

    apply(host.ctx, Config({}))

    expect(registered.map((definition) => definition.name)).toEqual([VIBE_COMMAND_NAME])
    expect(host.effectLabels).toContain('vibe-studio: /vibe command')
  })

  it('still applies on a host without a command registry', () => {
    const host = createFakeHost()
    expect(() => apply(host.ctx, Config({}))).not.toThrow()
    expect(host.provided.has('vibeStudio')).toBe(true)
  })
})
