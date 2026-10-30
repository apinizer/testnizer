/**
 * "Values marked secret stay on this machine" (issue #177).
 *
 * The project file is what leaves the computer — a JSON file the user saves,
 * the `<slug>.json` committed to git, the push / diff preview. Secret values
 * must never reach it. `exportProjectData` itself stays a faithful DB dump
 * (Duplicate Project reuses it and MUST keep secrets); every file-writing
 * boundary calls `stripLocalSecrets` on the export instead.
 *
 * Exactly these are stripped (nothing else — request auth inside requests
 * follows the Postman / Bruno norm and travels with the collection):
 *   1. environment + global variables with `secret` set: `value` and
 *      `initial_value` become ''.
 *   2. HTTP mock auth (`mock_servers.auth_config`, `mock_endpoints.auth_override`):
 *      bearer tokens, basic-auth passwords and API keys become '' — structure
 *      (type, user names, header/query name) stays. The column is free JSON
 *      typed in the mock editor, so the rule is by FIELD NAME, not by one
 *      fixed shape: any credential-named field (`tokens`, `token`, `keys`,
 *      `password`, `apiKey`, `secret`, … — the shared `isCredentialArgName`
 *      rule, plurals included) plus `value(s)` (an API key's value carries no
 *      credential-looking name), at any depth (issue #177 re-open). The same
 *      values are also scrubbed out of the mock servers' and endpoints'
 *      `description` (the "Auth required" preset used to write its token
 *      there).
 *   3. Mock MCP `mock_mcp_servers.bearer_token` becomes ''.
 *   4. Client certificates: `passphrase` and `keystore_key_password` become ''
 *      (a NULL stays NULL — "no passphrase" must not turn into one). Both are
 *      `encryptSecret` output — ciphertext bound to this machine's keychain,
 *      or plaintext when the keychain is unavailable — so they are useless
 *      (or a leak) anywhere else.
 *   5. Project auth in `projects.shared_settings` (bearer token, basic
 *      password, API key value) becomes '' unless it is only `{{variable}}`
 *      references: those carry no secret, resolve per machine at Send / Run,
 *      and are what makes a teammate's Pull work. Project settings never
 *      left the machine before they moved to the project row, so a literal
 *      credential there must not start travelling now.
 *   6. Saved examples (`saved_responses`): the wire request they carry
 *      (`request_json.sent`, `response_json.actualRequest`) is masked by the
 *      one example rule (`saved-example-mask.ts`) — credential headers and
 *      the `<wsse:Password>` in a SOAP envelope.
 *
 * Blank is '' and never a missing key or NULL: `environment_variables.value`,
 * `mock_mcp_servers.bearer_token` and `mock_servers.auth_config` are NOT NULL.
 *
 * On import the counterpart (`keepLocal*`) lets a stripped value keep the
 * value this machine already holds, so a Pull / branch switch never wipes a
 * token the user typed in. A machine that has no local row gets '' and the
 * user fills it in; every mock runtime treats a blank secret as "no
 * credential" (fail-closed).
 */

import { maskSavedExample } from './saved-example-mask'
import { HISTORY_MASK, isCredentialArgName } from '../../shared/credential-headers'
import { createScrubber, type Scrubber } from './sensitive-scrub'
import { decryptSecret, isEncryptedSecret } from './secure-storage'

type Row = Record<string, unknown>

/** The export sections this module reads; `ProjectExport` satisfies it. */
export interface SecretBearingExport {
  project?: Row
  environmentVariables?: Row[]
  globalVariables?: Row[]
  mockServers?: Row[]
  mockEndpoints?: Row[]
  mockMcpServers?: Row[]
  certificates?: Row[]
  savedResponses?: Row[]
}

/** The two certificate columns that hold `encryptSecret` output (issue #177). */
export const CERT_SECRET_COLUMNS = ['passphrase', 'keystore_key_password'] as const

/** SQLite stores the flag as 0/1; JSON written by hand may carry a boolean. */
export function isSecretFlag(v: unknown): boolean {
  return v === 1 || v === true || v === '1'
}

function blank(v: unknown): boolean {
  return v === undefined || v === null || v === ''
}

// ─── Mock auth JSON ──────────────────────────────────────────────

const MAX_DEPTH = 32

/**
 * Field names inside a mock auth config that hold a secret but carry no
 * credential-looking word: an API key written as `{ name, value }`.
 */
const MOCK_AUTH_VALUE_FIELDS = new Set(['value', 'values'])

