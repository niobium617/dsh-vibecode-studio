import { describe, expect, it, vi } from 'vitest'
import { apply, Config, normalizeOrigin, resolveConfig, type VibeStudioConfig } from '../../src/host/index'
import { createFakeHost } from '../helpers/fake-host'

describe('host config', () => {
  it('applies documented defaults', () => {
    expect(Config({})).toEqual({
      logLevel: 'info',
      allowedOrigins: ['http://localhost', 'http://127.0.0.1'],
      retentionDays: 7,
      contextBudgetBytes: 8192,
      screenshotEnabled: true,
    })
  })

  it('rejects values the schema cannot represent', () => {
    // These inputs are invalid on purpose; the casts keep the type checker out of the way.
    expect(() => Config({ logLevel: 'verbose' } as never)).toThrow(/logLevel/)
    expect(() => Config({ retentionDays: 0 })).toThrow(/retentionDays/)
    expect(() => Config({ allowedOrigins: 'http://localhost' } as never)).toThrow(/allowedOrigins/)
  })

  it('rejects unknown keys', () => {
    const config = { ...Config({}), extra: true } as unknown as VibeStudioConfig
    expect(() => resolveConfig(config)).toThrow(/unknown config key "extra"/)
  })

  it('normalizes origins and removes duplicates', () => {
    const config = resolveConfig(Config({
      allowedOrigins: ['http://localhost:5173/', 'http://localhost:5173', 'https://example.test/path'],
    }))
    expect(config.allowedOrigins).toEqual(['http://localhost:5173', 'https://example.test'])
  })

  it('rejects non-HTTP origins and credentials', () => {
    expect(() => normalizeOrigin('file:///tmp/index.html')).toThrow(/http or https/)
    expect(() => normalizeOrigin('*')).toThrow(/invalid origin/)
    expect(() => normalizeOrigin('http://user:pass@localhost')).toThrow(/credentials/)
    expect(() => normalizeOrigin('http://localhost/?a=1')).toThrow(/query or hash/)
  })

  it('provides the resolved config through the service slot', () => {
    const host = createFakeHost()
    const provide = vi.fn(host.ctx.provide)
    host.ctx.provide = provide

    apply(host.ctx, Config({ logLevel: 'debug' }))

    expect(provide).toHaveBeenCalledWith('vibeStudio', {
      config: expect.objectContaining({ logLevel: 'debug' }),
      transport: expect.anything(),
      settings: expect.anything(),
    })
  })
})
