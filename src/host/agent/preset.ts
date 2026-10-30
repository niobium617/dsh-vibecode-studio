/**
 * T052: the `Vibe Studio` preset's agent-plane plugin (`lib/agent.js`).
 *
 * The four Vibe tools must be visible to Vibe Studio sessions only. A Cordis
 * tool registration lands in the *caller's* scope layer, so the preset mounts
 * this module as one of its own rows: `ctx.tools.register` then lands in that
 * preset's layer and `standard`/`ptc`/`minimal` keep their untouched tool
 * surface (FR-PRESET-02). Re-mounting the whole host plugin per preset would
 * re-register the transport routes, hence a second package entry.
 *
 * The tool hooks are registered here for the same reason: a `tools/pre-execute`
 * listener dispatches on the agent's scope chain, so `vibe_preview start|stop`
 * asks a human only inside this preset (T049), the overreach guard denies only
 * here (T053), and the stale marker after an edit stays inside this preset too.
 *
 * Everything host-owned (`config`, `preview`, `annotationHistory`,
 * `artifacts`) arrives through the `vibeStudio` service so the preset never
 * constructs a second preview session or artifact store.
 */
import type { VibeStudioConfig } from '../config'
import type { AnnotationHistoryService } from '../inspect/history'
import type { PreviewService } from '../preview/session'
import { createPreviewGuard } from './hooks/guard'
import { createStaleHook } from './hooks/stale'
import { createAnnotationGetHandler } from './tools/annotation'
import { createObserveHandler } from './tools/observe'
import {
  createPreviewApprovalGate,
  createPreviewHandler,
  type PreviewArtifactSink,
  type PreviewToolConfig,
} from './tools/preview'
import {
  registerVibeTools,
  type VibeToolHandlers,
  type VibeToolRegistry,
} from './tools/register'
import { createStatusHandler } from './tools/status'

/** Patch row ids in `presets/vibe-studio/cordis.patch.yml`. */
export const VIBE_PRESET_PATCH_ROW_ID = 'preset-vibe-studio'
export const VIBE_TOOLS_PLUGIN_ID = 'vibe-tools'
/** preset registry identity (`config.id` of the `dsh-agent-preset` row). */
export const VIBE_PRESET_ID = 'vibe-studio'
export const VIBE_PRESET_NAME = 'Vibe Studio'
/** The package subpath this plugin is mounted through. */
export const VIBE_TOOLS_PLUGIN_NAME = 'dsh-vibecode-studio/agent'

/** `PreviewService` fields the four tools use, spelled once. */
export type VibeToolPreviewSource = Pick<
  PreviewService,
  | 'status'
  | 'consoleList'
  | 'networkList'
  | 'domSnapshot'
  | 'reload'
  | 'navigate'
  | 'start'
  | 'stop'
  | 'captureScreenshot'
  | 'markStale'
>

/** The `vibeStudio` service fields the tools read (structural subset). */
export interface VibeAgentStudio {
  readonly config: VibeStudioConfig
  readonly preview: VibeToolPreviewSource
  readonly annotationHistory: Pick<AnnotationHistoryService, 'list' | 'get'>
  /** Where `vibe_preview screenshot` writes; image bytes never reach the model. */
  readonly artifacts: PreviewArtifactSink
}

/**
 * Live config slice for `vibe_preview`. The settings service mutates the same
 * object in place, so reading through `studio.config` tracks panel edits
 * (origins, screenshot switch, retention) without a restart.
 */
export function previewToolConfig(config: VibeStudioConfig): PreviewToolConfig {
  return {
    allowedOrigins: config.allowedOrigins,
    screenshotEnabled: config.screenshotEnabled,
    retentionDays: config.retentionDays,
  }
}

/** One handler set bound to the shared host services. */
export function createVibeToolHandlers(studio: VibeAgentStudio): VibeToolHandlers {
  return {
    vibe_status: createStatusHandler({
      preview: studio.preview,
      annotations: studio.annotationHistory,
    }),
    vibe_observe: createObserveHandler({ preview: studio.preview }),
    vibe_annotation_get: createAnnotationGetHandler({ history: studio.annotationHistory }),
    vibe_preview: createPreviewHandler({
      preview: studio.preview,
      artifacts: studio.artifacts,
      config: () => previewToolConfig(studio.config),
    }),
  }
}

/** The Cordis surface this module uses inside a preset scope. */
export interface VibeAgentContext {
  readonly tools: VibeToolRegistry
  /** Inject-free read: `vibeStudio` is provided by the host row. */
  get(name: string): unknown
  on(
    event: string,
    listener:
      | ReturnType<typeof createPreviewGuard>
      | ReturnType<typeof createPreviewApprovalGate>
      | ReturnType<typeof createStaleHook>,
  ): () => void
}

export const name = 'vibe-studio-agent-tools'
// `vibeStudio` is provided by `dsh-vibecode-studio`'s `apply`, so declaring it
// here makes the row wait for the host instead of failing on a cold start.
export const inject = ['tools', 'vibeStudio']

export function apply(ctx: VibeAgentContext): () => void {
  const studio = ctx.get('vibeStudio') as VibeAgentStudio | undefined
  if (!studio) {
    throw new Error(
      'vibe-studio: the agent preset needs the dsh-vibecode-studio host plugin (vibeStudio service)',
    )
  }
  const disposeTools = registerVibeTools(ctx.tools, createVibeToolHandlers(studio))
  // Guard first: a denied call must not reach the approval prompt.
  const disposeGuard = ctx.on(
    'tools/pre-execute',
    createPreviewGuard({
      config: () => previewToolConfig(studio.config),
      currentUrl: () => studio.preview.status().url,
    }),
  )
  const disposeGate = ctx.on('tools/pre-execute', createPreviewApprovalGate())
  const disposeStale = ctx.on(
    'tools/post-execute',
    createStaleHook({ markStale: () => studio.preview.markStale() }),
  )
  return () => {
    disposeStale()
    disposeGate()
    disposeGuard()
    disposeTools()
  }
}
