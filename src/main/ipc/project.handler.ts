import { ipcMain } from 'electron'
import * as projectRepo from '../db/project.repo'

export function registerProjectHandlers(): void {
  ipcMain.handle('project:list', async (_event, workspaceId: string) => {
    try {
      const data = projectRepo.getProjectsByWorkspace(workspaceId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('project:get', async (_event, id: string) => {
    try {
      const data = projectRepo.getProjectById(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('project:create', async (_event, payload: {
    workspace_id: string
    name: string
    description?: string
    type?: string
    save_mode?: string
    local_path?: string
    icon_emoji?: string
    icon_color?: string
  }) => {
    try {
      const data = projectRepo.createProject(payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('project:update', async (_event, id: string, payload: {
    name?: string
    description?: string
    type?: string
    save_mode?: string
    local_path?: string | null
    icon_emoji?: string | null
    icon_color?: string | null
    sort_order?: number
  }) => {
    try {
      const data = projectRepo.updateProject(id, payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('project:delete', async (_event, id: string) => {
    try {
      const data = projectRepo.deleteProject(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Folders ─────────────────────────────────────────────

  ipcMain.handle('folder:list', async (_event, projectId: string) => {
    try {
      const data = projectRepo.getFoldersByProject(projectId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('folder:create', async (_event, payload: {
    project_id: string
    parent_id?: string | null
    name: string
  }) => {
    try {
      const data = projectRepo.createFolder(payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('folder:update', async (_event, id: string, payload: {
    name?: string
    parent_id?: string | null
    sort_order?: number
  }) => {
    try {
      const data = projectRepo.updateFolder(id, payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('folder:delete', async (_event, id: string) => {
    try {
      const data = projectRepo.deleteFolder(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
