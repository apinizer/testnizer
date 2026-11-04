/**
 * One-time upgrade step for "absolute file paths outside the working directory
 * need `readFilesOutsideWorkingDirectory`" (`lib/working-directory.ts`).
 *
 * Until then Send and Run read any absolute path a request held. Without this
 * step, an upgrade would stop existing requests and Scheduler tasks that upload
 * a file, so every project that already holds an enabled absolute file path
 * turns the setting on. Projects with none stay off.
 *
 * The setting lives in electron-store and the marker in the DB, so they cannot
 * be written together. The store goes first, the marker last: a crash in
 * between runs this again, and turning the setting on twice changes nothing.
 * A failed store write leaves no marker, so the next start finishes the job.
 * After the marker the setting is the user's: this never runs again.
 *
 * Asynchronous because electron-store is ESM-only (dynamic import). `index.ts`
 * awaits it before `registerAllHandlers`, which starts the Scheduler. Never
 * throws: a damaged row is skipped, it cannot be sent anyway.
 */
import type Database from 'better-sqlite3'
import { isAbsolute } from 'path'
import { bodyFilePaths, type FileBodyLike } from '../lib/body-file-paths'
import { allowFilesOutsideWorkingDirectory } from '../lib/project-settings'

export const FILES_OUTSIDE_WD_MIGRATION_KEY = 'migration.filesOutsideWorkingDirectory.v1'

export interface FilesOutsideWdMigrationResult {
  /** false when the marker was already present, or it must run again. */
  ran: boolean
  /** Projects the setting was turned on for. */
  enabled: number
}

/** Rows that can hold a request body, as JSON text columns, with their project. */
const MENTIONS = (col: string): string => `(${col} LIKE '%binaryPath%' OR ${col} LIKE '%filePath%')`
const ROW_QUERIES = [
  `SELECT project_id AS projectId, request_schema AS a, NULL AS b FROM endpoints
    WHERE ${MENTIONS('request_schema')}`,
  `SELECT project_id AS projectId, body AS a, metadata AS b FROM saved_requests
    WHERE project_id IS NOT NULL AND (${MENTIONS('body')} OR ${MENTIONS('metadata')})`,
  `SELECT s.project_id AS projectId, i.request_schema AS a, NULL AS b
     FROM test_suite_items i JOIN test_suites s ON s.id = i.suite_id
    WHERE ${MENTIONS('i.request_schema')}`,
]

/** A stored path that is absolute, or `{{dir}}/x`, which may resolve to one. */
function mayBeAbsolute(p: unknown): boolean {
  return typeof p === 'string' && (isAbsolute(p) || p.includes('{{'))
}

/** Does this JSON value hold a body that reads such a file, at any depth? */
function holdsAbsoluteFile(value: unknown): boolean {
  if (typeof value === 'string') {
    return /^\s*[{[]/.test(value) && /binaryPath|filePath/.test(value)
      ? holdsAbsoluteFile(JSON.parse(value))
      : false
  }
  if (Array.isArray(value)) return value.some(holdsAbsoluteFile)
  if (!value || typeof value !== 'object') return false
  if (bodyFilePaths(value as FileBodyLike).some(mayBeAbsolute)) return true
  return Object.values(value).some(holdsAbsoluteFile)
}

function columnHoldsAbsoluteFile(text: unknown): boolean {
  try {
    return holdsAbsoluteFile(text)
  } catch {
    return false // damaged JSON: not a request that can be sent
  }
}

export async function runFilesOutsideWorkingDirectoryMigration(
  db: Database.Database,
): Promise<FilesOutsideWdMigrationResult> {
  const result: FilesOutsideWdMigrationResult = { ran: false, enabled: 0 }
  try {
    const marker = db
      .prepare('SELECT 1 FROM settings WHERE key = ?')
      .get(FILES_OUTSIDE_WD_MIGRATION_KEY)
    if (marker !== undefined) return result

    const projects = new Set<string>()
    for (const sql of ROW_QUERIES) {
      const rows = db.prepare(sql).all() as Array<{ projectId: string; a: unknown; b: unknown }>
      for (const { projectId, a, b } of rows) {
        if (columnHoldsAbsoluteFile(a) || columnHoldsAbsoluteFile(b)) projects.add(projectId)
      }
    }

    let failed = false
    for (const projectId of projects) {
      try {
        await allowFilesOutsideWorkingDirectory(projectId)
        result.enabled += 1
      } catch {
        failed = true
      }
    }
    if (failed) return result

    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      FILES_OUTSIDE_WD_MIGRATION_KEY,
      JSON.stringify({ at: Date.now(), enabled: result.enabled }),
    )
    result.ran = true
  } catch {
    // Retried next launch (no marker written).
    return { ran: false, enabled: result.enabled }
  }
  return result
}
