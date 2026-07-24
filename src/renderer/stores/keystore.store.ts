import { create } from 'zustand'
import type {
  KeystoreMeta,
  KeystoreAliasDetail,
  KeystoreLibraryEntry,
  KeystorePickFileResult,
  KeystoreWriteResult,
} from '../types'

/**
 * Keystore Studio renderer store (Faz B1 — read-only viewer + Model B library).
 *
 * SECURITY INVARIANT: this store holds only a `sessionId` handle plus **safe,
 * public** metadata (alias summaries, certificate chain info, library rows).
 * The keystore bytes, the store/entry passwords, and any private-key material
 * live ONLY in the main process (keyed by `sessionId`). Passwords typed by the
 * user are forwarded straight to the IPC layer and never retained in state.
 */

/**
 * Bridge accessor. Returns `undefined` when the preload bridge is missing — the
 * classic case is a dev HMR reload where the renderer refreshed but the running
 * app still has an OLDER preload (window.api.keystore not present yet), or any
 * future partial load. Every action guards on this so a bridge mismatch DEGRADES
 * GRACEFULLY instead of throwing "Cannot read properties of undefined".
 */
function ks(): typeof window.api.keystore | undefined {
  return window.api?.keystore
}

const BRIDGE_UNAVAILABLE = 'keystore bridge unavailable'

async function unwrap<T>(p: Promise<{ success: boolean; data?: T; error?: string }>): Promise<T> {
  const r = await p
  if (!r.success || r.data === undefined) throw new Error(r.error ?? 'IPC error')
  return r.data as T
}

/**
 * Renderer-side generate inputs. `sessionId` is added by the store from the
 * open session — callers pass only the field set collected by the dialogs.
 * These mirror the preload payloads minus `sessionId` (§9.5 field sets).
 */
export interface GenerateKeyPairInput {
  alias: string
  keyAlgorithm?: string
  keySize?: number
  curve?: string
  subjectDN?: string
  subjectAlternativeNames?: string[]
  validityDays?: number
  serialNumber?: string
  keyUsage?: string[]
  basicConstraintsCa?: boolean
  signatureAlgorithm?: string
  entryPassword?: string
}

export interface GenerateSecretKeyInput {
  alias: string
  keyAlgorithm?: string
  keySize?: number
  entryPassword?: string
}

/**
 * Import inputs (Faz B3). `sessionId` is injected by the store from the open
 * session — callers pass only the field set collected by ImportDialog (§9.5).
 *
 * ADDITIVE-INPUT invariant: a PKCS12 source comes from a FILE (a `sourcePath`
 * read in MAIN, or `sourceBytes` for programmatic callers); the three PEM paths
 * take PASTED text (private key / combined PEM / trusted-cert content). Both
 * routes are honored — the dialog never forces a file for the paste paths.
 *
 * No `entryPassword` field: like the generate actions, per-entry passwords are
 * deferred to Faz B4 (the parse/open path only decrypts with the store
 * password, so a distinct entry password would make the entry undecryptable on
 * reopen). Imported entries are protected with the store password.
 */
export interface ImportPkcs12Input {
  /** Source file path — read in MAIN (native picker). */
  sourcePath?: string
  /** base64-encoded source bytes — programmatic/test callers only. */
  sourceBytes?: string
  sourcePassword?: string
  /** Blank ⇒ import ALL importable entries from the source. */
  sourceAlias?: string
  /** Target alias override (single-entry copy). */
  alias?: string
}

export interface ImportKeyMaterialInput {
  alias: string
  privateKeyPem: string
  certificatePem: string
}

export interface ImportPemInput {
  alias: string
  pemContent: string
}

export interface ImportTrustedCertInput {
  alias: string
  certificateContent: string
}

// ── Faz B4 renderer inputs (Edit / Export / Convert / Persist) ────────────────
// `sessionId` is injected by the store from the open session — callers pass only
// the field set collected by the dialogs (§9.5).

export interface RenameAliasInput {
  alias: string
  newAlias: string
  /** Current key-entry password when it differs from the store password (§3.1). */
  entryPassword?: string
}

export interface ChangeStorePasswordInput {
  newPassword: string
  /** Per-alias CURRENT key passwords for entries whose pw differs from the store
   * pw — main reads each key with these before re-encrypting under `newPassword`. */
  aliasEntryPasswords?: Record<string, string>
}

