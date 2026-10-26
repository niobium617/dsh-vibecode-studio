import { describe, expect, it } from 'vitest'
import { apply as clientApply, CLIENT_ID, inject as clientInject } from '../src/client/index'
import { apply, name } from '../src/host/index'

describe('package smoke', () => {
  it('exposes the host plugin name', () => {
    expect(name).toBe('dsh-vibecode-studio')
  })

  it('exposes a callable host apply()', () => {
    expect(apply).toBeTypeOf('function')
    expect(() => apply({ provide: () => {} })).not.toThrow()
  })

  it('exposes the client id', () => {
    expect(CLIENT_ID).toBe('dsh-vibecode-studio')
  })

  it('exposes the right-sidebar client registration', () => {
    expect(clientInject).toContain('sidebarRightTabs')
    expect(clientApply).toBeTypeOf('function')
  })
})
