/**
 * S8 spike — dev server process lifecycle on Windows.
 *
 * Measures, against the real Vite fixture:
 *  1. how long a Vite dev server takes to become reachable (spawn → TCP → HTTP),
 *  2. what a naive parent-only kill leaves behind,
 *  3. whether `taskkill /T /F` clears the whole tree (no orphans, port released),
 *  4. what happens when the port is already taken (readable error?).
 *
 * This is measurement only; the supervisor product code lands in T019.
 *
 * Run: pnpm tsx spikes/s8/run.ts
 */
import { execFile } from 'node:child_process'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer as createNetServer, connect } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const root = fileURLToPath(new URL('../..', import.meta.url))
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const viteConfig = join(root, 'fixtures', 'vite-basic', 'vite.config.ts')

const START_BUDGET_MS = 10_000
const RUNS = 3
const ORPHAN_GRACE_MS = 1_500

type ProcInfo = {
  ProcessId: number
  ParentProcessId: number
  Name: string
  CommandLine: string | null
}

type Spawned = {
  label: string
  child: ChildProcess
  spawnedAt: number
  stdout: string
  stderr: string
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null; at: number }>
  readyLogAt: number | null
}

type StartMeasurement = {
  run: number
  port: number
  spawnToPortMs: number | null
  spawnToHttpMs: number | null
  spawnToReadyLogMs: number | null
  pass: boolean
}

type StopMeasurement = {
  strategy: 'child.kill()' | 'taskkill /T /F'
  exitMs: number | null
  portReleaseMs: number | null
  descendantsBefore: number
  survivors: { pid: number; name: string }[]
  leakedPort: boolean
  pass: boolean
}

const tracked = new Set<number>()
const spawnedLog: Spawned[] = []

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function portOpen(port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const done = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

async function waitFor<T>(
  fn: () => Promise<T | null> | T | null,
  timeoutMs: number,
  intervalMs = 25,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await fn()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return null
}

function now(): number {
  return performance.now()
}

async function listProcesses(): Promise<ProcInfo[]> {
  const script =
    'Get-CimInstance Win32_Process | Where-Object { $_.Name -match "^(node|esbuild|cmd)(\\.exe)?$" } | ' +
    'Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress'
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    const trimmed = stdout.trim()
    if (!trimmed) return []
    const parsed = JSON.parse(trimmed) as ProcInfo | ProcInfo[]
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list.map((p) => ({ ...p, CommandLine: p.CommandLine ?? null }))
  } catch {
    return []
  }
}

function isOursCommand(commandLine: string | null): boolean {
  return commandLine !== null && /vite\.js|fixtures[\\/]vite-basic|S8_VITE_BIN/.test(commandLine)
}

function descendantsOf(rootPid: number, procs: ProcInfo[]): ProcInfo[] {
  const byParent = new Map<number, ProcInfo[]>()
  for (const proc of procs) {
    const list = byParent.get(proc.ParentProcessId) ?? []
    list.push(proc)
    byParent.set(proc.ParentProcessId, list)
  }
  const found: ProcInfo[] = []
  const queue = [rootPid]
  const seen = new Set<number>([rootPid])
  while (queue.length > 0) {
    const pid = queue.shift() as number
    for (const child of byParent.get(pid) ?? []) {
      if (seen.has(child.ProcessId)) continue
      seen.add(child.ProcessId)
      found.push(child)
      queue.push(child.ProcessId)
    }
  }
  return found
}

function spawnVite(label: string, port: number, viaShell = false): Spawned {
  const args = [
    viteBin,
    '--config',
    viteConfig,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
    '--clearScreen',
    'false',
  ]
  const env = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    S8_SPIKE: '1',
    S8_VITE_BIN: viteBin,
    S8_CFG: viteConfig,
    S8_PORT: String(port),
  }

  let child: ChildProcess
  const spawnedAt = now()
  if (viaShell) {
    // Extra indirection: node → cmd.exe → node vite, like a supervisor that
    // spawns through a shell. cmd.exe is not a Node parent, so nothing creates
    // a job for its children.
    const command =
      'node "%S8_VITE_BIN%" --config "%S8_CFG%" --host 127.0.0.1 ' +
      '--port %S8_PORT% --strictPort --clearScreen false'
    child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: true,
    })
  } else {
    child = spawn(process.execPath, args, {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  }

  const entry: Spawned = {
    label,
    child,
    spawnedAt,
    stdout: '',
    stderr: '',
    exit: new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal, at: now() }))
    }),
    readyLogAt: null,
  }
  tracked.add(child.pid as number)
  spawnedLog.push(entry)

  const markReadyLog = (text: string) => {
    if (entry.readyLogAt === null && /Local:|ready in/i.test(text)) entry.readyLogAt = now()
  }
  child.stdout?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    entry.stdout += text
    markReadyLog(text)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString('utf8')
    entry.stderr += text
    markReadyLog(text)
  })
  return entry
}

