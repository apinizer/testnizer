import { create } from 'zustand'
import type { SaveHistoryEntry } from '../types'

interface GitBranch {
  name: string
  current: boolean
  isRemote: boolean
}

interface BranchStore {
  branches: GitBranch[]
  currentBranch: string
  hasGit: boolean
  loading: boolean

  // Legacy compat
  activeBranchId: string | null
  saveHistory: SaveHistoryEntry[]

  checkGitConfig: (projectId: string) => Promise<void>
  fetchBranches: (projectId: string) => Promise<void>
  ensureDefault: (projectId: string) => Promise<void>
  createBranch: (projectId: string, name: string, baseBranch?: string) => Promise<boolean>
  switchBranch: (projectId: string, branchName: string) => Promise<boolean>
  mergeBranch: (projectId: string, sourceBranch: string) => Promise<{ success: boolean; error?: string }>
  pushBranch: (projectId: string) => Promise<{ success: boolean; error?: string }>
  pullBranch: (projectId: string) => Promise<{ success: boolean; error?: string }>
  deleteBranch: (projectId: string, branchName: string) => Promise<{ success: boolean; error?: string }>
  setActiveBranch: (id: string) => void
  getActiveBranch: () => { id: string; name: string; is_default: number } | null
  fetchSaveHistory: (projectId: string) => Promise<void>
}

const api = () => (window as Record<string, unknown>).api as Record<string, Record<string, (...args: unknown[]) => Promise<{ success: boolean; data?: unknown; error?: string }>>>

export const useBranchStore = create<BranchStore>((set, get) => ({
  branches: [],
  currentBranch: 'main',
  hasGit: false,
  loading: false,
  activeBranchId: null,
  saveHistory: [],

  checkGitConfig: async (projectId) => {
    try {
      const result = await api().git.hasConfig(projectId)
      if (result?.success) {
        const data = result.data as { hasGit: boolean }
        set({ hasGit: data.hasGit })
      }
    } catch {
      set({ hasGit: false })
    }
  },

  fetchBranches: async (projectId) => {
    const { hasGit } = get()
    if (!hasGit) {
      // Fallback to legacy DB branches
      try {
        const result = await api().branch.list(projectId)
        if (result?.success && result.data) {
          const dbBranches = result.data as { id: string; name: string; is_default: number }[]
          const branches: GitBranch[] = dbBranches.map((b, i) => ({
            name: b.name,
            current: i === 0,
            isRemote: false,
          }))
          const defaultBranch = dbBranches.find((b) => b.is_default)
          set({
            branches,
            currentBranch: defaultBranch?.name || 'main',
            activeBranchId: defaultBranch?.id || dbBranches[0]?.id || null,
          })
        }
      } catch { /* */ }
      return
    }

    set({ loading: true })
    try {
      const result = await api().git.listBranches(projectId)
      if (result?.success) {
        const data = result.data as { branches: GitBranch[]; current: string }
        set({
          branches: data.branches,
          currentBranch: data.current,
          activeBranchId: data.current,
        })
      }
    } catch { /* offline */ }
    set({ loading: false })
  },

  ensureDefault: async (projectId) => {
    await get().checkGitConfig(projectId)
    await get().fetchBranches(projectId)
  },

  createBranch: async (projectId, name, baseBranch) => {
    const { hasGit } = get()
    if (!hasGit) {
      // Legacy DB branch
      try {
        await api().branch.create({ project_id: projectId, name })
        await get().fetchBranches(projectId)
        return true
      } catch { return false }
    }

    try {
      const result = await api().git.createBranch({ projectId, branchName: name, baseBranch })
      if (result?.success) {
        await get().fetchBranches(projectId)
        return true
      }
      return false
    } catch { return false }
  },

  switchBranch: async (projectId, branchName) => {
    const { hasGit } = get()
    if (!hasGit) {
      // Legacy — just set active
      set({ currentBranch: branchName, activeBranchId: branchName })
      return true
    }

    try {
      const result = await api().git.switchBranch({ projectId, branchName })
      if (result?.success) {
        set({ currentBranch: branchName, activeBranchId: branchName })
        await get().fetchBranches(projectId)
        return true
      }
      return false
    } catch { return false }
  },

  mergeBranch: async (projectId, sourceBranch) => {
    try {
      const result = await api().git.merge({ projectId, sourceBranch })
      if (result?.success) {
        await get().fetchBranches(projectId)
        return { success: true }
      }
      return { success: false, error: result?.error || 'Merge failed' }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },

  pushBranch: async (projectId) => {
    try {
      const result = await api().git.push(projectId)
      if (result?.success) {
        return { success: true }
      }
      return { success: false, error: result?.error || 'Push failed' }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },

  pullBranch: async (projectId) => {
    try {
      const result = await api().git.pull(projectId)
      if (result?.success) {
        await get().fetchBranches(projectId)
        return { success: true }
      }
      return { success: false, error: result?.error || 'Pull failed' }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },

  deleteBranch: async (projectId, branchName) => {
    const { hasGit } = get()
    if (!hasGit) {
      // Legacy DB branch
      try {
        // Find branch by name and delete
        const branches = get().branches
        const br = branches.find((b) => b.name === branchName)
        if (br) {
          await api().branch.delete(branchName)
          await get().fetchBranches(projectId)
        }
        return { success: true }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    }

    try {
      const result = await api().git.deleteBranch({ projectId, branchName })
      if (result?.success) {
        await get().fetchBranches(projectId)
        return { success: true }
      }
      return { success: false, error: result?.error || 'Delete failed' }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },

  setActiveBranch: (id) => set({ activeBranchId: id, currentBranch: id }),

  getActiveBranch: () => {
    const { currentBranch } = get()
    return { id: currentBranch, name: currentBranch, is_default: currentBranch === 'main' ? 1 : 0 }
  },

  fetchSaveHistory: async (projectId) => {
    try {
      const result = await api().save.history(projectId)
      if (result?.success && result.data) {
        set({ saveHistory: result.data as SaveHistoryEntry[] })
      }
    } catch { /* */ }
  },
}))
