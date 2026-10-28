/**
 * Dev server supervisor (T019).
 *
 * Starts a long-running dev server without a shell, keeps a bounded log ring
 * buffer, polls an HTTP readiness URL (S8: HTTP 200, 10 s budget), and stops
 * the whole process tree on Windows with `taskkill /T /F`. Before stopping it
 * records descendant PIDs and cleans up any that `taskkill` missed, but only
 * when the recorded command line still matches — a recycled PID is never
 * killed. Every failure exposed to callers is a stable Studio error.
 *
 * All side effects (spawn, HTTP probe, process listing, tree kill, port probe)
 * are injectable so tests can drive a fake process without starting anything.
 */
import { execFile, spawn as spawnProcess } from 'node:child_process'
import { connect } from 'node:net'
import { isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { isStudioError, studioError, type StudioError } from '../../../contracts/errors'
import {
  createLogRingBuffer,
  stripAnsi,
  type DevServerLogEntry,
  type LogRingBufferSnapshotOptions,
} from './logs'

const execFileAsync = promisify(execFile)

const DEFAULT_READINESS_TIMEOUT_MS = 10_000
const DEFAULT_POLL_INTERVAL_MS = 100
const DEFAULT_STOP_TIMEOUT_MS = 5_000
const DEFAULT_CLEANUP_GRACE_MS = 100
const HTTP_PROBE_TIMEOUT_MS = 500
const PORT_PROBE_TIMEOUT_MS = 300
const MAX_OUTPUT_CHARS = 64 * 1024
const MAX_DISPLAY_COMMAND = 300

export interface DevServerSpec {
  readonly command: string
  readonly args?: readonly string[]
  readonly cwd: string
  readonly port: number
  /** Readiness URL; defaults to `http://127.0.0.1:<port>/`. */
  readonly url?: string
  readonly env?: Readonly<Record<string, string>>
}

export type DevServerStatus =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'stopped'
  | 'failed'

export interface DevServerExit {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly at: string
  /** True when the supervisor asked the process to stop. */
  readonly expected: boolean
}

export interface DevServerState {
  readonly status: DevServerStatus
  readonly pid: number | null
  readonly port: number | null
  readonly url: string | null
  readonly command: string | null
  /** Increments on every start; useful to tell runs apart after a restart. */
  readonly run: number
  readonly startedAt: string | null
  readonly readyAt: string | null
  readonly exit: DevServerExit | null
  readonly lastError?: StudioError
}

export interface DevServerStopResult {
  readonly status: 'stopped'
  readonly pid: number | null
  readonly portReleased: boolean
  /** Recorded descendants that were still alive after cleanup. */
  readonly survivors: readonly number[]
}

export interface DevServerStartOptions {
  readonly signal?: AbortSignal
}

export interface DevServerProcessInfo {
  readonly pid: number
  readonly parentPid: number
  readonly name: string
  readonly commandLine: string | null
}

export interface DevServerChildProcess {
  readonly pid?: number | undefined
  readonly stdout: NodeJS.ReadableStream | null
  readonly stderr: NodeJS.ReadableStream | null
  once(
    event: 'exit',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown
  once(event: 'error', listener: (error: Error) => void): unknown
  kill(signal?: NodeJS.Signals): boolean
}

export interface DevServerSpawnOptions {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly stdio: ['ignore', 'pipe', 'pipe']
  readonly windowsHide: boolean
  readonly shell: false
}

export type DevServerSpawn = (
  command: string,
  args: readonly string[],
  options: DevServerSpawnOptions,
) => DevServerChildProcess

export type DevServerTreeKill = (pid: number) => Promise<{
  readonly code: number | null
  readonly output: string
}>

export interface DevServerSupervisorOptions {
  readonly spawn?: DevServerSpawn
  readonly probeHttp?: (url: string) => Promise<boolean>
  readonly listProcesses?: () => Promise<readonly DevServerProcessInfo[]>
  readonly killTree?: DevServerTreeKill
  readonly probePort?: (port: number) => Promise<boolean>
  readonly platform?: NodeJS.Platform
  readonly readinessTimeoutMs?: number
  readonly pollIntervalMs?: number
  readonly stopTimeoutMs?: number
  readonly cleanupGraceMs?: number
  readonly logMaxEntries?: number
  readonly logMaxBytes?: number
  readonly now?: () => Date
}

export interface DevServerSupervisor {
  /** Starts the server and resolves once the readiness URL returns 2xx. */
  start(spec: DevServerSpec, options?: DevServerStartOptions): Promise<DevServerState>
  stop(): Promise<DevServerStopResult>
  /** Stops the current run and starts the last spec again. */
  restart(): Promise<DevServerState>
  logs(options?: LogRingBufferSnapshotOptions): readonly DevServerLogEntry[]
  clearLogs(): void
  state(): DevServerState
}

interface ActiveRun {
  readonly number: number
  readonly spec: DevServerSpec
  readonly proc: DevServerChildProcess
  readonly url: string
  readonly startedAt: string
  readonly startedAtMs: number
  readonly exited: Promise<void>
  readonly pid: number | undefined
  exit?: DevServerExit
  spawnError?: NodeJS.ErrnoException
  output: string
}

/* ------------------------------------------------------------------ */
/* Default side effects                                                */
/* ------------------------------------------------------------------ */

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: DevServerSpawnOptions,
): DevServerChildProcess {
  return spawnProcess(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: options.stdio,
    windowsHide: options.windowsHide,
    shell: options.shell,
  })
}

