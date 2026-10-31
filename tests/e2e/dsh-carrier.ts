// Boots a real DeepSeek Harness (DSH) web carrier for the studio main-chain
// E2E. The launcher is supplied through `VIBE_DSH_BIN` so this repository never
// hard-codes a machine path: point it at the `dsh` launcher of an install that
// already links this package into the `vibe-dev` profile.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'

const TOKEN_URL = /http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+/

export interface DshCarrier {
  /** Authenticated URL printed by the launcher. */
  readonly url: string
  /** Launcher process id; the root of the tree `close()` kills. */
  readonly pid: number | undefined
  /** Accumulated stdout/stderr tail, attached to the test on failure. */
  log(): string
  /** Kills the launcher's whole process tree. */
  close(): void
}

export interface DshCarrierOptions {
  readonly bin: string
  readonly port: number
  readonly profile?: string
  readonly timeoutMs?: number
}

/** `VIBE_DSH_BIN` is unset on machines without a DSH install. */
export function resolveDshBin(): string | null {
  const value = process.env.VIBE_DSH_BIN?.trim()
  return value !== undefined && value.length > 0 ? value : null
}

export async function startDsh(options: DshCarrierOptions): Promise<DshCarrier> {
  const args = [
    '/c',
    options.bin,
    '--profile',
    options.profile ?? 'vibe-dev',
    '--no-open',
    '--host',
    '127.0.0.1',
    '--port',
    String(options.port),
  ]
  const child = spawn('cmd.exe', args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let log = ''
  let url: string | null = null
  const debug = process.env.VIBE_E2E_DEBUG === '1'
  const onData = (chunk: Buffer): void => {
    log = (log + chunk.toString()).slice(-20_000)
    if (debug) process.stderr.write(`[dsh] ${chunk.toString().slice(0, 300)}\n`)
    const match = TOKEN_URL.exec(log)
    if (match !== null && url === null) url = match[0]
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  child.on('error', (error) => {
    log += `\nspawn error: ${error.message}`
  })

  const deadline = Date.now() + (options.timeoutMs ?? 120_000)
  while (url === null && Date.now() < deadline) {
    if (child.exitCode !== null) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (url === null) {
    stopTree(child)
    throw new Error(`dsh did not print a token URL within the timeout:\n${log.slice(-1500)}`)
  }

  return { url, pid: child.pid, log: () => log, close: () => stopTree(child) }
}

function stopTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    // Already gone.
  }
}
