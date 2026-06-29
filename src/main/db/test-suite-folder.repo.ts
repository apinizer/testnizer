import { randomUUID } from 'crypto'
import { getDb } from './database'

export interface TestSuiteFolderRow {
  id: string
  suite_id: string
  parent_id: string | null
  name: string
  sort_order: number
  /** JSON AuthConfig or null. 'inherit'/null is transparent up the chain. */
  auth: string | null
  /** Folder-level pre-request script (cascades project → folder(s) → request). */
  pre_script: string | null
  /** Folder-level post-response/test script. */
  post_script: string | null
  created_at: number
}

// ─── Read ────────────────────────────────────────────────────

export function getFolderById(id: string): TestSuiteFolderRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM test_suite_folders WHERE id = ?').get(id) as
    | TestSuiteFolderRow
    | undefined
}

export function listFoldersBySuite(suiteId: string): TestSuiteFolderRow[] {
  const db = getDb()
  return db
    .prepare(
      'SELECT * FROM test_suite_folders WHERE suite_id = ? ORDER BY sort_order ASC, created_at ASC',
    )
    .all(suiteId) as TestSuiteFolderRow[]
}

// ─── Create ──────────────────────────────────────────────────

export function createFolder(input: {
  suite_id: string
  parent_id?: string | null
  name: string
}): TestSuiteFolderRow {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()

  const where =
    input.parent_id == null
      ? 'suite_id = ? AND parent_id IS NULL'
      : 'suite_id = ? AND parent_id = ?'
  const params = input.parent_id == null ? [input.suite_id] : [input.suite_id, input.parent_id]
  const maxRow = db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM test_suite_folders WHERE ${where}`)
    .get(...params) as { m: number }
  const nextSort = maxRow.m + 1

  db.prepare(
    `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.suite_id, input.parent_id ?? null, input.name, nextSort, now)
  return getFolderById(id)!
}

// ─── Settings (auth + scripts) ──────────────────────────────

/**
 * Update a suite folder's auth/script settings. Pass `null` to clear a field
 * (auth 'inherit' is stored as NULL so the folder stays transparent up the
 * chain). Mirrors the APIs `folders` update path used by FolderSettingsModal.
 */
export function updateFolderSettings(
  id: string,
  settings: { auth?: string | null; pre_script?: string | null; post_script?: string | null },
): TestSuiteFolderRow | undefined {
  const db = getDb()
  const existing = getFolderById(id)
  if (!existing) return undefined
  db.prepare(
    'UPDATE test_suite_folders SET auth = ?, pre_script = ?, post_script = ? WHERE id = ?',
  ).run(settings.auth ?? null, settings.pre_script ?? null, settings.post_script ?? null, id)
  return getFolderById(id)
}

// ─── Rename ─────────────────────────────────────────────────

export function renameFolder(id: string, name: string): TestSuiteFolderRow | undefined {
  const db = getDb()
  const existing = getFolderById(id)
  if (!existing) return undefined
  db.prepare('UPDATE test_suite_folders SET name = ? WHERE id = ?').run(name, id)
  return getFolderById(id)
}

// ─── Delete ──────────────────────────────────────────────────

/**
 * Delete a folder. Cascade is handled by the SQL FK (`ON DELETE CASCADE` on
 * both `test_suite_folders.parent_id` and `test_suite_items.folder_id`),
 * so nested folders and items underneath disappear in one shot.
 */
export function deleteFolder(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM test_suite_folders WHERE id = ?').run(id)
  return result.changes > 0
}

// ─── Move (drag-drop reorder) ───────────────────────────────

/**
 * Move a folder under a new parent and into a specific position. Same
 * splice + renumber pattern as `test-suite-item.repo.ts#moveItem`. Cycle
 * prevention (folder dropped into itself or a descendant) is the caller's
 * responsibility — the IPC handler already enforces this for APIs tree
 * moves, and the test-suite move handler will reuse that check.
 */
export function moveFolder(opts: {
  id: string
  targetSuiteId: string
  targetParentId: string | null
  insertBeforeId: string | null
}): TestSuiteFolderRow | undefined {
  const db = getDb()
  const existing = getFolderById(opts.id)
  if (!existing) return undefined

  const txn = db.transaction(() => {
    db.prepare('UPDATE test_suite_folders SET parent_id = ? WHERE id = ?').run(
      opts.targetParentId,
      opts.id,
    )

    const where =
      opts.targetParentId == null
        ? 'suite_id = ? AND parent_id IS NULL'
        : 'suite_id = ? AND parent_id = ?'
    const params =
      opts.targetParentId == null ? [opts.targetSuiteId] : [opts.targetSuiteId, opts.targetParentId]
    const siblings = db
      .prepare(
        `SELECT id FROM test_suite_folders WHERE ${where} ORDER BY sort_order ASC, created_at ASC`,
      )
      .all(...params) as Array<{ id: string }>

    const others = siblings.filter((s) => s.id !== opts.id).map((s) => s.id)
    const beforeIdx = opts.insertBeforeId ? others.indexOf(opts.insertBeforeId) : -1
    const ordered =
      beforeIdx >= 0
        ? [...others.slice(0, beforeIdx), opts.id, ...others.slice(beforeIdx)]
        : [...others, opts.id]

    const stmt = db.prepare('UPDATE test_suite_folders SET sort_order = ? WHERE id = ?')
    ordered.forEach((rowId, i) => stmt.run(i, rowId))
  })
  txn()
  return getFolderById(opts.id)
}

/**
 * Return true when `descendantId` is a transitive child of `ancestorId`
 * inside the suite folder tree (or when they refer to the same folder).
 * Used by the move handler to reject illegal drops (folder into self or
 * one of its descendants).
 */
export function isDescendantOf(descendantId: string, ancestorId: string): boolean {
  if (descendantId === ancestorId) return true
  const db = getDb()
  let cur: string | null = descendantId
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const row = db.prepare('SELECT parent_id FROM test_suite_folders WHERE id = ?').get(cur) as
      | { parent_id: string | null }
      | undefined
    if (!row) return false
    if (row.parent_id === ancestorId) return true
    cur = row.parent_id
  }
  return false
}
