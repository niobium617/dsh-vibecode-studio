/**
 * Loopback check shared by the web adapter (T017) and the agent's preview tool
 * (T049).
 *
 * Preview targets are loopback-only by default (FR-SEC-01). Two guards that
 * disagree about what "local" means would leave a gap either way, so the rule
 * lives here once. `*.localhost` is included because browsers resolve it to
 * loopback; `::1` arrives with brackets from `URL.hostname`.
 */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '[::1]') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}
