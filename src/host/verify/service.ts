/**
 * T055: basic verification service.
 *
 * One `run()` reads the live preview (session state, a minimal DOM outline and
 * the bounded console/network buffers) and evaluates the four basic checks in
 * `checks.ts`. It never starts, reloads or navigates the preview: verification
 * reports what the panel already shows, so the evidence ids in the result can
 * be opened in the Console/Network drawers (T056).
 *
 * Reads are independent. A failed DOM read still lets the console/network
 * checks report their buffers, and an unavailable collector degrades its own
 * check to `skipped` instead of failing the run with an exception.
 */
import { truncateChars } from '../../contracts/budget'
import { isStudioError } from '../../contracts/errors'
import {
  MAX_CONSOLE_ENTRIES,
  MAX_NETWORK_ENTRIES,
  type PreviewConsoleSnapshot,
  type PreviewNetworkSnapshot,
  type PreviewSessionSnapshot,
} from '../../contracts/transport'
import { DOM_OUTLINE_MIN_BYTES, type DomSnapshot } from '../preview/dom'
import { evaluateVerify, type VerifyRead, type VerifyResult } from './checks'

/** The narrow preview surface verification needs; `PreviewService` satisfies it. */
export interface VerifyPreviewSource {
  status(): PreviewSessionSnapshot
  domSnapshot(params?: unknown): Promise<DomSnapshot>
  consoleList(query?: unknown): PreviewConsoleSnapshot
  networkList(query?: unknown): PreviewNetworkSnapshot
}

export interface VerifyServiceOptions {
  readonly preview: VerifyPreviewSource
  /** Test seam: the wall clock used for `ranAt`/`durationMs`. */
  readonly now?: () => number
}

export interface VerifyService {
  /** Runs all four checks once. Never throws for a preview-side failure. */
  run(): Promise<VerifyResult>
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g

/** Host-generated one-liner for a read failure; page data is clipped. */
function describeVerifyError(error: unknown): string {
  const message = isStudioError(error)
    ? error.message
    : error instanceof Error
      ? error.message
      : 'unknown error'
  return truncateChars(message.replace(CONTROL_CHARS, ' ').trim(), 200)
}

export function createVerifyService(options: VerifyServiceOptions): VerifyService {
  const now = options.now ?? Date.now

  async function readDom(): Promise<VerifyRead<DomSnapshot>> {
    try {
      // The smallest legal outline is enough: the check only needs the node
      // count and whether the page answered at all.
      const value = await options.preview.domSnapshot({ maxBytes: DOM_OUTLINE_MIN_BYTES })
      return { ok: true, value }
    } catch (error) {
      return { ok: false, message: describeVerifyError(error) }
    }
  }

  function readConsole(): VerifyRead<PreviewConsoleSnapshot> {
    try {
      return { ok: true, value: options.preview.consoleList({ limit: MAX_CONSOLE_ENTRIES }) }
    } catch (error) {
      return { ok: false, message: describeVerifyError(error) }
    }
  }

  function readNetwork(): VerifyRead<PreviewNetworkSnapshot> {
    try {
      return { ok: true, value: options.preview.networkList({ limit: MAX_NETWORK_ENTRIES }) }
    } catch (error) {
      return { ok: false, message: describeVerifyError(error) }
    }
  }

  async function run(): Promise<VerifyResult> {
    const started = now()
    const session = options.preview.status()
    const ready = session.status === 'ready'

    // Only a ready preview is read; an idle/failed session is reported by the
    // target check and the remaining checks stay skipped.
    const dom = ready ? await readDom() : null
    const consoleRead = ready ? readConsole() : null
    const networkRead = ready ? readNetwork() : null

    const finished = now()
    return evaluateVerify(
      { session, dom, console: consoleRead, network: networkRead },
      {
        ranAt: new Date(finished).toISOString(),
        durationMs: finished - started,
      },
    )
  }

  return { run }
}
