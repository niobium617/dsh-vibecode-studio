/**
 * Harness-only fake target adapter.
 *
 * T016 defines the real `TargetAdapter` contract. Until then this helper keeps
 * lifecycle tests (start/stop/coalescing/failure) independent of Playwright and
 * browser processes.
 */
export type FakeAdapterStatus = 'idle' | 'starting' | 'running' | 'stopped' | 'failed'

export interface FakeAdapterCapabilities {
  readonly preview: boolean
  readonly input: boolean
  readonly inspect: boolean
}

export interface FakeSession {
  readonly id: string
  readonly url: string
  closed: boolean
}

export interface FakeAdapterOptions {
  readonly id?: string
  readonly startDelayMs?: number
  readonly stopDelayMs?: number
  /** When set, every start rejects with this message and the adapter ends `failed`. */
  readonly failStartWith?: string
}

export interface FakeTargetAdapter {
  readonly id: string
  readonly capabilities: FakeAdapterCapabilities
  readonly status: FakeAdapterStatus
  readonly sessions: readonly FakeSession[]
  readonly logs: readonly string[]
  start(url?: string): Promise<FakeSession>
  stop(): Promise<void>
}

const DEFAULT_URL = 'http://127.0.0.1:4320/'

export function createFakeAdapter(options: FakeAdapterOptions = {}): FakeTargetAdapter {
  const startDelayMs = options.startDelayMs ?? 0
  const stopDelayMs = options.stopDelayMs ?? 0
  const sessions: FakeSession[] = []
  const logs: string[] = []
  let status: FakeAdapterStatus = 'idle'
  let active: FakeSession | undefined
  let pendingStart: Promise<FakeSession> | undefined

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

  function start(url = DEFAULT_URL): Promise<FakeSession> {
    if (status === 'running' && active) return Promise.resolve(active)
    if (status === 'starting' && pendingStart) return pendingStart
    if (status === 'failed') {
      return Promise.reject(new Error(options.failStartWith ?? 'fake adapter failed'))
    }

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
        id: `fake-${sessions.length + 1}`,
        url,
        closed: false,
      }
      sessions.push(session)
      active = session
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
    status = 'stopped'
    logs.push('stop')
  }

  return {
    id: options.id ?? 'fake-target',
    capabilities: Object.freeze({ preview: true, input: true, inspect: true }),
    get status() {
      return status
    },
    get sessions() {
      return sessions
    },
    get logs() {
      return logs
    },
    start,
    stop,
  }
}
