import { randomUUID } from 'crypto'
import { getDb } from './database'

export interface WorkspaceRow {
  id: string
  name: string
  description: string | null
  color: string | null
  created_at: number
  updated_at: number
}

export function getAllWorkspaces(): WorkspaceRow[] {
  const db = getDb()
  return db.prepare('SELECT * FROM workspaces ORDER BY created_at ASC').all() as WorkspaceRow[]
}

export function getWorkspaceById(id: string): WorkspaceRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined
}

export function createWorkspace(data: {
  name: string
  description?: string
  color?: string
}): WorkspaceRow {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()
  db.prepare(`
    INSERT INTO workspaces (id, name, description, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, data.name, data.description ?? null, data.color ?? null, now, now)
  return getWorkspaceById(id)!
}

export function updateWorkspace(id: string, data: {
  name?: string
  description?: string
  color?: string
}): WorkspaceRow | undefined {
  const db = getDb()
  const now = Date.now()
  const existing = getWorkspaceById(id)
  if (!existing) return undefined

  db.prepare(`
    UPDATE workspaces SET name = ?, description = ?, color = ?, updated_at = ?
    WHERE id = ?
  `).run(
    data.name ?? existing.name,
    data.description ?? existing.description,
    data.color ?? existing.color,
    now,
    id
  )
  return getWorkspaceById(id)
}

export function deleteWorkspace(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
  return result.changes > 0
}
