/**
 * T027 service wiring: the picker is installed after a successful start,
 * degrades the `pick` capability when the page refuses the script, resets on
 * navigation and is disposed before the adapter closes the page.
 */
import { describe, expect, it } from 'vitest'
import type { ElementContext } from '../../../src/contracts/inspect'
import type { PickSnapshot } from '../../../src/contracts/transport'
import type { PreviewPicker } from '../../../src/host/inspect/inject'
import { createPreviewService, type PreviewServiceOptions } from '../../../src/host/preview/route'
import type { ScreencastSource } from '../../../src/host/preview/screencast'
import { createTargetAdapterRegistry } from '../../../src/host/targets/registry'
import { createFakeAdapter } from '../../helpers/fake-adapter'

const URL = 'http://127.0.0.1:4320/'
const NEXT_URL = 'http://127.0.0.1:4320/other'

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

function fakePicker(log: string[], options: { failInstall?: boolean } = {}) {
  let active = false
  let pick: ElementContext | null = null
  let seq = 0
  const picker: PreviewPicker = {
    async install() {
      log.push('picker.install')
      if (options.failInstall) throw new Error('page refused the script')
    },
    async activate() {
      log.push('picker.activate')
      active = true
    },
    async deactivate() {
      log.push('picker.deactivate')
      active = false
    },
    reset() {
      log.push('picker.reset')
      active = false
    },
    snapshot(): PickSnapshot {
      return { active, seq, pick, ts: null }
    },
    async dispose() {
      log.push('picker.dispose')
      active = false
    },
    get active() {
      return active
    },
  }
  return {
    picker,
    push(next: ElementContext) {
      pick = next
      seq += 1
    },
  }
}

function harness(options: { failInstall?: boolean } = {}) {
  const log: string[] = []
  const fake = fakePicker(log, options)
  const adapter = createFakeAdapter()
  const registry = createTargetAdapterRegistry()
  registry.register(adapter)
  const serviceOptions: PreviewServiceOptions = {
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
    createPicker: () => fake.picker,
  }
  return { service: createPreviewService(serviceOptions), adapter, log, fake }
}

const PICKED: ElementContext = {
  selector: '#save',
  unique: true,
  tag: 'button',
  id: 'save',
  classes: [],
  role: null,
  name: '',
  text: '',
  html: '',
  visible: true,
  box: { x: 1, y: 2, width: 3, height: 4 },
  source: null,
}

describe('preview picker service (T027)', () => {
  it('installs after start, activates on demand and reports picks', async () => {
    const { service, log, fake } = harness()
    const started = await service.start({ url: URL })
    expect(started.capabilities?.pick).toBe(true)
    expect(log).toEqual(['picker.install'])

    expect(service.pickStatus()).toEqual({ active: false, seq: 0, pick: null, ts: null })

    const activated = await service.pickStart()
    expect(activated.active).toBe(true)
    expect(log).toEqual(['picker.install', 'picker.activate'])

    fake.push(PICKED)
    expect(service.pickStatus()).toMatchObject({ active: true, seq: 1, pick: PICKED })

    const stopped = await service.pickStop()
    expect(stopped.active).toBe(false)
    expect(log.at(-1)).toBe('picker.deactivate')
    await service.stop()
  })

  it('degrades the capability when the page refuses the script', async () => {
    const { service } = harness({ failInstall: true })
    const started = await service.start({ url: URL })
    expect(started.status).toBe('ready')
    expect(started.capabilities?.pick).toBe(false)
    await expect(service.pickStart()).rejects.toMatchObject({ code: 'unsupported' })
    expect(service.pickStatus()).toEqual({ active: false, seq: 0, pick: null, ts: null })
    await service.stop()
  })

  it('resets on navigation and reload, and disposes before the adapter stops', async () => {
    const { service, adapter, log } = harness()
    await service.start({ url: URL })
    await service.pickStart()

    await service.navigate({ url: NEXT_URL })
    expect(log.at(-1)).toBe('picker.reset')
    expect(service.pickStatus().active).toBe(false)

    await service.pickStart()
    await service.reload()
    expect(log.at(-1)).toBe('picker.reset')

    await service.stop()
    expect(log.at(-1)).toBe('picker.dispose')
    // The picker release is ordered before the adapter that owns the page.
    expect(adapter.logs.at(-1)).toBe('stop')
  })

  it('treats stop and status as harmless outside a live session', async () => {
    const { service } = harness()
    await expect(service.pickStop()).resolves.toEqual({
      active: false,
      seq: 0,
      pick: null,
      ts: null,
    })
    expect(service.pickStatus().active).toBe(false)
    await expect(service.pickStart()).rejects.toMatchObject({ code: 'target_unavailable' })
    await service.stop()
  })
})
