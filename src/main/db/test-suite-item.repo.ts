import { randomUUID } from 'crypto'
import { getDb } from './database'

export interface TestSuiteItemRow {
  id: string
  suite_id: string
  folder_id: string | null
  protocol: string
  name: string
  method: string | null
  url: string | null
  /** JSON of request fields: params, headers, body, auth, preScript, postScript, ... */
  request_schema: string
  /** JSON array of TestAssertion. NULL when no assertions defined yet. */
  assertions: string | null
  /** Advisory pointer to the endpoint this item was imported from. No FK. */
  source_endpoint_id: string | null
  sort_order: number
  created_at: number
  updated_at: number
}

export interface CreateTestSuiteItemInput {
  suite_id: string
  folder_id?: string | null
  protocol: string
  name: string
  method?: string | null
  url?: string | null
  request_schema: string
  assertions?: string | null
  source_endpoint_id?: string | null
}

export interface UpdateTestSuiteItemInput {
  name?: string
  folder_id?: string | null
  protocol?: string
  method?: string | null
  url?: string | null
  request_schema?: string
  assertions?: string | null
  sort_order?: number
}

// ─── Read ────────────────────────────────────────────────────

export function getItemById(id: string): TestSuiteItemRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM test_suite_items WHERE id = ?').get(id) as
    | TestSuiteItemRow
    | undefined
}

export function listItemsBySuite(suiteId: string): TestSuiteItemRow[] {
  const db = getDb()
  return db
    .prepare(
      'SELECT * FROM test_suite_items WHERE suite_id = ? ORDER BY sort_order ASC, created_at ASC',
    )
    .all(suiteId) as TestSuiteItemRow[]
}

export function listItemsByFolder(folderId: string): TestSuiteItemRow[] {
  const db = getDb()
  return db
    .prepare(
      'SELECT * FROM test_suite_items WHERE folder_id = ? ORDER BY sort_order ASC, created_at ASC',
    )
    .all(folderId) as TestSuiteItemRow[]
}

// ─── Create ──────────────────────────────────────────────────

export function createItem(input: CreateTestSuiteItemInput): TestSuiteItemRow {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()

  // sort_order is computed against siblings — items inside the same folder
  // (or at suite root when folder_id is null). Two folders coexisting at the
  // same level get independent sequences.
  const where =
    input.folder_id == null
      ? 'suite_id = ? AND folder_id IS NULL'
      : 'suite_id = ? AND folder_id = ?'
  const params = input.folder_id == null ? [input.suite_id] : [input.suite_id, input.folder_id]
  const maxRow = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM test_suite_items WHERE ${where}`)
    .get(...params) as { m: number }
  const nextSort = maxRow.m + 1

  db.prepare(
    `INSERT INTO test_suite_items
       (id, suite_id, folder_id, protocol, name, method, url,
        request_schema, assertions, source_endpoint_id,
        sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.suite_id,
    input.folder_id ?? null,
    input.protocol,
    input.name,
    input.method ?? null,
    input.url ?? null,
    input.request_schema,
    input.assertions ?? null,
    input.source_endpoint_id ?? null,
    nextSort,
    now,
    now,
  )
  return getItemById(id)!
}

// ─── Update ──────────────────────────────────────────────────

export function updateItem(
  id: string,
  patch: UpdateTestSuiteItemInput,
): TestSuiteItemRow | undefined {
  const db = getDb()
  const existing = getItemById(id)
  if (!existing) return undefined
  const now = Date.now()

  db.prepare(
    `UPDATE test_suite_items
       SET name = ?, folder_id = ?, protocol = ?, method = ?, url = ?,
           request_schema = ?, assertions = ?, sort_order = ?, updated_at = ?
       WHERE id = ?`,
  ).run(
    patch.name ?? existing.name,
    patch.folder_id !== undefined ? patch.folder_id : existing.folder_id,
    patch.protocol ?? existing.protocol,
    patch.method !== undefined ? patch.method : existing.method,
    patch.url !== undefined ? patch.url : existing.url,
    patch.request_schema ?? existing.request_schema,
    patch.assertions !== undefined ? patch.assertions : existing.assertions,
    patch.sort_order ?? existing.sort_order,
    now,
    id,
  )
  return getItemById(id)
}

// ─── Delete ──────────────────────────────────────────────────

export function deleteItem(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM test_suite_items WHERE id = ?').run(id)
  return result.changes > 0
}

// ─── Move (drag-drop reorder) ───────────────────────────────

/**
 * Move an item to a new folder (or suite root) and a specific position
 * relative to siblings. Mirrors `tree:move` semantics:
 *
 *   - `targetFolderId` is the destination folder, or null for the suite root.
 *   - `insertBeforeId` is the id of the sibling that should follow this
 *     item once moved; null means append at the end.
 *
 * Done in a single transaction: detach from the old siblings, splice into
 * the new position, renumber all destination siblings 0..N-1 so there are
 * no gaps or duplicates.
 */
export function moveItem(opts: {
  id: string
  targetSuiteId: string
  targetFolderId: string | null
  insertBeforeId: string | null
}): TestSuiteItemRow | undefined {
  const db = getDb()
  const existing = getItemById(opts.id)
  if (!existing) return undefined

  const txn = db.transaction(() => {
    // Detach: set the new folder_id without touching sort_order yet, so the
    // renumber pass below doesn't compete with the item's stale position.
    db.prepare(`UPDATE test_suite_items SET folder_id = ?, updated_at = ? WHERE id = ?`).run(
      opts.targetFolderId,
      Date.now(),
      opts.id,
    )

    // Collect siblings in current sort_order, then build the desired
    // insertion order with `opts.id` placed at the right slot.
    const where =
      opts.targetFolderId == null
        ? 'suite_id = ? AND folder_id IS NULL'
        : 'suite_id = ? AND folder_id = ?'
    const params =
      opts.targetFolderId == null ? [opts.targetSuiteId] : [opts.targetSuiteId, opts.targetFolderId]
    const siblings = db
      .prepare(
        `SELECT id FROM test_suite_items WHERE ${where} ORDER BY sort_order ASC, created_at ASC`,
      )
      .all(...params) as Array<{ id: string }>

    const others = siblings.filter((s) => s.id !== opts.id).map((s) => s.id)
    const beforeIdx = opts.insertBeforeId ? others.indexOf(opts.insertBeforeId) : -1
    const ordered =
      beforeIdx >= 0
        ? [...others.slice(0, beforeIdx), opts.id, ...others.slice(beforeIdx)]
        : [...others, opts.id]

    const stmt = db.prepare(
      `UPDATE test_suite_items SET sort_order = ?, updated_at = ? WHERE id = ?`,
    )
    const now = Date.now()
    ordered.forEach((rowId, i) => stmt.run(i, now, rowId))
  })
  txn()
  return getItemById(opts.id)
}

// ─── Bulk import (snapshot from endpoint/saved_request) ─────

/**
 * Insert pre-built item rows in order under the same suite (and optional
 * folder). Returns the inserted rows in the order they landed. Used by the
 * "Import as copies" path that turns a multi-select from the APIs tree into
 * inline suite items.
 */
export function bulkInsertItems(rows: CreateTestSuiteItemInput[]): TestSuiteItemRow[] {
  if (rows.length === 0) return []
  const db = getDb()
  const txn = db.transaction(() => rows.map((r) => createItem(r)))
  return txn()
}
