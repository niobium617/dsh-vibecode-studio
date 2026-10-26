/**
 * Host transport registration (T011).
 *
 * Uses `ctx.connection.fetch.register` exact routes only. `rpc.handle` is
 * intentionally unused: in DSH 0.2.1-rc.2 it is bound to the Connection
 * service's own fiber, which does not inject `webServer`, so third-party
 * plugins fail with `cannot get property "webServer" without inject` (S1).
 */
import {
  HEALTH_PATH,
  REQUEST_PATH,
  STUDIO_PING_METHOD,
  TRANSPORT_VERSION,
  type PingResult,
  type TransportConfigSummary,
  type TransportHealth,
} from '../../contracts/transport'
import { createHealthRoute, createUnaryRoute } from './routes'
import { UnaryRegistry, type UnaryHandler } from './unary'

export { UnaryRegistry } from './unary'
export type { UnaryCallContext, UnaryDispatchResult, UnaryHandler } from './unary'
export { createHealthRoute, createUnaryRoute, jsonResponse } from './routes'

export interface ConnectionFetchRouteLike {
  readonly path: string
  readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
  readonly requestBody: 'buffered' | 'streaming'
  readonly fetch: (request: Request) => Promise<Response>
}

/** Minimal Cordis surface this module uses. */
export interface TransportHostContext {
  readonly connection: {
    readonly fetch: {
      register(route: ConnectionFetchRouteLike): () => Promise<void>
    }
  }
  effect?: (
    setup: () => void | (() => void | Promise<void>),
    label?: string,
  ) => void
}

export interface RegisterTransportOptions {
  readonly plugin: string
  readonly config: TransportConfigSummary
}

export interface TransportRegistration {
  /** Shared with later host modules; they add methods instead of routes. */
  readonly registry: UnaryRegistry
}

export function createHealthPayload(
  plugin: string,
  startedAt: number,
  config: TransportConfigSummary,
): TransportHealth {
  return {
    plugin,
    transportVersion: TRANSPORT_VERSION,
    serverTime: new Date().toISOString(),
    uptimeMs: Math.max(0, Date.now() - startedAt),
    config,
  }
}

export function registerTransport(
  ctx: TransportHostContext,
  options: RegisterTransportOptions,
): TransportRegistration {
  const registry = new UnaryRegistry()
  const ping: UnaryHandler = (params): PingResult => ({
    pong: true,
    serverTime: new Date().toISOString(),
    transportVersion: TRANSPORT_VERSION,
    echo: params ?? null,
  })
  registry.register(STUDIO_PING_METHOD, ping)

  const startedAt = Date.now()
  const health = () => createHealthPayload(options.plugin, startedAt, options.config)

  const routes: ConnectionFetchRouteLike[] = [
    {
      path: HEALTH_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: createHealthRoute(health),
    },
    {
      path: REQUEST_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: createUnaryRoute(registry),
    },
  ]

  for (const route of routes) {
    const setup = () => ctx.connection.fetch.register(route)
    if (typeof ctx.effect === 'function') {
      ctx.effect(setup, `vibe-studio: ${route.path}`)
    } else {
      void setup()
    }
  }

  return { registry }
}
