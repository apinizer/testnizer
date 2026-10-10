/**
 * ONE main-side mask for everything that records a request: History rows,
 * Runner history (`runner_history.results_json`), the Runner's live results
 * and its HTML / JSON export, and every Console entry (issues #195, #196).
 *
 * Two layers, always both:
 *
 *  (a) NAME rule — a value whose header / query-param / form-field / auth-field
 *      name is credential-bearing becomes `HISTORY_MASK`. The name lists are
 *      the shared ones (`src/shared/credential-headers.ts`):
 *      `isCredentialHeaderName` for headers (broad substring rule, as the MCP
 *      diagnostics use it) and `isCredentialArgName` for query params, form /
 *      JSON / XML body fields (whole-word rule — `keyword`, `author` stay).
 *      Auth objects are masked per auth type (`AUTH_SECRET_FIELDS`): the
 *      `apiKey.value` field carries no credential-looking name.
 *  (b) VALUE scrub — the values of variables marked secret (environment +
 *      global, every project: over-scrubbing another project's secret costs a
 *      `••••••`, under-scrubbing leaks it) and the secrets the request itself
 *      carried (its auth fields) are replaced wherever they appear: URL,
 *      query, headers, body, response headers and body, error text. Values
 *      shorter than `MIN_SECRET_LENGTH` are ignored so `1` or `true` never
 *      turn every row into dots. The raw, URL-encoded and JSON-escaped forms
 *      of each value are scrubbed.
 *
 * Two modes for the name rule:
 *  - `sent`     — what went on the wire (resolved). Every credential-named
 *                 value is masked.
 *  - `template` — the request as configured (`{{var}}` kept), stored in a
 *                 History row's `configured` for re-send (issue #195). A value
 *                 that references a variable (`Bearer {{token}}`) is kept —
 *                 re-send resolves it again; a literal credential is masked
 *                 and comes back EMPTY on reopen.
 *
 * Pure except `loadSecretInventory`, which takes the DB handle as an argument
 * so this module never imports the database (Console tests run without one).
 */
import {
  HISTORY_MASK,
  isCredentialArgName,
  isCredentialHeaderName,
} from '../../shared/credential-headers'
import type { EndpointRunResult } from '../../shared/runner-types'
import { INLINE_MASK } from '../../shared/mcp-call'

export { HISTORY_MASK }

/** Secret values shorter than this are never scrubbed (issue #195). */
export const MIN_SECRET_LENGTH = 6

/**
 * Values collected BY NAME from the request (a credential-named header or
 * query value) must be at least this long before they are scrubbed elsewhere
 * in the row — a broad name rule (`X-Token-Type`, `X-Auth-Mode`) catches
 * ordinary values too, and short ones would eat common words.
 */
export const MIN_COLLECTED_LENGTH = 8

/**
 * Words never scrubbed as values: auth scheme names and JSON literals. A
 * header like `X-Token-Type: Bearer` must not turn every "Bearer" in the
 * row into dots. Compared case-insensitively.
 */
const NEVER_SCRUB = new Set([
  'bearer',
  'basic',
  'digest',
  'token',
  'negotiate',
  'ntlm',
  'true',
  'false',
  'null',
])

export type MaskMode = 'sent' | 'template'

type Json = Record<string, unknown>

const isRecord = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

const TEMPLATE_REF = /\{\{[^{}]+\}\}/

const MAX_DEPTH = 64

// ─── (b) value scrub ─────────────────────────────────────────────

export interface Scrubber {
  /** The secret values this scrubber was built from. */
  readonly values: readonly string[]
  /** The strings replaced, longest first (raw + encoded forms). */
  readonly needles: readonly string[]
  /** `s` with every secret value replaced by `HISTORY_MASK`. */
  text(s: string): string
}

/** Build a value scrubber from secret values; non-strings and short values are ignored. */
export function createScrubber(values: Iterable<unknown>): Scrubber {
  const set = new Set<string>()
  const kept: string[] = []
  const add = (s: string): void => {
    if (s.trim().length >= MIN_SECRET_LENGTH) set.add(s)
  }
  for (const v of values) {
    if (typeof v !== 'string' || v.trim().length < MIN_SECRET_LENGTH) continue
    if (NEVER_SCRUB.has(v.trim().toLowerCase())) continue
    if (v.includes(HISTORY_MASK)) continue
    kept.push(v)
    add(v)
    const uri = encodeURIComponent(v)
    if (uri !== v) {
      add(uri)
      add(uri.replace(/%20/g, '+'))
    }
    const json = JSON.stringify(v).slice(1, -1)
    if (json !== v) add(json)
  }
  const needles = [...set].sort((a, b) => b.length - a.length)
  return {
    values: kept,
    needles,
    text(s: string): string {
      if (!s || needles.length === 0) return s
      let out = s
      for (const n of needles) {
        if (out.includes(n)) out = out.split(n).join(HISTORY_MASK)
      }
      return out
    },
  }
}

