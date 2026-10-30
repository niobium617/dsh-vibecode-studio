/**
 * Host entry for dsh-vibecode-studio.
 *
 * T008 scaffold: plugin identity, config validation and the service slot.
 * T011 adds the authenticated `/api/vibe` transport (health + unary methods);
 * later preview features register methods on the same registry.
 */
import { createApiCollectionStore } from './api/collection-store'
import { createApiEnvironmentStore } from './api/environment-store'
import { createApiHistoryStore } from './api/history-store'
import { createApiSampleServer } from './api/sample-server'
import type { ApiSecretStore, CredentialProviderLike } from './api/secrets'
import { createApiSecretStore } from './api/secrets'
import { ApiService, registerApiMethods } from './api/service'
import {
  registerVibeCommand,
  type VibeCommandRegistry,
} from './agent/commands/vibe'
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
export {
  API_ENVIRONMENT_DIR_NAME,
  API_ENVIRONMENT_FILE_EXT,
  ApiEnvironmentStore,
  createApiEnvironmentStore,
  summarizeEnvironment,
} from './api/environment-store'
export type { ApiEnvironmentListResult } from './api/environment-store'
export { createApiSecretStore, CREDENTIAL_NAME_PATTERN, isCredentialName } from './api/secrets'
export { createApiSampleServer } from './api/sample-server'
export type { ApiSampleServer } from './api/sample-server'
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
  API_ENV_GET_METHOD,
  API_ENV_LIST_METHOD,
  API_ENV_REMOVE_METHOD,
  API_ENV_SAVE_METHOD,
  API_HISTORY_CLEAR_METHOD,
  API_HISTORY_LIST_METHOD,
  API_HTTP_SEND_METHOD,
  API_OPENAPI_IMPORT_METHOD,
  API_REPLAY_PREPARE_METHOD,
  API_SAMPLE_INFO_METHOD,
  ApiService,
  registerApiMethods,
  summarizeCollection,
} from './api/service'
export type { ApiSendOutcome, ApiServiceOptions } from './api/service'
export { prepareReplay } from './api/replay'
export type { ReplayPrepareOptions } from './api/replay'
export {
  importOpenApi,
  OPENAPI_IMPORT_BODY_BUDGET_BYTES,
} from './api/openapi/mapper'
export type {
  OpenApiEndpoint,
  OpenApiImportOptions,
  OpenApiImportResult,
} from './api/openapi/mapper'
export {
  OPENAPI_MAX_DOCUMENT_BYTES,
  OPENAPI_MAX_OPERATIONS,
  OpenApiError,
} from './api/openapi/parser'
export type { OpenApiErrorCode, OpenApiVersion } from './api/openapi/parser'
export { evaluateAssertions, findHeader, formatAssertionValue, parseJsonPath } from './api/assertions'
export type { JsonPathSegment } from './api/assertions'
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
export { createPreviewService, PREVIEW_TARGET_ID } from './preview/session'
export type {
  PreviewScreenshot,
  PreviewService,
  PreviewServiceOptions,
} from './preview/session'
export { isLoopbackHost } from './preview/url'
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
export {
  isVibeToolName,
  VIBE_TOOL_NAMES,
  VIBE_TOOL_SPECS,
  validateToolArguments,
  validateToolSpecs,
} from './agent/tools/definitions'
export type {
  JsonSchemaNode,
  JsonSchemaObject,
  VibeToolName,
  VibeToolSpec,
} from './agent/tools/definitions'
export {
  createVibeCommand,
  createVibeCommandHandler,
  registerVibeCommand,
  renderVibeStatus,
  suggestNextStep,
  VIBE_COMMAND_BUDGET_BYTES,
  VIBE_COMMAND_NAME,
  VIBE_COMMAND_USAGE,
} from './agent/commands/vibe'
export type {
  VibeCommandDefinition,
  VibeCommandDeps,
  VibeCommandHandler,
  VibeCommandInvocation,
  VibeCommandRegistry,
  VibeCommandResult,
} from './agent/commands/vibe'
export {
  asVibeToolError,
  createVibeToolDefinitions,
  registerVibeTools,
  renderToolResult,
  VibeToolError,
} from './agent/tools/register'
export type {
  VibeTextBlock,
  VibeToolContent,
  VibeToolDefinition,
  VibeToolHandler,
  VibeToolHandlers,
  VibeToolRegistry,
  VibeToolRunContext,
} from './agent/tools/register'
export { createStatusHandler } from './agent/tools/status'
export type {
  StatusAnnotationSource,
  StatusPreviewSource,
  StatusToolDeps,
  StatusToolOutput,
} from './agent/tools/status'
export { createObserveHandler, OBSERVE_SECTIONS } from './agent/tools/observe'
export type {
  ObservePreviewSource,
  ObserveSection,
  ObserveToolDeps,
  ObserveToolOutput,
} from './agent/tools/observe'
export {
  createPreviewApprovalGate,
  createPreviewHandler,
  PREVIEW_ACTIONS,
  PREVIEW_TOOL_NAME,
  previewApprovalDecision,
} from './agent/tools/preview'
export type {
  PreviewAction,
  PreviewArtifactSink,
  PreviewAskDecision,
  PreviewGateExecution,
  PreviewToolConfig,
  PreviewToolDeps,
  PreviewToolOutput,
  PreviewToolSource,
} from './agent/tools/preview'
export {
  ARTIFACT_DIR_NAME,
  ArtifactStore,
  ArtifactStoreError,
  createArtifactStore,
  isArtifactId,
  MAX_ARTIFACT_BYTES,
  SCREENSHOT_FILE_EXT,
  toArtifactStudioError,
} from './artifacts/store'
export type {
  ArtifactStoreOptions,
  SaveScreenshotOptions,
  StoredArtifact,
} from './artifacts/store'
export { createAnnotationGetHandler, toAnnotationToolOutput } from './agent/tools/annotation'
export type {
  AnnotationElementOutput,
  AnnotationToolDeps,
  AnnotationToolOutput,
} from './agent/tools/annotation'
export {
  buildDomOutlineExpression,
  collectDomOutline,
  DOM_OUTLINE_MAX_BYTES,
  isDomSnapshotParams,
  parseDomOutlineResult,
} from './preview/dom'
export type { DomSnapshot, DomSnapshotParams } from './preview/dom'
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
  /**
   * Cordis' inject-free service read. `/vibe` registers through this slot so
   * a host without the `commands` plugin keeps the rest of the studio working.
   */
  get?(name: string): unknown
  /** The command registry itself, when a host exposes it directly. */
  readonly commands?: VibeCommandRegistry
}

