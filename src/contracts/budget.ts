/**
 * Context budgets are byte-based because the model sees UTF-8 tokens.
 * Truncation iterates code points so CJK and emoji never split a surrogate.
 */

export const ANNOTATION_BUDGET_BYTES = 4 * 1024
export const OBSERVE_BUDGET_BYTES = 8 * 1024
export const DOM_SNIPPET_BYTES = 2 * 1024
export const ELEMENT_TEXT_CHARS = 200
export const CONSOLE_ENTRY_BUDGET_BYTES = 500
export const NETWORK_ENTRY_BUDGET_BYTES = 500

const encoder = new TextEncoder()

export function utf8Bytes(value: string): number {
  return encoder.encode(value).length
}

export function truncateUtf8(value: string, maxBytes: number, suffix = '…'): string {
  if (maxBytes <= 0) return ''
  if (utf8Bytes(value) <= maxBytes) return value

  const suffixBytes = utf8Bytes(suffix)
  if (suffixBytes >= maxBytes) {
    return suffixBytes === maxBytes ? suffix : ''
  }

  const contentBudget = maxBytes - suffixBytes
  let used = 0
  let result = ''
  for (const char of value) {
    const size = utf8Bytes(char)
    if (used + size > contentBudget) break
    result += char
    used += size
  }
  return `${result}${suffix}`
}

export function truncateChars(value: string, maxChars: number, suffix = '…'): string {
  if (maxChars <= 0) return ''
  const chars = Array.from(value)
  if (chars.length <= maxChars) return value
  return `${chars.slice(0, maxChars).join('')}${suffix}`
}