/** A scrubber that only applies the name rule (no secret values known). */
export const NAME_ONLY: Scrubber = createScrubber([])

/** Every string inside `value`, scrubbed. Structure is kept. */
export function deepScrub(value: unknown, scrub: Scrubber, depth = 0): unknown {
  if (typeof value === 'string') return scrub.text(value)
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => deepScrub(v, scrub, depth + 1))
  const out: Json = {}
  for (const [k, v] of Object.entries(value)) out[k] = deepScrub(v, scrub, depth + 1)
  return out
}

// ─── Secret inventory (DB) ──────────────────────────────────────

/** The slice of a better-sqlite3 handle this module needs. */
export interface SecretDb {
  prepare(sql: string): { all(...params: unknown[]): unknown[] }
}

export interface SecretInventory {
  /** `value` + `initial_value` of every variable marked secret. */
  values: string[]
  /** Keys of the variables marked secret (a script may hold a newer value). */
  keys: Set<string>
}

/**
 * Every secret-flagged environment / global variable, across all projects.
 * Never throws: a DB without the tables (or before init) yields nothing, and
 * the name rule still applies.
 */
export function loadSecretInventory(db: SecretDb | null | undefined): SecretInventory {
  const inv: SecretInventory = { values: [], keys: new Set() }
  if (!db) return inv
  try {
    const rows = db
      .prepare(
        `SELECT key, value, initial_value FROM environment_variables WHERE secret = 1
         UNION ALL
         SELECT key, value, initial_value FROM global_variables WHERE secret = 1`,
      )
      .all() as Array<{ key: unknown; value: unknown; initial_value: unknown }>
    for (const r of rows) {
      if (typeof r.key === 'string') inv.keys.add(r.key)
      if (typeof r.value === 'string') inv.values.push(r.value)
      if (typeof r.initial_value === 'string') inv.values.push(r.initial_value)
    }
  } catch {
    /* no tables / not initialised — name rule only */
  }
  return inv
}

/**
 * The scrubber for one request: the DB's secret values, the current value of
 * each secret-flagged key in `liveVars` (a script may have set it during a
 * run before it was written back), and `extra` (the request's own auth).
 */
export function scrubberFor(
  db: SecretDb | null | undefined,
  extra: Iterable<unknown> = [],
  liveVars?: Record<string, unknown>,
): Scrubber {
  const inv = loadSecretInventory(db)
  const values: unknown[] = [...inv.values, ...extra]
  if (liveVars) for (const k of inv.keys) values.push(liveVars[k])
  return createScrubber(values)
}

// ─── (a) name rule ───────────────────────────────────────────────

/**
 * Secret fields per auth type (`AuthConfig` in `renderer/types`). Listed per
 * type rather than by name because `apiKey.value` has no credential-looking
 * name and `oauth2.tokenUrl` / `hawk.authId` would match a word rule.
 */
const AUTH_SECRET_FIELDS: Record<string, readonly string[]> = {
  basic: ['password'],
  bearer: ['token'],
  apiKey: ['value'],
  apikey: ['value'],
  oauth2: ['clientSecret', 'token', 'accessToken', 'refreshToken', 'idToken', 'password'],
  digest: ['password'],
  ntlm: ['password'],
  hawk: ['authKey'],
  awsSignature: ['secretKey', 'sessionToken'],
  wsse: ['password'],
}

/** The secret values an auth config carries (resolved auth → value scrub). */
export function authSecretValues(auth: unknown): string[] {
  const out: string[] = []
  if (!isRecord(auth)) return out
  for (const [type, fields] of Object.entries(AUTH_SECRET_FIELDS)) {
    const sub = auth[type]
    if (!isRecord(sub)) continue
    for (const f of fields) {
      const v = sub[f]
      if (typeof v === 'string' && v) out.push(v)
    }
  }
  return out
}

/**
 * Already masked upstream — `HISTORY_MASK`, or the MCP path's inline `***`
 * (`src/shared/mcp-call.ts`). Left as it is: MCP History restore and its
 * tests read those exact marks.
 */
function isMasked(value: string): boolean {
  return value === HISTORY_MASK || value === INLINE_MASK
}

/** Should a credential-named value be masked in this mode? */
function shouldMask(value: string, mode: MaskMode): boolean {
  if (value === '' || isMasked(value)) return false
  return mode === 'sent' || !TEMPLATE_REF.test(value)
}

function maskValue(named: boolean, value: string, mode: MaskMode, scrub: Scrubber): string {
  return named && shouldMask(value, mode) ? HISTORY_MASK : scrub.text(value)
}