async function waitHttp(port: number, timeoutMs: number): Promise<number | null> {
  return waitFor(
    async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })
        if (res.ok) {
          await res.text()
          return now()
        }
        return null
      } catch {
        return null
      }
    },
    timeoutMs,
    50,
  )
}

async function taskkillTree(pid: number, force = true): Promise<{ code: number | null; output: string }> {
  const args = ['/PID', String(pid), '/T']
  if (force) args.push('/F')
  try {
    const { stdout, stderr } = await execFileAsync('taskkill', args, { windowsHide: true })
    return { code: 0, output: `${stdout}${stderr}`.trim() }
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string }
    return { code: err.code ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() }
  }
}

async function waitPortClosed(port: number, timeoutMs = 5_000): Promise<number | null> {
  return waitFor(async () => ((await portOpen(port)) ? null : now()), timeoutMs, 25)
}

async function measureStart(run: number): Promise<StartMeasurement> {
  const port = await freePort()
  const proc = spawnVite(`start-${run}`, port)
  const portAt = await waitFor(async () => ((await portOpen(port)) ? now() : null), START_BUDGET_MS, 25)
  const httpAt = portAt === null ? null : await waitHttp(port, Math.max(1_000, START_BUDGET_MS - (now() - proc.spawnedAt)))
  const readyLogAt = await waitFor(() => (proc.readyLogAt !== null ? proc.readyLogAt : null), 1_000, 25)

  const spawnToPortMs = portAt === null ? null : Math.round(portAt - proc.spawnedAt)
  const spawnToHttpMs = httpAt === null ? null : Math.round(httpAt - proc.spawnedAt)
  const spawnToReadyLogMs = readyLogAt === null ? null : Math.round(readyLogAt - proc.spawnedAt)

  // Stop for the next scenario; this also feeds the tree-kill measurement.
  const pid = proc.child.pid as number
  await new Promise((resolve) => setTimeout(resolve, 250))
  const before = descendantsOf(pid, await listProcesses())
  for (const child of before) tracked.add(child.ProcessId)
  const killAt = now()
  const killed = await taskkillTree(pid)
  const exited = await Promise.race([proc.exit, new Promise<null>((r) => setTimeout(() => r(null), 5_000))])
  const closedAt = await waitPortClosed(port, 5_000)
  await new Promise((resolve) => setTimeout(resolve, ORPHAN_GRACE_MS))
  const after = descendantsOf(pid, await listProcesses())
  const survivors = after.filter((p) => before.some((b) => b.ProcessId === p.ProcessId))

  const stop: StopMeasurement = {
    strategy: 'taskkill /T /F',
    exitMs: exited ? Math.round(exited.at - killAt) : null,
    portReleaseMs: closedAt === null ? null : Math.round(closedAt - killAt),
    descendantsBefore: before.length,
    survivors: survivors.map((p) => ({ pid: p.ProcessId, name: p.Name })),
    leakedPort: (await portOpen(port)) === false ? false : true,
    pass: killed.code === 0 && exited !== null && closedAt !== null && survivors.length === 0 && !(await portOpen(port)),
  }
  stops.push({ ...stop, run })

  return {
    run,
    port,
    spawnToPortMs,
    spawnToHttpMs,
    spawnToReadyLogMs,
    pass: spawnToHttpMs !== null && spawnToHttpMs < START_BUDGET_MS,
  }
}

