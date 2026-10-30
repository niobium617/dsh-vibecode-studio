/**
 * Beginner / professional switch for the API page (U04).
 *
 * Beginner is the default: one request row, URL parameters and the response.
 * Professional keeps the advanced entries (cURL, result checks, environment,
 * OpenAPI, history) available. The last explicit choice is remembered in
 * `localStorage`; a storage failure falls back to beginner without breaking the
 * panel.
 */
export const API_UI_MODE_STORAGE_KEY = 'vibe-studio.api-mode'

export type ApiUiMode = 'beginner' | 'pro'

export function isApiUiMode(value: unknown): value is ApiUiMode {
  return value === 'beginner' || value === 'pro'
}

export function loadApiUiMode(): ApiUiMode {
  try {
    const stored = window.localStorage.getItem(API_UI_MODE_STORAGE_KEY)
    return isApiUiMode(stored) ? stored : 'beginner'
  } catch {
    return 'beginner'
  }
}

export function saveApiUiMode(mode: ApiUiMode): void {
  try {
    window.localStorage.setItem(API_UI_MODE_STORAGE_KEY, mode)
  } catch {
    // A blocked storage must never stop the switch itself.
  }
}
