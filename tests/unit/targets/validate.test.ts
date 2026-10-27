import { describe, expect, it } from 'vitest'
import { isStudioError, type StudioError } from '../../../src/contracts/errors'
import { DEFAULT_VIEWPORT, validateTargetConfig } from '../../../src/host/index'

function invalid(input: unknown): StudioError {
  try {
    validateTargetConfig(input)
  } catch (error) {
    if (isStudioError(error)) return error
    throw error
  }
  throw new Error('expected validateTargetConfig to reject the input')
}

describe('validateTargetConfig', () => {
  it('normalizes a minimal web target and fills the default viewport', () => {
    const config = validateTargetConfig({
      id: 'web-local',
      name: '  Local web  ',
      kind: 'web',
      url: 'http://127.0.0.1:4320/form?tab=one',
    })

    expect(config).toEqual({
      id: 'web-local',
      name: 'Local web',
      kind: 'web',
      url: 'http://127.0.0.1:4320/form?tab=one',
      viewport: DEFAULT_VIEWPORT,
    })
  })

  it('accepts a command-driven target with port, cwd and a custom viewport', () => {
    const config = validateTargetConfig({
      id: 'dev-server',
      name: 'Vite dev server',
      kind: 'web',
      command: 'pnpm vite --port 4321',
      cwd: process.cwd(),
      port: 4321,
      viewport: { width: 1024, height: 768, deviceScaleFactor: 2 },
    })

    expect(config).toMatchObject({
      command: 'pnpm vite --port 4321',
      port: 4321,
      viewport: { width: 1024, height: 768, deviceScaleFactor: 2 },
    })
    expect(config.url).toBeUndefined()
  })

  it('defaults deviceScaleFactor when only width and height are given', () => {
    const config = validateTargetConfig({
      id: 'web-local',
      name: 'Web',
      kind: 'web',
      url: 'https://example.test/',
      viewport: { width: 800, height: 600 },
    })

    expect(config.viewport).toEqual({ width: 800, height: 600, deviceScaleFactor: 1 })
  })

  it('rejects non-object input', () => {
    expect(invalid(null)).toMatchObject({ code: 'invalid_config' })
    expect(invalid([])).toMatchObject({ code: 'invalid_config' })
    expect(invalid('http://localhost').message).toMatch(/must be an object/)
  })

  it('rejects unknown keys and unknown viewport keys', () => {
    expect(invalid({ id: 'web', name: 'Web', kind: 'web', url: 'http://localhost/', extra: 1 }))
      .toMatchObject({ code: 'invalid_config', details: { field: 'extra' } })

    expect(
      invalid({
        id: 'web',
        name: 'Web',
        kind: 'web',
        url: 'http://localhost/',
        viewport: { width: 800, height: 600, zoom: 1 },
      }).message,
    ).toMatch(/unknown key "zoom"/)
  })

  it('rejects an invalid id, empty name and unknown kind', () => {
    expect(invalid({ id: 'bad id', name: 'Web', kind: 'web', url: 'http://localhost/' }).details)
      .toEqual({ field: 'id' })
    expect(invalid({ id: 'web', name: '   ', kind: 'web', url: 'http://localhost/' }).message)
      .toMatch(/name.*must not be empty/)
    expect(invalid({ id: 'web', name: 'Web', kind: 'mobile', url: 'http://localhost/' }).message)
      .toMatch(/unknown "kind"/)
  })

  it('requires a url or command, and a url for api targets', () => {
    expect(invalid({ id: 'web', name: 'Web', kind: 'web' }).message).toMatch(/needs a "url" or a "command"/)
    expect(
      invalid({ id: 'api', name: 'API', kind: 'api', command: 'node server.js' }).message,
    ).toMatch(/an "api" target needs a "url"/)
  })

  it('rejects unsafe URLs', () => {
    const base = { id: 'web', name: 'Web', kind: 'web' }
    expect(invalid({ ...base, url: 'file:///etc/passwd' }).message).toMatch(/http or https/)
    expect(invalid({ ...base, url: 'javascript:alert(1)' }).message).toMatch(/http or https/)
    expect(invalid({ ...base, url: 'http://user:pass@localhost/' }).message).toMatch(/credentials/)
    expect(invalid({ ...base, url: 'not a url' }).message).toMatch(/invalid "url"/)
  })

  it('rejects relative cwd, bad ports and bad viewports', () => {
    const base = { id: 'web', name: 'Web', kind: 'web', command: 'vite' }
    expect(invalid({ ...base, cwd: 'relative/dir' }).details).toEqual({ field: 'cwd' })
    expect(invalid({ ...base, port: 0 }).details).toEqual({ field: 'port' })
    expect(invalid({ ...base, port: 8080.5 }).details).toEqual({ field: 'port' })

    const withUrl = { ...base, command: undefined, url: 'http://localhost/' }
    expect(invalid({ ...withUrl, viewport: { width: 10, height: 600 } }).details)
      .toEqual({ field: 'viewport.width' })
    expect(invalid({ ...withUrl, viewport: { width: 800, height: 600, deviceScaleFactor: 10 } }).details)
      .toEqual({ field: 'viewport.deviceScaleFactor' })
  })
})
