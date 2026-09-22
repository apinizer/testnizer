import { ipcMain } from 'electron'
import * as repo from '../db/saved-response.repo'
import type { SavedResponseOwnerType } from '../db/saved-response.repo'

/** `savedResponse:*` — named response examples pinned to a request (issue #125). */
export function registerSavedResponseHandlers(): void {
  ipcMain.handle(
    'savedResponse:list',
    async (_event, ownerType: SavedResponseOwnerType, ownerId: string) => {
      try {
        return { success: true, data: repo.listSavedResponses(ownerType, ownerId) }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // Tree binding: one call per project, blobs excluded (see repo).
  ipcMain.handle('savedResponse:listByProject', async (_event, projectId: string) => {
    try {
      return { success: true, data: repo.listSavedResponsesByProject(projectId) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('savedResponse:get', async (_event, id: string) => {
    try {
      const row = repo.getSavedResponse(id)
      if (!row) return { success: false, error: 'This saved example no longer exists.' }
      return { success: true, data: row }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(
    'savedResponse:create',
    async (
      _event,
      payload: {
        project_id?: string | null
        owner_type: SavedResponseOwnerType
        owner_id: string
        name: string
        protocol?: string
        method?: string | null
        url?: string | null
        status_code?: number | null
        response_json: string
        request_json?: string | null
      },
    ) => {
      try {
        if (!payload?.owner_type || !payload.owner_id) {
          return { success: false, error: 'Save the request first, then save its response.' }
        }
        if (typeof payload.response_json !== 'string' || !payload.response_json) {
          return { success: false, error: 'No response to save.' }
        }
        if (!repo.ownerExists(payload.owner_type, payload.owner_id)) {
          return { success: false, error: 'The request this response belongs to no longer exists.' }
        }
        // project_id comes from the owner row, not from the renderer.
        const project_id = repo.resolveOwnerProjectId(payload.owner_type, payload.owner_id)
        return { success: true, data: repo.createSavedResponse({ ...payload, project_id }) }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('savedResponse:rename', async (_event, id: string, name: string) => {
    try {
      return { success: true, data: repo.renameSavedResponse(id, name) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('savedResponse:delete', async (_event, id: string) => {
    try {
      return { success: true, data: repo.deleteSavedResponse(id) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