export interface SetEntryPasswordInput {
  alias: string
  /** Current entry password (omitted ⇒ falls back to the store password). */
  entryPassword?: string
  newEntryPassword: string
}

export interface ExportCertificateInput {
  alias: string
  /** DER | PEM | PKCS7 | PKIPATH — omitted ⇒ PEM (design §4.14 default). */
  format?: string
}

export interface ConvertInput {
  targetType: string
  newPassword: string
  /** Current key-entry password when it differs from the store password. */
  entryPassword?: string
  /** Per-alias CURRENT key passwords (symmetric with changeStorePassword) —
   * resolves ahead of the scalar `entryPassword` for entries under different pws. */
  aliasEntryPasswords?: Record<string, string>
}

/**
 * A recovery-blocked open (FIX 1): the store password validated, but one or more
 * KEY entries are protected with a password ≠ the store password, so the parse
 * could not decrypt them. We stash enough to RE-invoke the same open (the source
 * — a `path` OR base64 `bytes` — plus the type/store password) once the user has
 * supplied each locked alias's entry password. NO key material or store password
 * is ever surfaced to the UI beyond what the user typed; the store password held
 * here is the same value the user just entered to open and is forwarded straight
 * back to the IPC layer on retry.
 */
export interface PendingEntryPasswordOpen {
  /** Re-open source — a picked file path OR base64 bytes (programmatic callers). */
  source: { path: string } | { bytes: string }
  /** Display name carried through to the reopened session. */
  fileName: string
  type?: string
  /** The store password the user already supplied (forwarded verbatim on retry). */
  storePassword?: string
  /** The KEY aliases whose entry password is required. */
  aliases: string[]
}

/** Extract the alias(es) named by one or more §8 "Cannot recover key entry '…'"
 * recovery messages. The engine throws on the FIRST unrecoverable key, so this is
 * usually a single alias — the loop future-proofs a multi-alias message. */
function parseRecoveryAliases(message: string): string[] {
  const aliases: string[] = []
  const re = /Cannot recover key entry '([^']+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(message)) !== null) aliases.push(m[1])
  return aliases
}

export interface KeystoreState {
  /** Opaque main-process handle. `null` = empty state (no keystore open). */
  sessionId: string | null
  /** Safe alias/type metadata for the open session. */
  meta: KeystoreMeta | null
  /** Display name for the open session (file name or library entry name). */
  fileName: string | null
  /** Whether the open session originated from a saved library entry. */
  libraryId: string | null
  /** Saved keystore library rows (metadata only — never blob/password). */
  library: KeystoreLibraryEntry[]
  /** Alias whose certificate detail is currently displayed. */
  selectedAlias: string | null
  /** Certificate chain detail for `selectedAlias` (public material only). */
  aliasDetail: KeystoreAliasDetail | null
  /**
   * Unsaved-changes flag (design §9.7 dirty-guard). Set `true` after any B2/B3/B4
   * mutation, cleared on Save-As / library save. Drives the tool-tab close +
   * app-quit guards. Mirrors `meta.dirty` but is hoisted to the top level so the
   * guard can read it without a null-check on `meta`.
   */
  dirty: boolean
  loading: boolean
  error: string | null
  /**
   * Set when an open failed because a KEY entry's password ≠ the store password
   * (FIX 1). The UI prompts for each locked alias and calls
   * `retryOpenWithEntryPasswords`. `null` when no such prompt is pending.
   */
  pendingEntryPasswordOpen: PendingEntryPasswordOpen | null