/**
 * Is this mock-auth field credential-bearing? The shared whole-word rule
 * (`isCredentialArgName`) on the name and on its singular — the canonical
 * shape stores lists (`tokens`, `keys`) — plus `value(s)`. Structural fields
 * (`type`, `in`, `name`, `username`, `users`) never match.
 */
export function isMockAuthSecretField(name: string): boolean {
  if (MOCK_AUTH_VALUE_FIELDS.has(name.toLowerCase())) return true
  if (isCredentialArgName(name)) return true
  return name.length > 1 && /s$/i.test(name) && isCredentialArgName(name.slice(0, -1))
}

const isRecord = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Rebuild `v` with `fn` applied to every string that sits under a
 * credential-named field. Arrays inherit the field's verdict; an object
 * decides again per key (so `{ auth: { type: 'bearer', … } }` keeps `type`).
 */
function mapSecretStrings(
  v: unknown,
  secret: boolean,
  fn: (s: string) => string,
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) return v
  if (typeof v === 'string') return secret ? fn(v) : v
  if (Array.isArray(v)) return v.map((x) => mapSecretStrings(x, secret, fn, depth + 1))
  if (isRecord(v)) {
    const out: Row = {}
    for (const [k, x] of Object.entries(v)) {
      out[k] = mapSecretStrings(x, isMockAuthSecretField(k), fn, depth + 1)
    }
    return out
  }
  return v
}

interface ParsedAuth {
  auth: Row
  /** The column held the JSON as a JSON string (`"{\"type\":…}"`) — written back the same way. */
  doubleEncoded: boolean
}

/**
 * A mock auth column → the auth object. Accepts a JSON string (the DB form),
 * a JSON string that itself encodes a JSON string (one level), or an object.
 * Anything else (`''` = no endpoint override, unparseable text) is null.
 */
function parseAuth(raw: unknown): ParsedAuth | null {
  if (isRecord(raw)) return { auth: raw, doubleEncoded: false }
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    let parsed: unknown = JSON.parse(raw)
    let doubleEncoded = false
    if (typeof parsed === 'string') {
      parsed = JSON.parse(parsed)
      doubleEncoded = true
    }
    return isRecord(parsed) ? { auth: parsed, doubleEncoded } : null
  } catch {
    return null
  }
}

function serialiseAuth(raw: unknown, parsed: ParsedAuth, out: Row): unknown {
  if (isRecord(raw)) return out
  const json = JSON.stringify(out)
  return parsed.doubleEncoded ? JSON.stringify(json) : json
}

/**
 * Every non-empty secret value inside a mock auth column (for the description
 * scrub). The column holds `encryptSecret` output since issue #239, the
 * description the plaintext the "Auth required" preset wrote — so each value
 * is decrypted here; an undecryptable one is skipped (it can match nothing).
 */
export function mockAuthSecretValues(raw: unknown): string[] {
  const parsed = parseAuth(raw)
  if (!parsed) return []
  const out: string[] = []
  mapSecretStrings(parsed.auth, false, (s) => {
    if (s === '') return s
    const plain = isEncryptedSecret(s) ? decryptSecret(s) : s
    if (plain) out.push(plain)
    return s
  })
  return out
}

/**
 * `raw` with `fn` applied to every string under a credential-named field of
 * the mock auth JSON (the same field rule as the export strip). Returns `raw`
 * itself (same reference) when `fn` changed nothing, so an untouched column
 * is never re-serialised (issue #239: encryption at rest).
 */
export function mapMockAuthSecrets(raw: unknown, fn: (s: string) => string): unknown {
  const parsed = parseAuth(raw)
  if (!parsed) return raw
  let changed = false
  const out = mapSecretStrings(parsed.auth, false, (s) => {
    const next = fn(s)
    if (next !== s) changed = true
    return next
  }) as Row
  return changed ? serialiseAuth(raw, parsed, out) : raw
}

/**
 * Blank every secret inside a serialised mock `AuthConfig`. Values that are
 * not a JSON object ('' = no endpoint override, or something unparseable)
 * and configs without a secret come back unchanged (same reference).
 */
export function stripMockAuthJson(raw: unknown): unknown {
  const parsed = parseAuth(raw)
  if (!parsed) return raw
  let changed = false
  const out = mapSecretStrings(parsed.auth, false, (s) => {
    if (s === '') return s
    changed = true
    return ''
  }) as Row
  return changed ? serialiseAuth(raw, parsed, out) : raw
}

/** A list of user-like objects is matched by `username`, anything else by position. */
function userKey(v: unknown): string | null {
  return isRecord(v) && typeof v.username === 'string' ? v.username : null
}