async function measureNodeJob(): Promise<{ port: number; childInJob: boolean | null }> {
  const port = await freePort()
  const proc = spawnVite('job-probe', port)
  await waitHttp(port, START_BUDGET_MS)
  const pid = proc.child.pid as number
  const script =
    "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class J{" +
    "[DllImport(\"kernel32.dll\",SetLastError=true)]public static extern bool IsProcessInJob(IntPtr h,IntPtr j,out bool r);" +
    '[DllImport("kernel32.dll",SetLastError=true)]public static extern IntPtr OpenProcess(int a,bool b,int p);}\'; ' +
    `$h=[J]::OpenProcess(0x1000,$false,${pid}); $r=$false; [J]::IsProcessInJob($h,[IntPtr]::Zero,[ref]$r) | Out-Null; if($r){"true"}else{"false"}`
  let childInJob: boolean | null = null
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
    })
    childInJob = stdout.trim() === 'true'
  } catch {
    childInJob = null
  }
  await taskkillTree(pid, true)
  await Promise.race([proc.exit, new Promise<null>((r) => setTimeout(() => r(null), 5_000))])
  await waitPortClosed(port, 5_000)
  return { port, childInJob }
}

async function measureNaiveKill(): Promise<StopMeasurement> {
  const port = await freePort()
  const proc = spawnVite('naive-kill', port)
  await waitHttp(port, START_BUDGET_MS)
  const pid = proc.child.pid as number
  const before = descendantsOf(pid, await listProcesses())
  // Snapshot again — esbuild may come up just after the first HTTP response.
  await new Promise((resolve) => setTimeout(resolve, 250))
  const before2 = descendantsOf(pid, await listProcesses())
  const seen = new Map<number, ProcInfo>()
  for (const p of [...before, ...before2]) seen.set(p.ProcessId, p)
  for (const p of seen.values()) tracked.add(p.ProcessId)

  const killAt = now()
  proc.child.kill()
  const exited = await Promise.race([proc.exit, new Promise<null>((r) => setTimeout(() => r(null), 5_000))])
  const closedAt = await waitPortClosed(port, 5_000)
  await new Promise((resolve) => setTimeout(resolve, ORPHAN_GRACE_MS))

  const live = new Set((await listProcesses()).map((p) => p.ProcessId))
  const survivors = [...seen.values()].filter((p) => live.has(p.ProcessId))

  return {
    strategy: 'child.kill()',
    exitMs: exited ? Math.round(exited.at - killAt) : null,
    portReleaseMs: closedAt === null ? null : Math.round(closedAt - killAt),
    descendantsBefore: seen.size,
    survivors: survivors.map((p) => ({ pid: p.ProcessId, name: p.Name })),
    leakedPort: await portOpen(port),
    pass: exited !== null && closedAt !== null && survivors.length === 0 && !(await portOpen(port)),
  }
}

async function measureWrapperOrphan(): Promise<{
  descendantsBefore: number
  survivorsAfterParentKill: { pid: number; name: string }[]
  orphanHeldPort: boolean
  cleanedUp: boolean
  port: number
}> {
  const port = await freePort()
  const proc = spawnVite('shell-orphan', port, true)
  const wrapperPid = proc.child.pid as number
  await waitHttp(port, START_BUDGET_MS)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const before = descendantsOf(wrapperPid, await listProcesses())
  for (const p of before) tracked.add(p.ProcessId)

  // Kill only the wrapper (no /T): this is the classic orphan-making failure mode.
  proc.child.kill()
  await Promise.race([proc.exit, new Promise<null>((r) => setTimeout(() => r(null), 5_000))])
  await new Promise((resolve) => setTimeout(resolve, ORPHAN_GRACE_MS))

  const liveProcs = await listProcesses()
  const live = new Set(liveProcs.map((p) => p.ProcessId))
  const survivors = before.filter((p) => live.has(p.ProcessId))
  const orphanHeldPort = await portOpen(port)

  // Clean up every recorded descendant directly; taskkill /T on the dead
  // wrapper cannot reach them, which is exactly why PIDs must be recorded.
  // Re-check the command line so a recycled PID is never killed.
  const liveProcsAfterKill = await listProcesses()
  for (const survivor of survivors) {
    const current = liveProcsAfterKill.find((p) => p.ProcessId === survivor.ProcessId)
    if (!current || !isOursCommand(current.CommandLine)) continue
    await taskkillTree(survivor.ProcessId, true)
  }
  const closed = await waitPortClosed(port, 5_000)
  const allGone = await waitFor(async () => {
    const liveNow = new Set((await listProcesses()).map((p) => p.ProcessId))
    return before.every((p) => !liveNow.has(p.ProcessId)) ? true : null
  }, 5_000, 100)

  return {
    descendantsBefore: before.length,
    survivorsAfterParentKill: survivors.map((p) => ({ pid: p.ProcessId, name: p.Name })),
    orphanHeldPort,
    cleanedUp: closed !== null && allGone === true,
    port,
  }
}

