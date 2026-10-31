/**
 * One-time upgrade step for "the active environment is the DB `is_active` row"
 * (follow-up to issue #307).
 *
 * Until then the renderer store showed the FIRST environment of a project as
 * active when no row had `is_active = 1` (`hydrated[0]` of
 * `environment:listByProject` → `getEnvironmentsByProject`, `ORDER BY
 * created_at ASC`), and Send resolved from it — while Run / Mock / Scheduler,
 * which read `is_active`, used no environment. The store now mirrors the DB
 * exactly, so without this step such a project would open with
 * "No environment" and Send would stop resolving its variables.
 *
 * For every project that has environments but no active one, the environment
 * the old store picked becomes active: Send keeps what the user saw, and Run
 * now agrees with it. Ties on `created_at` break on `rowid` — the order SQLite
 * returns the store's query in (the `project_id` index walks rows in rowid
 * order). Workspace-level environments (`project_id IS NULL`) are untouched:
 * the store only ever listed project rows, so the fallback never applied.
 *
 * Runs ONCE (settings marker): afterwards "no active row" is a deliberate
 * "No environment" choice the user persisted, and must survive a restart.
 * Synchronous and cheap (one statement per affected project), run right after
 * the schema migrations and before the window loads, so the first
 * `environment:listByProject` already sees the result. Never throws.
 */
import type Database from 'better-sqlite3'

export const ACTIVE_ENVIRONMENT_MIGRATION_KEY = 'migration.activeEnvironment.v1'

export interface ActiveEnvironmentMigrationResult {
  /** false when the marker was already present (or the step failed). */
  ran: boolean
  /** Projects whose first environment was made active. */
  activated: number
}

export function runActiveEnvironmentMigration(
  db: Database.Database,
): ActiveEnvironmentMigrationResult {
  const result: ActiveEnvironmentMigrationResult = { ran: false, activated: 0 }
  try {
    const marker = db
      .prepare('SELECT 1 FROM settings WHERE key = ?')
      .get(ACTIVE_ENVIRONMENT_MIGRATION_KEY)
    if (marker !== undefined) return result

    const projects = db
      .prepare(
        `SELECT DISTINCT e.project_id AS projectId FROM environments e
          WHERE e.project_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM environments a WHERE a.project_id = e.project_id AND a.is_active = 1
            )`,
      )
      .all() as Array<{ projectId: string }>
    const firstOf = db.prepare(
      'SELECT id FROM environments WHERE project_id = ? ORDER BY created_at ASC, rowid ASC LIMIT 1',
    )
    // `updated_at` is left alone: this records what the user already saw, it
    // is not an edit (git merge compares `updated_at`).
    const activate = db.prepare('UPDATE environments SET is_active = 1 WHERE id = ?')
    const mark = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')

    db.transaction(() => {
      for (const { projectId } of projects) {
        const first = firstOf.get(projectId) as { id: string } | undefined
        if (!first) continue
        activate.run(first.id)
        result.activated += 1
      }
      mark.run(
        ACTIVE_ENVIRONMENT_MIGRATION_KEY,
        JSON.stringify({ at: Date.now(), activated: result.activated }),
      )
    })()
    result.ran = true
  } catch {
    // Retried next launch (no marker written: the transaction rolled back).
    return { ran: false, activated: 0 }
  }
  return result
}
