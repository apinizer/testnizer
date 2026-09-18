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
