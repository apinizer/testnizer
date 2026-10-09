import { ipcMain } from 'electron'
import * as workspaceRepo from '../db/workspace.repo'
import { syncRunningMocksWithDb } from './mock-runtime-sync'

export function registerWorkspaceHandlers(): void {
  ipcMain.handle('workspace:list', async () => {
    try {
      const data = workspaceRepo.getAllWorkspaces()
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('workspace:get', async (_event, id: string) => {
    try {
      const data = workspaceRepo.getWorkspaceById(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(
    'workspace:create',
    async (
      _event,
      payload: {
        name: string
        description?: string
        color?: string
      },
    ) => {
      try {
        const data = workspaceRepo.createWorkspace(payload)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle(
    'workspace:update',
    async (
      _event,
      id: string,
      payload: {
        name?: string
        description?: string
        color?: string
      },
    ) => {
      try {
        const data = workspaceRepo.updateWorkspace(id, payload)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('workspace:delete', async (_event, id: string) => {
    try {
      const data = workspaceRepo.deleteWorkspace(id)
      // The FK cascade (workspace → projects → mock rows) just removed the
      // rows of any mock server still listening; stop it (issue #154).
      await syncRunningMocksWithDb()
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
