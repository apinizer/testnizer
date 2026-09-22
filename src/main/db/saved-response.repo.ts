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
  /**
   * JSON `SavedRequestSnapshot` — `configured` (the editor template with
   * `{{var}}` intact) + `sent` (the resolved wire request). Null on rows
   * saved before the column existed.
   */
  request_json: string | null
  created_at: number
}

/** Tree-side projection: everything but the two JSON blobs. */
export type SavedResponseSummary = Omit<SavedResponseRow, 'response_json' | 'request_json'>

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
  'request_json',
] as const

/**
 * Header names whose values never reach disk in a saved example. The
 * resolved snapshot is the wire form, so it carries the real credential —
 * unlike the template (`{{token}}`). Same idea as stripping `user:pass@`
 * from persisted URLs; masked in MAIN so no renderer path can forget it.
 */
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
])
export const MASKED_VALUE = '••••••'

export function maskSensitiveHeaders(
  headers: Record<string, unknown> | undefined | null,
): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== 'object') return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) && v ? MASKED_VALUE : v
  }
  return out
}

function isSensitiveKvp(h: unknown): h is { key: string; value: unknown } {
  return (
    !!h &&
    typeof h === 'object' &&
    typeof (h as { key?: unknown }).key === 'string' &&
    SENSITIVE_HEADERS.has((h as { key: string }).key.toLowerCase()) &&
    Boolean((h as { value?: unknown }).value)
  )
}

/**
 * Mask secrets inside a serialised request snapshot. Tolerant: anything that
 * is not the expected `{configured, sent}` shape passes through untouched;
 * unparseable text is dropped rather than persisted blindly.
 */
export function maskRequestJson(requestJson: string | null | undefined): string | null {
  if (!requestJson) return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(requestJson) as Record<string, unknown>
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const sent = parsed.sent as Record<string, unknown> | undefined
  if (sent && typeof sent === 'object' && sent.headers && typeof sent.headers === 'object') {
    parsed.sent = {
      ...sent,
      headers: maskSensitiveHeaders(sent.headers as Record<string, unknown>),
    }
  }
  const configured = parsed.configured as Record<string, unknown> | undefined
  if (configured && typeof configured === 'object' && Array.isArray(configured.headers)) {
    parsed.configured = {
      ...configured,
      headers: (configured.headers as unknown[]).map((h) =>
        isSensitiveKvp(h) ? { ...h, value: MASKED_VALUE } : h,
      ),
    }
  }
  return JSON.stringify(parsed)
}

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

/**
 * Every example of a project in one query — the APIs tree binds them under
 * their owner rows. Blobs are left out on purpose: a project with hundreds
 * of examples must not ship megabytes of bodies on every tree refresh.
 */
export function listSavedResponsesByProject(projectId: string): SavedResponseSummary[] {
  return getDb()
    .prepare(
      `SELECT id, project_id, owner_type, owner_id, name, protocol, method, url, status_code, created_at
         FROM saved_responses WHERE project_id = ? ORDER BY created_at ASC`,
    )
    .all(projectId) as SavedResponseSummary[]
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
  request_json?: string | null
}): SavedResponseRow {
  const id = randomUUID()
  const name = data.name.trim()
  if (!name) throw new Error('A name is required')
  if (!data.owner_id) throw new Error('owner_id is required')
  getDb()
    .prepare(
      `INSERT INTO saved_responses (${SAVED_RESPONSE_COLUMNS.join(', ')})
       VALUES (${SAVED_RESPONSE_COLUMNS.map(() => '?').join(', ')})`,
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
      maskRequestJson(data.request_json),
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