async function defaultProbeHttp(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(HTTP_PROBE_TIMEOUT_MS),
      redirect: 'manual',
    })
    const ok = response.ok
    if (response.body) await response.body.cancel().catch(() => undefined)
    return ok
  } catch {
    return false
  }
}

async function defaultProbePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    let settled = false
    const done = (open: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

const LIST_PROCESSES_SCRIPT =
  'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'

async function defaultListProcesses(): Promise<readonly DevServerProcessInfo[]> {
  if (process.platform !== 'win32') return []
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', LIST_PROCESSES_SCRIPT],
      { maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout: 15_000 },
    )
    const trimmed = stdout.trim()
    if (!trimmed) return []
    const parsed = JSON.parse(trimmed) as unknown
    const rawList = Array.isArray(parsed) ? parsed : [parsed]
    const list: DevServerProcessInfo[] = []
    for (const item of rawList) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      const pid = Number(record.ProcessId)
      const parentPid = Number(record.ParentProcessId)
      if (!Number.isInteger(pid) || !Number.isInteger(parentPid)) continue
      list.push({
        pid,
        parentPid,
        name: typeof record.Name === 'string' ? record.Name : '',
        commandLine: typeof record.CommandLine === 'string' ? record.CommandLine : null,
      })
    }
    return list
  } catch {
    return []
  }
}

async function defaultKillTree(pid: number): Promise<{
  readonly code: number | null
  readonly output: string
}> {
  try {
    const { stdout, stderr } = await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 10_000,
    })
    return { code: 0, output: `${stdout}${stderr}`.trim() }
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string }
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim()
    const alreadyGone = /not found|no running instance|已终止|没有找到|找不到/i.test(output)
    return {
      code: alreadyGone ? 0 : typeof err.code === 'number' ? err.code : 1,
      output,
    }
  }
}

/* ------------------------------------------------------------------ */
/* Validation and error mapping                                        */
/* ------------------------------------------------------------------ */

const SPEC_KEYS = new Set(['command', 'args', 'cwd', 'port', 'url', 'env'])

function invalidSpec(field: string, message: string): StudioError {
  return studioError('invalid_config', `vibe-studio: dev server: ${message}`, { field })
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '[::1]') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

function readString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') throw invalidSpec(field, `"${field}" must be a string`)
  const trimmed = value.trim()
  if (trimmed.length === 0) throw invalidSpec(field, `"${field}" must not be empty`)
  if (trimmed.length > maxLength) {
    throw invalidSpec(field, `"${field}" must be at most ${maxLength} characters`)
  }
  if (trimmed.includes('\0')) throw invalidSpec(field, `"${field}" must not contain null bytes`)
  return trimmed
}

