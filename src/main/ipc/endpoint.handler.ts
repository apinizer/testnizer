import { ipcMain } from 'electron'
import * as endpointRepo from '../db/endpoint.repo'
import * as projectRepo from '../db/project.repo'
import { getDb } from '../db/database'

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

  ipcMain.handle(
    'endpoint:create',
    async (
      _event,
      payload: {
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
      },
    ) => {
      try {
        const data = endpointRepo.createEndpoint(payload)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle(
    'endpoint:update',
    async (
      _event,
      id: string,
      payload: {
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
      },
    ) => {
      try {
        const data = endpointRepo.updateEndpoint(id, payload)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

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

  ipcMain.handle(
    'endpointCase:create',
    async (
      _event,
      payload: {
        endpoint_id: string
        name: string
        params?: string
        headers?: string
        body?: string
        auth?: string
        assertions?: string
        is_default?: boolean
      },
    ) => {
      try {
        const data = endpointRepo.createCase(payload)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

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

  ipcMain.handle(
    'savedRequest:create',
    async (
      _event,
      payload: {
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
      },
    ) => {
      try {
        const data = endpointRepo.createSavedRequest(payload)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle(
    'savedRequest:update',
    async (
      _event,
      id: string,
      payload: {
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
      },
    ) => {
      try {
        const data = endpointRepo.updateSavedRequest(id, payload)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('savedRequest:delete', async (_event, id: string) => {
    try {
      const data = endpointRepo.deleteSavedRequest(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Tree drag-drop reparent ─────────────────────────────
  // Handles moving any tree node (folder, endpoint, or saved request) into a
  // new parent folder via a single IPC. Renumbers siblings 0..N-1 so the
  // dragged node lands at the requested insertion point — no holes, no
  // collisions (UX 5).
  ipcMain.handle(
    'tree:move',
    async (
      _event,
      payload: {
        nodeId: string
        nodeType: 'folder' | 'endpoint' | 'request'
        targetFolderId: string | null
        insertBeforeId?: string | null
      },
    ) => {
      try {
        const db = getDb()
        const { nodeId, nodeType, targetFolderId } = payload
        const insertBeforeId = payload.insertBeforeId ?? null

        // Guard against dropping a folder into itself or one of its descendants.
        if (nodeType === 'folder' && targetFolderId) {
          let cur: string | null = targetFolderId
          const seen = new Set<string>()
          while (cur && !seen.has(cur)) {
            if (cur === nodeId) return { success: false, error: 'Cannot move a folder into itself' }
            seen.add(cur)
            const parent = projectRepo.getFolderById(cur)
            cur = parent?.parent_id ?? null
          }
        }

        const txn = db.transaction(() => {
          // Step 1: detach the node from its current siblings by setting the
          // new folder_id without touching sort_order yet (so the temporary
          // out-of-place row doesn't fight with the renumbering below).
          if (nodeType === 'folder') {
            projectRepo.updateFolder(nodeId, { parent_id: targetFolderId })
          } else if (nodeType === 'endpoint') {
            endpointRepo.updateEndpoint(nodeId, { folder_id: targetFolderId })
          } else {
            endpointRepo.updateSavedRequest(nodeId, { folder_id: targetFolderId })
          }

          // Step 2: collect every sibling in the destination, in current order,
          // then build the desired order (insert the moved node at the right
          // position) and renumber 0..N-1.
          type Sibling = { id: string; kind: 'folder' | 'endpoint' | 'request'; sort_order: number }
          const folderWhere = targetFolderId === null ? 'parent_id IS NULL' : 'parent_id = ?'
          const endpointWhere = targetFolderId === null ? 'folder_id IS NULL' : 'folder_id = ?'
          const params = targetFolderId === null ? [] : [targetFolderId]

          const folders = db
            .prepare(
              `SELECT id, sort_order FROM folders WHERE ${folderWhere} ORDER BY sort_order ASC`,
            )
            .all(...params) as Array<{ id: string; sort_order: number }>
          const endpoints = db
            .prepare(
              `SELECT id, sort_order FROM endpoints WHERE ${endpointWhere} ORDER BY sort_order ASC`,
            )
            .all(...params) as Array<{ id: string; sort_order: number }>
          const requests = db
            .prepare(
              `SELECT id, sort_order FROM saved_requests WHERE ${endpointWhere} ORDER BY sort_order ASC`,
            )
            .all(...params) as Array<{ id: string; sort_order: number }>

          const siblings: Sibling[] = [
            ...folders.map((r) => ({ ...r, kind: 'folder' as const })),
            ...endpoints.map((r) => ({ ...r, kind: 'endpoint' as const })),
            ...requests.map((r) => ({ ...r, kind: 'request' as const })),
          ].sort((a, b) => a.sort_order - b.sort_order)

          // The moved node already appears in `siblings` (since the
          // detach-step set its parent_id). Remove it and reinsert at the
          // requested position so we know the final ordering.
          const without = siblings.filter((s) => s.id !== nodeId)
          const moved: Sibling = { id: nodeId, kind: nodeType, sort_order: 0 }
          const insertIdx = insertBeforeId
            ? Math.max(
                0,
                without.findIndex((s) => s.id === insertBeforeId),
              )
            : without.length
          const ordered = [...without.slice(0, insertIdx), moved, ...without.slice(insertIdx)]

          // Renumber
          const updFolder = db.prepare('UPDATE folders SET sort_order = ? WHERE id = ?')
          const updEndpoint = db.prepare('UPDATE endpoints SET sort_order = ? WHERE id = ?')
          const updRequest = db.prepare('UPDATE saved_requests SET sort_order = ? WHERE id = ?')
          ordered.forEach((s, idx) => {
            if (s.kind === 'folder') updFolder.run(idx, s.id)
            else if (s.kind === 'endpoint') updEndpoint.run(idx, s.id)
            else updRequest.run(idx, s.id)
          })
        })
        txn()
        return { success: true, data: true }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )
}
