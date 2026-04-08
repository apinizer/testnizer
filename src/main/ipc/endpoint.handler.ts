import { ipcMain } from 'electron'
import * as endpointRepo from '../db/endpoint.repo'

export function registerEndpointHandlers(): void {
  // ─── Endpoints ───────────────────────────────────────────

  ipcMain.handle('endpoint:listByProject', async (_event, projectId: string) => {
    try {
      const data = endpointRepo.getEndpointsByProject(projectId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('endpoint:listByFolder', async (_event, folderId: string) => {
    try {
      const data = endpointRepo.getEndpointsByFolder(folderId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('endpoint:get', async (_event, id: string) => {
    try {
      const data = endpointRepo.getEndpointById(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('endpoint:create', async (_event, payload: {
    project_id: string
    folder_id?: string | null
    name: string
    description?: string
    protocol?: string
    method?: string
    path: string
    status?: string
    request_schema?: string
    response_schemas?: string
  }) => {
    try {
      const data = endpointRepo.createEndpoint(payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('endpoint:update', async (_event, id: string, payload: {
    name?: string
    description?: string
    folder_id?: string | null
    protocol?: string
    method?: string
    path?: string
    status?: string
    request_schema?: string
    response_schemas?: string
    sort_order?: number
  }) => {
    try {
      const data = endpointRepo.updateEndpoint(id, payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('endpoint:delete', async (_event, id: string) => {
    try {
      const data = endpointRepo.deleteEndpoint(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Endpoint Cases ──────────────────────────────────────

  ipcMain.handle('endpointCase:list', async (_event, endpointId: string) => {
    try {
      const data = endpointRepo.getCasesByEndpoint(endpointId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('endpointCase:get', async (_event, id: string) => {
    try {
      const data = endpointRepo.getCaseById(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('endpointCase:create', async (_event, payload: {
    endpoint_id: string
    name: string
    params?: string
    headers?: string
    body?: string
    auth?: string
    assertions?: string
    is_default?: boolean
  }) => {
    try {
      const data = endpointRepo.createCase(payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('endpointCase:delete', async (_event, id: string) => {
    try {
      const data = endpointRepo.deleteCase(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Saved Requests ──────────────────────────────────────

  ipcMain.handle('savedRequest:list', async (_event, projectId: string) => {
    try {
      const data = endpointRepo.getSavedRequestsByProject(projectId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('savedRequest:get', async (_event, id: string) => {
    try {
      const data = endpointRepo.getSavedRequestById(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('savedRequest:create', async (_event, payload: {
    project_id?: string | null
    folder_id?: string | null
    name: string
    protocol?: string
    method?: string
    url: string
    params?: string
    headers?: string
    body?: string
    auth?: string
    pre_script?: string
    post_script?: string
    assertions?: string
    metadata?: string
  }) => {
    try {
      const data = endpointRepo.createSavedRequest(payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('savedRequest:update', async (_event, id: string, payload: {
    name?: string
    protocol?: string
    method?: string
    url?: string
    params?: string
    headers?: string
    body?: string
    auth?: string
    pre_script?: string
    post_script?: string
    assertions?: string
    metadata?: string
    folder_id?: string | null
    sort_order?: number
  }) => {
    try {
      const data = endpointRepo.updateSavedRequest(id, payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('savedRequest:delete', async (_event, id: string) => {
    try {
      const data = endpointRepo.deleteSavedRequest(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
