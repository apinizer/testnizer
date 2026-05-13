import { randomUUID } from 'crypto'
import { getDb } from './database'

export interface BranchRow {
  id: string
  project_id: string
  name: string
  parent_branch_id: string | null
  created_at: number
  is_default: number
}

export interface SaveHistoryRow {
  id: string
  project_id: string
  mode: string
  path: string
  message: string
  timestamp: number
}

// ─── Branches ────────────────────────────────────────────────

export function getBranchesByProject(projectId: string): BranchRow[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM branches WHERE project_id = ? ORDER BY is_default DESC, created_at ASC')
    .all(projectId) as BranchRow[]
}

export function getBranchById(id: string): BranchRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM branches WHERE id = ?').get(id) as BranchRow | undefined
}

export function getDefaultBranch(projectId: string): BranchRow | undefined {
  const db = getDb()
  return db
    .prepare('SELECT * FROM branches WHERE project_id = ? AND is_default = 1')
    .get(projectId) as BranchRow | undefined
}

export function createBranch(data: {
  project_id: string
  name: string
  parent_branch_id?: string | null
  is_default?: boolean
}): BranchRow {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()

  db.prepare(
    `
    INSERT INTO branches (id, project_id, name, parent_branch_id, created_at, is_default)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(id, data.project_id, data.name, data.parent_branch_id ?? null, now, data.is_default ? 1 : 0)
  return getBranchById(id)!
}

export function renameBranch(id: string, name: string): BranchRow | undefined {
  const db = getDb()
  const existing = getBranchById(id)
  if (!existing) return undefined

  db.prepare('UPDATE branches SET name = ? WHERE id = ?').run(name, id)
  return getBranchById(id)
}

export function deleteBranch(id: string): boolean {
  const db = getDb()
  // Prevent deleting the default branch
  const branch = getBranchById(id)
  if (!branch || branch.is_default) return false

  const result = db.prepare('DELETE FROM branches WHERE id = ?').run(id)
  return result.changes > 0
}

export function ensureDefaultBranch(projectId: string): BranchRow {
  const existing = getDefaultBranch(projectId)
  if (existing) return existing
  return createBranch({ project_id: projectId, name: 'main', is_default: true })
}

// ─── Save History ────────────────────────────────────────────

export function getSaveHistory(projectId: string, limit = 10): SaveHistoryRow[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM save_history WHERE project_id = ? ORDER BY timestamp DESC LIMIT ?')
    .all(projectId, limit) as SaveHistoryRow[]
}

export function addSaveHistory(data: {
  project_id: string
  mode: string
  path: string
  message: string
}): SaveHistoryRow {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()

  db.prepare(
    `
    INSERT INTO save_history (id, project_id, mode, path, message, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(id, data.project_id, data.mode, data.path, data.message, now)

  return db.prepare('SELECT * FROM save_history WHERE id = ?').get(id) as SaveHistoryRow
}