/**
 * A header / param / field container: `Record<name, value>` or a
 * `[{ key | name, value, … }]` list. `isCred` decides the name rule.
 */
function maskNamed(
  container: unknown,
  isCred: (name: string) => boolean,
  mode: MaskMode,
  scrub: Scrubber,
): unknown {
  // Header containers hold strings; a param / field container may nest
  // (SOAP `params.Login.Credentials.Password`) — the arg rule then recurses.
  const nested = (v: unknown): unknown =>
    isCred === isCredentialArgName ? maskJsonBody(v, scrub, mode) : deepScrub(v, scrub)
  if (Array.isArray(container)) {
    return container.map((item) => {
      if (!isRecord(item)) return nested(item)
      const name =
        typeof item.key === 'string' ? item.key : typeof item.name === 'string' ? item.name : ''
      const out = nested(item) as Json
      if (name && typeof item.value === 'string') {
        out.value = maskValue(isCred(name), item.value, mode, scrub)
      } else if (name && item.value !== undefined && isCred === isCredentialArgName) {
        out.value = maskJsonBody(item.value, scrub, mode)
      }
      return out
    })
  }
  if (isRecord(container)) {
    const out: Json = {}
    for (const [k, v] of Object.entries(container)) {
      out[k] = typeof v === 'string' && isCred(k) ? maskValue(true, v, mode, scrub) : nested(v)
    }
    return out
  }
  return nested(container)
}

export function maskHeaders(container: unknown, scrub: Scrubber, mode: MaskMode = 'sent'): unknown {
  return maskNamed(container, isCredentialHeaderName, mode, scrub)
}

export function maskHeaderRecord(
  headers: Record<string, string> | undefined,
  scrub: Scrubber,
): Record<string, string> | undefined {
  if (!headers) return headers
  return maskNamed(headers, isCredentialHeaderName, 'sent', scrub) as Record<string, string>
}

function maskAuth(auth: unknown, mode: MaskMode, scrub: Scrubber): unknown {
  if (!isRecord(auth)) return deepScrub(auth, scrub)
  const out: Json = {}
  for (const [k, sub] of Object.entries(auth)) {
    const fields = AUTH_SECRET_FIELDS[k]
    if (!fields || !isRecord(sub)) {
      out[k] = deepScrub(sub, scrub)
      continue
    }
    const o: Json = {}
    for (const [fk, fv] of Object.entries(sub)) {
      o[fk] =
        typeof fv === 'string' && fields.includes(fk)
          ? maskValue(true, fv, mode, scrub)
          : deepScrub(fv, scrub)
    }
    out[k] = o
  }
  return out
}

