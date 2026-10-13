/**
 * The headers an HTTP request carries that the user did NOT type in the
 * Headers tab (issue #204) — auth, body Content-Type, the cookie jar, the
 * default User-Agent, and what axios / Node add on the wire.
 *
 * ONE source for two consumers:
 *  - the HTTP engine (`src/main/protocols/http.engine.ts`) takes its default
 *    Content-Type per body type, the User-Agent format and the Content-Type
 *    precedence check from here, so the preview cannot drift from the request;
 *  - the Headers tab's read-only "auto-generated" section
 *    (`AutoHeadersSection.tsx`) renders `computeAutoHeaders()`.
 *
 * Precedence mirrors the engine exactly (verified against the wire by
 * `tests/main/http-auto-headers-parity.test.ts`):
 *  - a user header wins over an auth header / body default / axios default
 *    whatever case it is written in (`hasExplicitHeader`, `hasUserContentType`,
 *    AxiosHeaders merge);
 *  - form-data is the exception: it always replaces any user Content-Type
 *    with the boundary-bearing one;
 *  - AWS SigV4 headers are spread over the user's headers (no guard);
 *  - jar cookies are APPENDED to the user's `Cookie` header (same key, any
 *    case), never suppressed.
 *
 * Values are display-safe: every auth-sourced value is masked
 * (`HISTORY_MASK`) whatever the header name (a custom API-key header such as
 * `X-Foo` does not match `isCredentialHeaderName`), except a value that is only
 * `{{variable}}` templates. Values known only at send time (Content-Length of a
 * body, the multipart boundary, Digest/NTLM/Hawk/AWS signatures, a fetched
 * OAuth2 token, jar cookies) carry `SEND_TIME_TOKEN` instead of an invented
 * value; the UI swaps the token for a translated label.
 *
 * Pure TS — no Node / DOM / renderer imports, compiled into both bundles.
 */
import { HISTORY_MASK, isCredentialHeaderName } from './credential-headers'

export type AutoHeaderSource = 'auth' | 'engine' | 'cookie'

export interface AutoHeaderRow {
  name: string
  value: string
  source: AutoHeaderSource
  /** The user's own header with this name wins — this row is NOT sent. */
  overriddenByUser?: boolean
  /** The value (or part of it, see `SEND_TIME_TOKEN`) is only known at send. */
  sendTime?: boolean
}

/** Placeholder for a value computed at send time; the UI translates it. */
export const SEND_TIME_TOKEN = '<calculated at send>'

/** axios default `Accept` (axios `defaults.headers.common.Accept`). */
export const AXIOS_DEFAULT_ACCEPT = 'application/json, text/plain, */*'
/** axios http adapter default `Accept-Encoding`. */
export const AXIOS_DEFAULT_ACCEPT_ENCODING = 'gzip, compress, deflate, br'
/** axios default Content-Type for POST / PUT / PATCH sent without a body. */
export const AXIOS_DEFAULT_FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded'

/** Structural subset of the renderer `RequestBody` / engine body option. */
export interface AutoHeaderBody {
  type: string
  content?: string
  binaryPath?: string
}

/** Structural subset of the renderer `AuthConfig` (resolved, not `inherit`). */
export interface AutoHeaderAuth {
  type: string
  basic?: { username?: string; password?: string }
  bearer?: { token?: string; prefix?: string }
  apiKey?: { key?: string; value?: string; in?: 'header' | 'query' | string }
  oauth2?: {
    token?: string
    grantType?: string
    tokenUrl?: string
    clientId?: string
  }
  digest?: unknown
  ntlm?: unknown
  hawk?: unknown
  awsSignature?: unknown
}

export interface AutoHeaderInput {
  method: string
  url: string
  /** The user's Headers-tab rows (disabled / empty-key rows are ignored). */
  headers?: ReadonlyArray<{ key: string; value: string; enabled?: boolean }>
  body?: AutoHeaderBody | null
  /** Effective auth (inherited auth already folded in); `inherit` = none. */
  auth?: AutoHeaderAuth | null
  /** App version for the User-Agent; omitted → the value is a send-time row. */
  appVersion?: string
}

// ─── Pieces the engine consumes ───────────────────────────────

/** Default Content-Type the engine applies per body type. form-data is not
 *  here: the `form-data` package computes its boundary-bearing header. */
const BODY_CONTENT_TYPES: Readonly<Record<string, string>> = {
  json: 'application/json',
  xml: 'application/xml',
  text: 'text/plain',
  html: 'text/html',
  javascript: 'application/javascript',
  urlencoded: 'application/x-www-form-urlencoded',
  binary: 'application/octet-stream',
}

export function defaultContentTypeForBody(type: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(BODY_CONTENT_TYPES, type)
    ? BODY_CONTENT_TYPES[type]
    : undefined
}

