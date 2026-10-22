/**
 * Values marked secret are encrypted at rest (issue #239).
 *
 * Exactly the values issue #177 keeps on this machine are stored with
 * Electron safeStorage (`secure-storage.ts`, `enc:v1:` envelope) — in place,
 * in the same columns, no new column:
 *   - `environment_variables` / `global_variables` with `secret = 1`:
 *     `value` and `initial_value`;
 *   - HTTP mock auth JSON (`mock_servers.auth_config`,
 *     `mock_endpoints.auth_override`): ONLY the credential fields inside the
 *     JSON (the `isMockAuthSecretField` rule the export strip uses), so the
 *     column stays parseable and `stripLocalSecrets` keeps working;
 *   - Mock MCP `mock_mcp_servers.bearer_token`.
 *
 * Same pattern as certificate passphrases: sealed where the row is written,
 * opened where the value is used — the repositories (`environment.repo`,
 * `mock.repo`, `mock-mcp.repo`), the Run / Mock variable loader
 * (`env-vars.ts`), the mask inventory (`sensitive-scrub.ts`) and the mock
 * description scrub (`local-secrets.ts`). The renderer only ever sees
 * plaintext; files never see ciphertext (`stripLocalSecrets` blanks it).
 *
 * Rules every caller relies on:
 *   - '' stays '' and NULL stays NULL (`value` / `bearer_token` are NOT NULL,
 *     and `encryptSecret('')` would return NULL).
 *   - A value that cannot be decrypted (keychain reset, profile restored on
 *     another machine) opens as '' with `failed: true` — never as ciphertext,
 *     and the stored ciphertext is never overwritten by that '' (see
 *     `keepUndecryptable`). The UI shows "re-enter the value".
 *   - When the OS keychain cannot encrypt, `encryptSecret` falls back to
 *     plaintext (headless Linux keeps working); `secretStorageStatus` tells
 *     the UI so it can say so. The startup sweep seals those rows later, once
 *     the keychain works.
 */
import { safeStorage } from 'electron'
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  isEncryptionAvailable,
} from './secure-storage'
import { isSecretFlag, mapMockAuthSecrets, mergeMockAuthJson } from './local-secrets'

/** The outcome of opening one stored value. */
export interface OpenedSecret {
  value: string
  /** The value is ciphertext this machine's keychain cannot decrypt. */
  failed: boolean
}

/** A stored value → plaintext. Plain (legacy / non-secret) values pass through. */
export function openSecret(stored: string | null | undefined): OpenedSecret {
  if (stored === null || stored === undefined || stored === '') return { value: '', failed: false }
  if (!isEncryptedSecret(stored)) return { value: stored, failed: false }
  const plain = decryptSecret(stored)
  return plain === null ? { value: '', failed: true } : { value: plain, failed: false }
}

/** Same as {@link openSecret}, NULL preserved (for `initial_value`). */
function openNullable(stored: string | null | undefined): OpenedSecret & { isNull: boolean } {
  if (stored === null || stored === undefined) return { value: '', failed: false, isNull: true }
  return { ...openSecret(stored), isNull: false }
}

/** Is this stored value ciphertext the keychain cannot open? */
export function isUndecryptable(stored: unknown): boolean {
  return isEncryptedSecret(stored) && decryptSecret(stored) === null
}

/** Plaintext → stored form. '' / NULL kept as they are; already-sealed values unchanged. */
export function sealSecret(plain: string): string
export function sealSecret(plain: string | null): string | null
export function sealSecret(plain: string | null | undefined): string | null | undefined
export function sealSecret(plain: string | null | undefined): string | null | undefined {
  if (plain === null || plain === undefined || plain === '') return plain
  if (isEncryptedSecret(plain)) return plain
  return encryptSecret(plain) ?? plain
}

/**
 * The incoming value to store, unless it is '' / absent while the stored
 * value is ciphertext this machine cannot decrypt: then the ciphertext stays
 * (the editor received '' for it, and any unrelated edit sends that '' back).
 */
export function keepUndecryptable<T extends string | null | undefined>(
  incoming: T,
  stored: string | null | undefined,
): T | string {
  if ((incoming === undefined || incoming === null || incoming === '') && isUndecryptable(stored)) {
    return stored as string
  }
  return incoming
}

// ─── Variables ───────────────────────────────────────────────────

interface VariableColumns {
  value: string
  initial_value: string | null
  secret: number
}

/**
 * A variable row as main hands it out: `value` / `initial_value` in
 * plaintext. `decryptFailed: true` is set when either could not be decrypted
 * (that field reads '' and the stored ciphertext is untouched).
 */
export function openVariableRow<T extends VariableColumns>(row: T): T & { decryptFailed?: true } {
  const value = openSecret(row.value)
  const initial = openNullable(row.initial_value)
  const out = {
    ...row,
    value: value.value,
    initial_value: initial.isNull ? row.initial_value : initial.value,
  } as T & { decryptFailed?: true }
  if (value.failed || initial.failed) out.decryptFailed = true
  return out
}

