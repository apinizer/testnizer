import { ipcMain } from 'electron'
import * as endpointRepo from '../db/endpoint.repo'
import * as projectRepo from '../db/project.repo'
import { getDb } from '../db/database'
import { ipcResult } from '../lib/ipc-helpers'

export function registerEndpointHandlers(): void {
  // ─── Endpoints ───────────────────────────────────────────

  ipcMain.handle('endpoint:listByProject', (_event, projectId: string, branchId?: string | null) =>
    ipcResult(() => endpointRepo.getEndpointsByProject(projectId, branchId)),
  )

  ipcMain.handle('endpoint:listByFolder', (_event, folderId: string) =>
    ipcResult(() => endpointRepo.getEndpointsByFolder(folderId)),
  )

  ipcMain.handle('endpoint:get', (_event, id: string) =>
    ipcResult(() => endpointRepo.getEndpointById(id)),
  )

  ipcMain.handle(
    'endpoint:create',
    (
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
        branch_id?: string | null
      },
    ) => ipcResult(() => endpointRepo.createEndpoint(payload)),
  )

  ipcMain.handle(
    'endpoint:update',
    (
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
    ) =>
      ipcResult(() => {
        // Cross-project guard: if the renderer is moving the endpoint into
        // a new folder, make sure that folder belongs to the same project.
        // Otherwise a corrupted payload could splice an endpoint into a
        // foreign project's tree.
        if (payload.folder_id !== undefined && payload.folder_id !== null) {
          const ep = endpointRepo.getEndpointById(id)
          if (!ep) throw new Error('Endpoint not found')
          const folder = projectRepo.getFolderById(payload.folder_id)
          if (!folder) throw new Error('Target folder not found')
          if (folder.project_id !== ep.project_id) {
            throw new Error('Cannot move endpoint across projects')
          }
        }
        return endpointRepo.updateEndpoint(id, payload)
      }),
  )

  ipcMain.handle('endpoint:delete', (_event, id: string) =>
    ipcResult(() => endpointRepo.deleteEndpoint(id)),
  )

  // ─── Endpoint Cases ──────────────────────────────────────

  ipcMain.handle('endpointCase:list', (_event, endpointId: string) =>
    ipcResult(() => endpointRepo.getCasesByEndpoint(endpointId)),
  )

  ipcMain.handle('endpointCase:get', (_event, id: string) =>
    ipcResult(() => endpointRepo.getCaseById(id)),
  )

  ipcMain.handle(
    'endpointCase:create',
    (
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
    ) => ipcResult(() => endpointRepo.createCase(payload)),
  )

  ipcMain.handle('endpointCase:delete', (_event, id: string) =>
    ipcResult(() => endpointRepo.deleteCase(id)),
  )

  // ─── Saved Requests ──────────────────────────────────────

  ipcMain.handle('savedRequest:list', (_event, projectId: string, branchId?: string | null) =>
    ipcResult(() => endpointRepo.getSavedRequestsByProject(projectId, branchId)),
  )

  ipcMain.handle('savedRequest:get', (_event, id: string) =>
    ipcResult(() => endpointRepo.getSavedRequestById(id)),
  )

  ipcMain.handle(
    'savedRequest:create',
    (
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
        branch_id?: string | null
      },
    ) => ipcResult(() => endpointRepo.createSavedRequest(payload)),
  )

  ipcMain.handle(
    'savedRequest:update',
    (
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
    ) =>
      ipcResult(() => {
        // Same cross-project guard as endpoint:update — saved requests can
        // be moved between folders too.
        if (payload.folder_id !== undefined && payload.folder_id !== null) {
          const sr = endpointRepo.getSavedRequestById(id)
          if (!sr) throw new Error('Saved request not found')
          const folder = projectRepo.getFolderById(payload.folder_id)
          if (!folder) throw new Error('Target folder not found')
          if (sr.project_id && folder.project_id !== sr.project_id) {
            throw new Error('Cannot move saved request across projects')
          }
        }
        return endpointRepo.updateSavedRequest(id, payload)
      }),
  )

  ipcMain.handle('savedRequest:delete', (_event, id: string) =>
    ipcResult(() => endpointRepo.deleteSavedRequest(id)),
  )

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

        // Resolve the source node's project_id so we can refuse cross-project
        // moves. Without this guard a malicious or buggy renderer payload
        // could splice an endpoint from project A into project B (review
        // finding HIGH #1).
        let sourceProjectId: string | null = null
        if (nodeType === 'folder') {
          const f = projectRepo.getFolderById(nodeId)
          sourceProjectId = f?.project_id ?? null
        } else if (nodeType === 'endpoint') {
          const e = endpointRepo.getEndpointById(nodeId)
          sourceProjectId = e?.project_id ?? null
        } else {
          const r = endpointRepo.getSavedRequestById(nodeId)
          sourceProjectId = r?.project_id ?? null
        }
        if (!sourceProjectId) {
          return { success: false, error: 'Source node not found' }
        }

        // If the move targets a specific folder, verify the folder belongs to
        // the same project. Root drops (targetFolderId === null) stay in
        // whatever project the node already belongs to.
        if (targetFolderId !== null) {
          const targetFolder = projectRepo.getFolderById(targetFolderId)
          if (!targetFolder) {
            return { success: false, error: 'Target folder not found' }
          }
          if (targetFolder.project_id !== sourceProjectId) {
            return { success: false, error: 'Cannot move node across projects' }
          }
        }

        // Guard against dropping a folder into itself or one of its descendants.
        if (nodeType === 'folder' && targetFolderId) {
          if (targetFolderId === nodeId) {
            return { success: false, error: 'Cannot move a folder into itself' }
          }
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
          // If `insertBeforeId` is stale (e.g. drag started before tree was
          // refreshed) findIndex returns -1. Falling back to "append at end"
          // is safer than silently inserting at position 0 — the user almost
          // never expects a missing reference to land at the very top
          // (review finding MEDIUM #4).
          let insertIdx: number
          if (insertBeforeId) {
            const idx = without.findIndex((s) => s.id === insertBeforeId)
            insertIdx = idx >= 0 ? idx : without.length
          } else {
            insertIdx = without.length
          }
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
