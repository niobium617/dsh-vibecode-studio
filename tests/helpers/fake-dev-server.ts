/**
 * Fake dev server child process for supervisor tests (T019).
 *
 * It behaves like the small part of `ChildProcess` the supervisor uses:
 * `pid`, piped stdout/stderr, `once('exit'|'error')`, `kill`. Nothing is
 * spawned, so tests never leave a real process or port behind.
 */
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { DevServerChildProcess } from '../../src/host/targets/process/supervisor'

export class FakeDevServerChild extends EventEmitter implements DevServerChildProcess {
  readonly pid: number
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly signals: (NodeJS.Signals | undefined)[] = []
  spawnError: NodeJS.ErrnoException | undefined
  private alive = true

  constructor(pid: number) {
    super()
    this.pid = pid
  }

  get running(): boolean {
    return this.alive
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal)
    if (!this.alive) return false
    this.exit(null, signal ?? 'SIGTERM')
    return true
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (!this.alive) return
    this.alive = false
    this.stdout.end()
    this.stderr.end()
    this.emit('exit', code, signal)
  }

  failSpawn(error: NodeJS.ErrnoException): void {
    this.spawnError = error
    this.emit('error', error)
  }

  writeStdout(text: string): void {
    this.stdout.write(text)
  }

  writeStderr(text: string): void {
    this.stderr.write(text)
  }
}

/** Lets stream `data` handlers and promise continuations run. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export async function waitFor<T>(
  check: () => T | null | undefined | false,
  timeoutMs = 1000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = check()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  throw new Error(`condition not met within ${timeoutMs} ms`)
}
