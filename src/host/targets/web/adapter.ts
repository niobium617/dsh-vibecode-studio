/**
 * Web preview adapter (T017): Edge via Playwright, one page per session.
 *
 * The adapter owns the browser lifecycle only; screencast, input, console and
 * network consume the CDP handle from `screencastPage()`, and pick injects its
 * overlay through the same handle (T027). Every failure is mapped to a stable
 * Studio error, and only loopback targets are opened unless the caller
 * explicitly approves a non-local URL.
 */
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { isStudioError, studioError, type StudioError } from '../../../contracts/errors'
import { asSessionId } from '../../../contracts/ids'
import type { TargetCapabilities, TargetSession, TargetViewport } from '../../../contracts/target'
import type {
  ScreencastPageLike,
  ScreencastSessionLike,
  TargetAdapter,
  TargetStartOptions,
  ValidatedTargetConfig,
} from '../types'
import {
  EDGE_CHANNEL,
  launchEdge,
  toNavigationError,
  toScreenshotError,
  toStartError,
  type BrowserLauncher,
  type LaunchEdgeOptions,
} from './launch'

export type WebTargetAdapterStatus = 'idle' | 'starting' | 'ready' | 'stopped' | 'failed'

/** Screencast (T020), input (T021), console (T023), network (T024) and pick (T027). */
export const WEB_TARGET_CAPABILITIES: TargetCapabilities = Object.freeze({
  screencast: true,
  input: true,
  pick: true,
  sourceMap: false,
  console: true,
  network: true,
  screenshot: true,
})

export interface WebTargetAdapterOptions {
  readonly id?: string
  /** Override the default Edge launcher (tests, alternate channels). */
  readonly launch?: BrowserLauncher
  readonly headless?: boolean
  readonly navigationTimeoutMs?: number
  /**
   * Non-local previews need explicit user approval (SPEC FR-SEC-01); until an
   * approval flow exists, callers must opt in here.
   */
  readonly allowNonLocal?: boolean
  readonly now?: () => Date
}

export interface WebTargetAdapter extends TargetAdapter {
  navigate(url: string): Promise<void>
  reload(): Promise<void>
  setViewport(viewport: TargetViewport): Promise<void>
  screenshot(): Promise<Uint8Array>
  screencastPage(): ScreencastPageLike | undefined
  isAlive(): boolean
  readonly status: WebTargetAdapterStatus
  readonly session: TargetSession | undefined
  readonly lastError: StudioError | undefined
  /** Current page URL, or the last known URL after the page closed. */
  readonly url: string | undefined
}

const DEFAULT_NAVIGATION_TIMEOUT_MS = 15_000

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '[::1]') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

function parsePreviewUrl(
  raw: string,
  options: WebTargetAdapterOptions,
  code: 'invalid_config' | 'invalid_input',
): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw studioError(code, 'preview URL is invalid', { field: 'url' })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw studioError('unsupported', 'preview URL must use http or https', {
      protocol: url.protocol,
    })
  }
  if (url.username || url.password) {
    throw studioError(code, 'preview URL must not contain credentials', { field: 'url' })
  }
  if (!options.allowNonLocal && !isLoopbackHost(url.hostname)) {
    throw studioError(
      'permission_denied',
      `preview target "${url.hostname}" is not local; non-local targets need explicit approval`,
      { host: url.hostname },
    )
  }
  return url
}

function abortedError(): StudioError {
  return studioError(
    'target_unavailable',
    'preview start was aborted before the page was ready',
    { reason: 'aborted' },
  )
}

