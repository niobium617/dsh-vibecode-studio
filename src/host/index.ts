/**
 * Host entry for dsh-vibecode-studio.
 *
 * T008 scaffold: plugin identity, config validation and the service slot.
 * T011 adds the authenticated `/api/vibe` transport (health + unary methods);
 * later preview features register methods on the same registry.
 */
import { createApiCollectionStore } from './api/collection-store'
import { createApiHistoryStore } from './api/history-store'
import type { ApiSecretStore, CredentialProviderLike } from './api/secrets'
import { createApiSecretStore } from './api/secrets'
import { ApiService, registerApiMethods } from './api/service'
import { Config, resolveConfig, type VibeStudioConfig } from './config'
import {
  AnnotationHistoryService,
  createAnnotationHistoryService,
  registerAnnotationHistoryMethods,
} from './inspect/history'
import {
  registerPreviewMethods,
  registerPreviewRoutes,
  type PreviewService,
} from './preview/route'
import { createPreviewService } from './preview/session'
import {
  createStudioSettingsService,
  registerSettingsMethods,
  type StudioSettingsService,
} from './studio/settings'
import {
  createTargetAdapterRegistry,
  type TargetAdapterRegistry,
} from './targets/registry'
import { createWebTargetAdapter } from './targets/web/adapter'
import {
  registerTransport,
  type TransportHostContext,
  type UnaryRegistry,
} from './transport'

