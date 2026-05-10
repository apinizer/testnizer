import { create } from 'zustand'
import type { SaveHistoryEntry } from '../types'

interface GitBranch {
  name: string
  current: boolean
  isRemote: boolean
}

export interface ConflictStats {
  endpoints: number
  savedRequests: number
  folders: number
  testSuites: number
  mockServers: number
  mockEndpoints: number
  environments: number
  certificates: number
  parsable: boolean
}

export interface ConflictEntry {
  file: string
  stats: { ours: ConflictStats; theirs: ConflictStats }
}

export interface ConflictContext {
  projectId: string
  origin: 'merge' | 'pull'
  sourceBranch?: string
  currentBranch: string
  conflicts: ConflictEntry[]
}

type Resolution = { success: boolean; error?: string; conflict?: ConflictContext }

interface BranchStore {
  branches: GitBranch[]
  currentBranch: string
  hasGit: boolean
  loading: boolean

  // Legacy compat
  activeBranchId: string | null
  saveHistory: SaveHistoryEntry[]

  // In-flight merge/pull conflict for the renderer to resolve. Cleared when
  // the user picks a side or aborts.
  pendingConflict: ConflictContext | null

  checkGitConfig: (projectId: string) => Promise<void>
  fetchBranches: (projectId: string) => Promise<void>
  ensureDefault: (projectId: string) => Promise<void>
  createBranch: (projectId: string, name: string, baseBranch?: string) => Promise<boolean>
  switchBranch: (projectId: string, branchName: string) => Promise<boolean>
  mergeBranch: (projectId: string, sourceBranch: string) => Promise<Resolution>
  pushBranch: (projectId: string) => Promise<{ success: boolean; error?: string }>
  pullBranch: (projectId: string) => Promise<Resolution>
  deleteBranch: (
    projectId: string,
    branchName: string,
  ) => Promise<{ success: boolean; error?: string }>
  resolveConflict: (
    file: string,
    side: 'ours' | 'theirs',
  ) => Promise<{ success: boolean; error?: string; complete: boolean }>
  abortConflict: () => Promise<{ success: boolean; error?: string }>
  setActiveBranch: (id: string) => void
  getActiveBranch: () => { id: string; name: string; is_default: number } | null
  fetchSaveHistory: (projectId: string) => Promise<void>
}

const api = () =>
  (window as unknown as Record<string, unknown>).api as Record<
    string,
    Record<
      string,
      (...args: unknown[]) => Promise<{ success: boolean; data?: unknown; error?: string }>
    >
  >

export const useBranchStore = create<BranchStore>((set, get) => ({
  branches: [],
  currentBranch: 'main',
  hasGit: false,
  loading: false,
  activeBranchId: null,
  saveHistory: [],
  pendingConflict: null,

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
      } catch {
        /* */
      }
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
    } catch {
      /* offline */
    }
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
      } catch {
        return false
      }
    }

    try {
      const result = await api().git.createBranch({ projectId, branchName: name, baseBranch })
      if (result?.success) {
        await get().fetchBranches(projectId)
        return true
      }
      return false
    } catch {
      return false
    }
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
    } catch {
      return false
    }
  },

  mergeBranch: async (projectId, sourceBranch) => {
    try {
      const result = await api().git.merge({ projectId, sourceBranch })
      if (result?.success) {
        const data = result.data as {
          state: 'clean' | 'conflicted'
          conflicts?: ConflictEntry[]
          currentBranch: string
        }
        if (data.state === 'conflicted' && data.conflicts) {
          const conflict: ConflictContext = {
            projectId,
            origin: 'merge',
            sourceBranch,
            currentBranch: data.currentBranch,
            conflicts: data.conflicts,
          }
          set({ pendingConflict: conflict })
          return { success: false, conflict, error: 'Conflict needs resolution' }
        }
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
        const data = result.data as {
          state?: 'clean' | 'conflicted'
          conflicts?: ConflictEntry[]
          branch?: string
        }
        if (data.state === 'conflicted' && data.conflicts) {
          const conflict: ConflictContext = {
            projectId,
            origin: 'pull',
            currentBranch: data.branch ?? get().currentBranch,
            conflicts: data.conflicts,
          }
          set({ pendingConflict: conflict })
          return { success: false, conflict, error: 'Conflict needs resolution' }
        }
        await get().fetchBranches(projectId)
        return { success: true }
      }
      return { success: false, error: result?.error || 'Pull failed' }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },

  resolveConflict: async (file, side) => {
    const conflict = get().pendingConflict
    if (!conflict) return { success: false, error: 'No conflict in progress', complete: false }
    try {
      const result = await api().git.resolveConflict({
        projectId: conflict.projectId,
        file,
        side,
      })
      if (!result?.success) {
        return {
          success: false,
          error: result?.error || 'Resolve failed',
          complete: false,
        }
      }
      const data = result.data as { stillConflicted: boolean; remainingConflicts: string[] }
      if (!data.stillConflicted) {
        // All conflicts resolved — clear the pending state and refresh.
        set({ pendingConflict: null })
        await get().fetchBranches(conflict.projectId)
        return { success: true, complete: true }
      }
      // Some files still conflicted — drop the resolved file from the list.
      const remaining = conflict.conflicts.filter((c) => data.remainingConflicts.includes(c.file))
      set({
        pendingConflict: { ...conflict, conflicts: remaining },
      })
      return { success: true, complete: false }
    } catch (e) {
      return { success: false, error: (e as Error).message, complete: false }
    }
  },

  abortConflict: async () => {
    const conflict = get().pendingConflict
    if (!conflict) return { success: true }
    try {
      const result = await api().git.abortMerge(conflict.projectId)
      set({ pendingConflict: null })
      if (!result?.success) return { success: false, error: result?.error || 'Abort failed' }
      await get().fetchBranches(conflict.projectId)
      return { success: true }
    } catch (e) {
      set({ pendingConflict: null })
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
    } catch {
      /* */
    }
  },
}))
