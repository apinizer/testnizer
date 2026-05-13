import { ipcMain } from 'electron'
import {
  getBranchesByProject,
  getBranchById,
  createBranch,
  renameBranch,
  deleteBranch,
  ensureDefaultBranch,
  getSaveHistory,
} from '../db/branch.repo'

export function registerBranchHandlers(): void {
  ipcMain.handle('branch:list', async (_event, projectId: string) => {
    try {
      const data = getBranchesByProject(projectId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('branch:get', async (_event, id: string) => {
    try {
      const data = getBranchById(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(
    'branch:create',
    async (
      _event,
      payload: {
        project_id: string
        name: string
        parent_branch_id?: string | null
      },
    ) => {
      try {
        const data = createBranch(payload)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('branch:rename', async (_event, id: string, name: string) => {
    try {
      const data = renameBranch(id, name)
      if (!data) return { success: false, error: 'Branch not found' }
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('branch:delete', async (_event, id: string) => {
    try {
      const ok = deleteBranch(id)
      if (!ok) return { success: false, error: 'Cannot delete default branch' }
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('branch:ensureDefault', async (_event, projectId: string) => {
    try {
      const data = ensureDefaultBranch(projectId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
