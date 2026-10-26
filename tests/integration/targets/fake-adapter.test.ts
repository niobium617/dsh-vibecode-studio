import { describe, expect, it } from 'vitest'
import { createFakeAdapter } from '../../helpers/fake-adapter'

describe('fake target adapter', () => {
  it('starts and reports a running session', async () => {
    const adapter = createFakeAdapter()
    expect(adapter.status).toBe('idle')

    const session = await adapter.start('http://127.0.0.1:4320/form')

    expect(adapter.status).toBe('running')
    expect(session.url).toBe('http://127.0.0.1:4320/form')
    expect(session.closed).toBe(false)
    expect(adapter.sessions).toEqual([session])
  })

  it('coalesces concurrent starts into one session', async () => {
    const adapter = createFakeAdapter({ startDelayMs: 10 })

    const [first, second] = await Promise.all([
      adapter.start('http://127.0.0.1:4320/a'),
      adapter.start('http://127.0.0.1:4320/b'),
    ])

    expect(second).toBe(first)
    expect(first.url).toBe('http://127.0.0.1:4320/a')
    expect(adapter.sessions).toHaveLength(1)
  })

  it('returns the active session for a repeated start', async () => {
    const adapter = createFakeAdapter()
    const running = await adapter.start()

    await expect(adapter.start('http://127.0.0.1:4320/other')).resolves.toBe(running)
    expect(adapter.sessions).toHaveLength(1)
  })

  it('closes sessions on stop and stays idempotent', async () => {
    const adapter = createFakeAdapter()
    const session = await adapter.start()

    await adapter.stop()
    await adapter.stop()

    expect(adapter.status).toBe('stopped')
    expect(session.closed).toBe(true)
    expect(adapter.logs).toEqual(['start', 'stop'])
  })

  it('stops an in-flight start without leaving an open session', async () => {
    const adapter = createFakeAdapter({ startDelayMs: 10 })
    const starting = adapter.start()

    await adapter.stop()
    const session = await starting

    expect(session.closed).toBe(true)
    expect(adapter.status).toBe('stopped')
  })

  it('propagates start failures and keeps the failed state', async () => {
    const adapter = createFakeAdapter({ failStartWith: 'Edge is not installed' })

    await expect(adapter.start()).rejects.toThrow('Edge is not installed')
    expect(adapter.status).toBe('failed')
    await expect(adapter.start()).rejects.toThrow('Edge is not installed')
  })
})
