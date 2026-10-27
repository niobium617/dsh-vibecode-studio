/**
 * Harness-only fake target adapter implementing the real `TargetAdapter`
 * contract (T016). It keeps lifecycle tests (start/stop/coalescing/failure)
 * independent of Playwright and browser processes while exposing the same
 * status/session/log observability the integration tests use.
 */
import { asSessionId, asTargetId } from '../../src/contracts/ids'
import type { TargetCapabilities, TargetSession, TargetViewport } from '../../src/contracts/target'
import type {
  ScreencastPageLike,
  TargetAdapter,
  ValidatedTargetConfig,
} from '../../src/host/targets/types'

export type FakeAdapterStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'failed'

export interface FakeSession extends Omit<TargetSession, 'url'> {
  /** Mutable so `navigate` can update the fake's session like the real one. */
  url: string
  /** Mutable test-only marker set by `stop`. */
  closed: boolean
}

export interface FakeAdapterOptions {
  readonly id?: string
  readonly kind?: TargetAdapter['kind']
  readonly startDelayMs?: number
  readonly stopDelayMs?: number
  /** When set, every start rejects with this message and the adapter ends `failed`. */
  readonly failStartWith?: string
  /** Toolbar failures (T025): each rejects once per call while set. */
  readonly failNavigateWith?: string
  readonly failReloadWith?: string
  readonly failViewportWith?: string
}

export interface FakeTargetAdapter extends Omit<TargetAdapter, 'start'> {
  readonly status: FakeAdapterStatus
  readonly sessions: readonly FakeSession[]
  readonly logs: readonly string[]
  /** URLs passed to `navigate`, in order. */
  readonly navigations: readonly string[]
  /** Last viewport applied through `setViewport`. */
  readonly lastViewport: TargetViewport | undefined
  start(input?: ValidatedTargetConfig | string): Promise<FakeSession>
  stop(): Promise<void>
  /** Simulates a crashed browser: still `running`, but `isAlive()` is false. */
  crash(): void
  /** Simulates a closed tab without a process crash. */
  closePage(): void
}

const DEFAULT_URL = 'http://127.0.0.1:4320/'
const CAPABILITIES: TargetCapabilities = Object.freeze({
  screencast: true,
  input: true,
  pick: true,
  sourceMap: true,
  console: true,
  network: true,
  screenshot: true,
})

export function createFakeAdapter(options: FakeAdapterOptions = {}): FakeTargetAdapter {
  const startDelayMs = options.startDelayMs ?? 0
  const stopDelayMs = options.stopDelayMs ?? 0
  const sessions: FakeSession[] = []
  const logs: string[] = []
  const navigations: string[] = []
  let status: FakeAdapterStatus = 'idle'
  let active: FakeSession | undefined
  let pendingStart: Promise<FakeSession> | undefined
  let alive = false
  let lastViewport: TargetViewport | undefined

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  function resolveTarget(input?: ValidatedTargetConfig | string): {
    url: string
    targetId: ReturnType<typeof asTargetId>
    kind: TargetSession['kind']
  } {
    if (typeof input === 'string' || input === undefined) {
      return {
        url: input ?? DEFAULT_URL,
        targetId: asTargetId('fake-target'),
        kind: options.kind ?? 'web',
      }
    }
    const url = input.url ?? (input.port ? `http://127.0.0.1:${input.port}/` : DEFAULT_URL)
    return { url, targetId: asTargetId(input.id), kind: input.kind }
  }

  function start(input?: ValidatedTargetConfig | string): Promise<FakeSession> {
    if (status === 'running' && active) return Promise.resolve(active)
    if (status === 'starting' && pendingStart) return pendingStart
    if (status === 'failed') {
      return Promise.reject(new Error(options.failStartWith ?? 'fake adapter failed'))
    }

    const target = resolveTarget(input)
    status = 'starting'
    logs.push('start')
    pendingStart = (async () => {
      if (startDelayMs > 0) await sleep(startDelayMs)
      if (options.failStartWith) {
        status = 'failed'
        logs.push('start-failed')
        throw new Error(options.failStartWith)
      }
      const session: FakeSession = {
        id: asSessionId(`fake-${sessions.length + 1}`),
        targetId: target.targetId,
        kind: target.kind,
        status: 'ready',
        url: target.url,
        capabilities: CAPABILITIES,
        startedAt: new Date().toISOString(),
        closed: false,
      }
      sessions.push(session)
      active = session
      alive = true
      lastViewport = input && typeof input !== 'string' ? input.viewport : undefined
      status = 'running'
      return session
    })().finally(() => {
      pendingStart = undefined
    })
    return pendingStart
  }

  async function stop(): Promise<void> {
    if (status === 'stopped') return
    if (status === 'starting' && pendingStart) {
      // Let an in-flight start settle so its session is closed too.
      await pendingStart.catch(() => undefined)
    }
    if (stopDelayMs > 0) await sleep(stopDelayMs)
    for (const session of sessions) session.closed = true
    active = undefined
    alive = false
    status = 'stopped'
    logs.push('stop')
  }

  async function navigate(url: string): Promise<void> {
    if (status !== 'running' || !active) {
      throw new Error('fake adapter is not running')
    }
    logs.push('navigate')
    if (options.failNavigateWith) throw new Error(options.failNavigateWith)
    navigations.push(url)
    active.url = url
  }

  async function reload(): Promise<void> {
    if (status !== 'running' || !active) {
      throw new Error('fake adapter is not running')
    }
    logs.push('reload')
    if (options.failReloadWith) throw new Error(options.failReloadWith)
  }

  async function setViewport(viewport: TargetViewport): Promise<void> {
    if (status !== 'running' || !active) {
      throw new Error('fake adapter is not running')
    }
    logs.push('viewport')
    if (options.failViewportWith) throw new Error(options.failViewportWith)
    lastViewport = viewport
  }

  function isAlive(): boolean {
    return status === 'running' && active !== undefined && alive
  }

  /** Enough surface for the preview service's screencast handshake. */
  function screencastPage(): ScreencastPageLike | undefined {
    if (!isAlive()) return undefined
    return {
      viewport: () =>
        lastViewport === undefined
          ? null
          : { width: lastViewport.width, height: lastViewport.height },
      async createCdpSession() {
        return {
          async send() {
            return {}
          },
          on() {
            // No events in the fake.
          },
          off() {
            // No events in the fake.
          },
          async detach() {
            // Nothing to detach.
          },
        }
      },
    }
  }

  return {
    id: options.id ?? 'fake-target',
    kind: options.kind ?? 'web',
    capabilities: CAPABILITIES,
    get status() {
      return status
    },
    get sessions() {
      return sessions
    },
    get logs() {
      return logs
    },
    get navigations() {
      return navigations
    },
    get lastViewport() {
      return lastViewport
    },
    start,
    navigate,
    reload,
    setViewport,
    isAlive,
    screencastPage,
    stop,
    crash() {
      alive = false
      logs.push('crash')
    },
    closePage() {
      alive = false
      logs.push('close-page')
    },
  }
}
