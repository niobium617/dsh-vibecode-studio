/**
 * Scrubs host-resolved secrets out of an execution result before it crosses
 * the unary wire (G4 follow-up).
 *
 * `HttpExecutionResult.url` is the final URL after redirects and therefore may
 * contain a resolved secret when the request used `api-key in=query`, a plain
 * query variable, or a path placeholder. Redirect hops carry the same URL in
 * `url` and `location`. The executor cannot know which values came from
 * credentials, so the service passes the host-only list from
 * `resolveHttpRequest()` here.
 *
 * Redaction has two layers:
 * 1. Replace every exact resolved secret (and its URL-encoded forms) with
 *    `REDACTED`, regardless of the parameter name. This catches non-sensitive
 *    keys such as `?session=...`.
 * 2. Run `redactUrl()` for credentials and sensitive query keys (for example a
 *    literal `api_key` the user typed instead of a variable).
 *
 * The response body is data returned by the target and is not rewritten.
 */
import type { HttpExecutionResult } from '../../contracts/api'
import { REDACTED, redactUrl } from '../../contracts/redact'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A secret can appear raw (path), percent-encoded (query), or with `+` for
 * spaces (`URLSearchParams`). Include all three forms; longest first so one
 * secret that contains another is replaced as a whole.
 */
function secretVariants(values: readonly string[]): readonly string[] {
  const variants = new Set<string>()
  for (const value of values) {
    if (value === '') continue
    variants.add(value)
    try {
      const encoded = encodeURIComponent(value)
      variants.add(encoded)
      variants.add(encoded.replace(/%20/g, '+'))
    } catch {
      // A malformed surrogate is not URL-encoded; the raw form still applies.
    }
  }
  return [...variants].sort((left, right) => right.length - left.length)
}

/** Returns a copy with the final URL and every redirect hop scrubbed. */
export function redactExecutionResult(
  result: HttpExecutionResult,
  secretValues: readonly string[],
): HttpExecutionResult {
  const variants = secretVariants(secretValues)
  const pattern =
    variants.length === 0
      ? null
      : new RegExp(variants.map(escapeRegExp).join('|'), 'g')
  const scrub = (value: string): string => {
    const withoutSecrets = pattern === null ? value : value.replace(pattern, REDACTED)
    return redactUrl(withoutSecrets)
  }

  return {
    ...result,
    url: scrub(result.url),
    redirects: result.redirects.map((hop) => ({
      ...hop,
      url: scrub(hop.url),
      location: scrub(hop.location),
    })),
  }
}
