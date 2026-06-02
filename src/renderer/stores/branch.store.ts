import { create } from 'zustand'
import type { SaveHistoryEntry } from '../types'

interface GitBranch {
  /** DB row id (UUID) for legacy non-git branches. Absent for synthetic
   *  rows (e.g. the always-materialised default 'main') and git branches,
   *  which are addressed by name. */
  id?: string
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

// Discriminated union — callers can `if (r.success)` for the happy path and,
// on failure, narrow further via `'conflict' in r` vs `'error' in r` instead
// of optional-chaining gymnastics.
export type Resolution =
  | { success: true }
  | { success: false; conflict: ConflictContext }
  | { success: false; error: string }

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
    commitMessage?: string,
  ) => Promise<{ success: boolean; error?: string; complete: boolean }>
  abortConflict: () => Promise<{ success: boolean; error?: string }>
  // Clear any in-flight conflict context. Called by the project switcher so
  // a stale conflict from project A doesn't bleed into project B's UI.
  clearPendingConflict: () => void
  setActiveBranch: (id: string) => void
  getActiveBranch: () => { id: string; name: string; is_default: number } | null
  /** Branch scope key for tree content: null on the default branch, else the
   *  active branch name. Used to stamp + filter folders/endpoints (#8). */
  getActiveBranchScope: () => string | null
  fetchSaveHistory: (projectId: string) => Promise<void>
}

const api = () => window.api

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
      // Fallback to legacy DB branches. The DB list may not include `main`
      // for older projects that pre-date the default-branch seeding (B1) —
      // synthesize it so the BranchesPane always renders the default and
      // exactly one row is flagged `current`.
      try {
        const result = await api().branch.list(projectId)
        if (result?.success && result.data) {
          const dbBranches = result.data
          const defaultBranch = dbBranches.find((b) => b.is_default)
          const previous = get().currentBranch
          // Pick the active branch: prefer the previously-selected name if it
          // still exists, otherwise fall back to the default, otherwise 'main'.
          const activeName =
            dbBranches.find((b) => b.name === previous)?.name || defaultBranch?.name || 'main'
          const namesSeen = new Set<string>()
          const branches: GitBranch[] = []
          for (const b of dbBranches) {
            if (namesSeen.has(b.name)) continue
            namesSeen.add(b.name)
            branches.push({
              id: b.id,
              name: b.name,
              current: b.name === activeName,
              isRemote: false,
            })
          }
          // Always materialise the default 'main' row if missing.
          if (!namesSeen.has('main')) {
            branches.unshift({
              name: 'main',
              current: activeName === 'main',
              isRemote: false,
            })
          }
          set({
            branches,
            currentBranch: activeName,
            activeBranchId: activeName,
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
    // For non-git projects, seed the `main` row in the DB so older projects
    // that pre-date branch-seeding still show `main` in the Branches modal (B1).
    if (!get().hasGit) {
      try {
        await api().branch.ensureDefault(projectId)
      } catch {
        /* best effort — fetchBranches still synthesizes main if missing */
      }
    }
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
      // Legacy — flip current flag on every branch so exactly one is active.
      // Without rewriting the array, the previous "current" row from the
      // initial fetch would stay marked, producing the double-active badge
      // in the Branches pane (B1).
      const branches = get().branches.map((b) => ({ ...b, current: b.name === branchName }))
      set({ branches, currentBranch: branchName, activeBranchId: branchName })
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
          return { success: false, conflict }
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
          return { success: false, conflict }
        }
        await get().fetchBranches(projectId)
        return { success: true }
      }
      return { success: false, error: result?.error || 'Pull failed' }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },

  resolveConflict: async (file, side, commitMessage) => {
    const conflict = get().pendingConflict
    if (!conflict) return { success: false, error: 'No conflict in progress', complete: false }
    try {
      const result = await api().git.resolveConflict({
        projectId: conflict.projectId,
        file,
        side,
        commitMessage,
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

  clearPendingConflict: () => set({ pendingConflict: null }),

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
        // Find branch by name; the IPC layer deletes by row id (UUID), not by
        // name. Previously this passed the NAME — getBranchById(name) returned
        // undefined so the repo's delete short-circuited, yet the store
        // ignored the failed result and returned success anyway, so the UI
        // showed "deleted" while the branch stayed (issue #35).
        const br = get().branches.find((b) => b.name === branchName)
        if (!br) return { success: false, error: 'Branch not found' }
        if (!br.id) return { success: false, error: 'Cannot delete this branch' }
        const res = (await api().branch.delete(br.id)) as { success: boolean; error?: string }
        if (res && res.success === false) {
          return { success: false, error: res.error || 'Delete failed' }
        }
        await get().fetchBranches(projectId)
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

  // Branch scope key for tree content (issue #8). The default branch maps to
  // `null` ("shared" — content visible on every branch); a non-default branch
  // maps to its name, which is what new content on that branch is stamped with
  // and what the tree filters on. Using the branch name keeps it consistent
  // for both git and legacy projects without a separate id lookup.
  getActiveBranchScope: () => {
    const ab = get().getActiveBranch()
    return ab && ab.is_default ? null : (ab?.id ?? null)
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
