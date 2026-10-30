/**
 * Issue #291 — table-by-table, row-by-row comparison of two Testnizer
 * databases (the one an older build wrote, and the same file after a newer
 * build opened and migrated it).
 *
 * Uses Node's built-in `node:sqlite`, which is not tied to the Electron ABI
 * that better-sqlite3 in node_modules is built for. It is a Node 22.5+ builtin,
 * so it is resolved lazily: on an older Node the caller skips instead of
 * crashing test collection (see the db-migration.spec.ts note).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

type Row = Record<string, unknown>
interface SqliteStatement {
  all(...params: unknown[]): Row[]
  run(...params: unknown[]): unknown
}
interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  exec(sql: string): void
  close(): void
}
type SqliteCtor = new (file: string, opts?: { readOnly?: boolean }) => SqliteDatabase

export const DatabaseSync: SqliteCtor | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('node:sqlite') as { DatabaseSync: SqliteCtor }).DatabaseSync
  } catch {
    return null
  }
})()

export interface TableSnapshot {
  columns: string[]
  key: string[]
  rows: Map<string, Row>
}
export type DbSnapshot = Map<string, TableSnapshot>

/** Copy the DB (+ WAL/SHM) to a temp dir first so reading never touches the original. */
export function snapshotDb(dbPath: string): DbSnapshot {
  if (!DatabaseSync) throw new Error('node:sqlite is not available on this Node')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnz-snap-'))
  const copy = path.join(tmp, 'db.sqlite')
  fs.copyFileSync(dbPath, copy)
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(dbPath + ext)) fs.copyFileSync(dbPath + ext, copy + ext)
  }
  const db = new DatabaseSync(copy)
  try {
    const out: DbSnapshot = new Map()
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => String(r.name))
    for (const t of tables) {
      const info = db.prepare(`PRAGMA table_info("${t}")`).all() as Array<{
        name: string
        pk: number
      }>
      const columns = info.map((c) => c.name)
      const pk = info
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name)
      const key = pk.length > 0 ? pk : ['rowid']
      const select = pk.length > 0 ? '*' : 'rowid AS rowid, *'
      const rows = new Map<string, Row>()
      for (const r of db.prepare(`SELECT ${select} FROM "${t}"`).all()) {
        rows.set(JSON.stringify(key.map((k) => normalise(r[k]))), r)
      }
      out.set(t, { columns, key, rows })
    }
    return out
  } finally {
    db.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

function normalise(v: unknown): unknown {
  if (v instanceof Uint8Array) return `blob:${Buffer.from(v).toString('base64')}`
  if (typeof v === 'bigint') return Number(v)
  return v
}

/**
 * A column whose value a migration is ALLOWED to change, and how to tell a
 * legitimate change from data loss. `accept(oldValue, newValue, oldRow)`
 * returns true when the change is the documented one.
 */
export interface ChangeRule {
  table: string
  column: string
  reason: string
  accept: (oldValue: unknown, newValue: unknown, oldRow: Row) => boolean
}

export interface DiffReport {
  tablesCompared: number
  rowsCompared: number
  missingTables: string[]
  missingRows: Array<{ table: string; key: string }>
  changedValues: Array<{ table: string; key: string; column: string; old: unknown; new: unknown }>
  /** Changes that matched a ChangeRule — expected, listed for the report. */
  acceptedChanges: Array<{ table: string; column: string; reason: string; count: number }>
  addedTables: string[]
  addedRows: Array<{ table: string; count: number }>
}

/**
 * Every OLD row must exist in NEW with every OLD column equal, unless a
 * ChangeRule accepts the difference. New tables, new columns and new rows are
 * additive and only reported.
 */
export function diffSnapshots(
  oldDb: DbSnapshot,
  newDb: DbSnapshot,
  rules: ChangeRule[],
): DiffReport {
  const report: DiffReport = {
    tablesCompared: 0,
    rowsCompared: 0,
    missingTables: [],
    missingRows: [],
    changedValues: [],
    acceptedChanges: [],
    addedTables: [...newDb.keys()].filter((t) => !oldDb.has(t)),
    addedRows: [],
  }
  const accepted = new Map<
    string,
    { table: string; column: string; reason: string; count: number }
  >()
  for (const [table, oldT] of oldDb) {
    const newT = newDb.get(table)
    if (!newT) {
      report.missingTables.push(table)
      continue
    }
    report.tablesCompared++
    for (const [key, oldRow] of oldT.rows) {
      const newRow = newT.rows.get(key)
      if (!newRow) {
        report.missingRows.push({ table, key })
        continue
      }
      report.rowsCompared++
      for (const col of oldT.columns) {
        if (!newT.columns.includes(col)) {
          report.changedValues.push({
            table,
            key,
            column: col,
            old: oldRow[col],
            new: '<column dropped>',
          })
          continue
        }
        const a = normalise(oldRow[col])
        const b = normalise(newRow[col])
        if (a === b) continue
        const rule = rules.find((r) => r.table === table && (r.column === col || r.column === '*'))
        if (rule && rule.accept(a, b, oldRow)) {
          const id = `${table}.${col}`
          const entry = accepted.get(id) ?? { table, column: col, reason: rule.reason, count: 0 }
          entry.count++
          accepted.set(id, entry)
          continue
        }
        report.changedValues.push({ table, key, column: col, old: a, new: b })
      }
    }
    const added = [...newT.rows.keys()].filter((k) => !oldT.rows.has(k)).length
    if (added > 0) report.addedRows.push({ table, count: added })
  }
  report.acceptedChanges = [...accepted.values()]
  return report
}

/** True when the old value was stored plaintext and the new one is sealed (#239). */
export function sealedFrom(oldValue: unknown, newValue: unknown): boolean {
  return (
    typeof oldValue === 'string' &&
    typeof newValue === 'string' &&
    !oldValue.startsWith('enc:') &&
    newValue.startsWith('enc:v1:')
  )
}

/**
 * True when `newValue` is `oldValue` with one or more substrings replaced by
 * the app's mask (`••••••`) — what the History / Runner masking sweeps
 * (issues #195, #238) do to a credential echoed in a stored row. Every other
 * character must be identical.
 */
export function maskedFrom(oldValue: unknown, newValue: unknown): boolean {
  if (typeof oldValue !== 'string' || typeof newValue !== 'string') return false
  if (!newValue.includes('•')) return false
  const pattern = newValue
    .split(/•+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^]+?')
  return new RegExp(`^${pattern}$`).test(oldValue)
}

/**
 * Write a minimal SQL dump (schema + rows) — used to turn a generated fixture
 * DB into a reviewable, checked-in text file.
 */
export function dumpSql(dbPath: string, opts: { dropRows?: Record<string, string> } = {}): string {
  if (!DatabaseSync) throw new Error('node:sqlite is not available on this Node')
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const lines: string[] = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;']
    const objects = db
      .prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
      )
      .all()
    for (const o of objects.filter((x) => x.type === 'table')) {
      lines.push(`${String(o.sql)};`)
      const filter = opts.dropRows?.[String(o.name)]
      const rows = db
        .prepare(`SELECT * FROM "${String(o.name)}"${filter ? ` WHERE NOT (${filter})` : ''}`)
        .all()
      for (const r of rows) {
        const cols = Object.keys(r)
        const vals = cols.map((c) => sqlLiteral(r[c]))
        lines.push(
          `INSERT INTO "${String(o.name)}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${vals.join(',')});`,
        )
      }
    }
    for (const o of objects.filter((x) => x.type !== 'table')) lines.push(`${String(o.sql)};`)
    lines.push('COMMIT;')
    return lines.join('\n') + '\n'
  } finally {
    db.close()
  }
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number' || typeof v === 'bigint') return String(v)
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`
  return `'${String(v).replace(/'/g, "''")}'`
}

/** Recreate a DB file from a dump written by {@link dumpSql}. */
export function restoreSql(sql: string, dbPath: string): void {
  if (!DatabaseSync) throw new Error('node:sqlite is not available on this Node')
  const db = new DatabaseSync(dbPath)
  try {
    db.exec(sql)
  } finally {
    db.close()
  }
}

/** A row of the DB `settings` table (migration markers live there), read from a copy. */
export function readDbSetting(dbPath: string, key: string): string | null {
  const row = snapshotDb(dbPath)
    .get('settings')
    ?.rows.get(JSON.stringify([key]))
  return row ? String(row.value) : null
}

/** Every table's row count — the coarse half of the report. */
export function rowCounts(snap: DbSnapshot): Record<string, number> {
  return Object.fromEntries([...snap].map(([t, s]) => [t, s.rows.size]))
}
