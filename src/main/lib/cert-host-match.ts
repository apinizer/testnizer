// Certificate host matching — pure, no DB / no Node APIs so it unit-tests
// trivially and both the repo lookup and any future caller share one rule.
//
// WHY THIS EXISTS: a client certificate row stores a `host` the user typed in
// the project's Certificates settings, and at request time we match it against
// `new URL(url).hostname` (a BARE hostname, e.g. "sandbox.api.visa.com"). Users
// routinely paste a full base URL ("https://sandbox.api.visa.com"), add a port
// ("host:443"), a trailing path/slash, or mixed case. A strict `host = ?`
// equality (the old SQL) silently failed to match every one of those, so the
// request went out WITHOUT the client cert and the server answered with a
// "missing client credential" error. Normalising both sides fixes that.

/**
 * Reduce a user-entered certificate host pattern to a bare, lowercase hostname
 * so it can be compared against a URL's hostname. Strips scheme, userinfo,
 * port, and any path/query. Empty input returns ''; the wildcard '*' passes
 * through unchanged (it means "any host").
 */
export function normalizeCertHost(raw: string | null | undefined): string {
  let h = (raw ?? '').trim().toLowerCase()
  if (!h || h === '*') return h
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // strip scheme (https://, http://, …)
  const at = h.lastIndexOf('@')
  if (at >= 0) h = h.slice(at + 1) // strip userinfo (user:pass@)
  h = h.split('/')[0].split('?')[0] // strip path / query
  // Bracketed IPv6 ("[::1]" / "[::1]:8443") → the address inside the brackets.
  const v6 = h.match(/^\[([^\]]+)\]/)
  if (v6) return v6[1]
  // Otherwise strip a trailing :port only when there's exactly one colon —
  // a bare IPv6 ("::1") has several and must be left intact.
  if ((h.match(/:/g) || []).length === 1) h = h.replace(/:\d+$/, '')
  return h
}

/**
 * Does a request hostname match a stored certificate host pattern?
 * - empty / null / '*' pattern → matches every host (host is unset ⇒ global).
 * - '*.example.com' → matches the apex `example.com` and any subdomain.
 * - otherwise → normalized, case-insensitive hostname equality (tolerant of a
 *   pasted scheme/port/path in the stored pattern).
 */
export function certHostMatches(requestHost: string, pattern: string | null | undefined): boolean {
  const np = normalizeCertHost(pattern)
  if (np === '' || np === '*') return true
  const rh = normalizeCertHost(requestHost)
  if (!rh) return false
  if (np === rh) return true
  if (np.startsWith('*.')) {
    const base = np.slice(2)
    return rh === base || rh.endsWith('.' + base)
  }
  return false
}
