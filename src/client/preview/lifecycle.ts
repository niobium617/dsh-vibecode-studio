/**
 * Preview lifecycle hooks shared by the preview page and the shell (T025).
 *
 * Switching internal Studio tabs unmounts `PreviewPage` but must not kill the
 * live target; closing the DSH panel unmounts `StudioShell` and must. The
 * module-level flag is the difference, and it is only set after the Host
 * reports a live or failed session, so plain shell renders never call the
 * transport.
 */
import { PREVIEW_STOP_METHOD } from '../../contracts/transport'
import { callUnary } from '../transport/client'

export const PREVIEW_STOP_TIMEOUT_MS = 15_000

let active = false

/** Marks whether a Host-side preview session may still hold resources. */
export function markPreviewActive(value: boolean): void {
  active = value
}

export function isPreviewActive(): boolean {
  return active
}

/**
 * Best-effort stop for shell teardown (panel close). Failures are swallowed:
 * teardown cannot surface an error, and the Host fiber's dispose repeats the
 * cleanup on reload.
 */
export async function stopPreviewSession(): Promise<void> {
  if (!active) return
  active = false
  try {
    await callUnary(PREVIEW_STOP_METHOD, undefined, {
      timeoutMs: PREVIEW_STOP_TIMEOUT_MS,
    })
  } catch {
    // The panel is going away; there is nowhere to show this.
  }
}
