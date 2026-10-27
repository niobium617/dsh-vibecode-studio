import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SETTINGS_GET_METHOD,
  SETTINGS_UPDATE_METHOD,
  type StudioSettingsSnapshot,
} from '../../src/contracts/settings'
import { Config } from '../../src/host/config'
import {
  createStudioSettingsService,
  registerSettingsMethods,
  type StudioSettingsService,
} from '../../src/host/studio/settings'
import { UnaryRegistry, type UnaryDispatchResult } from '../../src/host/transport'

let tempRoot: string
let projectDir: string

beforeEach(async () => {
  const root = join(process.cwd(), '.tmp')
  await mkdir(root, { recursive: true })
  tempRoot = await mkdtemp(join(root, 'studio-settings-'))
  projectDir = join(tempRoot, 'project')
  await mkdir(projectDir)
})

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true })
})

function createService(
  overrides: Parameters<typeof Config>[0] = {},
): { config: ReturnType<typeof Config>; service: StudioSettingsService } {
  const config = Config(overrides)
  return { config, service: createStudioSettingsService({ projectDir, config }) }
}

async function writeStudio(value: unknown): Promise<string> {
  const dir = join(projectDir, '.vibe')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'studio.json')
  await writeFile(file, JSON.stringify(value), 'utf8')
  return file
}

async function readStudio(): Promise<unknown> {
  return JSON.parse(await readFile(join(projectDir, '.vibe', 'studio.json'), 'utf8'))
}

function successValue<T>(result: UnaryDispatchResult): T {
  if (result.body.ok !== true) throw new Error('expected a successful envelope')
  return result.body.value as T
}

const callContext = {
  request: new Request('http://127.0.0.1/api/vibe/request'),
  signal: new AbortController().signal,
}

describe('StudioSettingsService', () => {
  it('uses the profile config when studio.json is missing', async () => {
    const { config, service } = createService({
      allowedOrigins: ['http://localhost:5173'],
      retentionDays: 30,
    })

    await service.ready()

    expect(service.get()).toEqual({
      settings: {
        allowedOrigins: ['http://localhost:5173'],
        retentionDays: 30,
        contextBudgetBytes: 8192,
        screenshotEnabled: true,
        logLevel: 'info',
      },
      status: 'missing',
      issues: [],
    })
    expect(config.retentionDays).toBe(30)
    await expect(access(join(projectDir, '.vibe'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('loads studio.json onto the live config object', async () => {
    await writeStudio({
      version: 1,
      settings: {
        allowedOrigins: ['https://example.test/app/'],
        retentionDays: 3,
        contextBudgetBytes: 16384,
        screenshotEnabled: false,
        logLevel: 'debug',
      },
    })
    const { config, service } = createService({ retentionDays: 30, logLevel: 'error' })

    await service.ready()

    expect(service.get().status).toBe('ok')
    expect(service.get().issues).toEqual([])
    expect(config.allowedOrigins).toEqual(['https://example.test'])
    expect(config.retentionDays).toBe(3)
    expect(config.contextBudgetBytes).toBe(16384)
    expect(config.screenshotEnabled).toBe(false)
    expect(config.logLevel).toBe('debug')
  })

  it('persists updates atomically and a new service reads them back', async () => {
    const { config, service } = createService()
    await service.ready()

    const snapshot = await service.update({
      retentionDays: 14,
      allowedOrigins: ['http://localhost:3000/app', 'http://localhost:3000'],
    })

    expect(snapshot.status).toBe('ok')
    expect(snapshot.issues).toEqual([])
    expect(snapshot.settings).toEqual({
      allowedOrigins: ['http://localhost:3000'],
      retentionDays: 14,
      contextBudgetBytes: 8192,
      screenshotEnabled: true,
      logLevel: 'info',
    })
    expect(config.retentionDays).toBe(14)
    expect(await readStudio()).toEqual({ version: 1, settings: snapshot.settings })

    const reopened = createStudioSettingsService({ projectDir, config: Config({}) })
    await reopened.ready()
    expect(reopened.get().settings).toEqual(snapshot.settings)
  })

  it('rejects invalid updates before touching the file', async () => {
    const { service } = createService()
    await service.ready()

    await expect(service.update({ retentionDays: 0 })).rejects.toMatchObject({
      code: 'invalid_input',
      details: {
        issues: expect.arrayContaining([expect.stringContaining('retentionDays')]),
      },
    })
    await expect(access(join(projectDir, '.vibe'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recovers defaults from an invalid file and reports every issue', async () => {
    await writeStudio({
      version: 1,
      settings: {
        allowedOrigins: ['http://localhost:3000'],
        retentionDays: 0,
        contextBudgetBytes: 16384,
        screenshotEnabled: 'yes',
        logLevel: 'verbose',
      },
    })
    const { service } = createService({ retentionDays: 30 })

    await service.ready()
    const snapshot = service.get()

    expect(snapshot.status).toBe('invalid')
    expect(snapshot.settings.retentionDays).toBe(7)
    expect(snapshot.settings.contextBudgetBytes).toBe(16384)
    expect(snapshot.settings.screenshotEnabled).toBe(true)
    expect(snapshot.settings.logLevel).toBe('info')
    expect(snapshot.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('retentionDays'),
        expect.stringContaining('screenshotEnabled'),
        expect.stringContaining('logLevel'),
      ]),
    )
  })

  it('reports unreadable project paths instead of throwing at startup', async () => {
    const service = createStudioSettingsService({
      projectDir: join(tempRoot, 'absent'),
      config: Config({}),
    })

    await service.ready()

    expect(service.get().status).toBe('invalid')
    expect(service.get().issues.join('\n')).toContain('does not exist')
    await expect(service.update({ retentionDays: 3 })).rejects.toMatchObject({
      code: 'invalid_config',
    })
  })
})

describe('settings unary methods', () => {
  it('serves studio.settings.get and studio.settings.update', async () => {
    const { config, service } = createService()
    const registry = new UnaryRegistry()
    const dispose = registerSettingsMethods(registry, service)

    expect(registry.has(SETTINGS_GET_METHOD)).toBe(true)
    expect(registry.has(SETTINGS_UPDATE_METHOD)).toBe(true)

    const loaded = successValue<StudioSettingsSnapshot>(
      await registry.dispatch(SETTINGS_GET_METHOD, undefined, callContext),
    )
    expect(loaded.status).toBe('missing')

    const updated = successValue<StudioSettingsSnapshot>(
      await registry.dispatch(
        SETTINGS_UPDATE_METHOD,
        { settings: { retentionDays: 5 } },
        callContext,
      ),
    )
    expect(updated.status).toBe('ok')
    expect(updated.settings.retentionDays).toBe(5)
    expect(config.retentionDays).toBe(5)

    dispose()
    expect(registry.has(SETTINGS_GET_METHOD)).toBe(false)
    expect(registry.has(SETTINGS_UPDATE_METHOD)).toBe(false)
  })

  it('rejects malformed update params with invalid_input', async () => {
    const { service } = createService()
    const registry = new UnaryRegistry()
    registerSettingsMethods(registry, service)

    const result = await registry.dispatch(
      SETTINGS_UPDATE_METHOD,
      { settings: 'nope' },
      callContext,
    )

    expect(result.status).toBe(400)
    expect(result.body).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
  })
})