export function validateDevServerSpec(input: unknown): DevServerSpec {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw studioError('invalid_config', 'vibe-studio: dev server spec must be an object')
  }
  const record = input as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!SPEC_KEYS.has(key)) {
      throw invalidSpec(key, `unknown key "${key}"`)
    }
  }

  const command = readString(record.command, 'command', 4096)
  const cwd = readString(record.cwd, 'cwd', 1024)
  if (!isAbsolute(cwd)) throw invalidSpec('cwd', '"cwd" must be an absolute path')

  const port = record.port
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw invalidSpec('port', '"port" must be an integer between 1 and 65535')
  }

  let args: string[] | undefined
  if (record.args !== undefined) {
    if (!Array.isArray(record.args)) throw invalidSpec('args', '"args" must be an array')
    args = record.args.map((arg, index) => readString(arg, `args[${index}]`, 4096))
  }

  let env: Record<string, string> | undefined
  if (record.env !== undefined) {
    if (
      !record.env ||
      typeof record.env !== 'object' ||
      Array.isArray(record.env)
    ) {
      throw invalidSpec('env', '"env" must be an object of strings')
    }
    env = {}
    for (const [key, value] of Object.entries(record.env as Record<string, unknown>)) {
      if (key.length === 0 || key.length > 256 || key.includes('\0')) {
        throw invalidSpec('env', `invalid environment variable name "${key}"`)
      }
      if (typeof value !== 'string' || value.length > 8192 || value.includes('\0')) {
        throw invalidSpec('env', `environment variable "${key}" must be a string`)
      }
      env[key] = value
    }
  }

  let url: string | undefined
  if (record.url !== undefined) {
    const raw = readString(record.url, 'url', 2048)
    let parsed: URL
    try {
      parsed = new URL(raw)
    } catch {
      throw invalidSpec('url', 'invalid "url"')
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw invalidSpec('url', '"url" must use http or https')
    }
    if (parsed.username || parsed.password) {
      throw invalidSpec('url', '"url" must not contain credentials')
    }
    if (!isLoopbackHost(parsed.hostname)) {
      throw studioError(
        'permission_denied',
        `dev server readiness URL "${parsed.hostname}" is not local; only loopback dev servers are supported`,
        { host: parsed.hostname },
      )
    }
    url = parsed.toString()
  }

  return {
    command,
    cwd,
    port,
    ...(args ? { args } : {}),
    ...(env ? { env } : {}),
    ...(url ? { url } : {}),
  }
}

function abortedError(): StudioError {
  return studioError('target_unavailable', 'dev server start was aborted before it became ready', {
    reason: 'aborted',
  })
}

function spawnFailure(command: string, error: unknown): StudioError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return studioError(
    'target_unavailable',
    `dev server command "${command}" could not be started`,
    { reason: 'spawn_failed', ...(typeof code === 'string' ? { code } : {}) },
  )
}

function firstMeaningfulLine(output: string): string | undefined {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.replace(/[\u0000-\u001f\u007f]/g, '').trim())
    .filter((line) => line.length > 0)
  const line = lines.find((candidate) => /error|in use|already|EADDRINUSE|failed/i.test(candidate))
  return (line ?? lines[0])?.slice(0, 300)
}

function exitFailure(spec: DevServerSpec, run: ActiveRun): StudioError {
  const output = stripAnsi(run.output)
  if (/already in use|EADDRINUSE|address in use/i.test(output)) {
    const match = /Port\s+(\d+)\s+is already in use/i.exec(output)
    const port = match ? Number(match[1]) : spec.port
    return studioError(
      'preview_failed',
      `dev server port ${port} is already in use; choose another port or stop the process using it`,
      { reason: 'port_in_use', port, exitCode: run.exit?.code ?? null },
    )
  }
  const line = firstMeaningfulLine(output)
  const code = run.exit?.code ?? null
  return studioError(
    'preview_failed',
    `dev server exited before it became ready (code ${code ?? 'null'})`,
    {
      reason: 'exited',
      exitCode: code,
      signal: run.exit?.signal ?? null,
      ...(line ? { line } : {}),
    },
  )
}

