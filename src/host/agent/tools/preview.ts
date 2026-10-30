/**
 * T049: `vibe_preview` — reload, navigate, screenshot, start and stop.
 *
 * Three boundaries live here:
 * - Arguments: the schema already rejects wrong types, so the handler only
 *   adds semantics (which action needs a URL, which action ignores one) and
 *   fails with `invalid_input` plus a field hint.
 * - Origin: navigation stays on the live target origin, inside `allowedOrigins`
 *   and on loopback. `start` is held to the same list; a non-local target is
 *   `permission_denied` rather than a late adapter failure (FR-SEC-01).
 * - Screenshots: image bytes never enter a tool result (FR-AGENT-09). The host
 *   stores the PNG and returns its artifact id and size; `screenshotEnabled`
 *   is read from live config because the panel can switch it at any time.
 *
 * start/stop need a human decision. A tool body cannot ask (DSH's run context
 * carries no approval), so {@link createPreviewApprovalGate} is the
 * `tools/pre-execute` listener that answers `ask` for exactly those two
 * actions and delegates everything else with `next()`.
 */
import type { ArtifactRef } from '../../../contracts/artifacts'
import { studioError } from '../../../contracts/errors'
import type { PreviewSessionSnapshot, PreviewStartParams } from '../../../contracts/transport'
import { toArtifactStudioError } from '../../artifacts/store'
import { PREVIEW_TARGET_ID, type PreviewScreenshot } from '../../preview/session'
import { isLoopbackHost } from '../../preview/url'
import { toToolPreviewState, type ToolPreviewState } from './preview-data'
import type { VibeToolRunContext } from './register'

export const PREVIEW_ACTIONS = ['reload', 'navigate', 'screenshot', 'start', 'stop'] as const
export type PreviewAction = (typeof PREVIEW_ACTIONS)[number]

/** `navigate` and `start` take a URL; the other actions never do. */
const URL_ACTIONS: ReadonlySet<PreviewAction> = new Set(['navigate', 'start'])

const PREVIEW_URL_MAX_CHARS = 2048
/** Prompt text is bounded and control-free; the model supplies the URL. */
const DISPLAY_URL_MAX_CHARS = 120

export interface PreviewToolConfig {
  readonly allowedOrigins: readonly string[]
  readonly screenshotEnabled: boolean
  readonly retentionDays: number
}

/** The preview service surface this tool needs (a subset of `PreviewService`). */
export interface PreviewToolSource {
  status(): PreviewSessionSnapshot
  reload(): Promise<PreviewSessionSnapshot>
  navigate(params: { url: string }): Promise<PreviewSessionSnapshot>
  start(params: PreviewStartParams): Promise<PreviewSessionSnapshot>
  stop(): Promise<PreviewSessionSnapshot>
  captureScreenshot(): Promise<PreviewScreenshot>
}

/** Where captured bytes go; the `ArtifactStore` satisfies this structurally. */
export interface PreviewArtifactSink {
  saveScreenshot(bytes: Uint8Array, options: { retentionDays: number; label?: string }): Promise<ArtifactRef>
}

export interface PreviewToolDeps {
  readonly preview: PreviewToolSource
  readonly artifacts: PreviewArtifactSink
  /** Live config: settings may change origins, retention or screenshots. */
  readonly config: () => PreviewToolConfig
}

export interface PreviewToolOutput {
  action: PreviewAction
  state: ToolPreviewState
  url?: string
  screenshot?: {
    artifactId: string
    width?: number
    height?: number
    bytes?: number
  }
  message?: string
}

function invalidInput(detail: string, field: string): never {
  throw studioError('invalid_input', `vibe-studio: ${detail}`, { field })
}

function parseAction(value: unknown): PreviewAction {
  if (typeof value === 'string' && (PREVIEW_ACTIONS as readonly string[]).includes(value)) {
    return value as PreviewAction
  }
  return invalidInput('invalid preview action', 'action')
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalidInput(`${field} must be a non-empty string`, field)
  }
  return value
}

function parseHttpUrl(raw: string, field: string): URL {
  if (raw.length > PREVIEW_URL_MAX_CHARS) {
    invalidInput(`url must be at most ${PREVIEW_URL_MAX_CHARS} characters`, field)
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    invalidInput('url must be an absolute http(s) URL', field)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    invalidInput('url must use http or https', field)
  }
  if (url.username || url.password) {
    invalidInput('url must not contain credentials', field)
  }
  return url
}

function requireLoopback(url: URL): void {
  if (isLoopbackHost(url.hostname)) return
  throw studioError(
    'permission_denied',
    `vibe-studio: preview target "${url.hostname}" is not local; only loopback targets are allowed`,
    { host: url.hostname },
  )
}