/**
 * `inc` with every blank secret refilled from the same place in `loc`.
 * Lists of `{ username, … }` match by user name, other lists by position.
 */
function refill(
  inc: unknown,
  loc: unknown,
  secret: boolean,
  onFill: () => void,
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) return inc
  if (typeof inc === 'string') {
    if (secret && inc === '' && typeof loc === 'string' && loc !== '') {
      onFill()
      return loc
    }
    return inc
  }
  if (Array.isArray(inc)) {
    const locList = Array.isArray(loc) ? loc : []
    const byUser = new Map<string, unknown>()
    for (const l of locList) {
      const k = userKey(l)
      if (k !== null && !byUser.has(k)) byUser.set(k, l)
    }
    return inc.map((x, i) => {
      const k = userKey(x)
      const counterpart = k !== null ? byUser.get(k) : locList[i]
      return refill(x, counterpart, secret, onFill, depth + 1)
    })
  }
  if (isRecord(inc)) {
    const locRow = isRecord(loc) ? loc : {}
    const out: Row = {}
    for (const [k, x] of Object.entries(inc)) {
      out[k] = refill(x, locRow[k], isMockAuthSecretField(k), onFill, depth + 1)
    }
    return out
  }
  return inc
}

/**
 * Import side: the incoming (stripped) auth JSON with every blank secret
 * refilled from the local row's auth JSON — only when both are the same auth
 * type. Basic users match by username, tokens / keys by position. Returns
 * `incoming` untouched when nothing could be refilled.
 */
export function mergeMockAuthJson(incoming: unknown, local: unknown): unknown {
  const inc = parseAuth(incoming)
  const loc = parseAuth(local)
  if (!inc || !loc || inc.auth.type !== loc.auth.type) return incoming
  let changed = false
  const out = refill(inc.auth, loc.auth, false, () => {
    changed = true
  }) as Row
  return changed ? serialiseAuth(incoming, inc, out) : incoming
}

// ─── Mock descriptions ───────────────────────────────────────────

/**
 * `description` with every mock auth secret of the export replaced by
 * `HISTORY_MASK` (values shorter than `MIN_SECRET_LENGTH` are left alone, as
 * everywhere else). The "Auth required" preset used to write its token there.
 */
function scrubDescriptions(rows: Row[] | undefined, scrub: Scrubber): Row[] | undefined {
  if (!Array.isArray(rows) || scrub.needles.length === 0) return rows
  return rows.map((r) => {
    if (typeof r.description !== 'string') return r
    const next = scrub.text(r.description)
    return next === r.description ? r : { ...r, description: next }
  })
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Import side: an incoming description that carries masks keeps this
 * machine's description when the local one is the same text with the
 * secrets in place — a Pull never turns the local token into dots.
 */
export function keepLocalMaskedText(incoming: unknown, local: unknown): unknown {
  if (typeof incoming !== 'string' || !incoming.includes(HISTORY_MASK)) return incoming
  if (typeof local !== 'string' || local === incoming) return incoming
  const pattern = incoming.split(HISTORY_MASK).map(escapeRegExp).join('[\\s\\S]+?')
  return new RegExp(`^${pattern}$`).test(local) ? local : incoming
}

// ─── Export boundary ─────────────────────────────────────────────

function stripVariables(rows: Row[] | undefined): Row[] | undefined {
  if (!Array.isArray(rows)) return rows
  return rows.map((r) => {
    if (isSecretFlag(r.secret)) return { ...r, value: '', initial_value: '' }
    // Safety net (issue #239): ciphertext is bound to this machine's keychain
    // and must never reach a file, even on a row no longer marked secret
    // (an undecryptable value is kept as-is when its flag is cleared).
    const enc = (['value', 'initial_value'] as const).filter((c) => isEncryptedSecret(r[c]))
    if (enc.length === 0) return r
    const next: Row = { ...r }
    for (const c of enc) next[c] = ''
    return next
  })
}

function stripColumn(rows: Row[] | undefined, column: string): Row[] | undefined {
  if (!Array.isArray(rows)) return rows
  return rows.map((r) => {
    if (!(column in r)) return r
    const next = stripMockAuthJson(r[column])
    return next === r[column] ? r : { ...r, [column]: next }
  })
}

/**
 * A copy of `data` with every value marked secret blanked. Call it at each
 * place the export becomes a file (save dialog, local save, git working
 * tree, push, diff preview) — never inside `exportProjectData`, which
 * Duplicate Project relies on to copy secrets. Idempotent; never mutates.
 */
// ─── Project auth (shared_settings) ──────────────────────────────

/** Project auth fields that hold a credential (`StoredProjectAuth`). */
const PROJECT_AUTH_SECRET_FIELDS = ['bearerToken', 'basicPass', 'apiKeyValue'] as const

/** Only `{{var}}` references (and whitespace): no secret in the text itself. */
export function isVariableReferenceOnly(v: string): boolean {
  return /\{\{[^{}]+\}\}/.test(v) && v.replace(/\{\{[^{}]+\}\}/g, '').trim() === ''
}

function parseObject(raw: unknown): Row | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const v = JSON.parse(raw) as unknown
    return isRecord(v) ? v : null
  } catch {
    return null
  }
}

