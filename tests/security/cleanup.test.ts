/**
 * T059 cleanup audit (FR-SEC-07, SPEC §9 "clean up the process tree").
 *
 * The fake-process suite proves the decision logic; this one proves the real
 * Windows path: a dev server that spawns a grandchild is stopped with
 * `taskkill /T`, no recorded descendant survives, and the port is reusable.
 * The whole fixture lives under `.tmp/` and is removed afterwards.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createDevServerSupervisor,
  type DevServerState,
} from '../../src/host/targets/process/supervisor'

const CHILD_SCRIPT = `
const { createServer } = require('node:http')
const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const [port, pidFile] = process.argv.slice(2)
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
})
writeFileSync(pidFile, String(grandchild.pid))
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/plain' })
  response.end('ok')
})
server.listen(Number(port), '127.0.0.1')
`

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function freePort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>((resolveListen, reject) =>
    server.once('error', reject).listen(0, '127.0.0.1', resolveListen),
  )
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  if (port === 0) throw new Error('could not allocate a loopback port')
  return port
}

async function listenProbe(port: number): Promise<boolean> {
  const server = createServer()
  try {
    await new Promise<void>((resolveListen, reject) =>
      server.once('error', reject).listen(port, '127.0.0.1', resolveListen),
    )
    return true
  } catch {
    return false
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  }
}

const tempDirs: string[] = []
const supervisors: Array<{ stop(): Promise<unknown> }> = []

afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) {
    await supervisor.stop().catch(() => undefined)
  }
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform !== 'win32')('process-tree cleanup', () => {
  it(
    'stops the dev server, its grandchild and releases the port',
    async () => {
      await mkdir(resolve('.tmp'), { recursive: true })
      const dir = await mkdtemp(resolve('.tmp', 'security-cleanup-'))
      tempDirs.push(dir)
      const script = join(dir, 'server.cjs')
      const pidFile = join(dir, 'grandchild.pid')
      await writeFile(script, CHILD_SCRIPT, 'utf8')
      const port = await freePort()

      const supervisor = createDevServerSupervisor()
      supervisors.push(supervisor)

      let state: DevServerState | undefined
      try {
        state = await supervisor.start({
          command: process.execPath,
          args: [script, String(port), pidFile],
          cwd: dir,
          port,
        })

        const rootPid = state.pid
        expect(rootPid).toBeTypeOf('number')
        const grandchildPid = Number(await readFile(pidFile, 'utf8'))
        expect(isAlive(rootPid!)).toBe(true)
        expect(isAlive(grandchildPid)).toBe(true)

        const result = await supervisor.stop()

        expect(result).toMatchObject({ status: 'stopped', portReleased: true, survivors: [] })
        expect(isAlive(rootPid!)).toBe(false)
        expect(isAlive(grandchildPid)).toBe(false)
        expect(await listenProbe(port)).toBe(true)
      } finally {
        await supervisor.stop().catch(() => undefined)
      }
    },
    30_000,
  )
})