const QUERY_PAIR = /([?&])([^=&#?\s]+)=([^&#\s]*)/g

function decodeName(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '))
  } catch {
    return raw
  }
}

/**
 * Query values under a credential-named param (`?api_key=…`, `&token=…`) in
 * any text — a URL or a Console message line — then the value scrub. String
 * replacement, not `URLSearchParams.set`, which would percent-encode the mask.
 */
export function maskUrlText(text: string, scrub: Scrubber, mode: MaskMode = 'sent'): string {
  if (!text) return text
  const named = text
    .replace(QUERY_PAIR, (m, sep: string, name: string, value: string) =>
      value && isCredentialArgName(decodeName(name)) && shouldMask(value, mode)
        ? `${sep}${name}=${HISTORY_MASK}`
        : m,
    )
    .replace(URL_USERINFO, (m, userinfo: string) =>
      shouldMask(userinfo, mode) ? `//${HISTORY_MASK}@` : m,
    )
  return scrub.text(named)
}

/**
 * `scheme://user:pass@host` userinfo — the whole userinfo is replaced
 * (`https://••••••@host`), also on a templated host (`https://u:p@{{host}}`)
 * that `stripUrlCredentials` cannot parse. `/`, `?`, `#` are excluded so a
 * path or query `@` (`/@me`, `?email=a@b`) never matches. In `template` mode a
 * userinfo referencing a `{{var}}` is kept (re-send resolves it).
 */
const URL_USERINFO = /\/\/([^\s/?#@]+)@/g

const JSON_STRING_FIELD = /"((?:[^"\\]|\\.)*)"(\s*:\s*)"((?:[^"\\]|\\.)*)"/g
const XML_LEAF = /<((?:[\w.-]+:)?([\w.-]+))(\s[^<>]*)?>([^<]+)<\/\1\s*>/g
const URLENCODED_BODY = /^[^\s=&]+=[^\s&]*(?:&[^\s=&]+=[^\s&]*)*$/

/**
 * A request body as text: credential-named JSON string fields, XML leaf
 * elements (`<wsse:Password>`) and `application/x-www-form-urlencoded` pairs
 * are masked in place — formatting is kept, nothing is re-serialised — then
 * the value scrub. In `template` mode a value referencing a `{{var}}` is kept
 * (the same rule as headers, params and auth).
 */
export function maskBodyText(text: string, scrub: Scrubber, mode: MaskMode = 'sent'): string {
  if (!text) return text
  return scrub.text(maskBodyFields(text, mode, true))
}

/**
 * The name rule over a body text. A text that parses as a JSON object / array
 * (and is not huge) gets the in-place regex pass, then the structural pass
 * (`completeJsonMask`); anything else — invalid JSON, a templated body
 * (`{"n":{{n}}}`), XML, form data, a huge body — the regex passes only, with
 * `key` / `name` fields masked by the regex since no structural pass follows.
 */
function maskBodyFields(text: string, mode: MaskMode, xml: boolean): string {
  const json = parsesAsJsonContainer(text)
  let out = maskJsonFieldsText(text, mode, json)
  if (xml) {
    out = out.replace(
      XML_LEAF,
      (m, tag: string, local: string, attrs: string | undefined, value: string) =>
        value.trim() && shouldMask(value.trim(), mode) && isCredentialArgName(local)
          ? `<${tag}${attrs ?? ''}>${HISTORY_MASK}</${tag}>`
          : m,
    )
  }
  return json ? completeJsonMask(out, mode) : maskUrlencodedText(out, mode)
}

/**
 * A RESPONSE body as text, for the persisted sinks (History
 * `response_snapshot`, Runner results / `runner_history`) and the Console —
 * credential-named JSON fields (`access_token`, `refresh_token`, `id_token`,
 * `client_secret`, `password`, …) and urlencoded pairs, then the value scrub.
 * XML leaves are left alone (a SOAP reply is what the user debugs). The live
 * response pane is never masked: it reads the engine result, not these sinks.
 */
export function maskResponseBodyText(text: string, scrub: Scrubber): string {
  if (!text) return text
  return scrub.text(maskBodyFields(text, 'sent', false))
}

/** Should a credential-named BODY field (JSON / form) be masked? `token_type: Bearer` is not a credential. */
function shouldMaskField(value: string, mode: MaskMode): boolean {
  return shouldMask(value, mode) && !NEVER_SCRUB.has(value.trim().toLowerCase())
}

/**
 * Credential-named JSON string fields, in place (formatting kept).
 * `structuralFollows`: `completeJsonMask` runs next and handles `key` / `name`.
 */
function maskJsonFieldsText(text: string, mode: MaskMode, structuralFollows = false): string {
  return text.replace(JSON_STRING_FIELD, (m, key: string, sep: string, value: string) =>
    shouldMaskField(value, mode) &&
    isCredentialArgName(key) &&
    !(structuralFollows && PAIR_NAME_FIELDS.has(key))
      ? `"${key}"${sep}"${HISTORY_MASK}"`
      : m,
  )
}

/**
 * `key` / `name` may be the NAME half of a `{ key, value }` pair
 * (`[{"key":"Authorization","value":"Bearer …"}]`) — masking it would hide the
 * name and leave the value. The regex pass cannot see the pair, so when the
 * structural pass (`maskJsonBody`) follows it skips these two and lets that
 * pass mask the pair's VALUE by the name (and a lone `"key": "…"` as before).
 */
const PAIR_NAME_FIELDS = new Set(['key', 'name'])

/** An `application/x-www-form-urlencoded` text: credential-named pairs masked. */
function maskUrlencodedText(text: string, mode: MaskMode): string {
  const trimmed = text.trim()
  if (!URLENCODED_BODY.test(trimmed)) return text
  return trimmed
    .split('&')
    .map((pair) => {
      const i = pair.indexOf('=')
      const name = pair.slice(0, i)
      const value = pair.slice(i + 1)
      return shouldMaskField(value, mode) && isCredentialArgName(decodeName(name))
        ? `${name}=${HISTORY_MASK}`
        : pair
    })
    .join('&')
}

/** Larger JSON texts are masked in place only (regex), never parsed. */
const MAX_STRUCTURAL_JSON = 4 * 1024 * 1024

function looksLikeJsonContainer(text: string): boolean {
  const t = text.trimStart()
  return t.startsWith('{') || t.startsWith('[')
}

/** The indentation a pretty-printed JSON text uses (for re-serialising). */
function detectIndent(text: string): string | number | undefined {
  const m = /\n([ \t]+)\S/.exec(text)
  if (!m) return undefined
  return m[1].startsWith('\t') ? '\t' : Math.min(m[1].length, 10)
}

/**
 * After the in-place regex pass, a JSON text may still hold a credential the
 * regex cannot see — inside an escaped JSON-in-JSON string, or under a key
 * written with escapes. Parse, walk with the name rule, and only when that
 * changes something re-serialise (keeping the detected indentation);
 * otherwise the text — and its formatting — is returned as it was.
 */
/** Does `text` parse as a JSON object / array within the structural size cap? */
function parsesAsJsonContainer(text: string): boolean {
  if (text.length > MAX_STRUCTURAL_JSON || !looksLikeJsonContainer(text)) return false
  try {
    const v: unknown = JSON.parse(text)
    return v !== null && typeof v === 'object'
  } catch {
    return false
  }
}

function completeJsonMask(text: string, mode: MaskMode): string {
  if (text.length > MAX_STRUCTURAL_JSON || !looksLikeJsonContainer(text)) return text
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  if (parsed === null || typeof parsed !== 'object') return text
  const masked = maskJsonBody(parsed, NAME_ONLY, mode)
  const before = JSON.stringify(parsed)
  const after = JSON.stringify(masked)
  if (before === after) return text
  return JSON.stringify(masked, null, detectIndent(text))
}

/**
 * A JSON body VALUE (GraphQL `variables`, a SOAP param tree, a WebSocket /
 * Socket.IO payload, gRPC `messages`): the arg name rule applied RECURSIVELY
 * — a credential-named string leaf at any depth is masked — and a string that
 * parses as a JSON object / array is masked as a JSON body text. Value scrub
 * on every string. Exported for callers that persist such payloads (AI Chat).
 */
export function maskJsonBody(
  value: unknown,
  scrub: Scrubber,
  mode: MaskMode = 'sent',
  depth = 0,
): unknown {
  if (typeof value === 'string') {
    return looksLikeJsonContainer(value) ? maskBodyText(value, scrub, mode) : scrub.text(value)
  }
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => maskJsonBody(v, scrub, mode, depth + 1))
  const rec = value as Json
  // `{ key | name, value }` — a named pair: the name decides the value.
  const pairName =
    typeof rec.key === 'string' ? rec.key : typeof rec.name === 'string' ? rec.name : undefined
  const isPair = pairName !== undefined && 'value' in rec
  const out: Json = {}
  for (const [k, v] of Object.entries(rec)) {
    if (isPair && PAIR_NAME_FIELDS.has(k) && typeof v === 'string') {
      out[k] = scrub.text(v)
    } else if (isPair && k === 'value' && typeof v === 'string') {
      out[k] =
        isCredentialArgName(pairName) && shouldMaskField(v, mode)
          ? HISTORY_MASK
          : maskJsonBody(v, scrub, mode, depth + 1)
    } else {
      out[k] =
        typeof v === 'string' && isCredentialArgName(k) && shouldMaskField(v, mode)
          ? HISTORY_MASK
          : maskJsonBody(v, scrub, mode, depth + 1)
    }
  }
  return out
}

/** A body: text, or a `RequestBody` (`content` / `formData` / `urlEncoded`). */
function maskBody(body: unknown, mode: MaskMode, scrub: Scrubber): unknown {
  if (typeof body === 'string') return maskBodyText(body, scrub, mode)
  if (!isRecord(body)) return maskJsonBody(body, scrub, mode)
  const out: Json = {}
  for (const [k, v] of Object.entries(body)) {
    if (k === 'content' && typeof v === 'string') {
      out[k] = maskBodyText(v, scrub, mode)
    } else if (k === 'formData' || k === 'urlEncoded') {
      out[k] = maskNamed(v, isCredentialArgName, mode, scrub)
    } else if (typeof v === 'string' && isCredentialArgName(k) && shouldMaskField(v, mode)) {
      out[k] = HISTORY_MASK
    } else {
      // `body.graphql.variables`, a raw object body, … — the recursive rule.
      out[k] = maskJsonBody(v, scrub, mode)
    }
  }
  return out
}

// ─── Credential values the request itself carried ───────────────

/**
 * A credential value as it may be echoed back: the whole value, and for
 * `Scheme token` (`Bearer abc`, `Basic dXNl…`) the token alone.
 */
function credentialForms(v: string): string[] {
  const out = [v]
  const i = v.indexOf(' ')
  if (i > 0) out.push(v.slice(i + 1).trim())
  return out
}

function collectNamed(container: unknown, isCred: (n: string) => boolean, out: string[]): void {
  if (Array.isArray(container)) {
    for (const item of container) {
      if (!isRecord(item)) continue
      const name =
        typeof item.key === 'string' ? item.key : typeof item.name === 'string' ? item.name : ''
      if (name && typeof item.value === 'string' && isCred(name)) {
        out.push(...credentialForms(item.value))
      }
    }
  } else if (isRecord(container)) {
    for (const [k, v] of Object.entries(container)) {
      if (typeof v === 'string' && isCred(k)) out.push(...credentialForms(v))
    }
  }
}

function collectQuery(text: string, out: string[]): void {
  for (const m of text.matchAll(URL_USERINFO)) {
    const userinfo = m[1]
    if (TEMPLATE_REF.test(userinfo) || userinfo.includes(HISTORY_MASK)) continue
    const i = userinfo.indexOf(':')
    const pass = i >= 0 ? userinfo.slice(i + 1) : userinfo
    if (!pass) continue
    out.push(pass)
    try {
      out.push(decodeURIComponent(pass))
    } catch {
      /* keep the raw form */
    }
  }
  for (const m of text.matchAll(QUERY_PAIR)) {
    const value = m[3]
    if (value && isCredentialArgName(decodeName(m[2]))) {
      out.push(value)
      try {
        out.push(decodeURIComponent(value.replace(/\+/g, ' ')))
      } catch {
        /* keep the raw form */
      }
    }
  }
}

/**
 * Every credential value a SENT request carried by name — credential headers
 * (literal `X-API-Key`, `Authorization`), credential query params, auth
 * fields. Added to the value scrub for the same row / entry, so an echo
 * server (httpbin `/anything`) returning them in the response body does not
 * undo the mask. `configured` (the `{{var}}` template) is skipped.
 */
export function collectCredentialValues(value: unknown, depth = 0): string[] {
  const out: string[] = []
  const walk = (v: unknown, d: number): void => {
    if (d > MAX_DEPTH || v === null || typeof v !== 'object') return
    if (Array.isArray(v)) {
      for (const x of v) walk(x, d + 1)
      return
    }
    for (const [k, x] of Object.entries(v)) {
      if (k === 'configured') continue
      if (HEADER_KEYS.has(k) && !hasNested(x)) collectNamed(x, isCredentialHeaderName, out)
      else if (PARAM_KEYS.has(k)) collectNamed(x, isCredentialArgName, out)
      else if (k === 'auth') out.push(...authSecretValues(x))
      else if (URL_KEYS.has(k) && typeof x === 'string') collectQuery(x, out)
      else if (CREDENTIAL_KEYS.has(k) && typeof x === 'string') out.push(x)
      else walk(x, d + 1)
    }
  }
  walk(value, depth)
  return out.filter((v) => v.trim().length >= MIN_COLLECTED_LENGTH)
}

/** `scrub` plus the credential values found in `sources`. */
export function withCredentialValues(scrub: Scrubber, ...sources: unknown[]): Scrubber {
  const extra = sources.flatMap((s) => collectCredentialValues(s))
  return extra.length === 0 ? scrub : createScrubber([...scrub.values, ...extra])
}

// ─── Walkers ─────────────────────────────────────────────────────

/** Keys whose value is a header-like container (name rule = header rule). */
const HEADER_KEYS = new Set([
  'headers',
  'customHeaders',
  'extraHeaders',
  'requestHeaders',
  'responseHeaders',
  'responseMetadata',
  'metadata',
])
/** Keys whose value is a query-param-like container (name rule = arg rule). */
const PARAM_KEYS = new Set(['params', 'query', 'queryParams'])
/** Keys whose string value is a URL (credential query params masked). */
const URL_KEYS = new Set(['url', 'address', 'serverAddress', 'endpointUrl', 'wsdlUrl', 'protoUrl'])
/** Keys whose value is a request body. */
const BODY_KEYS = new Set(['body', 'requestBody', 'envelope'])
/**
 * Keys whose value is a JSON payload — GraphQL `variables`, a WebSocket
 * composer, a Socket.IO emit payload, gRPC `messages`, any `payload`. The
 * name rule is applied recursively (`maskJsonBody`).
 */
const PAYLOAD_KEYS = new Set(['variables', 'composerContent', 'emitPayload', 'messages', 'payload'])
/** Keys that hold one credential by themselves. */
const CREDENTIAL_KEYS = new Set(['bearerToken'])

/**
 * A request-like JSON value (a History snapshot, a protocol's editor state):
 * the name rule on the containers it knows, the value scrub everywhere.
 * `configured` switches to `template` mode below it.
 */
export function maskRequestLike(
  value: unknown,
  scrub: Scrubber,
  mode: MaskMode = 'sent',
  depth = 0,
): unknown {
  if (typeof value === 'string') {
    // Any string that is a JSON object / array is a JSON body (issue #195).
    return looksLikeJsonContainer(value) ? maskBodyText(value, scrub, mode) : scrub.text(value)
  }
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => maskRequestLike(v, scrub, mode, depth + 1))
  const out: Json = {}
  for (const [k, v] of Object.entries(value)) {
    if (k === 'configured') out[k] = maskRequestLike(v, scrub, 'template', depth + 1)
    else if (HEADER_KEYS.has(k) && (isRecord(v) || Array.isArray(v)) && !hasNested(v)) {
      out[k] = maskNamed(v, isCredentialHeaderName, mode, scrub)
    } else if (PARAM_KEYS.has(k) && (isRecord(v) || Array.isArray(v))) {
      out[k] = maskNamed(v, isCredentialArgName, mode, scrub)
    } else if (k === 'auth') out[k] = maskAuth(v, mode, scrub)
    else if (URL_KEYS.has(k) && typeof v === 'string') out[k] = maskUrlText(v, scrub, mode)
    else if (BODY_KEYS.has(k)) out[k] = maskBody(v, mode, scrub)
    else if (PAYLOAD_KEYS.has(k)) out[k] = maskJsonBody(v, scrub, mode)
    else if (CREDENTIAL_KEYS.has(k) && typeof v === 'string')
      out[k] = maskValue(true, v, mode, scrub)
    else out[k] = maskRequestLike(v, scrub, mode, depth + 1)
  }
  return out
}

/**
 * Is this "header container" really a nested object (endpoint `metadata` =
 * protocol meta, not gRPC metadata)? A header record holds strings; a
 * `[{key,value}]` list holds records with a `key`.
 */
function hasNested(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((i) => !(isRecord(i) && ('key' in i || 'name' in i)))
  if (isRecord(v)) return Object.values(v).some((x) => x !== null && typeof x === 'object')
  return false
}

/**
 * A response-like JSON value as PERSISTED (History `response_snapshot`):
 * header containers by name, `actualRequest` as a sent request, the body and
 * any JSON payload with the body name rule (`maskResponseBodyText` — an
 * OAuth token reply's `access_token` / `refresh_token` never reach disk),
 * everything else value-scrubbed. The live response pane is not masked — it
 * shows the engine result, not this snapshot.
 */
export function maskResponseLike(value: unknown, scrub: Scrubber, depth = 0): unknown {
  if (typeof value === 'string') {
    return looksLikeJsonContainer(value) ? maskResponseBodyText(value, scrub) : scrub.text(value)
  }
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => maskResponseLike(v, scrub, depth + 1))
  const out: Json = {}
  for (const [k, v] of Object.entries(value)) {
    if (k === 'actualRequest') out[k] = maskRequestLike(v, scrub, 'sent', depth + 1)
    else if (HEADER_KEYS.has(k) && (isRecord(v) || Array.isArray(v)) && !hasNested(v)) {
      out[k] = maskNamed(v, isCredentialHeaderName, 'sent', scrub)
    } else if (URL_KEYS.has(k) && typeof v === 'string') out[k] = maskUrlText(v, scrub)
    else if (typeof v === 'string' && (BODY_KEYS.has(k) || k === 'data')) {
      out[k] = maskResponseBodyText(v, scrub)
    } else if (PAYLOAD_KEYS.has(k)) out[k] = maskJsonBody(v, scrub, 'sent')
    else out[k] = maskResponseLike(v, scrub, depth + 1)
  }
  return out
}

