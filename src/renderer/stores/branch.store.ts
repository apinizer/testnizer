import { create } from 'zustand'
import type { Branch, SaveHistoryEntry } from '../types'

interface BranchStore {
  branches: Branch[]
  activeBranchId: string | null
  saveHistory: SaveHistoryEntry[]

  fetchBranches: (projectId: string) => Promise<void>
  ensureDefault: (projectId: string) => Promise<void>
  createBranch: (projectId: string, name: string, parentBranchId?: string | null) => Promise<Branch | null>
  renameBranch: (id: string, name: string) => Promise<void>
  deleteBranch: (id: string, projectId: string) => Promise<void>
  setActiveBranch: (id: string) => void
  getActiveBranch: () => Branch | null
  fetchSaveHistory: (projectId: string) => Promise<void>
}

export const useBranchStore = create<BranchStore>((set, get) => ({
  branches: [],
  activeBranchId: null,
  saveHistory: [],

  fetchBranches: async (projectId) => {
    try {
      const result = await window.api?.branch?.list(projectId) as { success: boolean; data?: unknown[] }
      if (result?.success && result.data) {
        const branches = result.data as Branch[]
        set({ branches })
        // Auto-select default branch if none active
        if (!get().activeBranchId && branches.length > 0) {
          const defaultBranch = branches.find((b) => b.is_default)
          set({ activeBranchId: defaultBranch?.id || branches[0].id })
        }
      }
    } catch {
      // IPC not available
    }
  },

  ensureDefault: async (projectId) => {
    try {
      const result = await window.api?.branch?.ensureDefault(projectId) as { success: boolean; data?: Branch }
      if (result?.success && result.data) {
        await get().fetchBranches(projectId)
        if (!get().activeBranchId) {
          set({ activeBranchId: result.data.id })
        }
      }
    } catch {
      // IPC not available
    }
  },

  createBranch: async (projectId, name, parentBranchId) => {
    try {
      const result = await window.api?.branch?.create({
        project_id: projectId,
        name,
        parent_branch_id: parentBranchId ?? get().activeBranchId ?? null,
      }) as { success: boolean; data?: Branch }
      if (result?.success && result.data) {
        await get().fetchBranches(projectId)
        return result.data
      }
    } catch {
      // IPC not available
    }
    return null
  },

  renameBranch: async (id, name) => {
    try {
      await window.api?.branch?.rename(id, name)
      const branches = get().branches.map((b) =>
        b.id === id ? { ...b, name } : b
      )
      set({ branches })
    } catch {
      // IPC not available
    }
  },

  deleteBranch: async (id, projectId) => {
    try {
      const result = await window.api?.branch?.delete(id) as { success: boolean }
      if (result?.success) {
        await get().fetchBranches(projectId)
        // If deleted branch was active, switch to default
        if (get().activeBranchId === id) {
          const defaultBranch = get().branches.find((b) => b.is_default)
          set({ activeBranchId: defaultBranch?.id || get().branches[0]?.id || null })
        }
      }
    } catch {
      // IPC not available
    }
  },

  setActiveBranch: (id) => set({ activeBranchId: id }),

  getActiveBranch: () => {
    const { branches, activeBranchId } = get()
    return branches.find((b) => b.id === activeBranchId) || null
  },

  fetchSaveHistory: async (projectId) => {
    try {
      const result = await window.api?.save?.history(projectId) as { success: boolean; data?: SaveHistoryEntry[] }
      if (result?.success && result.data) {
        set({ saveHistory: result.data })
      }
    } catch {
      // IPC not available
    }
  },
}))
