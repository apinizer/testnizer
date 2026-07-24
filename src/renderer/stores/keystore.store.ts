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
