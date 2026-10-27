import { describe, expect, it } from 'vitest'
import { apply as clientApply, CLIENT_ID, inject as clientInject } from '../src/client/index'
import { apply, name } from '../src/host/index'
import { createFakeHost } from './helpers/fake-host'

describe('package smoke', () => {
  it('exposes the host plugin name', () => {
    expect(name).toBe('dsh-vibecode-studio')
  })

  it('exposes a callable host apply()', () => {
    expect(apply).toBeTypeOf('function')
    const host = createFakeHost()
    expect(() => apply(host.ctx)).not.toThrow()
    expect(host.routes.size).toBe(2)
  })

  it('exposes the client id', () => {
    expect(CLIENT_ID).toBe('dsh-vibecode-studio')
  })

  it('exposes the right-sidebar client registration', () => {
    expect(clientInject).toContain('sidebarRightTabs')
    expect(clientApply).toBeTypeOf('function')
  })
})