  /** Native file picker → returns pick result, or `null` on cancel/no-op. */
  pickFile: () => Promise<KeystorePickFileResult | null>
  /**
   * Open a picked keystore file into a new session. When a key entry's password
   * differs from the store password, the raw open fails with a §8 recovery error;
   * rather than surface it, the store parses the offending alias(es) and sets
   * `pendingEntryPasswordOpen` so the UI can collect them and retry. Pass
   * `aliasEntryPasswords` directly to skip the prompt (programmatic callers).
   */
  openFile: (payload: {
    path: string
    fileName: string
    password?: string
    type?: string
    aliasEntryPasswords?: Record<string, string>
  }) => Promise<boolean>
  /**
   * Retry a `pendingEntryPasswordOpen` with the per-alias entry passwords the user
   * supplied. Clears the pending prompt on success; on another recovery failure it
   * keeps the prompt open and surfaces the error.
   */
  retryOpenWithEntryPasswords: (map: Record<string, string>) => Promise<boolean>
  /** Dismiss a pending entry-password prompt without opening. */
  cancelPendingOpen: () => void
  /** Create a fresh empty keystore session. */
  createNew: (payload?: { type?: string; password?: string }) => Promise<boolean>
  /**
   * Generate a key pair + self-signed X.509v3 certificate into the CURRENT
   * session, then refresh `meta` from the returned safe summary. The private
   * key never leaves main — only public metadata comes back.
   */
  generateKeyPair: (opts: GenerateKeyPairInput) => Promise<boolean>
  /**
   * Generate an AES secret key into the CURRENT session (PKCS12-only), then
   * refresh `meta`. Raw key bytes never leave main.
   */
  generateSecretKey: (opts: GenerateSecretKeyInput) => Promise<boolean>
  /**
   * Import entries from a source PKCS12 (copyEntry) into the CURRENT session,
   * then refresh `meta`. The source bytes are read/parsed in MAIN; nothing
   * secret round-trips back.
   */
  importPkcs12: (opts: ImportPkcs12Input) => Promise<boolean>
  /**
   * Import a private key + certificate chain (PKCS#8 / OpenSSL / SEC1) into the
   * CURRENT session. Main enforces the key-cert match gate before mutating.
   */
  importKeyMaterial: (opts: ImportKeyMaterialInput) => Promise<boolean>
  /**
   * Import a pasted PEM block into the CURRENT session (key+cert ⇒ key entry;
   * cert-only ⇒ trusted entry). Parsed in MAIN.
   */
  importPem: (opts: ImportPemInput) => Promise<boolean>
  /** Import a trusted certificate (PEM or base64 DER) into the CURRENT session. */
  importTrustedCert: (opts: ImportTrustedCertInput) => Promise<boolean>
  /**
   * Rename an alias in the CURRENT session (key vs certificate branch handled in
   * main). A key entry whose password differs from the store password needs its
   * `entryPassword`. Sets `dirty` on success.
   */
  renameAlias: (opts: RenameAliasInput) => Promise<boolean>
  /**
   * Rotate the store password — main re-encrypts every key entry under the new
   * password (atomic: verified recoverable first). Sets `dirty` on success.
   */
  changeStorePassword: (opts: ChangeStorePasswordInput) => Promise<boolean>
  /**
   * Set (rotate) a single key entry's password. Key entries only — main rejects a
   * certificate entry. Sets `dirty` on success.
   */
  setEntryPassword: (opts: SetEntryPasswordInput) => Promise<boolean>
  /** Delete an entry by alias from the CURRENT session. Sets `dirty` on success. */
  deleteEntry: (alias: string) => Promise<boolean>
  /**
   * Export an alias's PUBLIC certificate(s) to a user-picked file (DER/PEM/PKCS7/
   * PKIPATH). Main validates alias/format BEFORE opening the save dialog and
   * writes disk-to-disk; the renderer only learns `{path}` or `{canceled}`. Does
   * NOT affect `dirty` (a read-only export).
   */
  exportCertificate: (opts: ExportCertificateInput) => Promise<KeystoreWriteResult | null>
  /**
   * Convert the current keystore to the other type (JKS ⇄ PKCS12) into a NEW
   * session (the original is untouched in main). The store swaps to the new
   * session and marks it `dirty` (unsaved) — the converted bytes exist only in
   * memory until Save-As.
   */
  convert: (opts: ConvertInput) => Promise<boolean>
  /**
   * Save-As (Model A): serialize the current session and write it to a
   * user-picked path (native save dialog in main). Clears `dirty` ONLY on a real
   * write; a cancelled dialog leaves `dirty` untouched.
   */
  saveAs: (opts?: { suggestedName?: string }) => Promise<KeystoreWriteResult | null>
  /** Open a saved library entry into a session (password re-entered if not remembered). */
  openFromLibrary: (payload: { id: string; name: string; password?: string }) => Promise<boolean>
  /** Persist the current session to the Model B library. */
  saveToLibrary: (payload: { name: string; rememberPassword?: boolean }) => Promise<boolean>
  /** Delete a saved library entry. */
  deleteFromLibrary: (id: string) => Promise<void>
  /** Dispose the open main-process session and reset to empty state. */
  closeSession: () => Promise<void>
  /** Refresh the library list. */
  loadLibrary: () => Promise<void>
  /** Load the certificate chain detail for one alias. */
  loadAliasDetail: (alias: string) => Promise<KeystoreAliasDetail | null>
  /** Clear the currently shown alias detail. */
  clearAliasDetail: () => void
  clearError: () => void
}

