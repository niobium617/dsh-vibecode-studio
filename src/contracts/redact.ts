/**
 * Redaction is applied before page or API data leaves the host for logs,
 * renderers or model context. Contract-level helpers stay side-effect free.
 */

export const REDACTED = 'REDACTED'

const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|token|secret|password|passwd|api[-_]?key|credential|private[-_]?key/i

/**
 * A value that is entirely a `{{variable}}` placeholder carries no secret, so
 * redaction keeps it: imported requests (T042) are only reusable if their
 * placeholders survive a save.
 */
const PLACEHOLDER_PATTERN = /^\{\{[A-Za-z_][A-Za-z0-9_.-]*\}\}$/

export function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value)
}

/**
 * `new URL()` percent-encodes `{` and `}`, which would turn a saved
 * `{{petId}}` into `%7B%7BpetId%7D%7D` and stop the env resolver from finding
 * it. Restore just the placeholder sequences.
 */
const ENCODED_PLACEHOLDER_PATTERN = /%7B%7B([A-Za-z_][A-Za-z0-9_.-]*)%7D%7D/gi

function restorePlaceholders(value: string): string {
  return value.replace(ENCODED_PLACEHOLDER_PATTERN, '{{$1}}')
}

function maskSensitive(key: string, value: string): string {
  return isSensitiveKey(key) && !isPlaceholderValue(value) ? REDACTED : value
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * T059: a token can arrive in the fragment (OAuth implicit flow, hash routers
 * that mirror the query). Only `key=value` pairs with a sensitive key are
 * rewritten; everything else keeps its exact encoding, so a route fragment
 * like `#/settings` is untouched.
 */
function redactFragment(hash: string): string {
  const raw = hash.slice(1)
  if (raw === '' || !raw.includes('=')) return hash
  let changed = false
  const parts = raw.split('&').map((part) => {
    const separator = part.indexOf('=')
    if (separator <= 0) return part
    const key = part.slice(0, separator)
    const value = part.slice(separator + 1)
    if (!isSensitiveKey(safeDecode(key)) || isPlaceholderValue(safeDecode(value))) return part
    changed = true
    return `${key}=${REDACTED}`
  })
  return changed ? `#${parts.join('&')}` : hash
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

export function redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key] = maskSensitive(key, value)
  }
  return result
}

export function redactUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return value
  }

  if (url.username || url.password) {
    url.username = ''
    url.password = ''
  }

  const params = new URLSearchParams()
  for (const [key, entry] of url.searchParams) {
    params.append(key, maskSensitive(key, entry))
  }
  url.search = params.toString()
  url.hash = redactFragment(url.hash)
  return restorePlaceholders(url.toString())
}

export function redactJsonBody(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[max-depth]'
  if (Array.isArray(value)) {
    return value.map((entry) => redactJsonBody(entry, depth + 1))
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] =
        typeof entry === 'string'
          ? maskSensitive(key, entry)
          : isSensitiveKey(key)
            ? REDACTED
            : redactJsonBody(entry, depth + 1)
    }
    return result
  }
  return value
}