/**
 * `projects.shared_settings` as it may leave the machine: literal project
 * auth credentials blanked. Always re-serialised, so both sides of a
 * `sameExport` comparison have the same key order.
 */
export function stripProjectSharedSettings(raw: unknown): unknown {
  const settings = parseObject(raw)
  if (!settings) return raw
  const auth = settings.auth
  if (isRecord(auth)) {
    const next: Row = { ...auth }
    for (const f of PROJECT_AUTH_SECRET_FIELDS) {
      const v = next[f]
      if (typeof v === 'string' && v !== '' && !isVariableReferenceOnly(v)) next[f] = ''
    }
    settings.auth = next
  }
  return JSON.stringify(settings)
}

/**
 * Import: an incoming `shared_settings` whose project auth credential was
 * blanked keeps this machine's value for it (same auth type only — a
 * different type is a different credential).
 */
export function keepLocalProjectSharedSettings(incoming: unknown, local: unknown): unknown {
  const inc = parseObject(incoming)
  const loc = parseObject(local)
  if (!inc || !loc || !isRecord(inc.auth) || !isRecord(loc.auth)) return incoming
  if (inc.auth.type !== loc.auth.type) return incoming
  const auth: Row = { ...inc.auth }
  let changed = false
  for (const f of PROJECT_AUTH_SECRET_FIELDS) {
    if (auth[f] === '' && typeof loc.auth[f] === 'string' && loc.auth[f] !== '') {
      auth[f] = loc.auth[f]
      changed = true
    }
  }
  return changed ? JSON.stringify({ ...inc, auth }) : incoming
}

export function stripLocalSecrets<T extends SecretBearingExport>(data: T): T {
  const out: T = { ...data }
  if (data.project && 'shared_settings' in data.project) {
    out.project = {
      ...data.project,
      shared_settings: stripProjectSharedSettings(data.project.shared_settings),
    }
  }
  if (data.environmentVariables)
    out.environmentVariables = stripVariables(data.environmentVariables)
  if (data.globalVariables) out.globalVariables = stripVariables(data.globalVariables)
  // Every mock auth secret of the project, scrubbed out of free-text
  // descriptions before the auth columns themselves are blanked.
  const mockSecrets = createScrubber([
    ...(data.mockServers ?? []).flatMap((r) => mockAuthSecretValues(r.auth_config)),
    ...(data.mockEndpoints ?? []).flatMap((r) => mockAuthSecretValues(r.auth_override)),
  ])
  if (data.mockServers) {
    out.mockServers = stripColumn(scrubDescriptions(data.mockServers, mockSecrets), 'auth_config')
  }
  if (data.mockEndpoints) {
    out.mockEndpoints = stripColumn(
      scrubDescriptions(data.mockEndpoints, mockSecrets),
      'auth_override',
    )
  }
  if (Array.isArray(data.mockMcpServers)) {
    out.mockMcpServers = data.mockMcpServers.map((r) =>
      'bearer_token' in r ? { ...r, bearer_token: '' } : r,
    )
  }
  // Saved examples: the wire request in `request_json.sent` and
  // `response_json.actualRequest` — masked on write since the peer review of
  // issue #298, but a row written before that still holds the credential.
  if (Array.isArray(data.savedResponses)) {
    out.savedResponses = data.savedResponses.map((r) => maskSavedExample(r))
  }
  if (Array.isArray(data.certificates)) {
    out.certificates = data.certificates.map((r) => {
      const held = CERT_SECRET_COLUMNS.filter((c) => !blank(r[c]))
      if (held.length === 0) return r
      const next: Row = { ...r }
      for (const c of held) next[c] = ''
      return next
    })
  }
  return out
}

// ─── Import boundary ─────────────────────────────────────────────

/** Reads the local row with the same id; `undefined` when there is none. */
export type LocalRowLookup = (id: string) => Row | undefined

