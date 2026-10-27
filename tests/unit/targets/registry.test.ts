import { describe, expect, it } from 'vitest'
import { isStudioError, type StudioError } from '../../../src/contracts/errors'
import { createTargetAdapterRegistry } from '../../../src/host/index'
import { createFakeAdapter } from '../../helpers/fake-adapter'

function captureError(run: () => unknown): StudioError {
  try {
    run()
  } catch (error) {
    if (isStudioError(error)) return error
    throw error
  }
  throw new Error('expected the call to throw a StudioError')
}

describe('target adapter registry', () => {
  it('registers one adapter per kind and exposes its capabilities', () => {
    const registry = createTargetAdapterRegistry()
    const adapter = createFakeAdapter({ id: 'web-edge', kind: 'web' })

    const unregister = registry.register(adapter)

    expect(registry.has('web')).toBe(true)
    expect(registry.get('web')).toBe(adapter)
    expect(registry.tryGet('web')).toBe(adapter)
    expect(registry.byId('web-edge')).toBe(adapter)
    expect(registry.list()).toEqual([adapter])
    expect(registry.capabilities('web').screencast).toBe(true)

    unregister()
    unregister()
    expect(registry.has('web')).toBe(false)
    expect(registry.list()).toEqual([])
  })

  it('reports an unknown adapter for an unrecognized kind', () => {
    const registry = createTargetAdapterRegistry()
    const error = captureError(() => registry.get('mobile'))

    expect(error.code).toBe('unsupported')
    expect(error.message).toMatch(/unknown target adapter "mobile"/)
    expect(error.details).toEqual({ kind: 'mobile', available: [] })
  })

  it('reports a missing adapter for a known but unregistered kind', () => {
    const registry = createTargetAdapterRegistry()
    registry.register(createFakeAdapter({ id: 'web-edge', kind: 'web' }))

    const error = captureError(() => registry.get('desktop'))

    expect(error.code).toBe('unsupported')
    expect(error.message).toMatch(/no target adapter registered for kind "desktop"/)
    expect(error.details).toEqual({ kind: 'desktop', available: ['web'] })
  })

  it('rejects duplicate kinds and duplicate ids', () => {
    const registry = createTargetAdapterRegistry()
    registry.register(createFakeAdapter({ id: 'web-edge', kind: 'web' }))

    const duplicateKind = captureError(() =>
      registry.register(createFakeAdapter({ id: 'web-chrome', kind: 'web' })),
    )
    expect(duplicateKind).toMatchObject({ code: 'invalid_config' })
    expect(duplicateKind.message).toMatch(/already has adapter "web-edge"/)

    const duplicateId = captureError(() =>
      registry.register(createFakeAdapter({ id: 'web-edge', kind: 'desktop' })),
    )
    expect(duplicateId).toMatchObject({ code: 'invalid_config' })
    expect(duplicateId.message).toMatch(/already registered/)
  })

  it('rejects malformed adapters with a readable error', () => {
    const registry = createTargetAdapterRegistry()

    const badId = captureError(() =>
      registry.register({ ...createFakeAdapter(), id: 'bad id' }),
    )
    expect(badId).toMatchObject({ code: 'invalid_config', details: { field: 'id' } })

    const missingCapability = captureError(() =>
      registry.register({
        ...createFakeAdapter({ id: 'web-partial' }),
        capabilities: { ...createFakeAdapter().capabilities, pick: 'yes' },
      } as never),
    )
    expect(missingCapability).toMatchObject({
      code: 'invalid_config',
      details: { field: 'capabilities.pick' },
    })

    expect(captureError(() => registry.register({} as never)).message).toMatch(/invalid "id"/)
  })

  it('does not let an old unregister remove a newer adapter of the same kind', () => {
    const registry = createTargetAdapterRegistry()
    const first = createFakeAdapter({ id: 'web-one', kind: 'web' })
    const unregisterFirst = registry.register(first)
    unregisterFirst()

    const second = createFakeAdapter({ id: 'web-two', kind: 'web' })
    registry.register(second)
    unregisterFirst()

    expect(registry.get('web')).toBe(second)
  })
})