function unexpectedExitFailure(run: ActiveRun): StudioError {
  const code = run.exit?.code ?? null
  return studioError('preview_failed', `dev server exited unexpectedly (code ${code ?? 'null'})`, {
    reason: 'exited',
    exitCode: code,
    signal: run.exit?.signal ?? null,
  })
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function descendantsOf(
  rootPid: number,
  processes: readonly DevServerProcessInfo[],
): DevServerProcessInfo[] {
  const byParent = new Map<number, DevServerProcessInfo[]>()
  for (const proc of processes) {
    const list = byParent.get(proc.parentPid) ?? []
    list.push(proc)
    byParent.set(proc.parentPid, list)
  }
  const found: DevServerProcessInfo[] = []
  const seen = new Set<number>([rootPid])
  const queue = [rootPid]
  while (queue.length > 0) {
    const pid = queue.shift() as number
    for (const child of byParent.get(pid) ?? []) {
      if (seen.has(child.pid)) continue
      seen.add(child.pid)
      found.push(child)
      queue.push(child.pid)
    }
  }
  return found
}

function formatCommand(spec: DevServerSpec): string {
  const text = stripAnsi([spec.command, ...(spec.args ?? [])].join(' '))
  return text.length > MAX_DISPLAY_COMMAND ? `${text.slice(0, MAX_DISPLAY_COMMAND)}…` : text
}

function appendOutput(current: string, text: string): string {
  const next = `${current}${text}`
  return next.length > MAX_OUTPUT_CHARS ? next.slice(-MAX_OUTPUT_CHARS) : next
}

/* ------------------------------------------------------------------ */
/* Supervisor                                                          */
/* ------------------------------------------------------------------ */

export function createDevServerSupervisor(
  options: DevServerSupervisorOptions = {},
): DevServerSupervisor {
  const spawnFn = options.spawn ?? defaultSpawn
  const probeHttp = options.probeHttp ?? defaultProbeHttp
  const listProcesses = options.listProcesses ?? defaultListProcesses
  const killTree = options.killTree ?? defaultKillTree
  const probePort = options.probePort ?? defaultProbePort
  const platform = options.platform ?? process.platform
  const readinessTimeoutMs = options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
  const stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS
  const cleanupGraceMs = Math.max(0, options.cleanupGraceMs ?? DEFAULT_CLEANUP_GRACE_MS)
  const now = options.now ?? (() => new Date())
  const logBuffer = createLogRingBuffer({
    maxEntries: options.logMaxEntries,
    maxBytes: options.logMaxBytes,
  })

  let status: DevServerStatus = 'idle'
  let spec: DevServerSpec | undefined
  let active: ActiveRun | undefined
  let lastPid: number | undefined
  let startedAt: string | null = null
  let readyAt: string | null = null
  let lastExit: DevServerExit | undefined
  let lastError: StudioError | undefined
  let runCount = 0
  let pendingStart: Promise<DevServerState> | undefined
  let pendingStop: Promise<DevServerStopResult> | undefined

  function snapshotState(): DevServerState {
    return {
      status,
      pid: active?.pid ?? lastPid ?? null,
      port: spec?.port ?? null,
      url: spec ? (spec.url ?? `http://127.0.0.1:${spec.port}/`) : null,
      command: spec?.command ?? null,
      run: runCount,
      startedAt: active?.startedAt ?? startedAt,
      readyAt,
      exit: lastExit ?? null,
      ...(lastError ? { lastError } : {}),
    }
  }

  function attachRun(run: ActiveRun, resolveExited: () => void): void {
    const current = () => active === run
    const append = (stream: 'stdout' | 'stderr', chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if (current()) logBuffer.append(stream, text, now())
      run.output = appendOutput(run.output, text)
    }

    run.proc.stdout?.on('data', (chunk: Buffer | string) => append('stdout', chunk))
    run.proc.stderr?.on('data', (chunk: Buffer | string) => append('stderr', chunk))

    run.proc.once('exit', (code, signal) => {
      const expected = status === 'stopping' || status === 'stopped'
      run.exit = { code, signal, at: now().toISOString(), expected }
      lastExit = run.exit
      if (current()) {
        logBuffer.flush(now())
        logBuffer.system(
          `process exited (code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''})`,
          now(),
        )
        if (status === 'ready') {
          status = 'failed'
          lastError = unexpectedExitFailure(run)
          logBuffer.system(`failed: ${lastError.message}`, now())
        }
      }
      resolveExited()
    })

    run.proc.once('error', (error) => {
      run.spawnError = error as NodeJS.ErrnoException
      if (current()) logBuffer.system(`spawn error: ${error.message}`, now())
      resolveExited()
    })
  }

  async function safeListProcesses(): Promise<readonly DevServerProcessInfo[]> {
    try {
      return await listProcesses()
    } catch {
      return []
    }
  }

  async function recordDescendants(
    rootPid: number | undefined,
  ): Promise<readonly DevServerProcessInfo[]> {
    if (rootPid === undefined) return []
    return descendantsOf(rootPid, await safeListProcesses())
  }

  async function cleanupDescendants(
    recorded: readonly DevServerProcessInfo[],
  ): Promise<number[]> {
    if (recorded.length === 0) return []
    await delay(cleanupGraceMs)
    const live = await safeListProcesses()
    for (const recordedProc of recorded) {
      const current = live.find((proc) => proc.pid === recordedProc.pid)
      // Only kill a PID whose command line still matches what we recorded;
      // otherwise the PID was recycled by an unrelated process.
      if (!current || recordedProc.commandLine === null) continue
      if (current.commandLine !== recordedProc.commandLine) continue
      const killed = await killTree(recordedProc.pid).catch(() => ({ code: null, output: '' }))
      logBuffer.system(
        `cleaned up orphan pid ${recordedProc.pid} (code ${killed.code ?? 'unknown'})`,
        now(),
      )
    }
    await delay(cleanupGraceMs)
    const after = await safeListProcesses()
    return recorded
      .filter((recordedProc) => {
        const current = after.find((proc) => proc.pid === recordedProc.pid)
        return (
          current !== undefined &&
          recordedProc.commandLine !== null &&
          current.commandLine === recordedProc.commandLine
        )
      })
      .map((recordedProc) => recordedProc.pid)
  }

  function waitForExit(run: ActiveRun, timeoutMs: number): Promise<boolean> {
    if (run.exit) return Promise.resolve(true)
    return new Promise((resolve) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        resolve(false)
      }, timeoutMs)
      run.exited.then(() => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(true)
      })
    })
  }

  async function waitPortClosed(port: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (true) {
      const open = await probePort(port).catch(() => false)
      if (!open) return true
      if (Date.now() >= deadline) return false
      await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())))
    }
  }

  async function shutdown(
    run: ActiveRun,
    options: { verifyPort?: boolean } = {},
  ): Promise<{ survivors: readonly number[]; portReleased: boolean }> {
    const rootPid = run.pid
    const recorded = await recordDescendants(rootPid)

    if (!run.exit) {
      if (platform === 'win32' && rootPid !== undefined) {
        const killed = await killTree(rootPid).catch(() => ({ code: null, output: '' }))
        logBuffer.system(
          `tree kill pid ${rootPid} (code ${killed.code ?? 'unknown'})`,
          now(),
        )
      } else {
        try {
          run.proc.kill('SIGTERM')
        } catch {
          // The process is already gone; the exit promise decides below.
        }
      }
    }

    let exited = await waitForExit(run, stopTimeoutMs)
    if (!exited && rootPid !== undefined) {
      if (platform !== 'win32') {
        try {
          run.proc.kill('SIGKILL')
        } catch {
          // Ignore: a failed signal still falls through to the tree kill.
        }
        exited = await waitForExit(run, Math.min(1_000, stopTimeoutMs))
      }
      if (!exited) {
        const killed = await killTree(rootPid).catch(() => ({ code: null, output: '' }))
        logBuffer.system(`forced kill pid ${rootPid} (code ${killed.code ?? 'unknown'})`, now())
        await waitForExit(run, Math.min(1_000, stopTimeoutMs))
      }
    }

    const survivors = await cleanupDescendants(recorded)
    if (active === run) active = undefined

    // When a start fails because the child exited on its own (for example a
    // strictPort conflict), the port belongs to another process. Waiting for
    // it to close would block for the full stop timeout and then report a
    // misleading "still in use after stop" failure.
    if (options.verifyPort === false) return { survivors, portReleased: true }

    const portReleased = await waitPortClosed(run.spec.port, stopTimeoutMs)
    if (!portReleased) {
      lastError = studioError(
        'preview_failed',
        `dev server port ${run.spec.port} is still in use after stop`,
        { port: run.spec.port, reason: 'port_busy' },
      )
      logBuffer.system(`failed: ${lastError.message}`, now())
    }
    return { survivors, portReleased }
  }

  async function beginStart(
    validated: DevServerSpec,
    startOptions: DevServerStartOptions,
  ): Promise<DevServerState> {
    const signal = startOptions.signal
    runCount += 1
    spec = validated
    status = 'starting'
    lastError = undefined
    lastExit = undefined
    readyAt = null
    startedAt = now().toISOString()
    logBuffer.clear()

    const url = validated.url ?? `http://127.0.0.1:${validated.port}/`
    logBuffer.system(`starting ${formatCommand(validated)} (port ${validated.port})`, now())
    const startedAtMs = Date.now()

    let proc: DevServerChildProcess
    try {
      proc = spawnFn(validated.command, validated.args ?? [], {
        cwd: validated.cwd,
        env: { ...process.env, ...validated.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      })
    } catch (error) {
      throw spawnFailure(validated.command, error)
    }

    let resolveExited!: () => void
    const exited = new Promise<void>((resolve) => {
      resolveExited = resolve
    })
    const run: ActiveRun = {
      number: runCount,
      spec: validated,
      proc,
      url,
      startedAt,
      startedAtMs,
      exited,
      pid: proc.pid,
      output: '',
    }
    active = run
    lastPid = proc.pid
    attachRun(run, resolveExited)
    logBuffer.system(`spawned pid ${proc.pid ?? 'unknown'}`, now())

    if (proc.pid === undefined) {
      await delay(50)
      if (run.spawnError) throw spawnFailure(validated.command, run.spawnError)
      throw spawnFailure(validated.command, new Error('process has no pid'))
    }

    const deadline = Date.now() + readinessTimeoutMs
    while (true) {
      if (signal?.aborted) throw abortedError()
      if (run.spawnError) throw spawnFailure(validated.command, run.spawnError)
      if (run.exit) throw exitFailure(validated, run)

      const ready = await probeHttp(run.url).catch(() => false)
      if (ready) {
        if (run.exit) throw exitFailure(validated, run)
        status = 'ready'
        readyAt = now().toISOString()
        logBuffer.system(
          `ready at ${run.url} in ${Date.now() - startedAtMs} ms`,
          now(),
        )
        return snapshotState()
      }

      if (Date.now() >= deadline) {
        throw studioError(
          'timeout',
          `dev server did not become ready at ${run.url} within ${readinessTimeoutMs} ms`,
          { port: validated.port, timeoutMs: readinessTimeoutMs },
        )
      }
      await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())))
    }
  }

  function start(
    input: DevServerSpec,
    startOptions: DevServerStartOptions = {},
  ): Promise<DevServerState> {
    if (status === 'starting' && pendingStart) return pendingStart
    if (status === 'ready' && active) return Promise.resolve(snapshotState())

    let validated: DevServerSpec
    try {
      validated = validateDevServerSpec(input)
    } catch (error) {
      return Promise.reject(error)
    }
    if (startOptions.signal?.aborted) return Promise.reject(abortedError())
    if (status === 'stopping' && pendingStop) {
      return pendingStop.then(() => start(validated, startOptions))
    }

    pendingStart = (async () => {
      try {
        if (active) await shutdown(active)
        return await beginStart(validated, startOptions)
      } catch (error) {
        const studio = isStudioError(error)
          ? error
          : studioError('preview_failed', 'dev server failed to start', { reason: 'unknown' })
        if (active) {
          status = 'stopping'
          // A child that already exited by itself never owned the failed
          // start's port; only verify release when cleanup had to kill it.
          await shutdown(active, { verifyPort: active.exit === undefined })
        }
        status = 'failed'
        // Keep the start failure as the reported error even if cleanup also
        // noticed a busy port.
        lastError = studio
        logBuffer.system(`start failed: ${studio.message}`, now())
        throw studio
      } finally {
        pendingStart = undefined
      }
    })()
    return pendingStart
  }

  function stop(): Promise<DevServerStopResult> {
    if (pendingStop) return pendingStop
    if (status === 'idle' || status === 'stopped') {
      return Promise.resolve({
        status: 'stopped',
        pid: lastPid ?? null,
        portReleased: true,
        survivors: [],
      })
    }

    pendingStop = (async (): Promise<DevServerStopResult> => {
      if (status === 'starting' && pendingStart) await pendingStart.catch(() => undefined)
      const run = active
      if (!run) {
        status = 'stopped'
        const portReleased = spec ? await waitPortClosed(spec.port, stopTimeoutMs) : true
        return { status: 'stopped', pid: lastPid ?? null, portReleased, survivors: [] }
      }
      status = 'stopping'
      logBuffer.system('stopping dev server', now())
      const result = await shutdown(run)
      status = 'stopped'
      logBuffer.system(
        result.portReleased ? 'stopped' : 'stopped with port still in use',
        now(),
      )
      return {
        status: 'stopped',
        pid: run.pid ?? null,
        portReleased: result.portReleased,
        survivors: result.survivors,
      }
    })().finally(() => {
      pendingStop = undefined
    })
    return pendingStop
  }

  function restart(): Promise<DevServerState> {
    if (!spec) {
      return Promise.reject(
        studioError('invalid_input', 'no dev server spec is available to restart', {
          field: 'spec',
        }),
      )
    }
    const current = spec
    return stop().then(() => start(current))
  }

  return {
    start,
    stop,
    restart,
    logs(logOptions) {
      return logBuffer.snapshot(logOptions)
    },
    clearLogs() {
      logBuffer.clear()
    },
    state() {
      return snapshotState()
    },
  }
}
