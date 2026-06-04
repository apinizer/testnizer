/**
 * Cross-project / cross-workspace boundary checks at the IPC layer.
 *
 * The renderer is trusted in the happy path, but a corrupted sessionStorage
 * payload (downgrade, project switch race) or a buggy/malicious DOM script
 * shouldn't let one project mutate another's rows. Each helper here looks
 * up the source row, compares the owning `project_id`, and returns a plain
 * boolean — call-sites map `false` to an `ipcFail` response.
 */
import * as endpointRepo from '../db/endpoint.repo'
import * as projectRepo from '../db/project.repo'
import { getDb } from '../db/database'

export type RunnableKind = 'endpoint' | 'request' | 'suite_item'

/**
 * Resolve the project_id of an endpoint, a saved request, or a test-suite
 * item. Suite items inherit their project from the parent suite (one JOIN
 * because test_suite_items has no project_id column). Returns null when
 * nothing matches — caller decides whether that's a 404 or a refusal.
 */
export function projectIdOfRunnable(id: string): string | null {
  const ep = endpointRepo.getEndpointById(id)
  if (ep) return ep.project_id
  const sr = endpointRepo.getSavedRequestById(id)
  if (sr) return sr.project_id
  const row = getDb()
    .prepare(
      `SELECT s.project_id AS project_id
         FROM test_suite_items i
         JOIN test_suites s ON s.id = i.suite_id
        WHERE i.id = ?`,
    )
    .get(id) as { project_id: string } | undefined
  return row?.project_id ?? null
}

/**
 * Verify a runnable (endpoint or saved request) belongs to the project the
 * caller claims. Returns `true` if the id owner matches, `false` otherwise
 * (including not-found, which is treated as a refusal to leak existence).
 */
export function isRunnableInProject(id: string, projectId: string): boolean {
  const owner = projectIdOfRunnable(id)
  return owner !== null && owner === projectId
}

/** Same idea for a folder id. */
export function isFolderInProject(folderId: string, projectId: string): boolean {
  const f = projectRepo.getFolderById(folderId)
  return f?.project_id === projectId
}
