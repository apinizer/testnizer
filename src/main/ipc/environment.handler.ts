import { ipcMain } from 'electron'
import * as envRepo from '../db/environment.repo'

export function registerEnvironmentHandlers(): void {
  // ─── Environments ────────────────────────────────────────

  ipcMain.handle('environment:list', async (_event, workspaceId: string) => {
    try {
      const data = envRepo.getEnvironmentsByWorkspace(workspaceId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('environment:listByProject', async (_event, projectId: string) => {
    try {
      const data = envRepo.getEnvironmentsByProject(projectId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('environment:get', async (_event, id: string) => {
    try {
      const data = envRepo.getEnvironmentById(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('environment:create', async (_event, payload: {
    workspace_id: string
    project_id?: string | null
    name: string
    is_active?: boolean
  }) => {
    try {
      const data = envRepo.createEnvironment(payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('environment:update', async (_event, id: string, payload: {
    name?: string
    is_active?: boolean
  }) => {
    try {
      const data = envRepo.updateEnvironment(id, payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('environment:setActive', async (_event, workspaceId: string, environmentId: string) => {
    try {
      envRepo.setActiveEnvironment(workspaceId, environmentId)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('environment:setActiveForProject', async (_event, projectId: string, environmentId: string) => {
    try {
      envRepo.setActiveEnvironmentForProject(projectId, environmentId)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('environment:delete', async (_event, id: string) => {
    try {
      const data = envRepo.deleteEnvironment(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Environment Variables ───────────────────────────────

  ipcMain.handle('envVariable:list', async (_event, environmentId: string) => {
    try {
      const data = envRepo.getVariablesByEnvironment(environmentId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('envVariable:create', async (_event, payload: {
    environment_id: string
    key: string
    value: string
    description?: string
    enabled?: boolean
    secret?: boolean
    initial_value?: string
  }) => {
    try {
      const data = envRepo.createVariable(payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('envVariable:update', async (_event, id: string, payload: {
    key?: string
    value?: string
    description?: string
    enabled?: boolean
    secret?: boolean
    initial_value?: string
  }) => {
    try {
      const data = envRepo.updateVariable(id, payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('envVariable:delete', async (_event, id: string) => {
    try {
      const data = envRepo.deleteVariable(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Global Variables ────────────────────────────────────

  ipcMain.handle('globalVariable:list', async (_event, workspaceId: string) => {
    try {
      const data = envRepo.getGlobalVariables(workspaceId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('globalVariable:listByProject', async (_event, projectId: string) => {
    try {
      const data = envRepo.getGlobalVariablesByProject(projectId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('globalVariable:create', async (_event, payload: {
    workspace_id: string
    project_id?: string | null
    key: string
    value: string
    description?: string
    enabled?: boolean
    secret?: boolean
    initial_value?: string
  }) => {
    try {
      const data = envRepo.createGlobalVariable(payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('globalVariable:update', async (_event, id: string, payload: {
    key?: string
    value?: string
    description?: string
    enabled?: boolean
    secret?: boolean
    initial_value?: string
  }) => {
    try {
      const data = envRepo.updateGlobalVariable(id, payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('globalVariable:delete', async (_event, id: string) => {
    try {
      const data = envRepo.deleteGlobalVariable(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
