/**
 * APIs tree order — the ONE definition (issue #257).
 *
 * The APIs tree (`workspace.store` `buildTreeFromDB`) and every project
 * collection export (Postman v2.1, Postman v3 JSON and folder form) list a
 * level's children in this order, so an exported collection reads like the
 * tree the user built:
 *
 *   project root: folders, then endpoints, then saved requests
 *   inside a folder: endpoints, then saved requests, then sub-folders
 *
 * Endpoints and saved requests are NOT interleaved by `sort_order` (the tree
 * never did); within each kind the caller's order (`ORDER BY sort_order`) is
 * kept. Test SUITES have their own rule (a level's requests, then its folders
 * — `suite-order.ts`) and do not come through here.
 */

export interface TreeLevel<T> {
  folders: readonly T[]
  endpoints: readonly T[]
  savedRequests: readonly T[]
}

/** One level's children in tree order. `atRoot` = the project root. */
export function orderTreeLevel<T>(level: TreeLevel<T>, atRoot: boolean): T[] {
  const requests = [...level.endpoints, ...level.savedRequests]
  return atRoot ? [...level.folders, ...requests] : [...requests, ...level.folders]
}

/**
 * A project's request rows (both tables) in tree order within a level:
 * endpoints first, then saved requests, each kind keeping the given order.
 */
export function orderTreeRequests<T>(rows: readonly T[], isSavedRequest: (row: T) => boolean): T[] {
  return [...rows.filter((r) => !isSavedRequest(r)), ...rows.filter(isSavedRequest)]
}
