/**
 * Settings transport adapter (T014).
 *
 * The panel never touches `.vibe/studio.json` directly: it asks the Host over
 * the authenticated unary route and validates the response shape before
 * rendering. Tests inject a fake {@link SettingsApi}.
 */
import {
  SETTINGS_GET_METHOD,
  SETTINGS_UPDATE_METHOD,
  isStudioSettingsSnapshot,
  type StudioSettingsSnapshot,
  type StudioSettingsUpdateParams,
  type StudioSettingsValues,
} from '../../../contracts/settings'
import { TransportError, callUnary } from '../../transport'

export interface SettingsRequestOptions {
  readonly signal?: AbortSignal
}

export interface SettingsApi {
  load(options?: SettingsRequestOptions): Promise<StudioSettingsSnapshot>
  save(
    settings: StudioSettingsValues,
    options?: SettingsRequestOptions,
  ): Promise<StudioSettingsSnapshot>
}

function assertSnapshot(value: unknown): StudioSettingsSnapshot {
  if (!isStudioSettingsSnapshot(value)) {
    throw new TransportError('internal', 'invalid settings response')
  }
  return value
}

export const transportSettingsApi: SettingsApi = {
  async load(options = {}) {
    const value = await callUnary<unknown>(SETTINGS_GET_METHOD, undefined, options)
    return assertSnapshot(value)
  },
  async save(settings, options = {}) {
    const params: StudioSettingsUpdateParams = { settings }
    const value = await callUnary<unknown>(SETTINGS_UPDATE_METHOD, params, options)
    return assertSnapshot(value)
  },
}
