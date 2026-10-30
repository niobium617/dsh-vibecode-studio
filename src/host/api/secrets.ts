/**
 * Credential seam for the API workbench (T036).
 *
 * An environment never stores a secret value: it stores the name of a
 * credential reference, and the value lives only in `ctx.credentials`. This
 * module is the single host-side door to that service, so every secret read
 * happens where a request is executed and the only thing that can cross the
 * unary wire is `describe()` — presence, writability and the supplying source,
 * never the value.
 *
 * `CredentialProviderLike` mirrors `@deepseek-ai/dsh-credentials` structurally
 * instead of importing it: contracts stay dependency-free, and the branded
 * `CredentialRef`/`CredentialKey` strings are plain strings at runtime.
 */
import { studioError } from '../../contracts/errors'

/** POSIX-style environment name accepted by the credential seam. */
export const CREDENTIAL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export function isCredentialName(value: string): boolean {
  return CREDENTIAL_NAME_PATTERN.test(value)
}

/** The subset of `ctx.credentials` this module uses. */
export interface CredentialProviderLike {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

/** Facts about one reference that are safe to show in a configuration UI. */
export interface CredentialDescription {
  readonly configured: boolean
  readonly writable: boolean
  readonly source?: string
}

export interface ApiSecretStore {
  /** False when no credential provider is injected; secrets then never resolve. */
  readonly available: boolean
  /** Host-only: the current secret value, or `undefined` when unconfigured. */
  resolve(name: string): Promise<string | undefined>
  /** Safe for the client: never includes the value. */
  describe(name: string): Promise<CredentialDescription>
  set(name: string, value: string): Promise<void>
  unset(name: string): Promise<void>
}

export interface ApiSecretStoreOptions {
  /** `ctx.credentials`; omitted in tests and in hosts without the seam. */
  readonly credentials?: CredentialProviderLike
}

function invalidName(): never {
  throw studioError('invalid_input', 'vibe-studio: secret names must be environment identifiers', {
    field: 'name',
  })
}

/**
 * Wraps a credential provider in the narrow shape the API workbench needs.
 * Without a provider every reference reads as unconfigured and writes are
 * refused, so a host missing the seam degrades visibly instead of storing
 * secrets somewhere else.
 */
export function createApiSecretStore(options: ApiSecretStoreOptions = {}): ApiSecretStore {
  const provider = options.credentials

  return {
    available: provider !== undefined,

    async resolve(name: string): Promise<string | undefined> {
      if (!isCredentialName(name)) invalidName()
      if (!provider) return undefined
      try {
        const resolved = await provider.resolve(name)
        return resolved && resolved.value !== '' ? resolved.value : undefined
      } catch (error) {
        throw studioError('internal', 'vibe-studio: the credential store could not resolve a secret', {
          reason: 'credential_resolve_failed',
          cause: error instanceof Error ? error.name : undefined,
        })
      }
    },

    async describe(name: string): Promise<CredentialDescription> {
      if (!isCredentialName(name)) invalidName()
      if (!provider) return { configured: false, writable: false }
      const info = await provider.describe(name)
      return info.source === undefined
        ? { configured: info.configured, writable: info.writable }
        : { configured: info.configured, writable: info.writable, source: info.source }
    },

    async set(name: string, value: string): Promise<void> {
      if (!isCredentialName(name)) invalidName()
      if (typeof value !== 'string' || value === '') {
        throw studioError('invalid_input', 'vibe-studio: a secret value must not be empty', {
          field: 'value',
        })
      }
      if (!provider) {
        throw studioError(
          'permission_denied',
          'vibe-studio: this host has no credential store to write to',
          { reason: 'credentials_unavailable' },
        )
      }
      try {
        await provider.set(name, value)
      } catch (error) {
        throw studioError('internal', 'vibe-studio: the credential store rejected the write', {
          reason: 'credential_store_failed',
          cause: error instanceof Error ? error.name : undefined,
        })
      }
    },

    async unset(name: string): Promise<void> {
      if (!isCredentialName(name)) invalidName()
      if (!provider) {
        throw studioError(
          'permission_denied',
          'vibe-studio: this host has no credential store to write to',
          { reason: 'credentials_unavailable' },
        )
      }
      try {
        await provider.unset(name)
      } catch (error) {
        throw studioError('internal', 'vibe-studio: the credential store rejected the write', {
          reason: 'credential_store_failed',
          cause: error instanceof Error ? error.name : undefined,
        })
      }
    },
  }
}
