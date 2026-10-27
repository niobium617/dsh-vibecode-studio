/**
 * Edge launch helpers for the web preview target (T017).
 *
 * `playwright-core` is imported lazily so loading the host does not pay for it,
 * and a missing install or a missing Edge becomes a stable `target_unavailable`
 * instead of a module-resolution crash. Only the locally installed Edge is
 * used (channel `msedge`); no browser binaries are downloaded (S1/G0).
 */
import type { Browser } from 'playwright-core'
import { studioError, type StudioError } from '../../../contracts/errors'

export const EDGE_CHANNEL = 'msedge'

export interface LaunchEdgeOptions {
  readonly headless?: boolean
  readonly channel?: string
}

/** Injectable launcher; tests substitute fakes without touching the browser. */
export type BrowserLauncher = (options: LaunchEdgeOptions) => Promise<Browser>

/**
 * Playwright reports a missing channel with either of these messages:
 * `Chromium distribution 'msedge' is not found at <path>` or
 * `Executable doesn't exist at <path>\msedge.exe`.
 */
const EDGE_MISSING_PATTERN =
  /Chromium distribution ['"]?msedge['"]? is not found|Executable doesn't exist[\s\S]*msedge/i

const TIMEOUT_PATTERN = /Timeout \d+ms exceeded|timeout of \d+ms exceeded/i

const UNREACHABLE_PATTERN =
  /net::ERR_(?:CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED)/i

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : typeof error === 'string' ? error : ''
}

export function isEdgeMissingError(error: unknown): boolean {
  return EDGE_MISSING_PATTERN.test(messageOf(error))
}

function edgeMissing(): StudioError {
  return studioError(
    'target_unavailable',
    'Microsoft Edge (channel "msedge") is not available; install Edge to use the preview',
    { browser: EDGE_CHANNEL },
  )
}

/** Maps a launch failure to a stable Studio error; never echoes the raw error. */
export function toStartError(error: unknown): StudioError {
  if (isEdgeMissingError(error)) return edgeMissing()
  return studioError('preview_failed', 'could not launch Microsoft Edge for the preview', {
    browser: EDGE_CHANNEL,
    reason: 'launch_failed',
  })
}

/** Maps a `page.goto` failure. Timeouts and unreachable servers stay distinct. */
export function toNavigationError(error: unknown, origin: string): StudioError {
  const message = messageOf(error)
  if (TIMEOUT_PATTERN.test(message)) {
    return studioError('timeout', 'preview navigation timed out', { origin })
  }
  if (UNREACHABLE_PATTERN.test(message)) {
    return studioError('target_unavailable', 'preview page is not reachable', { origin })
  }
  return studioError('preview_failed', 'preview navigation failed', { origin })
}

/** Maps a screenshot failure; page content is never echoed. */
export function toScreenshotError(): StudioError {
  return studioError('preview_failed', 'could not capture a preview screenshot')
}

/**
 * Launches the locally installed Edge. Throws `target_unavailable` when
 * `playwright-core` cannot be imported and `toStartError`-mapped errors when
 * the launch itself fails.
 */
export async function launchEdge(options: LaunchEdgeOptions = {}): Promise<Browser> {
  let chromium: typeof import('playwright-core').chromium
  try {
    ;({ chromium } = await import('playwright-core'))
  } catch {
    throw studioError(
      'target_unavailable',
      'playwright-core is not installed; run "pnpm install" before starting a preview',
      { dependency: 'playwright-core' },
    )
  }

  try {
    return await chromium.launch({
      channel: options.channel ?? EDGE_CHANNEL,
      headless: options.headless ?? true,
    })
  } catch (error) {
    throw toStartError(error)
  }
}