/** `Testnizer/<version>` — the default User-Agent. */
export function formatDefaultUserAgent(version: string): string {
  return `Testnizer/${version}`
}

/** The key under which `headers` carries `name` (case-insensitive), if any. */
export function findHeaderKey(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase()
  return Object.keys(headers).find((k) => k.toLowerCase() === lower)
}

/** Case-insensitive "does this header map carry `name`?". */
export function hasHeaderIgnoreCase(headers: Record<string, string>, name: string): boolean {
  return findHeaderKey(headers, name) !== undefined
}

/**
 * Does the user's header map block the engine's default body Content-Type?
 * Any casing of `Content-Type` with a non-empty value — the user header wins
 * (issue #204; the engine used to check only the exact key, so a lowercase
 * `content-type` row was silently replaced on the wire). An empty value counts
 * as "not set", as it always has.
 */
export function hasUserContentType(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === 'content-type' && !!headers[k])
}

/** The engine's header map from the user's rows: enabled, non-empty key, last wins. */
export function userHeaderRecord(rows: AutoHeaderInput['headers']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const h of rows ?? []) {
    if (h.enabled !== false && h.key) out[h.key] = h.value
  }
  return out
}

// ─── Preview ──────────────────────────────────────────────────

const TEMPLATE_ONLY = /^(\s*\{\{[^{}]+\}\}\s*)+$/

/** Mask a credential value; a pure `{{var}}` template is shown as-is. */
export function maskCredentialValue(value: string | undefined): string {
  const v = value ?? ''
  if (v === '') return ''
  return TEMPLATE_ONLY.test(v) ? v : HISTORY_MASK
}

/** Methods for which Node does not add `Content-Length: 0` to a body-less request. */
const NO_IMPLICIT_LENGTH = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT'])
/** Methods axios gives a default form Content-Type when there is no body. */
const AXIOS_FORM_DEFAULT_METHODS = new Set(['POST', 'PUT', 'PATCH'])

