/**
 * Target model and adapter contract (T016).
 *
 * A target config is validated once by `validateTargetConfig`; adapters always
 * receive the normalized form. Capabilities are declared by the adapter, not
 * by the user, so the UI can hide unsupported features instead of failing
 * halfway through a session.
 */
import { studioError, type StudioError } from '../../contracts/errors'
import type {
  TargetCapabilities,
  TargetConfig,
  TargetKind,
  TargetSession,
  TargetViewport,
} from '../../contracts/target'

export const DEFAULT_VIEWPORT: TargetViewport = Object.freeze({
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
})

/** Config accepted by adapters: optional fields are normalized and complete. */
export interface ValidatedTargetConfig extends TargetConfig {
  readonly viewport: TargetViewport
}

export interface TargetStartOptions {
  readonly signal?: AbortSignal
}

/**
 * Narrow CDP surface used for `Page.startScreencast` (T020). Playwright's
 * `CDPSession` satisfies it structurally; tests substitute a fake.
 */
export interface ScreencastSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>
  on(event: string, listener: (params: unknown) => void): void
  off?(event: string, listener: (params: unknown) => void): void
  detach(): Promise<void>
}

/** Live page handle a screencast source can attach to. */
export interface ScreencastPageLike {
  viewport(): { readonly width: number; readonly height: number } | null
  createCdpSession(): Promise<ScreencastSessionLike>
}

/**
 * One adapter instance drives one target kind (web, desktop, api). Starting a
 * second time while running must return the same session; `stop` releases the
 * process/page and is idempotent. Feature methods are optional and are only
 * called when the matching capability is declared.
 */
export interface TargetAdapter {
  readonly id: string
  readonly kind: TargetKind
  readonly capabilities: TargetCapabilities
  start(config: ValidatedTargetConfig, options?: TargetStartOptions): Promise<TargetSession>
  navigate?(url: string): Promise<void>
  /** Reloads the current page in place (toolbar refresh). */
  reload?(): Promise<void>
  /** Resizes the live page; DPR changes need a restart and are not offered. */
  setViewport?(viewport: TargetViewport): Promise<void>
  screenshot?(): Promise<Uint8Array>
  /** Present when `capabilities.screencast` is true; undefined before start. */
  screencastPage?(): ScreencastPageLike | undefined
  /**
   * Liveness probe. A crashed browser or closed page reports false while the
   * session still holds its handles; the preview service turns that into a
   * visible `failed` snapshot that can be restarted.
   */
  isAlive?(): boolean
  stop(): Promise<void>
}

/** Thrown when a call needs a capability the adapter did not declare. */
export function assertCapability(
  capabilities: TargetCapabilities,
  name: keyof TargetCapabilities,
  error?: StudioError,
): void {
  if (capabilities[name]) return
  throw (
    error ??
    studioError('unsupported', `vibe-studio: target adapter does not support "${name}"`, {
      capability: name,
    })
  )
}
