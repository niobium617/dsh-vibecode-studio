/**
 * Minimal host Context for transport tests: records exact Fetch routes, runs
 * `effect` setups immediately, and exposes the provided service slot.
 */
import type { HostContext } from '../../src/host/index'
import type { ConnectionFetchRouteLike } from '../../src/host/transport'

export interface FakeHost {
  readonly ctx: HostContext
  readonly routes: Map<string, ConnectionFetchRouteLike>
  readonly provided: Map<string, unknown>
  readonly effectLabels: string[]
  dispose(): Promise<void>
}

export function createFakeHost(): FakeHost {
  const routes = new Map<string, ConnectionFetchRouteLike>()
  const provided = new Map<string, unknown>()
  const effectLabels: string[] = []
  const disposers: (() => void | Promise<void>)[] = []

  const ctx: HostContext = {
    connection: {
      fetch: {
        register(route) {
          if (routes.has(route.path)) {
            throw new Error(`duplicate route ${route.path}`)
          }
          routes.set(route.path, route)
          return async () => {
            routes.delete(route.path)
          }
        },
      },
    },
    provide(name, value) {
      provided.set(name, value)
    },
    effect(setup, label) {
      effectLabels.push(label ?? '')
      const disposer = setup()
      if (typeof disposer === 'function') disposers.push(disposer)
    },
  }

  return {
    ctx,
    routes,
    provided,
    effectLabels,
    async dispose() {
      for (const dispose of disposers.reverse()) await dispose()
    },
  }
}