/**
 * The stored form of one variable column given the row's (new) secret flag:
 *   - secret → sealed (plaintext encrypted, ciphertext kept);
 *   - not secret → plaintext (ciphertext decrypted; an undecryptable value
 *     stays as it is rather than being lost).
 */
export function storedVariableValue(v: string, secret: boolean): string
export function storedVariableValue(v: string | null, secret: boolean): string | null
export function storedVariableValue(v: string | null, secret: boolean): string | null {
  if (v === null || v === '') return v
  if (secret) return sealSecret(v)
  if (!isEncryptedSecret(v)) return v
  const plain = decryptSecret(v)
  return plain === null ? v : plain
}

// ─── Mock auth JSON ──────────────────────────────────────────────

/** A mock auth column with every credential field decrypted. */
export function openMockAuthJson(raw: string): { json: string; failed: boolean } {
  let failed = false
  const out = mapMockAuthSecrets(raw, (s) => {
    const o = openSecret(s)
    if (o.failed) failed = true
    return o.value
  })
  return { json: typeof out === 'string' ? out : raw, failed }
}

/**
 * A mock auth column (plaintext JSON from the editor / an import) with every
 * credential field sealed. A field that arrives '' where `previousRaw` holds
 * undecryptable ciphertext at the same place keeps that ciphertext. Returns
 * `raw` unchanged (same string) when nothing needed sealing.
 */
export function sealMockAuthJson(raw: string, previousRaw?: string | null): string {
  let base = raw
  if (previousRaw && previousRaw !== raw) {
    base = keepUndecryptableMockAuth(raw, previousRaw)
  }
  const out = mapMockAuthSecrets(base, (s) => sealSecret(s))
  return typeof out === 'string' ? out : base
}

/** `incoming` with '' credential fields refilled from undecryptable ones in `previous`. */
function keepUndecryptableMockAuth(incoming: string, previous: string): string {
  let locked = false
  // `previous` reduced to ONLY its undecryptable values; the import refill
  // (same auth type, users by name, lists by position) then puts them back
  // where the incoming JSON has ''.
  const lockedOnly = mapMockAuthSecrets(previous, (s) => {
    if (isUndecryptable(s)) {
      locked = true
      return s
    }
    return ''
  })
  if (!locked) return incoming
  const merged = mergeMockAuthJson(incoming, lockedOnly)
  return typeof merged === 'string' ? merged : incoming
}

// ─── Project-file rows (import / duplicate) ──────────────────────

type ExportRow = Record<string, unknown>

/**
 * Project-file rows as they are about to be written to the DB (import,
 * Pull, branch switch, Duplicate): plaintext secrets sealed. Runs AFTER the
 * `keepLocal*` refill, so a refilled local value (already ciphertext) passes
 * through unchanged and an old file's plaintext secret is sealed.
 */
export function sealVariableRows(rows: ExportRow[]): ExportRow[] {
  return rows.map((r) => {
    const secret = isSecretFlag(r.secret)
    const next: ExportRow = { ...r }
    let changed = false
    for (const c of ['value', 'initial_value'] as const) {
      const v = r[c]
      if (typeof v !== 'string') continue
      const stored = storedVariableValue(v, secret)
      if (stored !== v) {
        next[c] = stored
        changed = true
      }
    }
    return changed ? next : r
  })
}

/** Mock auth JSON column of project-file rows, credentials sealed. */
export function sealMockAuthRows(rows: ExportRow[], column: string): ExportRow[] {
  return rows.map((r) => {
    const raw = r[column]
    if (typeof raw !== 'string' || raw === '') return r
    const sealed = sealMockAuthJson(raw)
    return sealed === raw ? r : { ...r, [column]: sealed }
  })
}

/** Mock MCP `bearer_token` of project-file rows, sealed. */
export function sealMcpBearerRows(rows: ExportRow[]): ExportRow[] {
  return rows.map((r) => {
    const raw = r.bearer_token
    if (typeof raw !== 'string' || raw === '') return r
    const sealed = sealSecret(raw)
    return sealed === raw ? r : { ...r, bearer_token: sealed }
  })
}

// ─── Status ──────────────────────────────────────────────────────

export interface SecretStorageStatus {
  /** Secrets are encrypted with an OS-protected key. */
  encrypted: boolean
  /** Linux only: the safeStorage backend (`basic_text` = hard-coded key, not protected). */
  backend?: string
}

/**
 * Whether values marked secret are really protected at rest. On Linux
 * safeStorage may report "available" with the `basic_text` backend, whose key
 * is hard-coded — that counts as unencrypted for the UI note.
 */
export function secretStorageStatus(): SecretStorageStatus {
  const available = isEncryptionAvailable()
  let backend: string | undefined
  if (process.platform === 'linux') {
    try {
      backend = safeStorage.getSelectedStorageBackend()
    } catch {
      backend = undefined
    }
  }
  return { encrypted: available && backend !== 'basic_text', ...(backend ? { backend } : {}) }
}