export function createWebTargetAdapter(
  options: WebTargetAdapterOptions = {},
): WebTargetAdapter {
  const launcher = options.launch ?? launchEdge
  const navigationTimeoutMs = options.navigationTimeoutMs ?? DEFAULT_NAVIGATION_TIMEOUT_MS
  const now = options.now ?? (() => new Date())

  let status: WebTargetAdapterStatus = 'idle'
  let browser: Browser | undefined
  let context: BrowserContext | undefined
  let page: Page | undefined
  let session: TargetSession | undefined
  let lastError: StudioError | undefined
  let pendingStart: Promise<TargetSession> | undefined
  let sessionCount = 0

  async function dispose(): Promise<void> {
    const ownedContext = context
    const ownedBrowser = browser
    context = undefined
    page = undefined
    browser = undefined
    if (ownedContext) await ownedContext.close().catch(() => undefined)
    if (ownedBrowser) await ownedBrowser.close().catch(() => undefined)
  }

  async function requirePage(): Promise<Page> {
    if (status === 'starting' && pendingStart) await pendingStart.catch(() => undefined)
    if (status !== 'ready' || !page) {
      throw studioError('target_unavailable', 'preview target is not running')
    }
    return page
  }

  function start(
    config: ValidatedTargetConfig,
    startOptions?: TargetStartOptions,
  ): Promise<TargetSession> {
    if (status === 'ready' && session) return Promise.resolve(session)
    if (status === 'starting' && pendingStart) return pendingStart

    // Pre-flight errors do not touch the lifecycle: the adapter never started.
    if (config.kind !== 'web') {
      return Promise.reject(
        studioError('invalid_config', 'web target adapter received a non-web target', {
          field: 'kind',
        }),
      )
    }
    if (!config.url) {
      return Promise.reject(
        studioError('invalid_config', 'a web target needs a "url"', { field: 'url' }),
      )
    }
    let parsed: URL
    try {
      parsed = parsePreviewUrl(config.url, options, 'invalid_config')
    } catch (error) {
      return Promise.reject(error)
    }
    const signal = startOptions?.signal
    if (signal?.aborted) return Promise.reject(abortedError())

    status = 'starting'
    lastError = undefined

    pendingStart = (async () => {
      try {
        const launched = await launcher({
          channel: EDGE_CHANNEL,
          headless: options.headless,
        } satisfies LaunchEdgeOptions)
        if (signal?.aborted) {
          await launched.close().catch(() => undefined)
          throw abortedError()
        }
        browser = launched

        const createdContext = await launched.newContext({
          viewport: { width: config.viewport.width, height: config.viewport.height },
          deviceScaleFactor: config.viewport.deviceScaleFactor ?? 1,
          colorScheme: 'light',
        })
        context = createdContext

        const createdPage = await createdContext.newPage()
        page = createdPage
        try {
          await createdPage.goto(parsed.toString(), {
            waitUntil: 'load',
            timeout: navigationTimeoutMs,
          })
        } catch (error) {
          throw isStudioError(error) ? error : toNavigationError(error, parsed.origin)
        }
        if (signal?.aborted) throw abortedError()

        sessionCount += 1
        const created: TargetSession = {
          id: asSessionId(`${config.id}-${sessionCount}`),
          targetId: config.id,
          kind: 'web',
          status: 'ready',
          url: createdPage.url(),
          capabilities: WEB_TARGET_CAPABILITIES,
          startedAt: now().toISOString(),
        }
        session = created
        status = 'ready'
        return created
      } catch (error) {
        lastError = isStudioError(error) ? error : toStartError(error)
        await dispose()
        status = 'failed'
        throw lastError
      } finally {
        pendingStart = undefined
      }
    })()

    return pendingStart
  }

  async function navigate(rawUrl: string): Promise<void> {
    const activePage = await requirePage()
    const parsed = parsePreviewUrl(rawUrl, options, 'invalid_input')
    try {
      await activePage.goto(parsed.toString(), {
        waitUntil: 'load',
        timeout: navigationTimeoutMs,
      })
    } catch (error) {
      throw isStudioError(error) ? error : toNavigationError(error, parsed.origin)
    }
    if (session) session = { ...session, url: activePage.url() }
  }

  async function reload(): Promise<void> {
    const activePage = await requirePage()
    let origin = ''
    try {
      origin = new URL(activePage.url()).origin
    } catch {
      // A closed/crashed page is reported by `requirePage`/Playwright below.
    }
    try {
      await activePage.reload({ waitUntil: 'load', timeout: navigationTimeoutMs })
    } catch (error) {
      throw isStudioError(error) ? error : toNavigationError(error, origin)
    }
    if (session) session = { ...session, url: activePage.url() }
  }

  async function setViewport(viewport: TargetViewport): Promise<void> {
    const activePage = await requirePage()
    try {
      await activePage.setViewportSize({ width: viewport.width, height: viewport.height })
    } catch {
      throw studioError('preview_failed', 'preview viewport could not be applied')
    }
  }

  /**
   * Playwright reports a crashed browser through the connection and a closed
   * page through `isClosed`; either one means the session needs a restart.
   */
  function isAlive(): boolean {
    if (status !== 'ready' || !browser || !page) return false
    if (!browser.isConnected()) return false
    return !page.isClosed()
  }

  async function screenshot(): Promise<Uint8Array> {
    const activePage = await requirePage()
    try {
      const buffer = await activePage.screenshot({
        type: 'png',
        animations: 'disabled',
        caret: 'hide',
      })
      return new Uint8Array(buffer)
    } catch {
      throw toScreenshotError()
    }
  }

  /**
   * Handle for CDP screencast. The page is re-read on each call so a session
   * that stopped after being handed out fails with `target_unavailable` from
   * Playwright rather than capturing a stale page.
   */
  function screencastPage(): ScreencastPageLike | undefined {
    const activePage = status === 'ready' ? page : undefined
    if (!activePage) return undefined
    return {
      viewport() {
        const size = activePage.viewportSize()
        return size === null ? null : { width: size.width, height: size.height }
      },
      async createCdpSession(): Promise<ScreencastSessionLike> {
        const session = await activePage.context().newCDPSession(activePage)
        return session as unknown as ScreencastSessionLike
      },
    }
  }

  async function stop(): Promise<void> {
    if (status === 'starting' && pendingStart) await pendingStart.catch(() => undefined)
    await dispose()
    if (session) session = { ...session, status: 'closed' }
    status = 'stopped'
  }

  return {
    id: options.id ?? 'web',
    kind: 'web',
    capabilities: WEB_TARGET_CAPABILITIES,
    start,
    navigate,
    reload,
    setViewport,
    screenshot,
    screencastPage,
    isAlive,
    stop,
    get status() {
      return status
    },
    get session() {
      return session
    },
    get lastError() {
      return lastError
    },
    get url() {
      if (page) return page.url()
      return session?.url ?? undefined
    },
  }
}
