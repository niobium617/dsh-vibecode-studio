/**
 * Adapter registry (T016).
 *
 * One adapter per target kind keeps resolution unambiguous: a validated config
 * names a kind, and the registry is the only place that knows which adapter can
 * serve it. Late lookups fail with `unsupported` and a readable message rather
 * than `undefined`.
 */
import { studioError } from '../../contracts/errors'
import { isTargetId } from '../../contracts/ids'
import {
  TARGET_KINDS,
  type TargetCapabilities,
  type TargetKind,
} from '../../contracts/target'
import type { TargetAdapter } from './types'

const CAPABILITY_KEYS: readonly (keyof TargetCapabilities)[] = [
  'screencast',
  'input',
  'pick',
  'sourceMap',
  'console',
  'network',
  'screenshot',
]

export interface TargetAdapterRegistry {
  /** Registers an adapter and returns an idempotent unregister function. */
  register(adapter: TargetAdapter): () => void
  has(kind: string): boolean
  tryGet(kind: string): TargetAdapter | undefined
  /** Returns the adapter or throws `unsupported` for an unknown/unregistered kind. */
  get(kind: string): TargetAdapter
  byId(id: string): TargetAdapter | undefined
  list(): readonly TargetAdapter[]
  /** Capabilities declared by the adapter for `kind`; throws `unsupported`. */
  capabilities(kind: string): TargetCapabilities
}

function isKnownKind(value: string): value is TargetKind {
  return (TARGET_KINDS as readonly string[]).includes(value)
}

function assertAdapter(adapter: TargetAdapter): void {
  if (!adapter || typeof adapter !== 'object') {
    throw studioError('invalid_config', 'vibe-studio: target adapter must be an object')
  }
  if (typeof adapter.id !== 'string' || !isTargetId(adapter.id)) {
    throw studioError('invalid_config', 'vibe-studio: target adapter has an invalid "id"', {
      field: 'id',
    })
  }
  if (typeof adapter.kind !== 'string' || !isKnownKind(adapter.kind)) {
    throw studioError(
      'invalid_config',
      `vibe-studio: target adapter "${adapter.id}" has an unknown "kind"`,
      { field: 'kind' },
    )
  }
  if (typeof adapter.start !== 'function' || typeof adapter.stop !== 'function') {
    throw studioError(
      'invalid_config',
      `vibe-studio: target adapter "${adapter.id}" must implement start() and stop()`,
    )
  }
  for (const key of CAPABILITY_KEYS) {
    if (typeof adapter.capabilities?.[key] !== 'boolean') {
      throw studioError(
        'invalid_config',
        `vibe-studio: target adapter "${adapter.id}" must declare capability "${key}"`,
        { field: `capabilities.${key}` },
      )
    }
  }
  for (const method of ['navigate', 'screenshot'] as const) {
    const value = adapter[method]
    if (value !== undefined && typeof value !== 'function') {
      throw studioError(
        'invalid_config',
        `vibe-studio: target adapter "${adapter.id}" has a non-function "${method}"`,
      )
    }
  }
}

export function createTargetAdapterRegistry(): TargetAdapterRegistry {
  const byKind = new Map<TargetKind, TargetAdapter>()
  const byId = new Map<string, TargetAdapter>()

  function get(kind: string): TargetAdapter {
    if (!isKnownKind(kind)) {
      throw studioError('unsupported', `vibe-studio: unknown target adapter "${kind}"`, {
        kind,
        available: [...byKind.keys()],
      })
    }
    const adapter = byKind.get(kind)
    if (!adapter) {
      throw studioError(
        'unsupported',
        `vibe-studio: no target adapter registered for kind "${kind}"`,
        { kind, available: [...byKind.keys()] },
      )
    }
    return adapter
  }

  return {
    register(adapter) {
      assertAdapter(adapter)
      if (byId.has(adapter.id)) {
        throw studioError(
          'invalid_config',
          `vibe-studio: target adapter "${adapter.id}" is already registered`,
        )
      }
      const existing = byKind.get(adapter.kind)
      if (existing) {
        throw studioError(
          'invalid_config',
          `vibe-studio: target kind "${adapter.kind}" already has adapter "${existing.id}"`,
          { kind: adapter.kind },
        )
      }

      byId.set(adapter.id, adapter)
      byKind.set(adapter.kind, adapter)
      return () => {
        if (byId.get(adapter.id) === adapter) byId.delete(adapter.id)
        if (byKind.get(adapter.kind) === adapter) byKind.delete(adapter.kind)
      }
    },

    has(kind) {
      return isKnownKind(kind) && byKind.has(kind)
    },

    tryGet(kind) {
      return isKnownKind(kind) ? byKind.get(kind) : undefined
    },

    get,

    byId(id) {
      return byId.get(id)
    },

    list() {
      return [...byKind.values()]
    },

    capabilities(kind) {
      return get(kind).capabilities
    },
  }
}