export { Config, LOG_LEVELS, normalizeOrigin, resolveConfig } from './config'
export type { LogLevel, VibeStudioConfig } from './config'
export {
  createStudioSettingsService,
  registerSettingsMethods,
  StudioSettingsService,
} from './studio/settings'
export type { StudioSettingsServiceOptions } from './studio/settings'
export {
  createHealthPayload,
  registerTransport,
  UnaryRegistry,
} from './transport'
export type { UnaryCallContext, UnaryDispatchResult, UnaryHandler } from './transport'
export {
  AnnotationHistoryService,
  createAnnotationHistoryService,
  registerAnnotationHistoryMethods,
  toAnnotationHistoryError,
} from './inspect/history'
export type { AnnotationHistoryServiceOptions } from './inspect/history'
export {
  describeEnvironment,
  parseApiEnvironment,
  resolveHttpRequest,
  secretReferences,
} from './api/environment'
export type {
  ResolveHttpRequestOptions,
  ResolvedHttpRequest,
} from './api/environment'
export { createApiSecretStore, CREDENTIAL_NAME_PATTERN, isCredentialName } from './api/secrets'
export type {
  ApiSecretStore,
  ApiSecretStoreOptions,
  CredentialDescription,
  CredentialProviderLike,
} from './api/secrets'
export { createHttpExecutor, HttpExecutor } from './api/executor'
export type { HttpExecuteOptions, HttpExecutorOptions } from './api/executor'
export {
  API_COLLECTION_DIR_NAME,
  API_COLLECTION_FILE_EXT,
  ApiCollectionStore,
  createApiCollectionStore,
  redactCollection,
} from './api/collection-store'
export type { ApiCollectionListResult } from './api/collection-store'
export {
  API_HISTORY_FILE_NAME,
  API_HISTORY_VERSION,
  ApiHistoryStore,
  createApiHistoryStore,
} from './api/history-store'
export type {
  ApiHistoryAppendDetails,
  ApiHistoryListResult,
  ApiHistoryStoreOptions,
} from './api/history-store'
export { ApiStoreError, toApiStoreStudioError } from './api/store-files'
export type { ApiStoreErrorCode, ApiStoreFileOptions } from './api/store-files'
export {
  API_COLLECTION_ADD_METHOD,
  API_COLLECTION_GET_METHOD,
  API_COLLECTION_LIST_METHOD,
  API_COLLECTION_REMOVE_METHOD,
  API_HISTORY_CLEAR_METHOD,
  API_HISTORY_LIST_METHOD,
  API_HTTP_SEND_METHOD,
  API_REPLAY_PREPARE_METHOD,
  ApiService,
  registerApiMethods,
  summarizeCollection,
} from './api/service'
export type { ApiSendOutcome, ApiServiceOptions } from './api/service'
export { prepareReplay } from './api/replay'
export type { ReplayPrepareOptions } from './api/replay'
export { isBlockedHost, normalizeHttpRequest } from './api/request'
export type { NormalizedHttpRequest, NormalizeRequestOptions } from './api/request'
export { createTargetAdapterRegistry } from './targets/registry'
export type { TargetAdapterRegistry } from './targets/registry'
export { validateTargetConfig } from './targets/validate'
export { assertCapability, DEFAULT_VIEWPORT } from './targets/types'
export type {
  ScreencastPageLike,
  ScreencastSessionLike,
  TargetAdapter,
  TargetStartOptions,
  ValidatedTargetConfig,
} from './targets/types'
export { registerPreviewMethods, registerPreviewRoutes } from './preview/route'
export { createPreviewService } from './preview/session'
export type { PreviewService, PreviewServiceOptions } from './preview/session'
export { createPreviewFrameBuffer, PreviewFrameBuffer } from './preview/frame-buffer'
export type { FrameListener, PreviewFrame } from './preview/frame-buffer'
export { createScreencastSource } from './preview/screencast'
export type {
  ScreencastOptions,
  ScreencastSource,
  ScreencastStats,
} from './preview/screencast'
export {
  createPreviewInputDispatcher,
  mapPoint,
  modifierMask,
} from './preview/input'
export type {
  PreviewInputDispatcher,
  PreviewInputDispatcherOptions,
} from './preview/input'
export {
  createPreviewConsoleCollector,
  formatConsoleArgs,
  formatRemoteObject,
  mapConsoleEvent,
  normalizeConsoleText,
  normalizeConsoleTimestamp,
  PreviewConsoleBuffer,
} from './preview/console'
export type {
  ConsoleRecordInput,
  PreviewConsoleCollector,
  PreviewConsoleCollectorOptions,
  PreviewConsoleStats,
} from './preview/console'
export {
  buildPickerScript,
  createPreviewPicker,
  normalizePickedElement,
  PICK_BINDING_NAME,
  PICK_OVERLAY_ID,
} from './inspect/inject'
export type { PreviewPicker, PreviewPickerOptions } from './inspect/inject'
export {
  ANNOTATION_DIR_NAME,
  ANNOTATION_FILE_EXT,
  AnnotationStore,
  AnnotationStoreError,
  createAnnotationStore,
  MAX_ANNOTATION_FILE_BYTES,
} from './inspect/annotation-store'
export type {
  AnnotationListResult,
  AnnotationStoreErrorCode,
} from './inspect/annotation-store'
export { buildSelector } from './inspect/selector'
export type { SelectorResult } from './inspect/selector'
export { createWebTargetAdapter, WEB_TARGET_CAPABILITIES } from './targets/web/adapter'
export type {
  WebTargetAdapter,
  WebTargetAdapterOptions,
  WebTargetAdapterStatus,
} from './targets/web/adapter'
export {
  EDGE_CHANNEL,
  isEdgeMissingError,
  launchEdge,
  toNavigationError,
  toScreenshotError,
  toStartError,
} from './targets/web/launch'
export type { BrowserLauncher, LaunchEdgeOptions } from './targets/web/launch'
export {
  createDevServerSupervisor,
  validateDevServerSpec,
} from './targets/process/supervisor'
export type {
  DevServerChildProcess,
  DevServerExit,
  DevServerProcessInfo,
  DevServerSpec,
  DevServerSpawn,
  DevServerSpawnOptions,
  DevServerStartOptions,
  DevServerState,
  DevServerStatus,
  DevServerStopResult,
  DevServerSupervisor,
  DevServerSupervisorOptions,
  DevServerTreeKill,
} from './targets/process/supervisor'
export { createLogRingBuffer, stripAnsi } from './targets/process/logs'
export type {
  DevServerLogEntry,
  DevServerLogStream,
  LogRingBuffer,
  LogRingBufferOptions,
  LogRingBufferSnapshotOptions,
} from './targets/process/logs'

