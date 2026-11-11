import { randomUUID } from 'crypto'
import { getDb } from './database'
import { maskHistoryRow, scrubberFor } from '../lib/sensitive-scrub'

export interface HistoryRow {
  id: string
  workspace_id: string | null
  project_id: string | null
  endpoint_id: string | null
  protocol: string
  method: string | null
  url: string
  status_code: number | null
  duration_ms: number | null
  request_snapshot: string
  response_snapshot: string | null
  executed_at: number
}

export function getHistory(options: {
  workspace_id?: string
  project_id?: string
  limit?: number
  offset?: number
}): HistoryRow[] {
  const db = getDb()
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (options.workspace_id) {
    conditions.push('workspace_id = ?')
    params.push(options.workspace_id)
  }
  if (options.project_id) {
    conditions.push('project_id = ?')
    params.push(options.project_id)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = options.limit ?? 100
  const offset = options.offset ?? 0

  return db
    .prepare(`SELECT * FROM history ${where} ORDER BY executed_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as HistoryRow[]
}

export function getHistoryById(id: string): HistoryRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM history WHERE id = ?').get(id) as HistoryRow | undefined
}

export function addHistory(data: {
  workspace_id?: string
  project_id?: string
  endpoint_id?: string
  protocol: string
  method?: string
  url: string
  status_code?: number
  duration_ms?: number
  request_snapshot: string
  response_snapshot?: string
  /**
   * Secret values this request carried beyond the variables marked secret —
   * its resolved auth (bearer token, basic password, API key value, …).
   * Used only to mask; never stored.
   */
  extra_secrets?: unknown[]
}): HistoryRow {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()

  // Issue #195: History rows never hold credentials. Masked HERE, in the one
  // function every writer (each protocol handler, the Runner, `history:add`)
  // goes through — the same place-of-truth idea as `maskRequestJson` for
  // saved examples. Name rule + secret-value scrub; `configured` (the
  // `{{var}}` template kept for re-send) keeps variable references.
  const masked = maskHistoryRow(
    {
      url: data.url,
      request_snapshot: data.request_snapshot,
      response_snapshot: data.response_snapshot,
    },
    scrubberFor(db, data.extra_secrets ?? []),
  )
  const url = masked.url
  const requestSnapshot = masked.request_snapshot
  const responseSnapshot = masked.response_snapshot

  db.prepare(
    `
    INSERT INTO history (id, workspace_id, project_id, endpoint_id, protocol, method, url, status_code, duration_ms, request_snapshot, response_snapshot, executed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    id,
    data.workspace_id ?? null,
    data.project_id ?? null,
    data.endpoint_id ?? null,
    data.protocol,
    data.method ?? null,
    url,
    data.status_code ?? null,
    data.duration_ms ?? null,
    requestSnapshot,
    responseSnapshot ?? null,
    now,
  )
  return getHistoryById(id)!
}

type HistoryScope = string | { workspace_id?: string; project_id?: string }

/**
 * The ONE scope rule `clearHistory` and `countHistory` share, so the History
 * Clear confirmation can never announce a different number than it deletes.
 * Project wins over workspace; neither = every row.
 */
function historyScopeWhere(scope?: HistoryScope): { where: string; params: string[] } {
  // Back-compat: allow passing a workspaceId string directly
  const opts = typeof scope === 'string' ? { workspace_id: scope } : scope || {}
  if (opts.project_id) return { where: 'WHERE project_id = ?', params: [opts.project_id] }
  if (opts.workspace_id) return { where: 'WHERE workspace_id = ?', params: [opts.workspace_id] }
  return { where: '', params: [] }
}

export function clearHistory(scope?: HistoryScope): number {
  const db = getDb()
  const { where, params } = historyScopeWhere(scope)
  return db.prepare(`DELETE FROM history ${where}`).run(...params).changes
}

/** How many rows `clearHistory(scope)` would delete. */
export function countHistory(scope?: HistoryScope): number {
  const db = getDb()
  const { where, params } = historyScopeWhere(scope)
  const row = db.prepare(`SELECT COUNT(*) AS n FROM history ${where}`).get(...params) as
    | { n: number }
    | undefined
  return row?.n ?? 0
}

export function deleteHistoryEntry(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM history WHERE id = ?').run(id)
  return result.changes > 0
}

export function pruneHistory(limit: number, workspaceId?: string): number {
  const db = getDb()
  if (workspaceId) {
    const result = db
      .prepare(
        `
      DELETE FROM history WHERE id IN (
        SELECT id FROM history WHERE workspace_id = ?
        ORDER BY executed_at DESC
        LIMIT -1 OFFSET ?
      )
    `,
      )
      .run(workspaceId, limit)
    return result.changes
  }
  const result = db
    .prepare(
      `
    DELETE FROM history WHERE id IN (
      SELECT id FROM history ORDER BY executed_at DESC LIMIT -1 OFFSET ?
    )
  `,
    )
    .run(limit)
  return result.changes
}