async function measurePortConflict(): Promise<{
  port: number
  exitCode: number | null
  durationMs: number | null
  message: string
  readable: boolean
}> {
  const port = await freePort()
  const blocker = createNetServer()
  await new Promise<void>((resolve, reject) => {
    blocker.once('error', reject)
    blocker.listen(port, '127.0.0.1', () => resolve())
  })

  const proc = spawnVite('port-conflict', port)
  const startedAt = proc.spawnedAt
  const exited = await Promise.race([
    proc.exit,
    new Promise<null>((r) => setTimeout(() => r(null), 15_000)),
  ])
  const output = `${proc.stdout}\n${proc.stderr}`.trim()
  await new Promise<void>((resolve) => blocker.close(() => resolve()))

  const exitCode = exited?.code ?? null
  const durationMs = exited ? Math.round(exited.at - startedAt) : null
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const firstLine =
    lines.find((line) => line.includes(String(port))) ??
    lines.find((line) => /in use|already/i.test(line)) ??
    lines[0] ??
    output.slice(0, 300)

  return {
    port,
    exitCode,
    durationMs,
    message: firstLine,
    readable: exitCode !== null && exitCode !== 0 && new RegExp(String(port)).test(output) && /in use|already/i.test(output),
  }
}

async function checkPortProbe(runs = 5): Promise<{ ports: number[]; allBindable: boolean }> {
  const ports: number[] = []
  let allBindable = true
  for (let i = 0; i < runs; i += 1) {
    const port = await freePort()
    ports.push(port)
    const server = createNetServer()
    const bindable = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
    })
    if (!bindable) allBindable = false
  }
  return { ports, allBindable }
}

async function leftoverProcesses(ports: number[]): Promise<{ pid: number; name: string; reason: string }[]> {
  const procs = await listProcesses()
  const self = process.pid
  const leftovers: { pid: number; name: string; reason: string }[] = []
  for (const proc of procs) {
    if (proc.ProcessId === self) continue
    const cmd = proc.CommandLine ?? ''
    if (!/vite\.js|fixtures[\\/]vite-basic/.test(cmd)) continue
    const port = ports.find((p) => new RegExp(`--port\\s+${p}(\\s|$)`).test(cmd))
    if (port !== undefined) leftovers.push({ pid: proc.ProcessId, name: proc.Name, reason: `port ${port}` })
  }
  return leftovers
}

const starts: StartMeasurement[] = []
const stops: (StopMeasurement & { run?: number })[] = []

function displayPath(path: string): string {
  return path.replace(root, '<repo>/').replace(/\\/g, '/')
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
}

