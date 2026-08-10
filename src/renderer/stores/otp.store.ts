import { create } from 'zustand'
import type { OtpEntry, OtpCode, OtpDraft, OtpAddInput } from '../types'

const api = window.api.otp

async function unwrap<T>(p: Promise<{ success: boolean; data?: T; error?: string }>): Promise<T> {
  const r = await p
  if (!r.success || r.data === undefined) throw new Error(r.error ?? 'IPC error')
  return r.data as T
}

export interface OtpState {
  entries: OtpEntry[]
  codesById: Record<string, OtpCode>
  selectedId: string | null
  error: string | null

  load: () => Promise<void>
  refreshCodes: () => Promise<void>
  add: (input: OtpAddInput) => Promise<OtpEntry | null>
  update: (id: string, patch: OtpAddInput) => Promise<void>
  remove: (id: string) => Promise<void>
  select: (id: string | null) => void
  /** Advance an HOTP counter and refresh its code. */
  generateNext: (id: string) => Promise<void>
  parseUri: (uri: string) => Promise<OtpDraft | null>
  reveal: (id: string) => Promise<string | null>
  /** otpauth:// URI (secret-bearing) for rendering a QR to scan into a phone. */
  getUri: (id: string) => Promise<string | null>
}

export const useOtpStore = create<OtpState>((set, get) => ({
  entries: [],
  codesById: {},
  selectedId: null,
  error: null,

  load: async () => {
    try {
      const entries = (await unwrap(api.list())) as OtpEntry[]
      const selectedId =
        get().selectedId && entries.some((e) => e.id === get().selectedId)
          ? get().selectedId
          : (entries[0]?.id ?? null)
      set({ entries, selectedId, error: null })
      await get().refreshCodes()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  refreshCodes: async () => {
    try {
      const codes = (await unwrap(api.codes())) as OtpCode[]
      const codesById: Record<string, OtpCode> = {}
      for (const c of codes) codesById[c.id] = c
      set({ codesById })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  add: async (input) => {
    try {
      const entry = (await unwrap(api.add(input))) as OtpEntry
      set({ error: null })
      await get().load()
      set({ selectedId: entry.id })
      return entry
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },

  update: async (id, patch) => {
    try {
      await unwrap(api.update({ ...patch, id }))
      set({ error: null })
      await get().load()
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  remove: async (id) => {
    try {
      await unwrap(api.delete(id))
      const remaining = get().entries.filter((e) => e.id !== id)
      set({
        entries: remaining,
        selectedId: get().selectedId === id ? (remaining[0]?.id ?? null) : get().selectedId,
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  select: (id) => set({ selectedId: id }),

  generateNext: async (id) => {
    try {
      const code = (await unwrap(api.code(id))) as OtpCode
      set((s) => ({ codesById: { ...s.codesById, [id]: code } }))
      // Reload so the persisted counter is reflected in the entry list.
      const entries = (await unwrap(api.list())) as OtpEntry[]
      set({ entries })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  parseUri: async (uri) => {
    try {
      return (await unwrap(api.parseUri(uri))) as OtpDraft
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },

  reveal: async (id) => {
    try {
      return (await unwrap(api.reveal(id))) as string
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },

  getUri: async (id) => {
    try {
      return (await unwrap(api.uri(id))) as string
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
  },
}))
