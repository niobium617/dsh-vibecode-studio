/**
 * Real-Edge integration for the web target adapter (T017).
 *
 * Starts the Vite fixture on an ephemeral port, drives the adapter end to end
 * and verifies the screenshot pixels, navigation, error mapping and that no
 * browser process survives `stop`.
 */
import { execFileSync } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import type { Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import { isStudioError, type StudioError } from '../../../src/contracts/errors'
import {
  createWebTargetAdapter,
  launchEdge,
  validateTargetConfig,
} from '../../../src/host/index'
import { countDarkPixels, decodePng, pixelAt } from '../../helpers/png'

let server: ViteDevServer | undefined
let baseUrl = ''

async function captureError(run: () => Promise<unknown>): Promise<StudioError> {
  try {
    await run()
  } catch (error) {
    if (isStudioError(error)) return error
    throw error
  }
  throw new Error('expected the call to throw a StudioError')
}

/** PIDs of Edge processes still holding a Playwright temporary profile. */
function playwrightEdgePids(): string[] {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          "Get-CimInstance Win32_Process -Filter \"name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*--user-data-dir=*playwright_chromiumdev_profile*' } | Select-Object -ExpandProperty ProcessId",
        ],
        { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] },
      )
      return output.split(/\s+/).filter(Boolean)
    }
    const output = execFileSync('ps', ['-eo', 'args'], {
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output
      .split('\n')
      .filter(
        (line) =>
          /msedge/i.test(line) &&
          line.includes('--user-data-dir=') &&
          line.includes('playwright_chromiumdev_profile'),
      )
      .map((line) => line.trim())
  } catch {
    return []
  }
}

/** Reserves and releases a loopback port so the next connection is refused. */
async function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

async function expectNoPlaywrightEdge(): Promise<void> {
  const deadline = Date.now() + 5_000
  let pids = playwrightEdgePids()
  while (pids.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    pids = playwrightEdgePids()
  }
  expect(pids).toEqual([])
}

beforeAll(async () => {
  server = await createServer({
    configFile: fileURLToPath(
      new URL('../../../fixtures/vite-basic/vite.config.ts', import.meta.url),
    ),
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await server.listen()
  const local = server.resolvedUrls?.local[0]
  if (!local) throw new Error('fixture server did not report a local URL')
  baseUrl = local.replace(/\/$/, '')
}, 30_000)

afterAll(async () => {
  await server?.close()
})

describe('web target adapter (Edge)', () => {
  it(
    'opens the fixture, screenshots it, navigates and stops without residue',
    { timeout: 60_000 },
    async () => {
      const browsers: Browser[] = []
      const adapter = createWebTargetAdapter({
        launch: async (launchOptions) => {
          const browser = await launchEdge(launchOptions)
          browsers.push(browser)
          return browser
        },
        navigationTimeoutMs: 10_000,
      })
      const config = validateTargetConfig({
        id: 'fixture',
        name: 'Vite fixture',
        kind: 'web',
        url: `${baseUrl}/`,
        viewport: { width: 800, height: 600 },
      })

      try {
        const session = await adapter.start(config)

        expect(adapter.status).toBe('ready')
        expect(session.status).toBe('ready')
        expect(session.id).toBe('fixture-1')
        expect(session.targetId).toBe('fixture')
        expect(session.kind).toBe('web')
        expect(session.url).toBe(`${baseUrl}/`)
        expect(session.capabilities.screenshot).toBe(true)
        expect(session.capabilities.screencast).toBe(true)
        expect(session.capabilities.input).toBe(true)

        const image = decodePng(await adapter.screenshot())
        expect(image.width).toBe(800)
        expect(image.height).toBe(600)
        const [red, green, blue, alpha] = pixelAt(image, 2, 2)
        expect(alpha).toBe(255)
        const cornerLuminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
        expect(cornerLuminance).toBeGreaterThan(230)
        // Rendered heading and body text prove the fixture actually painted.
        expect(countDarkPixels(image)).toBeGreaterThan(1_000)
        expect(
          countDarkPixels(image, { x: 0, y: 0, width: 800, height: 120 }),
        ).toBeGreaterThan(200)

        await adapter.navigate(`${baseUrl}/?tab=one`)
        expect(adapter.url).toBe(`${baseUrl}/?tab=one`)
        expect(adapter.session?.url).toBe(`${baseUrl}/?tab=one`)

        const closedPort = await unusedPort()
        const refused = await captureError(() =>
          adapter.navigate(`http://127.0.0.1:${closedPort}/`),
        )
        expect(refused.code).toBe('target_unavailable')
        expect(adapter.status).toBe('ready')
        expect(adapter.url).toBe(`${baseUrl}/?tab=one`)

        expect(decodePng(await adapter.screenshot()).width).toBe(800)
      } finally {
        await adapter.stop()
      }

      expect(adapter.status).toBe('stopped')
      expect(adapter.session?.status).toBe('closed')
      expect(browsers).toHaveLength(1)
      expect(browsers[0]!.isConnected()).toBe(false)
      await adapter.stop()
      await expectNoPlaywrightEdge()

      // A stopped adapter can start again with a fresh session and browser.
      const second = await adapter.start(config)
      expect(second.id).toBe('fixture-2')
      expect(adapter.status).toBe('ready')
      await adapter.stop()

      expect(browsers).toHaveLength(2)
      for (const browser of browsers) expect(browser.isConnected()).toBe(false)
      await expectNoPlaywrightEdge()
    },
  )
})