async function main(): Promise<void> {
  console.log('S8 spike — Vite dev server lifecycle (Windows)')
  console.log(`node ${process.version} · ${process.platform} ${process.arch}`)
  console.log(`vite ${displayPath(viteBin)}`)
  console.log(`fixture ${displayPath(viteConfig)}\n`)

  const probe = await checkPortProbe()
  console.log(`port probe: ${probe.ports.join(', ')} · all bindable ${probe.allBindable ? 'yes' : 'NO'}`)

  const job = await measureNodeJob()
  console.log(
    `node job object: direct child in job ${job.childInJob === null ? 'unknown' : job.childInJob ? 'yes' : 'no'}`,
  )

  console.log(`\n[start] ${RUNS} spawns, budget ${START_BUDGET_MS} ms`)
  for (let i = 1; i <= RUNS; i += 1) {
    const result = await measureStart(i)
    starts.push(result)
    console.log(
      `  run ${i} port ${result.port}: tcp ${result.spawnToPortMs} ms · http ${result.spawnToHttpMs} ms · ` +
        `ready-log ${result.spawnToReadyLogMs} ms · ${result.pass ? 'PASS' : 'FAIL'}`,
    )
  }

  console.log('\n[stop] child.kill() — parent only, no tree kill')
  const naive = await measureNaiveKill()
  stops.push(naive)
  console.log(
    `  exit ${naive.exitMs} ms · port released ${naive.portReleaseMs} ms · ` +
      `descendants ${naive.descendantsBefore} · survivors ${naive.survivors.length}` +
      `${naive.survivors.length > 0 ? ` (${naive.survivors.map((s) => `${s.name}#${s.pid}`).join(', ')})` : ''} · ` +
      `${naive.pass ? 'PASS' : 'FAIL'}`,
  )

  console.log('\n[stop] taskkill /T /F — full tree (measured during each start run)')
  for (const stop of stops.filter((s) => s.strategy === 'taskkill /T /F')) {
    console.log(
      `  run ${stop.run} exit ${stop.exitMs} ms · port released ${stop.portReleaseMs} ms · ` +
        `descendants ${stop.descendantsBefore} · survivors ${stop.survivors.length} · ${stop.pass ? 'PASS' : 'FAIL'}`,
    )
  }

  console.log('\n[orphan] cmd.exe wrapper → vite node, kill wrapper only (shell: true)')
  const wrapper = await measureWrapperOrphan()
  console.log(
    `  descendants ${wrapper.descendantsBefore} · survivors after wrapper kill ` +
      `${wrapper.survivorsAfterParentKill.length}` +
      `${wrapper.survivorsAfterParentKill.length > 0 ? ` (${wrapper.survivorsAfterParentKill.map((s) => `${s.name}#${s.pid}`).join(', ')})` : ''} · ` +
      `orphan still holds port ${wrapper.orphanHeldPort ? 'yes' : 'no'} · ` +
      `direct cleanup ${wrapper.cleanedUp ? 'PASS' : 'FAIL'}`,
  )

  console.log('\n[conflict] Vite with --strictPort on an occupied port')
  const conflict = await measurePortConflict()
  console.log(
    `  exit ${conflict.exitCode} in ${conflict.durationMs} ms · message: ${JSON.stringify(conflict.message)} · ` +
      `${conflict.readable ? 'READABLE' : 'NOT READABLE'}`,
  )

  const listenPorts = [...starts.map((s) => s.port), job.port, wrapper.port, conflict.port]
  const leftovers = await leftoverProcesses(listenPorts)
  const openPorts: number[] = []
  for (const port of listenPorts) if (await portOpen(port)) openPorts.push(port)

  const startTimes = starts.map((s) => s.spawnToHttpMs).filter((v): v is number => v !== null)
  const treeStops = stops.filter((s) => s.strategy === 'taskkill /T /F')
  const pass =
    starts.every((s) => s.pass) &&
    probe.allBindable &&
    treeStops.every((s) => s.pass) &&
    wrapper.cleanedUp &&
    wrapper.survivorsAfterParentKill.length > 0 &&
    wrapper.orphanHeldPort &&
    conflict.readable &&
    leftovers.length === 0 &&
    openPorts.length === 0

  console.log('\n[cleanup]')
  console.log(`  leftover vite processes: ${leftovers.length}${leftovers.length > 0 ? ` → ${JSON.stringify(leftovers)}` : ''}`)
  console.log(`  ports still listening: ${openPorts.length}${openPorts.length > 0 ? ` → ${openPorts.join(', ')}` : ''}`)

  console.log('\n[summary]')
  console.log(
    `  start http ms: ${startTimes.join(', ')} · median ${median(startTimes)} · max ${Math.max(...startTimes)} ` +
      `(budget ${START_BUDGET_MS})`,
  )
  console.log(`  tree-kill stops without survivors: ${treeStops.filter((s) => s.pass).length}/${treeStops.length}`)
  console.log(`  naive kill survivors: ${naive.survivors.length}`)
  console.log(`  shell-wrapper orphans after parent-only kill: ${wrapper.survivorsAfterParentKill.length}`)
  console.log(`  overall: ${pass ? 'PASS' : 'FAIL'}`)

  const summary = {
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    portProbe: probe,
    job,
    starts,
    stops,
    wrapper,
    conflict,
    cleanup: { leftovers, openPorts },
    pass,
  }
  const logDir = join(root, '.tmp', 'logs')
  await mkdir(logDir, { recursive: true })
  const resultPath = join(logDir, 's8-results.json')
  await writeFile(resultPath, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(`results -> ${displayPath(resultPath)}`)
  if (!pass) process.exitCode = 1
}

async function cleanup(): Promise<void> {
  // Last-resort cleanup: every PID we ever spawned or discovered, but only if
  // it still runs our command line (PIDs can be recycled).
  const live = await listProcesses()
  for (const proc of live) {
    if (!tracked.has(proc.ProcessId)) continue
    if (!isOursCommand(proc.CommandLine)) continue
    await taskkillTree(proc.ProcessId, true)
  }
}

try {
  await main()
} finally {
  await cleanup()
}
