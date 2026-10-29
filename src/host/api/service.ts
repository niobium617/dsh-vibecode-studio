/**
 * Unary surface for the API workbench (T038).
 *
 * The request builder sends through one method so every browser → Host call
 * reuses the same envelope, validation and error mapping as the rest of the
 * panel. The request arrives as untrusted JSON: it is expanded against the
 * caller's environment first (secrets resolve host-side only) and then handed
 * to the executor, which re-validates everything it touches.
 */
import {
  API_HTTP_SEND_METHOD,
  API_REPLAY_PREPARE_METHOD,
  isApiEnvironment,
  type ApiReplayResult,
  type HttpExecutionResult,
  type UnresolvedVariable,
} from '../../contracts/api'
import { studioError } from '../../contracts/errors'
import { resolveHttpRequest } from './environment'
import { createHttpExecutor, type HttpExecutor } from './executor'
import { prepareReplay as prepareReplayDraft } from './replay'
import type { ApiSecretStore } from './secrets'
import type { UnaryRegistry } from '../transport'

export { API_HTTP_SEND_METHOD, API_REPLAY_PREPARE_METHOD }

export interface ApiServiceOptions {
  readonly secrets: ApiSecretStore
  /** Injected for tests; defaults to the real executor. */
  readonly executor?: HttpExecutor
}

export interface ApiSendOutcome {
  readonly result: HttpExecutionResult
  /** Placeholders that stayed literal because nothing resolved them. */
  readonly unresolved: readonly UnresolvedVariable[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(message: string, field: string): never {
  throw studioError('invalid_input', message, { field })
}

export class ApiService {
  private readonly executor: HttpExecutor
  private readonly secrets: ApiSecretStore

  constructor(options: ApiServiceOptions) {
    this.executor = options.executor ?? createHttpExecutor()
    this.secrets = options.secrets
  }

  /**
   * Expands `{{variables}}` and executes one request. Resolves with the
   * response even for 4xx/5xx; validation, policy and transport failures
   * reject with a `StudioError` the client can read.
   */
  async send(params: unknown, signal?: AbortSignal): Promise<ApiSendOutcome> {
    if (!isRecord(params)) invalid('api.http.send expects an object', 'params')
    const environment = params.environment
    if (environment !== undefined && !isApiEnvironment(environment)) {
      invalid('environment is not a valid environment document', 'environment')
    }
    const resolved = await resolveHttpRequest(params.request, {
      secrets: this.secrets,
      ...(environment === undefined ? {} : { environment }),
    })
    const result = await this.executor.execute(resolved.request, {
      ...(signal === undefined ? {} : { signal }),
    })
    return { result, unresolved: resolved.unresolved }
  }

  /**
   * Turns a captured row into a draft (T043). No execution path exists here:
   * the answer is a spec the user still has to send from the panel.
   */
  prepareReplay(params: unknown): ApiReplayResult {
    if (!isRecord(params)) invalid('api.replay.prepare expects an object', 'params')
    return prepareReplayDraft(params.entry, { confirm: params.confirm === true })
  }
}

/** Registers the workbench methods; returns one idempotent unregister function. */
export function registerApiMethods(registry: UnaryRegistry, service: ApiService): () => void {
  const unregisterSend = registry.register(API_HTTP_SEND_METHOD, (params, context) =>
    service.send(params, context.signal),
  )
  const unregisterReplay = registry.register(API_REPLAY_PREPARE_METHOD, (params) =>
    service.prepareReplay(params),
  )
  return () => {
    unregisterSend()
    unregisterReplay()
  }
}