/** Parse → mask → stringify; unparseable text is value-scrubbed as a whole. */
function maskJsonText(text: string, mask: (v: unknown) => unknown, scrub: Scrubber): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return scrub.text(text)
  }
  return JSON.stringify(mask(parsed))
}

export function maskHistoryRequestSnapshot(json: string, scrub: Scrubber): string {
  return maskJsonText(json, (v) => maskRequestLike(v, scrub), scrub)
}

export function maskHistoryResponseSnapshot(
  json: string | undefined,
  scrub: Scrubber,
): string | undefined {
  if (json == null) return json
  return maskJsonText(json, (v) => maskResponseLike(v, scrub), scrub)
}

/** Parsed JSON, or the text itself when it is not JSON. */
function parsedOrText(json: string | undefined): unknown {
  if (json == null) return undefined
  try {
    return JSON.parse(json)
  } catch {
    return json
  }
}

/**
 * A History row's three columns, masked together: the credentials the
 * request carried by name are scrubbed from the response too (echo servers).
 */
export function maskHistoryRow(
  row: { url: string; request_snapshot: string; response_snapshot?: string },
  baseScrub: Scrubber,
): { url: string; request_snapshot: string; response_snapshot?: string } {
  const scrub = withCredentialValues(
    baseScrub,
    parsedOrText(row.request_snapshot),
    { url: row.url },
    parsedOrText(row.response_snapshot),
  )
  return {
    url: maskUrlText(row.url, scrub),
    request_snapshot: maskHistoryRequestSnapshot(row.request_snapshot, scrub),
    response_snapshot: maskHistoryResponseSnapshot(row.response_snapshot, scrub),
  }
}

