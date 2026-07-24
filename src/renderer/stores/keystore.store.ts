import { create } from 'zustand'
import type {
  KeystoreMeta,
  KeystoreAliasDetail,
  KeystoreLibraryEntry,
  KeystorePickFileResult,
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
  loading: boolean
  error: string | null

  /** Native file picker → returns pick result, or `null` on cancel/no-op. */
  pickFile: () => Promise<KeystorePickFileResult | null>
  /** Open a picked keystore file into a new session. */
  openFile: (payload: {
    path: string
    fileName: string
    password?: string
    type?: string
  }) => Promise<boolean>
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
  loading: false,
  error: null,

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

  openFile: async ({ path, fileName, password, type }) => {
    const bridge = ks()
    if (!bridge) return fail(set, new Error(BRIDGE_UNAVAILABLE))
    set({ loading: true, error: null })
    try {
      const { sessionId, meta } = await unwrap(bridge.open({ path, password, type }))
      set({
        sessionId,
        meta,
        fileName,
        libraryId: null,
        selectedAlias: null,
        aliasDetail: null,
        loading: false,
      })
      return true
    } catch (e) {
      return fail(set, e)
    }
  },

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
      set({ meta, loading: false })
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
      set({ meta, loading: false })
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
      set({ meta, loading: false })
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
      set({ meta, loading: false })
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
      set({ meta, loading: false })
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
      set({ meta, loading: false })
      return true
    } catch (e) {
      return fail(set, e)
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
      set({ fileName: name, libraryId: entry.id, error: null })
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
      error: null,
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
