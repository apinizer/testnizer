import { ipcMain } from 'electron'
import * as historyRepo from '../db/history.repo'

export function registerHistoryHandlers(): void {
  ipcMain.handle('history:list', async (_event, options: {
    workspace_id?: string
    project_id?: string
    limit?: number
    offset?: number
  }) => {
    try {
      const data = historyRepo.getHistory(options)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('history:get', async (_event, id: string) => {
    try {
      const data = historyRepo.getHistoryById(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('history:add', async (_event, payload: {
    workspace_id?: string
    project_id?: string
    endpoint_id?: string
    protocol: string
    method?: string
    url: string
    status_code?: number
    duration_ms?: number
    request_snapshot: string
    response_snapshot?: string
  }) => {
    try {
      const data = historyRepo.addHistory(payload)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('history:clear', async (_event, scope?: string | { workspace_id?: string; project_id?: string }) => {
    try {
      const data = historyRepo.clearHistory(scope)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('history:delete', async (_event, id: string) => {
    try {
      const data = historyRepo.deleteHistoryEntry(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('history:prune', async (_event, limit: number, workspaceId?: string) => {
    try {
      const data = historyRepo.pruneHistory(limit, workspaceId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