// ─── Console entries ─────────────────────────────────────────────

/** The fields of a Console entry this module touches (`ConsoleLogEntryWire`). */
export interface ConsoleEntryLike {
  url?: string
  statusText?: string
  message?: string
  details?: {
    requestHeaders?: Record<string, string>
    requestBody?: string
    responseHeaders?: Record<string, string>
    responseBody?: string
    error?: { message: string; stack?: string }
    eventName?: string
    meta?: Record<string, string | number | boolean>
  }
  /** Script `console.*` lines (renderer-built entries, masked through main). */
  scriptLogs?: Array<{ level: 'log' | 'warn' | 'error'; message: string; timestamp: number }>
}

/**
 * A free-text line (Console message, script log, error text): credential
 * query params and URL userinfo, credential-named JSON fields written inline
 * (`WS ← {"token":"…"}`), then the value scrub.
 */
export function maskFreeText(text: string, scrub: Scrubber): string {
  if (!text) return text
  return scrub.text(maskJsonFieldsText(maskUrlText(text, scrub), 'sent'))
}

export function maskConsoleEntry<T extends ConsoleEntryLike>(entry: T, baseScrub: Scrubber): T {
  const scrub = withCredentialValues(baseScrub, {
    url: entry.url,
    requestHeaders: entry.details?.requestHeaders,
  })
  const out: T = { ...entry }
  if (Array.isArray(entry.scriptLogs)) {
    out.scriptLogs = entry.scriptLogs.map((l) => ({
      ...l,
      message: typeof l.message === 'string' ? maskFreeText(l.message, scrub) : l.message,
    }))
  }
  if (typeof entry.url === 'string') out.url = maskUrlText(entry.url, scrub)
  // The AI path puts provider error text in `statusText`.
  if (typeof entry.statusText === 'string') out.statusText = maskFreeText(entry.statusText, scrub)
  if (typeof entry.message === 'string') out.message = maskFreeText(entry.message, scrub)
  const d = entry.details
  if (d) {
    out.details = {
      ...d,
      requestHeaders: maskHeaderRecord(d.requestHeaders, scrub),
      responseHeaders: maskHeaderRecord(d.responseHeaders, scrub),
      requestBody:
        typeof d.requestBody === 'string' ? maskBodyText(d.requestBody, scrub) : d.requestBody,
      responseBody:
        typeof d.responseBody === 'string'
          ? maskResponseBodyText(d.responseBody, scrub)
          : d.responseBody,
      error: d.error
        ? {
            message: maskFreeText(d.error.message, scrub),
            ...(d.error.stack !== undefined ? { stack: scrub.text(d.error.stack) } : {}),
          }
        : d.error,
      eventName: typeof d.eventName === 'string' ? scrub.text(d.eventName) : d.eventName,
      meta: d.meta
        ? (Object.fromEntries(
            Object.entries(d.meta).map(([k, v]) => [
              k,
              typeof v === 'string' ? maskUrlText(v, scrub) : v,
            ]),
          ) as Record<string, string | number | boolean>)
        : d.meta,
    }
  }
  return out
}

