import { describe, expect, it, vi } from 'vitest'
import { isStudioError, type StudioError } from '../../../src/contracts/errors'
import {
  createDevServerSupervisor,
  type DevServerChildProcess,
  type DevServerProcessInfo,
  type DevServerSpawnOptions,
  type DevServerSpec,
  type DevServerSupervisorOptions,
} from '../../../src/host/targets/process/supervisor'
import { FakeDevServerChild, tick, waitFor } from '../../helpers/fake-dev-server'

const SPEC: DevServerSpec = {
  command: process.execPath,
  args: ['server.js'],
  cwd: process.cwd(),
  port: 4320,
}

async function captureError(run: () => Promise<unknown>): Promise<StudioError> {
  try {
    await run()
  } catch (error) {
    if (isStudioError(error)) return error
    throw error
  }
  throw new Error('expected the call to throw a StudioError')
}

function createHarness(overrides: Partial<DevServerSupervisorOptions> = {}) {
  const children: FakeDevServerChild[] = []
  const processTable = new Map<number, DevServerProcessInfo>()
  let nextPid = 4200

  const spawn = vi.fn(
    (
      _command: string,
      _args: readonly string[],
      _options: DevServerSpawnOptions,
    ): DevServerChildProcess => {
      const child = new FakeDevServerChild(nextPid)
      nextPid += 1
      children.push(child)
      return child
    },
  )
  const probeHttp = vi.fn(async (_url: string) => true)
  const listProcesses = vi.fn(async () => [...processTable.values()])
  const killTree = vi.fn(async (pid: number) => {
    processTable.delete(pid)
    const child = children.find((candidate) => candidate.pid === pid)
    if (child?.running) child.exit(null, null)
    return { code: 0, output: '' }
  })
  const probePort = vi.fn(async (_port: number) => false)

  const supervisor = createDevServerSupervisor({
    spawn,
    probeHttp,
    listProcesses,
    killTree,
    probePort,
    pollIntervalMs: 5,
    readinessTimeoutMs: 150,
    stopTimeoutMs: 100,
    cleanupGraceMs: 1,
    ...overrides,
  })

  function setProcesses(list: readonly DevServerProcessInfo[]): void {
    processTable.clear()
    for (const proc of list) processTable.set(proc.pid, proc)
  }

  return {
    supervisor,
    children,
    spawn,
    probeHttp,
    listProcesses,
    killTree,
    probePort,
    setProcesses,
  }
}