function fail(set: (p: Partial<KeystoreState>) => void, e: unknown): false {
  set({ error: e instanceof Error ? e.message : String(e), loading: false })
  return false
}

export const useKeystoreStore = create<KeystoreState>((set, get) => ({
  sessionId: null,
  meta: null,
  fileName: null,
  libraryId: null,
  library: [],
  selectedAlias: null,
  aliasDetail: null,
  dirty: false,
  loading: false,
  error: null,
  pendingEntryPasswordOpen: null,

  pickFile: async () => {
    const bridge = ks()
    if (!bridge) {
      set({ error: BRIDGE_UNAVAILABLE })
      return null
    }
    try {
      const r = await bridge.pickFile()
      if (!r.success) {
        // Dialog cancel is a no-op, not an error surface.
        if (r.error && r.error !== 'Cancelled') set({ error: r.error })
        return null
      }
      return r.data ?? null
    } catch (e) {
      fail(set, e)
      return null
    }
  },

  openFile: async ({ path, fileName, password, type, aliasEntryPasswords }) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      const { sessionId, meta } = await unwrap(
        bridge.open({ path, password, type, aliasEntryPasswords }),
      )
      set({
        sessionId,
        meta,
        fileName,
        libraryId: null,
        selectedAlias: null,
        aliasDetail: null,
        dirty: false,
        loading: false,
        pendingEntryPasswordOpen: null,
      })
      return true
    } catch (e) {
      // A §8 recovery failure means a KEY entry's password ≠ the store password.
      // Instead of surfacing a cryptic error, stash the offending alias(es) so the
      // UI can prompt for each and retry (FIX 1). Any other error surfaces as-is.
      const msg = e instanceof Error ? e.message : String(e)
      const aliases = parseRecoveryAliases(msg)
      if (aliases.length > 0) {
        set({
          loading: false,
          error: null,
          pendingEntryPasswordOpen: {
            source: { path },
            fileName,
            type,
            storePassword: password,
            aliases,
          },
        })
        return false
      }
      return fail(set, e)
    }
  },

  retryOpenWithEntryPasswords: async (map) => {
    const bridge = ks()
    const pending = get().pendingEntryPasswordOpen
    if (!bridge || !pending) return false
    set({ loading: true, error: null })
    try {
      const base = {
        password: pending.storePassword,
        type: pending.type,
        aliasEntryPasswords: map,
      }
      const payload =
        'path' in pending.source
          ? { ...base, path: pending.source.path }
          : { ...base, bytes: pending.source.bytes }
      const { sessionId, meta } = await unwrap(bridge.open(payload))
      set({
        sessionId,
        meta,
        fileName: pending.fileName,
        libraryId: null,
        selectedAlias: null,
        aliasDetail: null,
        dirty: false,
        loading: false,
        pendingEntryPasswordOpen: null,
      })
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const aliases = parseRecoveryAliases(msg)
      // Keep the prompt open on a repeat recovery failure (wrong entry pw); refresh
      // the alias list if the message named different aliases.
      set({
        loading: false,
        error: msg,
        ...(aliases.length > 0 ? { pendingEntryPasswordOpen: { ...pending, aliases } } : {}),
      })
      return false
    }
  },

  cancelPendingOpen: () => set({ pendingEntryPasswordOpen: null, error: null }),

  createNew: async (payload) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      const { sessionId, meta } = await unwrap(bridge.createNew(payload ?? {}))
      set({
        sessionId,
        meta,
        fileName: null,
        libraryId: null,
        selectedAlias: null,
        aliasDetail: null,
        dirty: false,
        loading: false,
      })
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

  generateKeyPair: async (opts) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    const sessionId = get().sessionId
    if (!sessionId) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      // Generate MUTATES the current session; the response carries the same
      // sessionId plus refreshed public meta (never key material).
      //
      // Faz B2: entryPassword is intentionally DROPPED here — generated entries
      // are protected with the store password. The engine can encrypt a bag
      // under a distinct entry password, but the parse/open path only decrypts
      // with the store password, so a per-entry password would make the entry
      // undecryptable on reopen (silent data loss). Per-entry password
      // protection lands in Faz B4 (setEntryPassword + parse-side
      // aliasEntryPasswords threading).
      const { entryPassword: _entryPasswordB4, ...safeOpts } = opts
      const { meta } = await unwrap(bridge.generateKeyPair({ sessionId, ...safeOpts }))
      set({ meta, dirty: meta.dirty ?? true, loading: false })
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

  generateSecretKey: async (opts) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    const sessionId = get().sessionId
    if (!sessionId) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      // entryPassword DROPPED (see generateKeyPair) — the secret entry is
      // protected with the store password until Faz B4 wires per-entry passwords.
      const { entryPassword: _entryPasswordB4, ...safeOpts } = opts
      const { meta } = await unwrap(bridge.generateSecretKey({ sessionId, ...safeOpts }))
      set({ meta, dirty: meta.dirty ?? true, loading: false })
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

  importPkcs12: async (opts) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    const sessionId = get().sessionId
    if (!sessionId) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      // Import MUTATES the current session; the response carries only refreshed
      // public meta (never key material / source password / source bytes).
      const { meta } = await unwrap(bridge.importPkcs12({ sessionId, ...opts }))
      set({ meta, dirty: meta.dirty ?? true, loading: false })
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

  importKeyMaterial: async (opts) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    const sessionId = get().sessionId
    if (!sessionId) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      // Main runs the deterministic key-cert match gate before mutating — a
      // mismatched pair fails with the §8 string and never enters the keystore.
      const { meta } = await unwrap(bridge.importKeyMaterial({ sessionId, ...opts }))
      set({ meta, dirty: meta.dirty ?? true, loading: false })
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

  importPem: async (opts) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    const sessionId = get().sessionId
    if (!sessionId) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      const { meta } = await unwrap(bridge.importPem({ sessionId, ...opts }))
      set({ meta, dirty: meta.dirty ?? true, loading: false })
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

  importTrustedCert: async (opts) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    const sessionId = get().sessionId
    if (!sessionId) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      const { meta } = await unwrap(bridge.importTrustedCert({ sessionId, ...opts }))
      set({ meta, dirty: meta.dirty ?? true, loading: false })
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

  renameAlias: async (opts) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    const sessionId = get().sessionId
    if (!sessionId) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      const { meta } = await unwrap(bridge.renameAlias({ sessionId, ...opts }))
      set({ meta, dirty: meta.dirty ?? true, loading: false })
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

  changeStorePassword: async (opts) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    const sessionId = get().sessionId
    if (!sessionId) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      const { meta } = await unwrap(bridge.changeStorePassword({ sessionId, ...opts }))
      set({ meta, dirty: meta.dirty ?? true, loading: false })
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

  setEntryPassword: async (opts) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    const sessionId = get().sessionId
    if (!sessionId) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      const { meta } = await unwrap(bridge.setEntryPassword({ sessionId, ...opts }))
      set({ meta, dirty: meta.dirty ?? true, loading: false })
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

  deleteEntry: async (alias) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    const sessionId = get().sessionId
    if (!sessionId) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      const { meta } = await unwrap(bridge.deleteEntry({ sessionId, alias }))
      // If the deleted alias was the one shown in the detail dialog, clear it.
      const clear = get().selectedAlias === alias
      set({
        meta,
        dirty: meta.dirty ?? true,
        loading: false,
        ...(clear ? { selectedAlias: null, aliasDetail: null } : {}),
      })
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

  exportCertificate: async (opts) => {
    const bridge = ks()
    if (!bridge) {
      fail(set, new Error(BRIDGE_UNAVAILABLE))
      return null
    }
    const sessionId = get().sessionId
    if (!sessionId) {
      fail(set, new Error(BRIDGE_UNAVAILABLE))
      return null
    }
    try {
      // Main validates alias/format BEFORE the save dialog, writes disk-to-disk,
      // and returns ONLY {path} or {canceled}. Export is read-only ⇒ dirty
      // untouched.
      const result = await unwrap(bridge.exportCertificate({ sessionId, ...opts }))
      set({ error: null })
      return result
    } catch (e) {
      fail(set, e)
      return null
    }
  },

  convert: async (opts) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    const sessionId = get().sessionId
    if (!sessionId) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      // Convert returns a NEW session (original untouched in main). Swap to it;
      // the converted bytes are in-memory only ⇒ mark dirty (needs Save-As).
      const { sessionId: newSessionId, meta } = await unwrap(bridge.convert({ sessionId, ...opts }))
      set({
        sessionId: newSessionId,
        meta,
        libraryId: null,
        selectedAlias: null,
        aliasDetail: null,
        dirty: meta.dirty ?? true,
        loading: false,
      })
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

  saveAs: async (opts) => {
    const bridge = ks()
    if (!bridge) {
      fail(set, new Error(BRIDGE_UNAVAILABLE))
      return null
    }
    const sessionId = get().sessionId
    if (!sessionId) {
      fail(set, new Error(BRIDGE_UNAVAILABLE))
      return null
    }
    try {
      const result = await unwrap(bridge.saveAs({ sessionId, ...(opts ?? {}) }))
      // Model A: clear dirty ONLY on a real write; a cancelled dialog is a no-op.
      if ('path' in result) set({ dirty: false, error: null })
      return result
    } catch (e) {
      fail(set, e)
      return null
    }
  },

  openFromLibrary: async ({ id, name, password }) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      const { sessionId, meta } = await unwrap(bridge.libraryOpen({ id, password }))
      set({
        sessionId,
        meta,
        fileName: name,
        libraryId: id,
        selectedAlias: null,
        aliasDetail: null,
        dirty: false,
        loading: false,
      })
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

  saveToLibrary: async ({ name, rememberPassword }) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    const sessionId = get().sessionId
    if (!sessionId) return false
    try {
      const entry = await unwrap(
        bridge.librarySave({ sessionId, name, rememberPassword, id: get().libraryId ?? undefined }),
      )
      // A library save persists the current session ⇒ it is no longer dirty.
      set({ fileName: name, libraryId: entry.id, dirty: false, error: null })
      await get().loadLibrary()
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

  deleteFromLibrary: async (id) => {
    const bridge = ks()
    if (!bridge) return
    try {
      await unwrap(bridge.libraryDelete({ id }))
      set((s) => ({
        library: s.library.filter((e) => e.id !== id),
        libraryId: s.libraryId === id ? null : s.libraryId,
      }))
    } catch (e) {
      fail(set, e)
    }
  },

  closeSession: async () => {
    const bridge = ks()
    const sessionId = get().sessionId
    if (sessionId && bridge) {
      try {
        await bridge.closeSession(sessionId)
      } catch {
        // Best-effort: the main session is idle-evicted anyway.
      }
    }
    set({
      sessionId: null,
      meta: null,
      fileName: null,
      libraryId: null,
      selectedAlias: null,
      aliasDetail: null,
      dirty: false,
      error: null,
      pendingEntryPasswordOpen: null,
    })
  },

  loadLibrary: async () => {
    // Runs on mount — degrade gracefully (empty list, no error banner) if the
    // preload bridge isn't loaded yet, rather than surfacing a cryptic
    // "Cannot read properties of undefined (reading 'libraryList')".
    const bridge = ks()
    if (!bridge) {
      set({ library: [] })
      return
    }
    try {
      const library = await unwrap(bridge.libraryList())
      set({ library })
    } catch (e) {
      fail(set, e)
    }
  },

  loadAliasDetail: async (alias) => {
    const bridge = ks()
    const sessionId = get().sessionId
    if (!bridge || !sessionId) return null
    try {
      const detail = await unwrap(bridge.aliasDetail({ sessionId, alias }))
      set({ selectedAlias: alias, aliasDetail: detail, error: null })
      return detail
    } catch (e) {
      fail(set, e)
      return null
    }
  },

  clearAliasDetail: () => set({ selectedAlias: null, aliasDetail: null }),
  clearError: () => set({ error: null }),
}))
