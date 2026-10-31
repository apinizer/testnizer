// Request naming (issue #201).
//
// A request created from the APIs tree ("Add Request" on a folder) is written
// to the DB straight away under a placeholder name, and Ctrl+S then saves it in
// place — so before this, the tree kept showing "New Endpoint" for every such
// request. The single save path (`saveActiveRequestInPlace`) and the Save As
// modal now replace a placeholder name with one derived from the URL. A name
// the user typed is never touched: only the placeholders listed here qualify.

import { t, valuesInAllLocales } from './i18n'
import type { Protocol } from '../types'

/**
 * Name + method a request starts with when it is created from the APIs tree.
 * One table — TreeView's "Add Request" reads it, and `isDefaultRequestName`
 * recognises every name in it.
 *
 * HTTP is 'New Endpoint', not 'New Request': the Workbench treats a tab named
 * exactly "New Request" with an empty url as the blank scratch tab and renders
 * the protocol picker instead of the HTTP editor (issue #69).
 */
export const DEFAULT_REQUEST_BY_PROTOCOL: Partial<
  Record<Protocol, { name: string; method: string }>
> = {
  http: { name: 'New Endpoint', method: 'GET' },
  soap: { name: 'New SOAP Method', method: 'POST' },
  websocket: { name: 'New WebSocket', method: 'GET' },
  graphql: { name: 'New GraphQL', method: 'POST' },
  grpc: { name: 'New gRPC', method: 'POST' },
  sse: { name: 'New SSE', method: 'GET' },
  ai: { name: 'New AI Chat', method: 'POST' },
  mcp: { name: 'New MCP', method: 'GET' },
  socketio: { name: 'New Socket.IO', method: 'GET' },
  mqtt: { name: 'New MQTT', method: 'GET' },
}

/**
 * The blank scratch tab's name before it was localized (issue #261). Tabs
 * restored from an older build still carry it, so it stays a scratch name.
 */
const LEGACY_SCRATCH_TAB_NAME = 'New Request'

/**
 * The name a blank scratch tab opens with, in the UI language at call time
 * ("New Request" / "Yeni İstek"). Every place that opens one uses it.
 */
export function defaultRequestTabName(): string {
  return t('tabStrip.newRequest')
}

/**
 * THE rule for "this is the blank scratch tab's name": the scratch name of any
 * locale (a tab opened in Turkish is still blank after switching to English)
 * or the legacy literal. Existing tabs are never renamed on a locale switch.
 * Tree defaults ("New Endpoint" / "Yeni Uç Nokta") are NOT scratch names —
 * issue #69: a stored request with such a name must open its editor.
 */
export function isScratchTabName(name: string | null | undefined): boolean {
  if (name == null) return false
  const trimmed = name.trim()
  if (!trimmed) return false
  return (
    trimmed === LEGACY_SCRATCH_TAB_NAME ||
    valuesInAllLocales('tabStrip.newRequest').includes(trimmed)
  )
}

/**
 * Name + method the APIs tree's "Add Request" creates a `protocol` request
 * with. HTTP's name is localized ("New Endpoint" / "Yeni Uç Nokta"); the
 * other protocols keep their table entry; an unknown protocol is HTTP.
 * `isDefaultRequestName` recognises the names of every locale (issue #201).
 */
export function defaultRequestFor(protocol: string): { name: string; method: string } {
  const entry = DEFAULT_REQUEST_BY_PROTOCOL[protocol as Protocol]
  if (entry && protocol !== 'http') return entry
  return { name: t('welcome.newEndpointName'), method: DEFAULT_REQUEST_BY_PROTOCOL.http!.method }
}

/**
 * i18n keys whose values are used as a new request's name: the "+ New"
 * dropdown and welcome pages (`welcome.*`), the Save As modal's fallback
 * (`endpointSave.defaultName`), the tab strip and the Tests panel.
 */
const DEFAULT_NAME_KEYS = [
  'welcome.newEndpointName',
  'welcome.newSoapMethodName',
  'welcome.quickRequest',
  'endpointSave.defaultName',
  'tabStrip.newRequest',
  'testsPanel.newRequestDefaultName',
]

let defaultNames: Set<string> | null = null

