/**
 * T036 credential seam: secrets are read only through the wrapped provider,
 * writes are refused without one, and every failure message stays value-free.
 */
import { describe, expect, it, vi } from 'vitest'
import type { StudioError } from '../../../src/contracts/errors'
import {
  createApiSecretStore,
  isCredentialName,
  type CredentialProviderLike,
} from '../../../src/host/api/secrets'

function provider(overrides: Partial<CredentialProviderLike> = {}): CredentialProviderLike {
  return {
    resolve: vi.fn(async () => ({ value: 's3cret', source: 'file' })),
    describe: vi.fn(async () => ({ configured: true, writable: true, source: 'file' })),
    set: vi.fn(async () => undefined),
    unset: vi.fn(async () => undefined),
    ...overrides,
  }
}

async function rejection(run: () => Promise<unknown>): Promise<StudioError> {
  try {
    await run()
  } catch (error) {
    return error as StudioError
  }
  throw new Error('expected the call to reject')
}

describe('createApiSecretStore', () => {
  it('resolves and describes through the injected provider', async () => {
    const seam = provider()
    const store = createApiSecretStore({ credentials: seam })

    expect(store.available).toBe(true)
    expect(await store.resolve('API_TOKEN')).toBe('s3cret')
    expect(await store.describe('API_TOKEN')).toEqual({
      configured: true,
      writable: true,
      source: 'file',
    })
    expect(seam.resolve).toHaveBeenCalledWith('API_TOKEN')
    expect(seam.describe).toHaveBeenCalledWith('API_TOKEN')
  })

  it('treats an empty or missing value as unconfigured', async () => {
    const empty = createApiSecretStore({
      credentials: provider({ resolve: async () => ({ value: '', source: 'env' }) }),
    })
    expect(await empty.resolve('API_TOKEN')).toBeUndefined()

    const missing = createApiSecretStore({
      credentials: provider({ resolve: async () => undefined }),
    })
    expect(await missing.resolve('API_TOKEN')).toBeUndefined()
  })

  it('degrades visibly when the host has no credential seam', async () => {
    const store = createApiSecretStore()

    expect(store.available).toBe(false)
    expect(await store.resolve('API_TOKEN')).toBeUndefined()
    expect(await store.describe('API_TOKEN')).toEqual({ configured: false, writable: false })

    const setError = await rejection(() => store.set('API_TOKEN', 'value'))
    expect(setError.code).toBe('permission_denied')
    expect(setError.details?.reason).toBe('credentials_unavailable')

    const unsetError = await rejection(() => store.unset('API_TOKEN'))
    expect(unsetError.code).toBe('permission_denied')
  })

  it('writes and removes references through the provider', async () => {
    const seam = provider()
    const store = createApiSecretStore({ credentials: seam })

    await store.set('API_TOKEN', 'fresh')
    await store.unset('API_TOKEN')
    expect(seam.set).toHaveBeenCalledWith('API_TOKEN', 'fresh')
    expect(seam.unset).toHaveBeenCalledWith('API_TOKEN')
  })

  it('rejects invalid names and empty writes', async () => {
    const store = createApiSecretStore({ credentials: provider() })

    for (const name of ['', 'with space', '1LEADING', 'a-b', '{{x}}']) {
      expect(isCredentialName(name)).toBe(false)
      const error = await rejection(() => store.resolve(name))
      expect(error.code).toBe('invalid_input')
      expect(error.details?.field).toBe('name')
    }

    const empty = await rejection(() => store.set('API_TOKEN', ''))
    expect(empty.code).toBe('invalid_input')
    expect(empty.details?.field).toBe('value')
  })

  it('maps provider failures without echoing the secret', async () => {
    const writeFailure = createApiSecretStore({
      credentials: provider({
        set: async () => {
          throw new Error('disk says no for hunter2')
        },
      }),
    })
    const writeError = await rejection(() => writeFailure.set('API_TOKEN', 'hunter2'))
    expect(writeError.code).toBe('internal')
    expect(writeError.details?.reason).toBe('credential_store_failed')
    expect(JSON.stringify(writeError)).not.toContain('hunter2')

    const readFailure = createApiSecretStore({
      credentials: provider({
        resolve: async () => {
          throw new Error('resolve exploded')
        },
      }),
    })
    const readError = await rejection(() => readFailure.resolve('API_TOKEN'))
    expect(readError.code).toBe('internal')
    expect(readError.details?.reason).toBe('credential_resolve_failed')
    expect(readError.message).not.toContain('resolve exploded')
  })
})