/**
 * Variables: a secret row whose incoming `value` / `initial_value` is blank
 * (stripped) keeps this machine's value. A non-blank incoming value — an old
 * file written before issue #177 — still wins, as it always did.
 */
export function keepLocalVariableSecrets(rows: Row[], lookup: LocalRowLookup): Row[] {
  return rows.map((row) => {
    if (!isSecretFlag(row.secret) || typeof row.id !== 'string') return row
    const local = lookup(row.id)
    if (!local) return row
    const next: Row = { ...row }
    let changed = false
    for (const col of ['value', 'initial_value'] as const) {
      if (blank(row[col]) && !blank(local[col])) {
        next[col] = local[col]
        changed = true
      }
    }
    return changed ? next : row
  })
}

/**
 * Mock auth JSON columns: refill blank secrets from the local row. When the
 * lookup also reads `description`, a masked description keeps the local text
 * (see `keepLocalMaskedText`).
 */
export function keepLocalMockAuth(rows: Row[], column: string, lookup: LocalRowLookup): Row[] {
  return rows.map((row) => {
    if (typeof row.id !== 'string') return row
    const local = lookup(row.id)
    if (!local) return row
    const next: Row = { ...row }
    let changed = false
    const auth = mergeMockAuthJson(row[column], local[column])
    if (auth !== row[column]) {
      next[column] = auth
      changed = true
    }
    if ('description' in local) {
      const description = keepLocalMaskedText(row.description, local.description)
      if (description !== row.description) {
        next.description = description
        changed = true
      }
    }
    return changed ? next : row
  })
}

/** Mock MCP bearer token: a blank incoming token keeps the local one. */
export function keepLocalMcpBearer(rows: Row[], lookup: LocalRowLookup): Row[] {
  return rows.map((row) => {
    if (!blank(row.bearer_token)) return row
    const local = typeof row.id === 'string' ? lookup(row.id) : undefined
    // '' rather than NULL when there is nothing to keep — the column is NOT NULL.
    const kept = local && !blank(local.bearer_token) ? local.bearer_token : ''
    return row.bearer_token === kept ? row : { ...row, bearer_token: kept }
  })
}

/**
 * Certificates: `passphrase` / `keystore_key_password` are bound to the
 * machine that encrypted them, so this machine's non-blank value ALWAYS
 * wins — over a stripped '' and over another machine's ciphertext carried by
 * a file written before issue #177. With no local value the incoming one
 * stays ('' from a stripped file).
 */
export function keepLocalCertSecrets(rows: Row[], lookup: LocalRowLookup): Row[] {
  return rows.map((row) => {
    if (typeof row.id !== 'string') return row
    const local = lookup(row.id)
    if (!local) return row
    const kept = CERT_SECRET_COLUMNS.filter((c) => !blank(local[c]) && row[c] !== local[c])
    if (kept.length === 0) return row
    const next: Row = { ...row }
    for (const c of kept) next[c] = local[c]
    return next
  })
}

/**
 * Re-import by variable KEY (the Postman environment / collection-variable
 * importers drop an environment's rows and insert fresh ones): the secret
 * rows this environment holds now, read before the DELETE.
 */
export type LocalSecretsByKey = Map<string, { value: unknown; initial_value: unknown }>

export function localSecretsByKey(rows: Row[]): LocalSecretsByKey {
  const out: LocalSecretsByKey = new Map()
  for (const r of rows) {
    if (!isSecretFlag(r.secret) || typeof r.key !== 'string' || out.has(r.key)) continue
    out.set(r.key, { value: r.value, initial_value: r.initial_value })
  }
  return out
}

/**
 * An incoming variable's `value` / `initial_value`, with a blank one refilled
 * from the local secret row of the same key — only when the incoming row is
 * secret too. A non-blank incoming value wins (as in `keepLocalVariableSecrets`).
 * `value` is never NULL (NOT NULL column).
 */
export function keepLocalSecretByKey(
  incoming: { key: string; secret: boolean; value: string; initial_value: string | null },
  local: LocalSecretsByKey,
): { value: string; initial_value: string | null } {
  const out = { value: incoming.value, initial_value: incoming.initial_value }
  if (!incoming.secret) return out
  const held = local.get(incoming.key)
  if (!held) return out
  if (blank(out.value) && typeof held.value === 'string' && held.value !== '') {
    out.value = held.value
  }
  if (
    blank(out.initial_value) &&
    typeof held.initial_value === 'string' &&
    held.initial_value !== ''
  ) {
    out.initial_value = held.initial_value
  }
  return out
}
