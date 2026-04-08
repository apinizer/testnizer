import { randomUUID } from 'crypto'
import { getDb } from './database'

export interface ProjectRow {
  id: string
  workspace_id: string
  name: string
  description: string | null
  type: string
  sort_order: number
  created_at: number
  updated_at: number
}

export interface FolderRow {
  id: string
  project_id: string
  parent_id: string | null
  name: string
  sort_order: number
}

// ─── Projects ────────────────────────────────────────────────

export function getProjectsByWorkspace(workspaceId: string): ProjectRow[] {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM projects WHERE workspace_id = ? ORDER BY sort_order ASC'
  ).all(workspaceId) as ProjectRow[]
}

export function getProjectById(id: string): ProjectRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined
}

export function createProject(data: {
  workspace_id: string
  name: string
  description?: string
  type?: string
}): ProjectRow {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) as max_order FROM projects WHERE workspace_id = ?'
  ).get(data.workspace_id) as { max_order: number }

  db.prepare(`
    INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.workspace_id,
    data.name,
    data.description ?? null,
    data.type ?? 'http',
    maxOrder.max_order + 1,
    now,
    now
  )
  return getProjectById(id)!
}

export function updateProject(id: string, data: {
  name?: string
  description?: string
  type?: string
  sort_order?: number
}): ProjectRow | undefined {
  const db = getDb()
  const now = Date.now()
  const existing = getProjectById(id)
  if (!existing) return undefined

  db.prepare(`
    UPDATE projects SET name = ?, description = ?, type = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(
    data.name ?? existing.name,
    data.description ?? existing.description,
    data.type ?? existing.type,
    data.sort_order ?? existing.sort_order,
    now,
    id
  )
  return getProjectById(id)
}

export function deleteProject(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id)
  return result.changes > 0
}

// ─── Folders ─────────────────────────────────────────────────

export function getFoldersByProject(projectId: string): FolderRow[] {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM folders WHERE project_id = ? ORDER BY sort_order ASC'
  ).all(projectId) as FolderRow[]
}

export function getFolderById(id: string): FolderRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow | undefined
}

export function createFolder(data: {
  project_id: string
  parent_id?: string | null
  name: string
}): FolderRow {
  const db = getDb()
  const id = randomUUID()

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) as max_order FROM folders WHERE project_id = ?'
  ).get(data.project_id) as { max_order: number }

  db.prepare(`
    INSERT INTO folders (id, project_id, parent_id, name, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, data.project_id, data.parent_id ?? null, data.name, maxOrder.max_order + 1)
  return getFolderById(id)!
}

export function updateFolder(id: string, data: {
  name?: string
  parent_id?: string | null
  sort_order?: number
}): FolderRow | undefined {
  const db = getDb()
  const existing = getFolderById(id)
  if (!existing) return undefined

  db.prepare(`
    UPDATE folders SET name = ?, parent_id = ?, sort_order = ?
    WHERE id = ?
  `).run(
    data.name ?? existing.name,
    data.parent_id !== undefined ? data.parent_id : existing.parent_id,
    data.sort_order ?? existing.sort_order,
    id
  )
  return getFolderById(id)
}

export function deleteFolder(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM folders WHERE id = ?').run(id)
  return result.changes > 0
}
