/**
 * The client only offers actions that are safe for local previews: external
 * open and the toolbar's URL affordances are limited to loopback http(s),
 * matching the Host's `allowNonLocal` guard.
 */
const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/

export function isLocalPreviewUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '[::1]') return true
  return LOOPBACK_V4.test(host)
}
