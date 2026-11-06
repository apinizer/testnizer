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
import { projectsWithAbsoluteFiles } from '../lib/body-file-paths'
import { allowFilesOutsideWorkingDirectory } from '../lib/project-settings'

export const FILES_OUTSIDE_WD_MIGRATION_KEY = 'migration.filesOutsideWorkingDirectory.v1'

export interface FilesOutsideWdMigrationResult {
  /** false when the marker was already present, or it must run again. */
  ran: boolean
  /** Projects the setting was turned on for. */
  enabled: number
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

    const projects = projectsWithAbsoluteFiles(db)

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
