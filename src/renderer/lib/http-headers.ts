/**
 * Common HTTP request/response header names used for autocomplete in the
 * KeyValueTable's "key" column. Includes both request and response headers
 * that users frequently set or read in API testing tools.
 *
 * Kept alphabetised so callers can rely on stable ordering of suggestions.
 */
export const STANDARD_HTTP_HEADERS: readonly string[] = [
  'Accept',
  'Accept-Charset',
  'Accept-Encoding',
  'Accept-Language',
  'Accept-Ranges',
  'Access-Control-Allow-Origin',
  'Access-Control-Request-Headers',
  'Access-Control-Request-Method',
  'Allow',
  'Authorization',
  'Cache-Control',
  'Connection',
  'Content-Disposition',
  'Content-Encoding',
  'Content-Language',
  'Content-Length',
  'Content-Type',
  'Cookie',
  'Date',
  'DNT',
  'ETag',
  'Expires',
  'Forwarded',
  'Host',
  'If-Match',
  'If-Modified-Since',
  'If-None-Match',
  'Last-Event-ID',
  'Location',
  'Origin',
  'Pragma',
  'Proxy-Authorization',
  'Range',
  'Referer',
  'Retry-After',
  'Server',
  'Set-Cookie',
  'SOAPAction',
  'Strict-Transport-Security',
  'Upgrade',
  'User-Agent',
  'Vary',
  'WWW-Authenticate',
  'X-API-Key',
  'X-Auth-Token',
  'X-Forwarded-For',
  'X-Frame-Options',
  'X-Real-IP',
  'X-Requested-With',
]

/**
 * Filter a list of header suggestions against a user-typed prefix.
 *
 * - Empty/whitespace input → empty list (caller should not show the popup).
 * - Match is case-insensitive prefix match.
 * - An entry that exactly equals the input is dropped — there is nothing
 *   useful to autocomplete to.
 * - Original ordering of `entries` is preserved.
 */
export function filterHeaderSuggestions(
  input: string,
  entries: readonly string[] = STANDARD_HTTP_HEADERS,
): string[] {
  const query = input.trim().toLowerCase()
  if (query.length === 0) return []

  const out: string[] = []
  for (const h of entries) {
    const lower = h.toLowerCase()
    if (lower === query) continue
    if (lower.startsWith(query)) out.push(h)
  }
  return out
}
