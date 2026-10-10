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
 *      (type, user names, header/query name) stays.
 *   3. Mock MCP `mock_mcp_servers.bearer_token` becomes ''.
 *   4. Client certificates: `passphrase` and `keystore_key_password` become ''
 *      (a NULL stays NULL — "no passphrase" must not turn into one). Both are
 *      `encryptSecret` output — ciphertext bound to this machine's keychain,
 *      or plaintext when the keychain is unavailable — so they are useless
 *      (or a leak) anywhere else.
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

type Row = Record<string, unknown>

/** The export sections this module reads; `ProjectExport` satisfies it. */
export interface SecretBearingExport {
  environmentVariables?: Row[]
  globalVariables?: Row[]
  mockServers?: Row[]
  mockEndpoints?: Row[]
  mockMcpServers?: Row[]
  certificates?: Row[]
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

interface MockAuthShape {
  type?: unknown
  tokens?: unknown
  users?: unknown
  keys?: unknown
  [k: string]: unknown
}

function parseAuth(raw: unknown): MockAuthShape | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as MockAuthShape)
      : null
  } catch {
    return null
  }
}

/**
 * Blank every secret inside a serialised mock `AuthConfig`. Values that are
 * not a JSON object ('' = no endpoint override, or something unparseable)
 * come back unchanged.
 */
export function stripMockAuthJson(raw: unknown): unknown {
  const auth = parseAuth(raw)
  if (!auth) return raw
  const out: MockAuthShape = { ...auth }
  let changed = false
  if (Array.isArray(auth.tokens)) {
    out.tokens = auth.tokens.map(() => '')
    changed = true
  }
  if (Array.isArray(auth.keys)) {
    out.keys = auth.keys.map(() => '')
    changed = true
  }
  if (Array.isArray(auth.users)) {
    out.users = auth.users.map((u) =>
      u && typeof u === 'object' ? { ...(u as Row), password: '' } : u,
    )
    changed = true
  }
  return changed ? JSON.stringify(out) : raw
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
  if (!inc || !loc || inc.type !== loc.type) return incoming
  const out: MockAuthShape = { ...inc }
  let changed = false

  const refillList = (key: 'tokens' | 'keys'): void => {
    const a = inc[key]
    const b = loc[key]
    if (!Array.isArray(a) || !Array.isArray(b)) return
    out[key] = a.map((v, i) => {
      if (v === '' && typeof b[i] === 'string' && b[i] !== '') {
        changed = true
        return b[i]
      }
      return v
    })
  }
  refillList('tokens')
  refillList('keys')

  if (Array.isArray(inc.users) && Array.isArray(loc.users)) {
    const localPw = new Map<string, string>()
    for (const u of loc.users) {
      if (!u || typeof u !== 'object') continue
      const { username, password } = u as Row
      if (typeof username === 'string' && typeof password === 'string' && password !== '') {
        localPw.set(username, password)
      }
    }
    out.users = inc.users.map((u) => {
      if (!u || typeof u !== 'object') return u
      const row = u as Row
      if (row.password !== '' || typeof row.username !== 'string') return u
      const pw = localPw.get(row.username)
      if (pw === undefined) return u
      changed = true
      return { ...row, password: pw }
    })
  }

  return changed ? JSON.stringify(out) : incoming
}

// ─── Export boundary ─────────────────────────────────────────────

function stripVariables(rows: Row[] | undefined): Row[] | undefined {
  if (!Array.isArray(rows)) return rows
  return rows.map((r) => (isSecretFlag(r.secret) ? { ...r, value: '', initial_value: '' } : r))
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
export function stripLocalSecrets<T extends SecretBearingExport>(data: T): T {
  const out: T = { ...data }
  if (data.environmentVariables)
    out.environmentVariables = stripVariables(data.environmentVariables)
  if (data.globalVariables) out.globalVariables = stripVariables(data.globalVariables)
  if (data.mockServers) out.mockServers = stripColumn(data.mockServers, 'auth_config')
  if (data.mockEndpoints) out.mockEndpoints = stripColumn(data.mockEndpoints, 'auth_override')
  if (Array.isArray(data.mockMcpServers)) {
    out.mockMcpServers = data.mockMcpServers.map((r) =>
      'bearer_token' in r ? { ...r, bearer_token: '' } : r,
    )
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

/** Mock auth JSON columns: refill blank secrets from the local row. */
export function keepLocalMockAuth(rows: Row[], column: string, lookup: LocalRowLookup): Row[] {
  return rows.map((row) => {
    if (typeof row.id !== 'string') return row
    const local = lookup(row.id)
    if (!local) return row
    const next = mergeMockAuthJson(row[column], local[column])
    return next === row[column] ? row : { ...row, [column]: next }
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