export const name = 'dsh-vibecode-studio'
// `credentials` is read in `apply` for the API secret seam (T036); Cordis throws
// on undeclared service access, so it must be in the inject map.
export const inject = ['connection', 'credentials']

/** The service this plugin exposes to later host modules (T011+). */
export interface VibeStudioService {
  readonly config: VibeStudioConfig
  /** Unary method registry shared by preview, inspect and API features. */
  readonly transport: UnaryRegistry
  /** `.vibe/studio.json` settings, shared with the panel. */
  readonly settings: StudioSettingsService
  /** Adapters that can serve each target kind (T016). */
  readonly targets: TargetAdapterRegistry
  /** Preview session + shared latest-frame buffer (T020). */
  readonly preview: PreviewService
  /** Persisted annotation history under `.vibe/annotations` (T033). */
  readonly annotationHistory: AnnotationHistoryService
  /** Credential seam for API environments (T036); never returns secret values. */
  readonly apiSecrets: ApiSecretStore
}

/** Minimal Cordis surface used at this stage. */
export interface HostContext extends TransportHostContext {
  provide(name: string, value: unknown): void
  /** DSH's `ctx.credentials`; absent in bare test hosts. */
  readonly credentials?: CredentialProviderLike
}

export function apply(ctx: HostContext, config: VibeStudioConfig = new Config()): void {
  const resolved = resolveConfig(config)
  const { registry } = registerTransport(ctx, { plugin: name, config: resolved })

  // M1 binds the project root to the Host process cwd; `apply` has no session
  // yet. Revisit once preview targets resolve a workspace directory (M2).
  const settings = createStudioSettingsService({ projectDir: process.cwd(), config: resolved })
  // M2 adapters register here; T017 provides the web/Edge adapter. Desktop and
  // API kinds stay unregistered and fail late lookups with `unsupported`.
  const targets = createTargetAdapterRegistry()
  targets.register(createWebTargetAdapter())
  const setupSettings = () => registerSettingsMethods(registry, settings)
  if (typeof ctx.effect === 'function') {
    ctx.effect(setupSettings, 'vibe-studio: settings methods')
  } else {
    setupSettings()
  }

  // T033 annotation history shares the project root with settings; the panel
  // saves, searches, reopens and deletes through these unary methods.
  const annotationHistory = createAnnotationHistoryService({ projectDir: process.cwd() })
  const setupAnnotationHistory = () => registerAnnotationHistoryMethods(registry, annotationHistory)
  if (typeof ctx.effect === 'function') {
    ctx.effect(setupAnnotationHistory, 'vibe-studio: annotation history methods')
  } else {
    setupAnnotationHistory()
  }

  // T020 preview: unary lifecycle methods plus the stream/pull frame routes.
  const preview = createPreviewService({ targets })
  const setupPreview = () => {
    const disposeMethods = registerPreviewMethods(registry, preview)
    return async () => {
      disposeMethods()
      await preview.dispose()
    }
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(setupPreview, 'vibe-studio: preview methods')
  } else {
    void setupPreview()
  }
  registerPreviewRoutes(ctx, preview)

  // T036: secrets live only in `ctx.credentials`. A host without the seam
  // reports every reference as unconfigured rather than storing values here.
  const apiSecrets = createApiSecretStore({ credentials: ctx.credentials })

  // T038: the request builder sends through one unary method; expansion and
  // execution stay host-side so resolved secrets never reach the panel.
  // T044: collections and history live beside it under `.vibe/api`; the panel
  // saves through `api.collection.add` and reads one page of history at a time.
  const apiCollections = createApiCollectionStore(process.cwd())
  const apiHistory = createApiHistoryStore(process.cwd())
  const api = new ApiService({
    secrets: apiSecrets,
    collections: apiCollections,
    history: apiHistory,
  })
  const setupApi = () => registerApiMethods(registry, api)
  if (typeof ctx.effect === 'function') {
    ctx.effect(setupApi, 'vibe-studio: api methods')
  } else {
    setupApi()
  }

  ctx.provide('vibeStudio', {
    config: resolved,
    transport: registry,
    settings,
    targets,
    preview,
    annotationHistory,
    apiSecrets,
  } satisfies VibeStudioService)
}
