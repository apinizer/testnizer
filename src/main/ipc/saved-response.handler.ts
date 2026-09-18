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
      },
    ) => {
      try {
        if (!payload?.owner_type || !payload.owner_id) {
          return { success: false, error: 'Save the request first, then save its response.' }
        }
        if (typeof payload.response_json !== 'string' || !payload.response_json) {
          return { success: false, error: 'No response to save.' }
        }
        return { success: true, data: repo.createSavedResponse(payload) }
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