function requireAllowedOrigin(url: URL, allowedOrigins: readonly string[]): void {
  if (allowedOrigins.includes(url.origin)) return
  throw studioError(
    'permission_denied',
    `vibe-studio: origin ${url.origin} is not in allowedOrigins`,
    { origin: url.origin },
  )
}

function snapshotOrigin(url: string | null): string | null {
  if (url === null) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function describeUrl(url: string): string {
  const clean = url.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return clean.length <= DISPLAY_URL_MAX_CHARS ? clean : `${clean.slice(0, DISPLAY_URL_MAX_CHARS - 1)}…`
}

function summarize(
  action: PreviewAction,
  snapshot: PreviewSessionSnapshot,
  extra?: { width: number | null; height: number | null; artifactId: string },
): string {
  switch (action) {
    case 'reload':
      return snapshot.url ? `Reloaded ${describeUrl(snapshot.url)}.` : 'Reloaded the preview page.'
    case 'navigate':
      return snapshot.url ? `Navigated to ${describeUrl(snapshot.url)}.` : 'Navigated the preview page.'
    case 'screenshot': {
      const size =
        extra?.width != null && extra?.height != null
          ? ` (${extra.width}x${extra.height})`
          : ''
      return `Captured a screenshot${size} as artifact ${extra?.artifactId ?? ''}; image bytes stay on the host and are never part of a tool result.`
    }
    case 'start':
      return snapshot.url ? `Preview started at ${describeUrl(snapshot.url)}.` : 'Preview started.'
    case 'stop':
      return 'Preview stopped.'
  }
}

/** Typed view of the handler; assignable to `VibeToolHandler` for registration. */
export type PreviewHandler = (
  args: Readonly<Record<string, unknown>>,
  exec: VibeToolRunContext,
) => Promise<PreviewToolOutput>

export function createPreviewHandler(deps: PreviewToolDeps): PreviewHandler {
  return async (args): Promise<PreviewToolOutput> => {
    const action = parseAction(args.action)
    const url = parseOptionalString(args.url, 'url')
    if (url !== undefined && !URL_ACTIONS.has(action)) {
      invalidInput(`url is only used with navigate and start, not ${action}`, 'url')
    }
    const requestedTarget = parseOptionalString(args.targetId, 'targetId')
    const initial = deps.preview.status()
    if (requestedTarget !== undefined && !targetMatches(requestedTarget, action, initial)) {
      throw studioError(
        'not_found',
        `vibe-studio: no preview target "${describeUrl(requestedTarget)}" is active`,
        { field: 'targetId' },
      )
    }

    switch (action) {
      case 'reload': {
        const next = await deps.preview.reload()
        return {
          action,
          state: toToolPreviewState(next.status),
          ...(next.url ? { url: next.url } : {}),
          message: summarize(action, next),
        }
      }
      case 'navigate': {
        if (url === undefined) invalidInput('navigate needs a url', 'url')
        const parsed = parseHttpUrl(url, 'url')
        requireLoopback(parsed)
        requireAllowedOrigin(parsed, deps.config().allowedOrigins)
        if (initial.status !== 'ready') {
          throw studioError('target_unavailable', 'vibe-studio: preview is not running')
        }
        const origin = snapshotOrigin(initial.url)
        if (origin !== parsed.origin) {
          throw studioError(
            'permission_denied',
            `vibe-studio: navigate must stay on the preview origin ${origin ?? '(unknown)'}`,
            { origin: parsed.origin, currentOrigin: origin },
          )
        }
        const next = await deps.preview.navigate({ url: parsed.toString() })
        return {
          action,
          state: toToolPreviewState(next.status),
          ...(next.url ? { url: next.url } : {}),
          message: summarize(action, next),
        }
      }
      case 'screenshot': {
        const config = deps.config()
        if (!config.screenshotEnabled) {
          throw studioError('permission_denied', 'vibe-studio: screenshots are disabled in settings')
        }
        const captured = await deps.preview.captureScreenshot()
        let ref: ArtifactRef
        try {
          ref = await deps.artifacts.saveScreenshot(captured.bytes, {
            retentionDays: config.retentionDays,
            label: 'preview screenshot',
          })
        } catch (error) {
          throw toArtifactStudioError(error)
        }
        const after = deps.preview.status()
        return {
          action,
          state: toToolPreviewState(after.status),
          ...(after.url ? { url: after.url } : {}),
          screenshot: {
            artifactId: ref.id,
            ...(captured.width === null ? {} : { width: captured.width }),
            ...(captured.height === null ? {} : { height: captured.height }),
            bytes: ref.bytes,
          },
          message: summarize(action, after, {
            width: captured.width,
            height: captured.height,
            artifactId: ref.id,
          }),
        }
      }
      case 'start': {
        if (url === undefined) invalidInput('start needs a url', 'url')
        const parsed = parseHttpUrl(url, 'url')
        requireLoopback(parsed)
        requireAllowedOrigin(parsed, deps.config().allowedOrigins)
        if (initial.status === 'ready') {
          // `start` is a no-op on a live session; say so instead of pretending
          // the preview moved to the requested page.
          return {
            action,
            state: 'ready',
            ...(initial.url ? { url: initial.url } : {}),
            message: `Preview is already running${initial.url ? ` at ${describeUrl(initial.url)}` : ''}; use navigate to change the page.`,
          }
        }
        const next = await deps.preview.start({ url: parsed.toString() })
        return {
          action,
          state: toToolPreviewState(next.status),
          ...(next.url ? { url: next.url } : {}),
          message: summarize(action, next),
        }
      }
      case 'stop': {
        const wasRunning = initial.status !== 'idle'
        const next = await deps.preview.stop()
        return {
          action,
          state: toToolPreviewState(next.status),
          message: wasRunning ? 'Preview stopped.' : 'Preview was not running.',
        }
      }
    }
  }
}

/**
 * Only one preview session exists, so the only ids that can match are the live
 * target id and the fixed preview id `start` will create.
 */
function targetMatches(
  requested: string,
  action: PreviewAction,
  snapshot: PreviewSessionSnapshot,
): boolean {
  if (snapshot.targetId === requested) return true
  return action === 'start' && requested === PREVIEW_TARGET_ID
}

/* ------------------------------------------------------------------ */
/* Approval gate (tools/pre-execute)                                   */
/* ------------------------------------------------------------------ */

export const PREVIEW_TOOL_NAME = 'vibe_preview'

/** The `tools/pre-execute` fields the gate reads. */
export interface PreviewGateExecution {
  readonly name: string
  readonly arguments?: unknown
}

/** Enough of DSH's `PreToolDecision` to type the ask; `next()` covers the rest. */
export type PreviewAskDecision = {
  readonly kind: 'ask'
  readonly reason: string
  readonly displayReason?: {
    readonly en: string
    readonly [locale: string]: string
  }
}

function actionArgument(exec: PreviewGateExecution): string | undefined {
  if (exec.name !== PREVIEW_TOOL_NAME) return undefined
  const args = exec.arguments
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined
  const action = (args as Record<string, unknown>).action
  return typeof action === 'string' ? action : undefined
}

function displayUrl(exec: PreviewGateExecution): string | undefined {
  const args = exec.arguments
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined
  const url = (args as Record<string, unknown>).url
  if (typeof url !== 'string') return undefined
  const clean = url.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (clean.length === 0) return undefined
  return clean.length <= DISPLAY_URL_MAX_CHARS
    ? clean
    : `${clean.slice(0, DISPLAY_URL_MAX_CHARS - 1)}…`
}

/**
 * `ask` for start/stop, `null` for everything else. Anything malformed also
 * returns `null`: the tool's schema validation rejects it with a better message
 * than an approval prompt would.
 */
export function previewApprovalDecision(exec: PreviewGateExecution): PreviewAskDecision | null {
  const action = actionArgument(exec)
  if (action === 'start') {
    const url = displayUrl(exec)
    const reason = url === undefined ? 'vibe_preview start' : `vibe_preview start ${url}`
    return {
      kind: 'ask',
      reason,
      displayReason: {
        en: url === undefined ? 'Start the Vibe Studio preview?' : `Start the Vibe Studio preview at ${url}?`,
        'zh-CN': url === undefined ? '是否启动 Vibe Studio 预览？' : `是否启动 Vibe Studio 预览（${url}）？`,
      },
    }
  }
  if (action === 'stop') {
    return {
      kind: 'ask',
      reason: 'vibe_preview stop',
      displayReason: {
        en: 'Stop the Vibe Studio preview?',
        'zh-CN': '是否停止 Vibe Studio 预览？',
      },
    }
  }
  return null
}

/**
 * `tools/pre-execute` listener. Non-approval calls delegate with `next()` so
 * later listeners (T053's guard, other plugins) still decide; returning `allow`
 * here would silently skip them.
 */
export function createPreviewApprovalGate() {
  return async <Decision extends { readonly kind: string }>(
    exec: PreviewGateExecution,
    next: () => Promise<Decision>,
  ): Promise<Decision | PreviewAskDecision> => previewApprovalDecision(exec) ?? next()
}