// ─── Runner results ──────────────────────────────────────────────

/** One Runner step result with credentials masked — live view, history, export. */
export function maskRunResult(result: EndpointRunResult, baseScrub: Scrubber): EndpointRunResult {
  const scrub = withCredentialValues(baseScrub, {
    url: result.url,
    requestHeaders: result.requestHeaders,
  })
  const out: EndpointRunResult = {
    ...result,
    url: maskUrlText(result.url, scrub),
    // Tolerant: reports handed back for export may predate a field.
    assertions: (Array.isArray(result.assertions) ? result.assertions : []).map((a) => ({
      ...a,
      ...(typeof a.actual === 'string' ? { actual: scrub.text(a.actual) } : {}),
      ...(typeof a.error === 'string' ? { error: scrub.text(a.error) } : {}),
      name: scrub.text(a.name),
    })),
  }
  if (result.error !== undefined) out.error = scrub.text(result.error)
  if (result.requestHeaders) out.requestHeaders = maskHeaderRecord(result.requestHeaders, scrub)
  if (result.responseHeaders) out.responseHeaders = maskHeaderRecord(result.responseHeaders, scrub)
  if (typeof result.requestBody === 'string')
    out.requestBody = maskBodyText(result.requestBody, scrub)
  if (typeof result.responseBody === 'string') {
    out.responseBody = maskResponseBodyText(result.responseBody, scrub)
  }
  if (result.consoleLogs) {
    out.consoleLogs = result.consoleLogs.map((l) => ({ ...l, message: scrub.text(l.message) }))
  }
  return out
}
