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

export type RunnableKind = 'endpoint' | 'request'

/**
 * Resolve the project_id of either an endpoint or a saved request. Returns
 * null when the id matches nothing — caller decides whether that's a 404
 * or an authentication failure.
 */
export function projectIdOfRunnable(id: string): string | null {
  const ep = endpointRepo.getEndpointById(id)
  if (ep) return ep.project_id
  const sr = endpointRepo.getSavedRequestById(id)
  return sr?.project_id ?? null
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
