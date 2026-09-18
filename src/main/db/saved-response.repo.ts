import { randomUUID } from 'crypto'
import { getDb } from './database'

/**
 * Named response examples pinned to a request (issue #125) — "Save response"
 * next to Send. Unlike `history` (an unbounded, auto-written log) these are
 * explicit, user-named, and travel with the project file / Git sync.
 */
export type SavedResponseOwnerType = 'endpoint' | 'saved_request' | 'test_suite_item'

export interface SavedResponseRow {
  id: string
  project_id: string | null
  owner_type: SavedResponseOwnerType
  owner_id: string
  name: string
  protocol: string
  method: string | null
  url: string | null
  status_code: number | null
  response_json: string
  created_at: number
}

export const SAVED_RESPONSE_COLUMNS = [
  'id',
  'project_id',
  'owner_type',
  'owner_id',
  'name',
  'protocol',
  'method',
  'url',
  'status_code',
  'response_json',
  'created_at',
] as const

/** Response bodies above this are dropped, matching the history snapshot cap. */
export const SAVED_RESPONSE_BODY_LIMIT = 500_000

/**
 * The project an owner row belongs to — resolved in MAIN, never trusted from
 * the renderer: a tab backed by project A's request while project B is active
 * would otherwise stamp the example onto B (wrong export, wrong cleanup).
 * Returns null when the owner row no longer exists.
 */
export function resolveOwnerProjectId(
  ownerType: SavedResponseOwnerType,
  ownerId: string,
): string | null {
  const db = getDb()
  if (ownerType === 'endpoint') {
    const r = db.prepare('SELECT project_id FROM endpoints WHERE id = ?').get(ownerId) as
      | { project_id: string | null }
      | undefined
    return r ? (r.project_id ?? null) : null
  }
  if (ownerType === 'saved_request') {
    const r = db.prepare('SELECT project_id FROM saved_requests WHERE id = ?').get(ownerId) as
      | { project_id: string | null }
      | undefined
    return r ? (r.project_id ?? null) : null
  }
  const r = db
    .prepare(
      `SELECT s.project_id AS project_id FROM test_suite_items i
         JOIN test_suites s ON s.id = i.suite_id WHERE i.id = ?`,
    )
    .get(ownerId) as { project_id: string | null } | undefined
  return r ? (r.project_id ?? null) : null
}

export function ownerExists(ownerType: SavedResponseOwnerType, ownerId: string): boolean {
  const db = getDb()
  const table =
    ownerType === 'endpoint'
      ? 'endpoints'
      : ownerType === 'saved_request'
        ? 'saved_requests'
        : 'test_suite_items'
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(ownerId))
}

export function listSavedResponses(
  ownerType: SavedResponseOwnerType,
  ownerId: string,
): SavedResponseRow[] {
  return getDb()
    .prepare(
      'SELECT * FROM saved_responses WHERE owner_type = ? AND owner_id = ? ORDER BY created_at DESC',
    )
    .all(ownerType, ownerId) as SavedResponseRow[]
}

export function getSavedResponse(id: string): SavedResponseRow | undefined {
  return getDb().prepare('SELECT * FROM saved_responses WHERE id = ?').get(id) as
    | SavedResponseRow
    | undefined
}

export function createSavedResponse(data: {
  project_id?: string | null
  owner_type: SavedResponseOwnerType
  owner_id: string
  name: string
  protocol?: string
  method?: string | null
  url?: string | null
  status_code?: number | null
  response_json: string
}): SavedResponseRow {
  const id = randomUUID()
  const name = data.name.trim()
  if (!name) throw new Error('A name is required')
  if (!data.owner_id) throw new Error('owner_id is required')
  getDb()
    .prepare(
      `INSERT INTO saved_responses (${SAVED_RESPONSE_COLUMNS.join(', ')})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      data.project_id ?? null,
      data.owner_type,
      data.owner_id,
      name,
      data.protocol || 'http',
      data.method ?? null,
      data.url ?? null,
      data.status_code ?? null,
      data.response_json,
      Date.now(),
    )
  return getSavedResponse(id)!
}

export function renameSavedResponse(id: string, name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('A name is required')
  return (
    getDb().prepare('UPDATE saved_responses SET name = ? WHERE id = ?').run(trimmed, id).changes > 0
  )
}

export function deleteSavedResponse(id: string): boolean {
  return getDb().prepare('DELETE FROM saved_responses WHERE id = ?').run(id).changes > 0
}