/**
 * Read DSH's command registry without making it a hard dependency:
 * `ctx.commands` throws in a Cordis context that did not `inject` the service,
 * so real hosts resolve through `ctx.get`, while bare test hosts may expose the
 * registry as a plain property.
 */
function resolveCommandRegistry(ctx: HostContext): VibeCommandRegistry | undefined {
  const service =
    typeof ctx.get === 'function' ? ctx.get('commands') : ctx.commands
  if (!service || typeof (service as { register?: unknown }).register !== 'function') {
    return undefined
  }
  return service as VibeCommandRegistry
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

  // T050: `/vibe` reads the same host-owned state as `vibe_status` and answers
  // with one next step; it never starts, stops or navigates a preview. The
  // command is user-facing only, so unlike the tools it is not preset-gated.
  const commands = resolveCommandRegistry(ctx)
  if (commands) {
    const setupCommand = () =>
      registerVibeCommand(commands, { preview, annotations: annotationHistory })
    if (typeof ctx.effect === 'function') {
      ctx.effect(setupCommand, 'vibe-studio: /vibe command')
    } else {
      void setupCommand()
    }
  }

  // T036: secrets live only in `ctx.credentials`. A host without the seam
  // reports every reference as unconfigured rather than storing values here.
  const apiSecrets = createApiSecretStore({ credentials: ctx.credentials })

  // T038: the request builder sends through one unary method; expansion and
  // execution stay host-side so resolved secrets never reach the panel.
  // T044: collections and history live beside it under `.vibe/api`; the panel
  // saves through `api.collection.add` and reads one page of history at a time.
  const apiCollections = createApiCollectionStore(process.cwd())
  const apiHistory = createApiHistoryStore(process.cwd())
  // T046 R4: environments are edited and persisted under `.vibe/api`; a send
  // names one by id and the Host loads it, so secret references stay host-side.
  const apiEnvironments = createApiEnvironmentStore(process.cwd())
  // U04: a loopback-only sample endpoint so the first Send works without typing
  // a URL or reaching the internet. It starts lazily on the first panel request.
  const apiSample = createApiSampleServer()
  const api = new ApiService({
    secrets: apiSecrets,
    collections: apiCollections,
    history: apiHistory,
    environments: apiEnvironments,
    sample: () => apiSample.info(),
  })
  const setupApi = () => {
    const disposeMethods = registerApiMethods(registry, api)
    return async () => {
      disposeMethods()
      await apiSample.dispose()
    }
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(setupApi, 'vibe-studio: api methods')
  } else {
    void setupApi()
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
