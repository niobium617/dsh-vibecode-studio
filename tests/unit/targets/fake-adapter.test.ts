import { describe, expect, it } from 'vitest'
import { isStudioError } from '../../../src/contracts/errors'
import { assertCapability, validateTargetConfig, type TargetAdapter } from '../../../src/host/index'
import { createFakeAdapter } from '../../helpers/fake-adapter'

const CONFIG = validateTargetConfig({
  id: 'web-local',
  name: 'Local web',
  kind: 'web',
  url: 'http://127.0.0.1:4320/form',
})

describe('fake target adapter lifecycle', () => {
  it('satisfies the TargetAdapter contract and returns a ready session', async () => {
    const adapter: TargetAdapter = createFakeAdapter({ id: 'web-fake' })
    expect(adapter.kind).toBe('web')
    expect(adapter.capabilities.input).toBe(true)

    const session = await adapter.start(CONFIG)

    expect(adapter).toMatchObject({ id: 'web-fake' })
    expect(session).toMatchObject({
      targetId: 'web-local',
      kind: 'web',
      status: 'ready',
      url: 'http://127.0.0.1:4320/form',
      capabilities: adapter.capabilities,
    })
    expect(session.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(adapter).toMatchObject({ status: 'running' })
  })

  it('coalesces concurrent starts and reuses the running session', async () => {
    const adapter = createFakeAdapter({ startDelayMs: 5 })

    const [first, second] = await Promise.all([adapter.start(CONFIG), adapter.start(CONFIG)])
    const third = await adapter.start(CONFIG)

    expect(second).toBe(first)
    expect(third).toBe(first)
    expect(adapter.sessions).toHaveLength(1)
    expect(adapter.logs).toEqual(['start'])
  })

  it('closes the session on stop and stays idempotent', async () => {
    const adapter = createFakeAdapter()
    const session = await adapter.start(CONFIG)

    await adapter.stop()
    await adapter.stop()

    expect(session.closed).toBe(true)
    expect(adapter.status).toBe('stopped')
    expect(adapter.logs).toEqual(['start', 'stop'])
  })

  it('stops an in-flight start without leaving an open session', async () => {
    const adapter = createFakeAdapter({ startDelayMs: 5 })
    const starting = adapter.start(CONFIG)

    await adapter.stop()
    const session = await starting

    expect(session.closed).toBe(true)
    expect(adapter.status).toBe('stopped')
  })

  it('propagates start failures and keeps the failed state', async () => {
    const adapter = createFakeAdapter({ failStartWith: 'Edge is not installed' })

    await expect(adapter.start(CONFIG)).rejects.toThrow('Edge is not installed')
    expect(adapter.status).toBe('failed')
    expect(adapter.logs).toEqual(['start', 'start-failed'])
    await expect(adapter.start(CONFIG)).rejects.toThrow('Edge is not installed')
  })

  it('reports a stable unsupported error for an undeclared capability', () => {
    const capabilities = { ...createFakeAdapter().capabilities, screencast: false }

    let caught: unknown
    try {
      assertCapability(capabilities, 'screencast')
    } catch (error) {
      caught = error
    }
    expect(isStudioError(caught)).toBe(true)
    expect(caught).toMatchObject({ code: 'unsupported', details: { capability: 'screencast' } })
    expect((caught as { message: string }).message).toMatch(/does not support "screencast"/)

    expect(() => assertCapability(capabilities, 'input')).not.toThrow()
  })
})
