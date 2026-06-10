import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import * as projectRepo from '../db/project.repo'
import { getDb } from '../db/database'

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

  ipcMain.handle(
    'project:create',
    async (
      _event,
      payload: {
        workspace_id: string
        name: string
        description?: string
        type?: string
        save_mode?: string
        local_path?: string
        icon_emoji?: string
        icon_color?: string
      },
    ) => {
      try {
        const data = projectRepo.createProject(payload)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle(
    'project:update',
    async (
      _event,
      id: string,
      payload: {
        name?: string
        description?: string
        type?: string
        save_mode?: string
        local_path?: string | null
        icon_emoji?: string | null
        icon_color?: string | null
        sort_order?: number
      },
    ) => {
      try {
        const data = projectRepo.updateProject(id, payload)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('project:delete', async (_event, id: string) => {
    try {
      const data = projectRepo.deleteProject(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Folders ─────────────────────────────────────────────

  ipcMain.handle('folder:list', async (_event, projectId: string, branchId?: string | null) => {
    try {
      const data = projectRepo.getFoldersByProject(projectId, branchId)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(
    'folder:create',
    async (
      _event,
      payload: {
        project_id: string
        parent_id?: string | null
        name: string
        branch_id?: string | null
        auth?: string | null
        pre_script?: string | null
        post_script?: string | null
      },
    ) => {
      try {
        const data = projectRepo.createFolder(payload)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle(
    'folder:update',
    async (
      _event,
      id: string,
      payload: {
        name?: string
        parent_id?: string | null
        sort_order?: number
        auth?: string | null
        pre_script?: string | null
        post_script?: string | null
      },
    ) => {
      try {
        const data = projectRepo.updateFolder(id, payload)
        return { success: true, data }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('folder:delete', async (_event, id: string) => {
    try {
      const data = projectRepo.deleteFolder(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('folder:duplicate', async (_event, id: string) => {
    try {
      const data = duplicateFolderDeep(id)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}

/**
 * Deep-clone a folder (and its sub-folders / endpoints / saved requests) into
 * the same project. All IDs are regenerated and sort_order is preserved so
 * the clone slots in next to the original. Wrapped in a single transaction so
 * a mid-flight failure can't leave half a copy behind. v1.3.1 B5: this is
 * what the silent "Duplicate" menu was supposed to do.
 */
function duplicateFolderDeep(rootFolderId: string): { newFolderId: string } {
  const db = getDb()
  const now = Date.now()

  const root = db
    .prepare('SELECT id, project_id, parent_id, name, sort_order FROM folders WHERE id = ?')
    .get(rootFolderId) as
    | { id: string; project_id: string; parent_id: string | null; name: string; sort_order: number }
    | undefined
  if (!root) throw new Error('Folder not found: ' + rootFolderId)

  // Collect every descendant folder iteratively so a deep tree doesn't blow
  // the stack. The map preserves insert order which lines up with sort_order.
  const allFolders: Array<{
    id: string
    parent_id: string | null
    name: string
    sort_order: number
  }> = [root]
  const queue: string[] = [rootFolderId]
  while (queue.length > 0) {
    const parentId = queue.shift()!
    const children = db
      .prepare(
        'SELECT id, parent_id, name, sort_order FROM folders WHERE parent_id = ? ORDER BY sort_order',
      )
      .all(parentId) as Array<{
      id: string
      parent_id: string
      name: string
      sort_order: number
    }>
    for (const c of children) {
      allFolders.push(c)
      queue.push(c.id)
    }
  }

  const folderIdMap = new Map<string, string>()
  for (const f of allFolders) folderIdMap.set(f.id, randomUUID())

  const tx = db.transaction(() => {
    // Folders: re-key parent_id via folderIdMap; the root's parent stays the
    // same so the clone sits as a sibling of the original.
    for (const f of allFolders) {
      const newId = folderIdMap.get(f.id)!
      const newParent =
        f.id === rootFolderId ? f.parent_id : folderIdMap.get(f.parent_id ?? '') || null
      const newName = f.id === rootFolderId ? `${f.name} (copy)` : f.name
      db.prepare(
        `INSERT INTO folders (id, project_id, parent_id, name, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(newId, root.project_id, newParent, newName, f.sort_order)
    }

    // Endpoints belonging to any of the source folders.
    const folderIds = allFolders.map((f) => f.id)
    if (folderIds.length > 0) {
      const placeholders = folderIds.map(() => '?').join(',')
      const endpoints = db
        .prepare(`SELECT * FROM endpoints WHERE folder_id IN (${placeholders})`)
        .all(...folderIds) as Array<Record<string, unknown>>
      const insertEp = db.prepare(
        `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const ep of endpoints) {
        insertEp.run(
          randomUUID(),
          root.project_id,
          folderIdMap.get(ep.folder_id as string),
          ep.name,
          ep.description ?? null,
          ep.protocol ?? 'http',
          ep.method,
          ep.path,
          ep.status ?? 'developing',
          ep.request_schema ?? null,
          ep.response_schemas ?? null,
          ep.sort_order ?? 0,
          now,
          now,
        )
      }

      // Saved requests (manual builds saved into the same folders).
      const saved = db
        .prepare(`SELECT * FROM saved_requests WHERE folder_id IN (${placeholders})`)
        .all(...folderIds) as Array<Record<string, unknown>>
      const insertSr = db.prepare(
        `INSERT INTO saved_requests
           (id, project_id, folder_id, name, protocol, method, url, params, headers, body, auth,
            pre_script, post_script, assertions, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const sr of saved) {
        insertSr.run(
          randomUUID(),
          sr.project_id ?? root.project_id,
          folderIdMap.get(sr.folder_id as string),
          sr.name,
          sr.protocol ?? 'http',
          sr.method ?? 'GET',
          sr.url ?? '',
          sr.params ?? null,
          sr.headers ?? null,
          sr.body ?? null,
          sr.auth ?? null,
          sr.pre_script ?? null,
          sr.post_script ?? null,
          sr.assertions ?? null,
          sr.sort_order ?? 0,
          now,
          now,
        )
      }
    }
  })
  tx()

  return { newFolderId: folderIdMap.get(rootFolderId)! }
}
