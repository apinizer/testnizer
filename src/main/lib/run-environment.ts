/**
 * The environment a run used (issue #307) — main's writer and reader for
 * `runner_history.environment_name`. Encoding: `src/shared/run-environment.ts`.
 *
 * Writer: `snapshotRunEnvironmentName` runs once at run start with the id the
 * run actually resolves variables from (explicit, or the project's active
 * environment as fallback) and stores the NAME. A later rename / delete never
 * rewrites history.
 *
 * Reader: `withRunEnvironmentNames` is applied by every `runner_history`
 * reader (`runner:history` in both argument forms, `scheduler:history`) so the
 * renderer only ever sees the shared encoding. Rows written before issue #307
 * held `options.environmentId` (an id) or NULL: an id of an environment that
 * still exists shows its CURRENT name, a gone id and NULL are unknown (null).
 */
import { getDb } from '../db/database'
import { NO_ENVIRONMENT } from '../../shared/run-environment'

type Db = ReturnType<typeof getDb>

/** Environment ids are `randomUUID()` everywhere they are created. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function environmentNameById(db: Db, id: string, projectId: string | null): string | undefined {
  const row = db
    .prepare(
      'SELECT name FROM environments WHERE id = ? AND (project_id = ? OR project_id IS NULL)',
    )
    .get(id, projectId) as { name: string | null } | undefined
  return row ? (row.name ?? '') : undefined
}

/**
 * The name to store for a run whose variables come from `environmentId`
 * ('' when it has none, or names an environment that does not exist — the run
 * then resolved no environment variables either).
 */
export function snapshotRunEnvironmentName(
  db: Db,
  environmentId: string | undefined,
  projectId: string | null,
): string {
  if (!environmentId) return NO_ENVIRONMENT
  try {
    return environmentNameById(db, environmentId, projectId) ?? NO_ENVIRONMENT
  } catch {
    return NO_ENVIRONMENT
  }
}

/** Resolve one stored value to the shared encoding (string, '' or null). */
export function resolveStoredRunEnvironmentName(
  db: Db,
  stored: unknown,
  projectId: string | null,
): string | null {
  if (typeof stored !== 'string') return null
  if (stored === NO_ENVIRONMENT) return NO_ENVIRONMENT
  let current: string | undefined
  try {
    current = environmentNameById(db, stored, projectId)
  } catch {
    current = undefined
  }
  if (current !== undefined) return current // legacy id row, environment still exists
  if (UUID_RE.test(stored)) return null // legacy id row, environment deleted
  return stored // a snapshotted name
}

interface StoredRunRow {
  environment_name?: unknown
  project_id?: unknown
}

/** Every `runner_history` reader passes its rows through here. */
export function withRunEnvironmentNames<T extends StoredRunRow>(
  db: Db,
  rows: readonly T[],
): Array<T & { environment_name: string | null }> {
  const cache = new Map<string, string | null>()
  return rows.map((row) => {
    const projectId = typeof row.project_id === 'string' ? row.project_id : null
    const stored = row.environment_name
    if (typeof stored !== 'string') return { ...row, environment_name: null }
    const key = `${projectId ?? ''}\u0000${stored}`
    if (!cache.has(key)) {
      cache.set(key, resolveStoredRunEnvironmentName(db, stored, projectId))
    }
    return { ...row, environment_name: cache.get(key) ?? null }
  })
}

interface StoredTaskRow {
  environment_id?: unknown
  project_id?: unknown
}

/**
 * `scheduler:list` rows get `environment_name` (issue #307): the task
 * environment's CURRENT name, '' when the task has none, null when the
 * environment it names was deleted. The renderer never shows the raw id.
 */
export function withTaskEnvironmentNames<T extends StoredTaskRow>(
  db: Db,
  rows: readonly T[],
): Array<T & { environment_name: string | null }> {
  return rows.map((row) => {
    const id = row.environment_id
    if (typeof id !== 'string' || !id) return { ...row, environment_name: NO_ENVIRONMENT }
    const projectId = typeof row.project_id === 'string' ? row.project_id : null
    let name: string | undefined
    try {
      name = environmentNameById(db, id, projectId)
    } catch {
      name = undefined
    }
    return { ...row, environment_name: name ?? null }
  })
}