function allDefaultNames(): Set<string> {
  if (defaultNames) return defaultNames
  const names = new Set<string>([LEGACY_SCRATCH_TAB_NAME, 'Untitled'])
  for (const d of Object.values(DEFAULT_REQUEST_BY_PROTOCOL)) if (d) names.add(d.name)
  // Every locale, not only the current one: a request created in Turkish is
  // still a placeholder after the UI is switched to English.
  for (const key of DEFAULT_NAME_KEYS) for (const v of valuesInAllLocales(key)) names.add(v)
  defaultNames = names
  return names
}

/** Is `name` one of the placeholder names the app gives a new request? */
export function isDefaultRequestName(name: string | null | undefined): boolean {
  if (name == null) return true
  const trimmed = name.trim()
  return trimmed === '' || allDefaultNames().has(trimmed)
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
// `{{id}}` (also `{{a}}{{b}}`), `:id`, `{id}`.
const VARIABLE_ONLY = [/^(\{\{[^{}]*\}\})+$/, /^:.+$/, /^\{[^{}]+\}$/]

function isVariableOnly(segment: string): boolean {
  return VARIABLE_ONLY.some((re) => re.test(segment))
}

// A resource id is not a name: `/users/123` → 'users', not '123'.
const ID_LIKE = [/^\d+$/, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i]

function isIdLike(segment: string): boolean {
  return ID_LIKE.some((re) => re.test(segment))
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    // A malformed escape (`%E0%A4`) keeps its raw text.
    return segment
  }
}

/** Host of an authority, without `user:pass@` and without the port. */
function hostOf(authority: string): string | null {
  // Never let credentials become a name: the name lands in the DB, the tree
  // and the project's git export.
  const at = authority.lastIndexOf('@')
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority
  const host = hostPort.startsWith('[')
    ? hostPort.slice(0, hostPort.indexOf(']') + 1) // IPv6 literal
    : hostPort.replace(/:[^:]*$/, '')
  const trimmed = host.trim()
  if (!trimmed || isVariableOnly(trimmed)) return null
  return trimmed
}

/**
 * A request name derived from its URL: the last path segment that is not only
 * a variable or a path parameter (`{{id}}`, `:id`, `{id}`) and not an id
 * (all digits, or a UUID), URL-decoded, with
 * the query string and fragment ignored. Without such a segment, the host.
 * `null` when nothing usable is left — an empty URL, or a host that is itself
 * a variable (`{{baseUrl}}`) — so the caller keeps the current name.
 *
 * Parsed by hand: `new URL` rejects `{{baseUrl}}/users` and scheme-less URLs.
 */
export function deriveEndpointName(url: string): string | null {
  let rest = url.trim()
  if (!rest) return null
  rest = rest.split('#')[0].split('?')[0]

  let authority = ''
  let path = rest
  const scheme = SCHEME.exec(rest)
  if (scheme) {
    const afterScheme = rest.slice(scheme[0].length)
    const slash = afterScheme.indexOf('/')
    authority = slash >= 0 ? afterScheme.slice(0, slash) : afterScheme
    path = slash >= 0 ? afterScheme.slice(slash) : ''
  } else if (!rest.startsWith('/')) {
    // `{{baseUrl}}/v1/users`, `api.test/users`, `localhost:3000/users`.
    const slash = rest.indexOf('/')
    authority = slash >= 0 ? rest.slice(0, slash) : rest
    path = slash >= 0 ? rest.slice(slash) : ''
  }

  const segments = path.split('/')
  for (let i = segments.length - 1; i >= 0; i--) {
    const raw = segments[i].trim()
    if (!raw || isVariableOnly(raw)) continue
    const name = decodeSegment(raw).trim()
    if (!name || name === '.' || name === '..' || isScratchTabName(name)) continue
    if (isIdLike(name)) continue
    return name
  }

  const host = hostOf(authority)
  return host && !isScratchTabName(host) ? host : null
}

/**
 * The name to save an HTTP request under when its current name is a
 * placeholder — `null` to keep the current name (a name the user chose, a
 * non-HTTP request, or a URL that yields nothing).
 *
 * HTTP only. A SOAP URL's last segment is the service endpoint (`/ws`,
 * `Service.asmx`) that every operation of the WSDL shares, so each method
 * would get the same name; GraphQL is nearly always `/graphql`; the other
 * protocols name a connection, not a resource.
 */
export function autoRequestName(
  protocol: string | undefined,
  currentName: string | null | undefined,
  url: string,
): string | null {
  if ((protocol ?? 'http') !== 'http') return null
  if (!isDefaultRequestName(currentName)) return null
  return deriveEndpointName(url)
}
