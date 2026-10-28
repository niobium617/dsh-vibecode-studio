import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { isStudioError, type StudioError } from '../../../src/contracts/errors'
import { asTargetId } from '../../../src/contracts/ids'
import {
  createWebTargetAdapter,
  isEdgeMissingError,
  toNavigationError,
  toScreenshotError,
  toStartError,
  validateTargetConfig,
} from '../../../src/host/index'
import type { ValidatedTargetConfig } from '../../../src/host/targets/types'
import { DEFAULT_VIEWPORT } from '../../../src/host/targets/types'

async function captureError(run: () => Promise<unknown>): Promise<StudioError> {
  try {
    await run()
  } catch (error) {
    if (isStudioError(error)) return error
    throw error
  }
  throw new Error('expected the call to throw a StudioError')
}

const FIXTURE_CONFIG: ValidatedTargetConfig = validateTargetConfig({
  id: 'fixture',
  name: 'Fixture',
  kind: 'web',
  url: 'http://127.0.0.1:4320/',
})

describe('web adapter error mapping', () => {
  it('recognizes both Playwright missing-Edge messages', () => {
    expect(
      isEdgeMissingError(
        new Error(
          "browserType.launch: Chromium distribution 'msedge' is not found at C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        ),
      ),
    ).toBe(true)
    expect(
      isEdgeMissingError(
        new Error("browserType.launch: Executable doesn't exist at C:\\msedge\\msedge.exe"),
      ),
    ).toBe(true)
    expect(isEdgeMissingError(new Error('launch failed'))).toBe(false)
  })

  it('reports a missing Edge as target_unavailable without leaking paths', () => {
    const error = toStartError(
      new Error("Chromium distribution 'msedge' is not found at C:\\Users\\secret\\msedge.exe"),
    )

    expect(error.code).toBe('target_unavailable')
    expect(error.message).toMatch(/Microsoft Edge/)
    expect(error.message).not.toContain('C:\\')
  })

  it('maps other launch failures to preview_failed', () => {
    expect(toStartError(new Error('boom')).code).toBe('preview_failed')
  })

  it('keeps navigation timeouts and unreachable pages distinct', () => {
    expect(
      toNavigationError(new Error('page.goto: Timeout 15000ms exceeded.'), 'http://127.0.0.1:4320')
        .code,
    ).toBe('timeout')
    expect(
      toNavigationError(
        new Error('page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:1/'),
        'http://127.0.0.1:1',
      ).code,
    ).toBe('target_unavailable')
    expect(toNavigationError(new Error('unexpected'), 'http://127.0.0.1:4320').code).toBe(
      'preview_failed',
    )
  })

  it('maps screenshot failures to preview_failed', () => {
    expect(toScreenshotError().code).toBe('preview_failed')
  })

  it(
    'recognizes the real Playwright error for a missing executable',
    { timeout: 20_000 },
    async () => {
      const { chromium } = await import('playwright-core')
      let captured: unknown
      try {
        await chromium.launch({
          executablePath: join(process.cwd(), '.tmp', 'missing-msedge.exe'),
          headless: true,
        })
      } catch (error) {
        captured = error
      }

      expect(captured).toBeInstanceOf(Error)
      expect(isEdgeMissingError(captured)).toBe(true)
      expect(toStartError(captured).code).toBe('target_unavailable')
    },
  )
})

describe('web adapter guards', () => {
  it('rejects non-local targets before launching a browser', async () => {
    const launch = vi.fn(async () => {
      throw new Error('launcher must not run')
    })
    const adapter = createWebTargetAdapter({ launch })
    const remote = validateTargetConfig({
      id: 'remote',
      name: 'Remote',
      kind: 'web',
      url: 'https://example.com/',
    })

    const error = await captureError(() => adapter.start(remote))

    expect(error.code).toBe('permission_denied')
    expect(error.message).toMatch(/not local/)
    expect(error.details).toEqual({ host: 'example.com' })
    expect(launch).not.toHaveBeenCalled()
    expect(adapter.status).toBe('idle')
  })

  it('allows non-local targets only when explicitly approved', async () => {
    const launch = vi.fn(async () => {
      throw new Error("Chromium distribution 'msedge' is not found")
    })
    const adapter = createWebTargetAdapter({ launch, allowNonLocal: true })
    const remote = validateTargetConfig({
      id: 'remote',
      name: 'Remote',
      kind: 'web',
      url: 'https://example.com/',
    })

    const error = await captureError(() => adapter.start(remote))

    expect(error.code).toBe('target_unavailable')
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it('rejects non-web targets and targets without a URL', async () => {
    const adapter = createWebTargetAdapter()
    const desktop = validateTargetConfig({
      id: 'desktop',
      name: 'Desktop',
      kind: 'desktop',
      url: 'http://127.0.0.1:4320/',
    })
    const withoutUrl: ValidatedTargetConfig = {
      id: asTargetId('no-url'),
      name: 'No URL',
      kind: 'web',
      viewport: DEFAULT_VIEWPORT,
    }

    const nonWeb = await captureError(() => adapter.start(desktop))
    const noUrl = await captureError(() => adapter.start(withoutUrl))

    expect(nonWeb.code).toBe('invalid_config')
    expect(nonWeb.details).toEqual({ field: 'kind' })
    expect(noUrl.code).toBe('invalid_config')
    expect(noUrl.details).toEqual({ field: 'url' })
    expect(adapter.status).toBe('idle')
  })

  it('honours an already-aborted start signal', async () => {
    const launch = vi.fn(async () => {
      throw new Error('launcher must not run')
    })
    const adapter = createWebTargetAdapter({ launch })
    const controller = new AbortController()
    controller.abort()

    const error = await captureError(() =>
      adapter.start(FIXTURE_CONFIG, { signal: controller.signal }),
    )

    expect(error.code).toBe('target_unavailable')
    expect(error.details).toEqual({ reason: 'aborted' })
    expect(launch).not.toHaveBeenCalled()
    expect(adapter.status).toBe('idle')
  })

  it('reports failed launches and remembers the stable error', async () => {
    const adapter = createWebTargetAdapter({
      launch: async () => {
        throw new Error("Chromium distribution 'msedge' is not found")
      },
    })

    const error = await captureError(() => adapter.start(FIXTURE_CONFIG))

    expect(error.code).toBe('target_unavailable')
    expect(adapter.status).toBe('failed')
    expect(adapter.lastError).toBe(error)
    expect(adapter.session).toBeUndefined()
  })

  it('rejects navigate and screenshot while no page is running', async () => {
    const adapter = createWebTargetAdapter()
    const navigateError = await captureError(() => adapter.navigate('http://127.0.0.1:4320/'))
    const screenshotError = await captureError(() => adapter.screenshot())

    expect(navigateError.code).toBe('target_unavailable')
    expect(screenshotError.code).toBe('target_unavailable')
    expect(await adapter.stop()).toBeUndefined()
    expect(adapter.status).toBe('stopped')
  })
})