describe('dev server supervisor lifecycle', () => {
  it('starts, reports ready state and merges repeated starts', async () => {
    const harness = createHarness()

    const state = await harness.supervisor.start(SPEC)

    expect(state.status).toBe('ready')
    expect(state.pid).toBe(harness.children[0].pid)
    expect(state.port).toBe(4320)
    expect(state.url).toBe('http://127.0.0.1:4320/')
    expect(state.command).toBe(process.execPath)
    expect(state.run).toBe(1)
    expect(harness.spawn).toHaveBeenCalledTimes(1)
    expect(harness.spawn.mock.calls[0][2]).toMatchObject({
      cwd: process.cwd(),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const again = await harness.supervisor.start(SPEC)
    expect(again.run).toBe(1)
    expect(harness.spawn).toHaveBeenCalledTimes(1)
    expect(harness.supervisor.logs().some((entry) => entry.line.includes('ready at'))).toBe(true)
  })

  it('merges concurrent starts into one spawn', async () => {
    const harness = createHarness()

    const [first, second] = await Promise.all([
      harness.supervisor.start(SPEC),
      harness.supervisor.start(SPEC),
    ])

    expect(first).toEqual(second)
    expect(first.run).toBe(1)
    expect(harness.spawn).toHaveBeenCalledTimes(1)
  })

  it('polls the readiness URL until it returns 2xx', async () => {
    const harness = createHarness()
    let attempts = 0
    harness.probeHttp.mockImplementation(async () => {
      attempts += 1
      return attempts >= 3
    })

    const state = await harness.supervisor.start(SPEC)

    expect(state.status).toBe('ready')
    expect(attempts).toBeGreaterThanOrEqual(3)
    expect(harness.probeHttp).toHaveBeenCalledWith('http://127.0.0.1:4320/')
  })

  it('fails with timeout and kills the process when readiness never arrives', async () => {
    const harness = createHarness({ readinessTimeoutMs: 30 })
    harness.probeHttp.mockResolvedValue(false)

    const error = await captureError(() => harness.supervisor.start(SPEC))

    expect(error.code).toBe('timeout')
    expect(error.details).toMatchObject({ port: 4320, timeoutMs: 30 })
    expect(harness.killTree).toHaveBeenCalledWith(harness.children[0].pid)
    expect(harness.children[0].running).toBe(false)
    expect(harness.supervisor.state().status).toBe('failed')
    expect(harness.supervisor.state().lastError?.code).toBe('timeout')
  })

  it('maps a strictPort conflict to a readable preview_failed error', async () => {
    const harness = createHarness()
    harness.probeHttp.mockResolvedValue(false)

    const starting = harness.supervisor.start(SPEC)
    await tick()
    const child = harness.children[0]
    child.writeStderr('Error: Port 4320 is already in use\n')
    await tick()
    child.exit(1, null)

    const error = await captureError(() => starting)

    expect(error.code).toBe('preview_failed')
    expect(error.message).toContain('4320')
    expect(error.message).toContain('already in use')
    expect(error.details).toEqual({ reason: 'port_in_use', port: 4320, exitCode: 1 })
    expect(harness.supervisor.state().status).toBe('failed')
    expect(harness.supervisor.state().lastError?.details).toEqual({
      reason: 'port_in_use',
      port: 4320,
      exitCode: 1,
    })
    expect(harness.killTree).not.toHaveBeenCalled()
    // The failing child never held the port, so cleanup must not wait for the
    // other process to release it or report it as a stop failure.
    expect(harness.probePort).not.toHaveBeenCalled()
    expect(
      harness.supervisor.logs().some((entry) => entry.line.includes('still in use after stop')),
    ).toBe(false)
  })

  it('maps a spawn failure to target_unavailable', async () => {
    const harness = createHarness()
    harness.probeHttp.mockResolvedValue(false)

    const starting = harness.supervisor.start(SPEC)
    await tick()
    const error = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })
    harness.children[0].failSpawn(error)

    const failure = await captureError(() => starting)

    expect(failure.code).toBe('target_unavailable')
    expect(failure.details).toEqual({ reason: 'spawn_failed', code: 'ENOENT' })
    expect(harness.supervisor.state().status).toBe('failed')
  })

  it('honours an aborted start and releases the process', async () => {
    const harness = createHarness()
    harness.probeHttp.mockResolvedValue(false)
    const controller = new AbortController()

    const starting = harness.supervisor.start(SPEC, { signal: controller.signal })
    await tick()
    controller.abort()

    const error = await captureError(() => starting)

    expect(error.code).toBe('target_unavailable')
    expect(error.details).toEqual({ reason: 'aborted' })
    expect(harness.killTree).toHaveBeenCalledWith(harness.children[0].pid)
  })

  it('can start again after a failed attempt', async () => {
    const harness = createHarness()
    harness.probeHttp.mockResolvedValue(false)

    const starting = harness.supervisor.start(SPEC)
    await tick()
    harness.children[0].exit(1, null)
    await captureError(() => starting)
    expect(harness.supervisor.state().status).toBe('failed')

    harness.probeHttp.mockResolvedValue(true)
    const state = await harness.supervisor.start(SPEC)

    expect(state.status).toBe('ready')
    expect(state.run).toBe(2)
    expect(state.pid).toBe(harness.children[1].pid)
    expect(harness.spawn).toHaveBeenCalledTimes(2)
  })
})

describe('dev server supervisor logs', () => {
  it('exposes stdout/stderr lines and keeps them after stop', async () => {
    const harness = createHarness()
    await harness.supervisor.start(SPEC)

    harness.children[0].writeStdout('Local: http://127.0.0.1:4320/\n')
    harness.children[0].writeStderr('warning: slow transform\n')
    await tick()
    await harness.supervisor.stop()

    const lines = harness.supervisor.logs().map((entry) => `${entry.stream}:${entry.line}`)
    expect(lines).toContain('stdout:Local: http://127.0.0.1:4320/')
    expect(lines).toContain('stderr:warning: slow transform')
    expect(lines.some((line) => line.includes('stopped'))).toBe(true)
  })

  it('clears previous run logs on restart', async () => {
    const harness = createHarness()
    await harness.supervisor.start(SPEC)
    harness.children[0].writeStdout('first run\n')
    await tick()

    const state = await harness.supervisor.restart()

    expect(state.run).toBe(2)
    expect(state.pid).toBe(harness.children[1].pid)
    const lines = harness.supervisor.logs().map((entry) => entry.line)
    expect(lines.some((line) => line.includes('first run'))).toBe(false)
    expect(lines.some((line) => line.startsWith('starting'))).toBe(true)
  })
})