/** `host[:port]` as Node sends it (default port omitted); undefined if unparsable. */
function hostHeaderFor(url: string): string | undefined {
  if (!url || url.includes('{{')) return undefined
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`
  try {
    const u = new URL(withScheme)
    return u.host || undefined
  } catch {
    return undefined
  }
}

function authRows(
  auth: AutoHeaderAuth | null | undefined,
  user: Record<string, string>,
): AutoHeaderRow[] {
  if (!auth) return []
  const userHas = (n: string): boolean => hasHeaderIgnoreCase(user, n)
  // `guarded`: the engine skips this header when the user set Authorization
  // (`hasExplicitHeader`). Digest / NTLM set it on the challenge retry leg
  // regardless, so they are not guarded.
  const authorization = (value: string, sendTime = false, guarded = true): AutoHeaderRow => ({
    name: 'Authorization',
    value,
    source: 'auth',
    ...(sendTime ? { sendTime: true } : {}),
    ...(guarded && userHas('Authorization') ? { overriddenByUser: true } : {}),
  })
  switch (auth.type) {
    case 'basic':
      return auth.basic ? [authorization(`Basic ${HISTORY_MASK}`)] : []
    case 'bearer': {
      if (!auth.bearer) return []
      const prefix = auth.bearer.prefix || 'Bearer'
      return [authorization(`${prefix} ${maskCredentialValue(auth.bearer.token)}`)]
    }
    case 'api-key': {
      const k = auth.apiKey
      if (!k || k.in !== 'header' || !k.key) return []
      return [
        {
          name: k.key,
          value: maskCredentialValue(k.value),
          source: 'auth',
          ...(userHas(k.key) ? { overriddenByUser: true } : {}),
        },
      ]
    }
    case 'oauth2': {
      const o = auth.oauth2
      if (!o) return []
      if (o.token && o.token.trim()) {
        return [authorization(`Bearer ${maskCredentialValue(o.token)}`)]
      }
      const grant = o.grantType ?? 'client_credentials'
      const fetchable = grant === 'client_credentials' || grant === 'password'
      return fetchable && o.tokenUrl && o.clientId
        ? [authorization(`Bearer ${SEND_TIME_TOKEN}`, true)]
        : []
    }
    case 'digest':
      return auth.digest ? [authorization(`Digest ${SEND_TIME_TOKEN}`, true, false)] : []
    case 'ntlm':
      return auth.ntlm ? [authorization(`NTLM ${SEND_TIME_TOKEN}`, true, false)] : []
    case 'hawk':
      return auth.hawk ? [authorization(`Hawk ${SEND_TIME_TOKEN}`, true)] : []
    case 'aws-signature':
      // Spread over the user's headers by the engine — never overridden.
      return auth.awsSignature
        ? [
            { name: 'Authorization', value: `AWS4-HMAC-SHA256 ${SEND_TIME_TOKEN}` },
            { name: 'X-Amz-Date', value: SEND_TIME_TOKEN },
            { name: 'X-Amz-Content-Sha256', value: SEND_TIME_TOKEN },
          ].map((r) => ({ ...r, source: 'auth' as const, sendTime: true }))
        : []
    default:
      return []
  }
}

function bodyRows(input: AutoHeaderInput, user: Record<string, string>): AutoHeaderRow[] {
  const method = (input.method || 'GET').toUpperCase()
  const body = input.body && input.body.type !== 'none' ? input.body : null
  const rows: AutoHeaderRow[] = []
  let hasData = false

  if (body?.type === 'form-data') {
    hasData = true
    // The engine drops any user Content-Type and applies the form's own header.
    rows.push({
      name: 'Content-Type',
      value: `multipart/form-data; boundary=${SEND_TIME_TOKEN}`,
      source: 'engine',
      sendTime: true,
    })
  } else if (body) {
    const ct =
      body.type === 'binary' && !body.binaryPath ? undefined : defaultContentTypeForBody(body.type)
    if (ct) {
      hasData = true
      rows.push({
        name: 'Content-Type',
        value: ct,
        source: 'engine',
        ...(hasUserContentType(user) ? { overriddenByUser: true } : {}),
      })
    }
  }
  if (!hasData && AXIOS_FORM_DEFAULT_METHODS.has(method)) {
    rows.push({
      name: 'Content-Type',
      value: AXIOS_DEFAULT_FORM_CONTENT_TYPE,
      source: 'engine',
      ...(hasHeaderIgnoreCase(user, 'Content-Type') ? { overriddenByUser: true } : {}),
    })
  }

  const lengthOverridden = hasHeaderIgnoreCase(user, 'Content-Length')
  if (hasData) {
    rows.push({
      name: 'Content-Length',
      value: SEND_TIME_TOKEN,
      source: 'engine',
      sendTime: true,
      ...(lengthOverridden ? { overriddenByUser: true } : {}),
    })
  } else if (!NO_IMPLICIT_LENGTH.has(method)) {
    rows.push({
      name: 'Content-Length',
      value: '0',
      source: 'engine',
      ...(lengthOverridden ? { overriddenByUser: true } : {}),
    })
  }
  return rows
}

/**
 * Every header the engine adds to this request, in roughly wire order.
 * Pre-request script header mutations, proxy headers and the legacy-TLS curl
 * sidecar are out of scope (they are only known at send time).
 */
export function computeAutoHeaders(input: AutoHeaderInput): AutoHeaderRow[] {
  const user = userHeaderRecord(input.headers)
  const userHas = (n: string): boolean => hasHeaderIgnoreCase(user, n)
  const engine = (name: string, value: string, sendTime = false): AutoHeaderRow => ({
    name,
    value,
    source: 'engine',
    ...(sendTime ? { sendTime: true } : {}),
    ...(userHas(name) ? { overriddenByUser: true } : {}),
  })

  const rows: AutoHeaderRow[] = []
  rows.push(engine('Accept', AXIOS_DEFAULT_ACCEPT))
  rows.push(...bodyRows(input, user))
  rows.push(...authRows(input.auth, user))
  rows.push(
    input.appVersion
      ? engine('User-Agent', formatDefaultUserAgent(input.appVersion))
      : engine('User-Agent', formatDefaultUserAgent(SEND_TIME_TOKEN), true),
  )
  rows.push(engine('Accept-Encoding', AXIOS_DEFAULT_ACCEPT_ENCODING))
  const host = hostHeaderFor(input.url)
  rows.push(host ? engine('Host', host) : engine('Host', SEND_TIME_TOKEN, true))
  // NTLM forces keep-alive agents (one TCP connection for the handshake).
  rows.push(engine('Connection', input.auth?.type === 'ntlm' ? 'keep-alive' : 'close'))
  // Jar cookies are appended to a user Cookie header — never overridden.
  rows.push({ name: 'Cookie', value: SEND_TIME_TOKEN, source: 'cookie', sendTime: true })

  // Defence in depth: whatever the source, a credential-named header never
  // shows a literal value (e.g. a future engine row).
  return rows.map((r) =>
    r.source !== 'auth' &&
    !r.sendTime &&
    isCredentialHeaderName(r.name) &&
    r.value !== '' &&
    r.value !== HISTORY_MASK
      ? { ...r, value: maskCredentialValue(r.value) }
      : r,
  )
}

/**
 * Rows that go on the wire: not overridden by a user header, and not the
 * jar `Cookie` row (sent only when the jar holds cookies for the URL).
 */
export function countSentAutoHeaders(rows: readonly AutoHeaderRow[]): number {
  return rows.filter((r) => !r.overriddenByUser && r.source !== 'cookie').length
}
