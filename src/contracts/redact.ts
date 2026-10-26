/**
 * Redaction is applied before page or API data leaves the host for logs,
 * renderers or model context. Contract-level helpers stay side-effect free.
 */

export const REDACTED = 'REDACTED'

const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|token|secret|password|passwd|api[-_]?key|credential|private[-_]?key/i

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key)
}

export function redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key] = isSensitiveKey(key) ? REDACTED : value
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
    params.append(key, isSensitiveKey(key) ? REDACTED : entry)
  }
  url.search = params.toString()
  return url.toString()
}

export function redactJsonBody(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[max-depth]'
  if (Array.isArray(value)) {
    return value.map((entry) => redactJsonBody(entry, depth + 1))
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = isSensitiveKey(key) ? REDACTED : redactJsonBody(entry, depth + 1)
    }
    return result
  }
  return value
}
