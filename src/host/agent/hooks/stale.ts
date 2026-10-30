/**
 * T053: a successful file edit makes the running preview *possibly* outdated.
 *
 * The flag is advisory, never a block: the agent may edit a file the page does
 * not use, so the panel only shows a hint and the user decides whether to
 * reload. Marking happens in `tools/post-execute` because the decision must be
 * based on the final result — a failed edit changes nothing, and a later
 * listener could still turn the call into an error.
 *
 * Only the fs editing tools count. `bash`/`pwsh` can write files too, but
 * marking on every shell command would keep the hint permanently lit and teach
 * the user to ignore it; that limit is deliberate.
 *
 * Like the approval gate, this listener delegates with `next()` first and only
 * marks when the final decision is `accept`, so it never changes the result.
 */
import type { PostToolDecision } from './types'

export interface StaleHookExecution {
  readonly name: string
}

export interface StaleHookResult {
  readonly isError: boolean
}

export interface StaleHookDeps {
  /** Marks the live preview stale; the service ignores it when nothing runs. */
  markStale(): void
}

/** DSH fs tool names that change a file on disk. */
export const EDITING_TOOL_NAMES: ReadonlySet<string> = new Set(['write', 'edit'])

export function isEditingTool(name: string): boolean {
  return EDITING_TOOL_NAMES.has(name)
}

/**
 * `tools/post-execute` listener. Runs the later listeners first, then marks the
 * preview stale when an editing tool succeeded and nobody blocked it.
 */
export function createStaleHook(deps: StaleHookDeps) {
  return async (
    exec: StaleHookExecution,
    result: StaleHookResult,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> => {
    const decision = await next()
    if (decision.kind === 'accept' && result.isError !== true && isEditingTool(exec.name)) {
      deps.markStale()
    }
    return decision
  }
}
