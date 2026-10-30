/**
 * T053: `tools/pre-execute` guard for `vibe_preview`.
 *
 * `vibe_preview` already rejects overreach inside its body, but a body failure
 * happens after approval and after the call was admitted. The guard answers the
 * same policy questions *before* dispatch, so a disallowed navigate/start never
 * reaches an approval prompt (T049 asks for `start`) and never touches a
 * browser: non-loopback hosts, origins outside `allowedOrigins`, a
 * cross-origin navigate, and screenshots while the setting is off are all
 * denied here.
 *
 * Registered inside the preset's scope only, and registered before the
 * approval gate: a denied call must not first ask the user. Everything the
 * guard does not deny delegates with `next()`, so the gate and any later
 * listener still decide — the gate itself follows the same rule.
 *
 * Malformed arguments return `null` instead of a deny: schema validation and
 * the tool body produce a better message (`invalid_input` with a field hint)
 * than a policy denial would.
 */
import { isStudioError } from '../../../contracts/errors'
import {
  PREVIEW_TOOL_NAME,
  parseHttpUrl,
  requireAllowedOrigin,
  requireLoopback,
  snapshotOrigin,
  type PreviewToolConfig,
} from '../tools/preview'
import type { PreToolDenyDecision } from './types'

/** The live settings slice the guard enforces. */
export type PreviewGuardConfig = PreviewToolConfig

export interface PreviewGuardDeps {
  /** Live config, so a settings change applies to the next call. */
  readonly config: () => PreviewGuardConfig
  /** URL of the running page, or null while the preview is not ready. */
  readonly currentUrl: () => string | null
}

export interface PreviewGuardExecution {
  readonly name: string
  readonly arguments?: unknown
}

function argsOf(exec: PreviewGuardExecution): Record<string, unknown> | undefined {
  if (exec.name !== PREVIEW_TOOL_NAME) return undefined
  const value = exec.arguments
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function deny(reason: string): PreToolDenyDecision {
  return { kind: 'deny', reason, info: { name: 'VibeToolError', code: 'permission_denied' } }
}

/**
 * `null` means "not overreach, let the pipeline continue". Anything that does
 * not parse as an action/URL is left to the tool's own validation.
 */
export function previewGuardDecision(
  exec: PreviewGuardExecution,
  deps: PreviewGuardDeps,
): PreToolDenyDecision | null {
  const args = argsOf(exec)
  if (!args) return null
  const action = args.action
  if (typeof action !== 'string') return null

  if (action === 'screenshot') {
    return deps.config().screenshotEnabled
      ? null
      : deny('vibe-studio: screenshots are disabled in settings')
  }

  if (action !== 'navigate' && action !== 'start') return null
  const raw = args.url
  if (typeof raw !== 'string' || raw.trim().length === 0) return null

  let url: URL
  try {
    url = parseHttpUrl(raw, 'url')
  } catch {
    // Invalid URLs are `invalid_input`, not policy overreach.
    return null
  }

  try {
    requireLoopback(url)
    requireAllowedOrigin(url, deps.config().allowedOrigins)
  } catch (error) {
    if (isStudioError(error)) return deny(error.message)
    throw error
  }

  if (action === 'navigate') {
    const current = snapshotOrigin(deps.currentUrl())
    if (current !== null && current !== url.origin) {
      return deny(`vibe-studio: navigate must stay on the preview origin ${current}`)
    }
  }

  return null
}

/** `tools/pre-execute` listener: deny overreach, delegate everything else. */
export function createPreviewGuard(deps: PreviewGuardDeps) {
  return async <Decision extends { readonly kind: string }>(
    exec: PreviewGuardExecution,
    next: () => Promise<Decision>,
  ): Promise<Decision | PreToolDenyDecision> => previewGuardDecision(exec, deps) ?? next()
}
