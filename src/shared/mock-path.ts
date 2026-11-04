/**
 * What a mock endpoint binds, from a stored request URL.
 *
 * `endpoints.path` is misnamed: after an OpenAPI import it holds the FULL URL
 * (server + path), and a saved request holds `{{baseUrl}}/x`. A mock matches
 * the path alone, so a URL copied in as it is never matches, and "Open in
 * request tab" glued it after the mock's own host.
 *
 * Parsed by hand on purpose: `new URL` percent-encodes `{petId}` and rejects
 * `{{baseUrl}}/x`, the two shapes this exists for.
 */
export interface MockPath {
  path: string
  /** `param` when the path has a `:name` segment. */
  mode: 'exact' | 'param'
}

/** `{{x}}` and `{x}` → `:x`; decides the mode. The single rule for every importer. */
export function templatedPathToMockPath(path: string): MockPath {
  const out = path.replace(/\{\{\s*([^}]+?)\s*\}\}/g, ':$1').replace(/\{\s*([^}]+?)\s*\}/g, ':$1')
  return { path: out, mode: /(^|\/):[^/]/.test(out) ? 'param' : 'exact' }
}

const VARIABLE = String.raw`\{\{[^}]*\}\}`
/** `https://host:1`, `{{scheme}}://{{host}}` — everything up to the path. */
const SCHEME_AND_HOST = new RegExp(String.raw`^(?:[a-z][a-z0-9+.-]*|${VARIABLE})://[^/]*`, 'i')
/** `{{baseUrl}}`, `petstore.io`, `localhost:3000` as the first segment of a scheme-less URL. */
const LEADING_HOST = new RegExp(String.raw`^(?:${VARIABLE}|[^/:]+\.[^/]*|[^/:]+:\d+)(?=/|$)`)

/** Null when the URL has no path to bind (empty, or only a query / fragment). */
export function requestUrlToMockPath(url: string): MockPath | null {
  const noSuffix = url.trim().split(/[?#]/, 1)[0]
  if (!noSuffix) return null
  const noHost = noSuffix.replace(SCHEME_AND_HOST, '').replace(LEADING_HOST, '')
  const path = noHost.startsWith('/') ? noHost : `/${noHost}`
  return templatedPathToMockPath(path)
}