describe('dev server supervisor stop', () => {
  it('tree-kills the root and cleans up leftover descendants', async () => {
    const harness = createHarness()
    await harness.supervisor.start(SPEC)
    const root = harness.children[0]
    harness.setProcesses([
      { pid: root.pid as number, parentPid: 1, name: 'node.exe', commandLine: 'node server.js' },
      { pid: 5001, parentPid: root.pid as number, name: 'node.exe', commandLine: 'node child-1.js' },
      { pid: 5002, parentPid: 5001, name: 'esbuild.exe', commandLine: 'esbuild --service' },
    ])

    const result = await harness.supervisor.stop()

    expect(harness.killTree).toHaveBeenCalledWith(root.pid)
    expect(harness.killTree).toHaveBeenCalledWith(5001)
    expect(harness.killTree).toHaveBeenCalledWith(5002)
    expect(result).toEqual({
      status: 'stopped',
      pid: root.pid,
      portReleased: true,
      survivors: [],
    })
    expect(harness.supervisor.state().status).toBe('stopped')
    expect(harness.children[0].running).toBe(false)
  })

  it('does not kill a recycled PID whose command line changed', async () => {
    const harness = createHarness()
    await harness.supervisor.start(SPEC)
    const root = harness.children[0]
    const recorded: DevServerProcessInfo = {
      pid: 5001,
      parentPid: root.pid as number,
      name: 'node.exe',
      commandLine: 'node child-1.js',
    }
    let calls = 0
    harness.listProcesses.mockImplementation(async () => {
      calls += 1
      if (calls === 1) {
        return [
          {
            pid: root.pid as number,
            parentPid: 1,
            name: 'node.exe',
            commandLine: 'node server.js',
          },
          recorded,
        ]
      }
      return [{ ...recorded, name: 'notepad.exe', commandLine: 'notepad.exe notes.txt' }]
    })

    const result = await harness.supervisor.stop()

    expect(harness.killTree).toHaveBeenCalledTimes(1)
    expect(harness.killTree).toHaveBeenCalledWith(root.pid)
    expect(result.survivors).toEqual([])
  })

  it('reports a port that is still in use after stop', async () => {
    const harness = createHarness({ stopTimeoutMs: 20 })
    await harness.supervisor.start(SPEC)
    harness.probePort.mockResolvedValue(true)

    const result = await harness.supervisor.stop()

    expect(result.portReleased).toBe(false)
    expect(harness.supervisor.state().lastError?.code).toBe('preview_failed')
    expect(harness.supervisor.state().lastError?.details).toMatchObject({
      reason: 'port_busy',
      port: 4320,
    })
  })

  it('is idempotent before any start', async () => {
    const harness = createHarness()

    const result = await harness.supervisor.stop()

    expect(result).toEqual({ status: 'stopped', pid: null, portReleased: true, survivors: [] })
    expect(harness.spawn).not.toHaveBeenCalled()
  })

  it('marks an unexpected exit as failed', async () => {
    const harness = createHarness()
    await harness.supervisor.start(SPEC)

    harness.children[0].exit(3, null)
    await waitFor(() => harness.supervisor.state().status === 'failed')

    const state = harness.supervisor.state()
    expect(state.lastError?.code).toBe('preview_failed')
    expect(state.lastError?.message).toContain('exited unexpectedly')
    expect(state.exit).toMatchObject({ code: 3, expected: false })
  })
})

describe('dev server supervisor validation', () => {
  it('rejects invalid specs before spawning', async () => {
    const harness = createHarness()
    const cases: [unknown, string, string][] = [
      [{ ...SPEC, command: '' }, 'invalid_config', 'command'],
      [{ ...SPEC, cwd: 'relative/path' }, 'invalid_config', 'cwd'],
      [{ ...SPEC, port: 0 }, 'invalid_config', 'port'],
      [{ ...SPEC, extra: true }, 'invalid_config', 'extra'],
    ]

    for (const [spec, code, field] of cases) {
      const error = await captureError(() => harness.supervisor.start(spec as DevServerSpec))
      expect(error.code).toBe(code)
      expect(error.details).toMatchObject({ field })
    }
    expect(harness.spawn).not.toHaveBeenCalled()
    expect(harness.supervisor.state().status).toBe('idle')
  })

  it('rejects non-local readiness URLs', async () => {
    const harness = createHarness()

    const error = await captureError(() =>
      harness.supervisor.start({ ...SPEC, url: 'http://example.com/' }),
    )

    expect(error.code).toBe('permission_denied')
    expect(error.details).toEqual({ host: 'example.com' })
    expect(harness.spawn).not.toHaveBeenCalled()
  })

  it('rejects restart before any start', async () => {
    const harness = createHarness()

    const error = await captureError(() => harness.supervisor.restart())

    expect(error.code).toBe('invalid_input')
    expect(error.details).toEqual({ field: 'spec' })
  })
})
