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
 * Filter a list of header suggestions against a user-typed substring.
 *
 * - Empty/whitespace input → empty list (caller should not show the popup).
 * - Match is case-insensitive substring (contains) match — typing "type"
 *   surfaces "Content-Type" / "If-None-Match-Type" etc., which was the
 *   v1.3.1 UX gap reported by Mehmet (M2).
 * - An entry that exactly equals the input is dropped — there is nothing
 *   useful to autocomplete to.
 * - Results are ordered: prefix matches first (preserving the original
 *   ordering of `entries`), then the remaining substring matches.
 */
export function filterHeaderSuggestions(
  input: string,
  entries: readonly string[] = STANDARD_HTTP_HEADERS,
): string[] {
  const query = input.trim().toLowerCase()
  if (query.length === 0) return []

  const prefixMatches: string[] = []
  const otherMatches: string[] = []
  for (const h of entries) {
    const lower = h.toLowerCase()
    if (lower === query) continue
    if (lower.startsWith(query)) {
      prefixMatches.push(h)
    } else if (lower.includes(query)) {
      otherMatches.push(h)
    }
  }
  return [...prefixMatches, ...otherMatches]
}

/**
 * Common values for well-known request headers. Keyed by lowercased header
 * name so callers can do `HEADER_VALUE_SUGGESTIONS[name.toLowerCase()]`
 * without normalising at every callsite.
 *
 * Used by the headers KeyValueTable to surface a value-cell autocomplete:
 * when the user types a recognised header name in the key cell, the value
 * cell offers a substring-filtered list of plausible values.
 */
export const HEADER_VALUE_SUGGESTIONS: Readonly<Record<string, readonly string[]>> = {
  'content-type': [
    'application/json',
    'application/xml',
    'application/x-www-form-urlencoded',
    'application/octet-stream',
    'application/soap+xml',
    'application/graphql',
    'application/javascript',
    'application/pdf',
    'multipart/form-data',
    'text/plain',
    'text/html',
    'text/xml',
    'text/xml; charset=utf-8',
    'text/csv',
  ],
  accept: [
    '*/*',
    'application/json',
    'application/xml',
    'application/soap+xml',
    'application/graphql',
    'application/octet-stream',
    'text/plain',
    'text/html',
    'text/xml',
    'text/event-stream',
  ],
  'accept-encoding': ['gzip', 'deflate', 'br', 'identity', 'gzip, deflate, br', '*'],
  'accept-language': ['en-US', 'en', 'tr-TR', 'tr', '*'],
  'accept-charset': ['utf-8', 'iso-8859-1', '*'],
  authorization: ['Bearer ', 'Basic ', 'Digest '],
  'cache-control': [
    'no-cache',
    'no-store',
    'no-store, no-cache, must-revalidate',
    'must-revalidate',
    'max-age=0',
    'max-age=3600',
    'public',
    'private',
  ],
  connection: ['keep-alive', 'close', 'Upgrade'],
  'x-requested-with': ['XMLHttpRequest'],
  'content-encoding': ['gzip', 'deflate', 'br', 'identity'],
  pragma: ['no-cache'],
  origin: ['*', 'null'],
  dnt: ['1', '0'],
  upgrade: ['websocket', 'h2c'],
}

/**
 * Returns suggestions for a header value given the (possibly partial) header
 * name and the currently-typed value. Match is case-insensitive substring;
 * input that exactly equals an entry is dropped.
 *
 * Empty `value` returns the full list — callers use that to show all options
 * on focus before the user types anything.
 */
export function filterHeaderValueSuggestions(headerName: string, value: string): string[] {
  const key = headerName.trim().toLowerCase()
  const entries = HEADER_VALUE_SUGGESTIONS[key]
  if (!entries) return []

  const query = value.trim().toLowerCase()
  if (query.length === 0) return [...entries]

  const out: string[] = []
  for (const v of entries) {
    const lower = v.toLowerCase()
    if (lower === query) continue
    if (lower.includes(query)) out.push(v)
  }
  return out
}
