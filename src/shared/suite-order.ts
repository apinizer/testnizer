/**
 * Test-suite execution order — the ONE definition.
 *
 * `sort_order` on `test_suite_items` / `test_suite_folders` is a SIBLING index:
 * it is numbered per folder (`createItem`, `createFolder`, `moveItem`), so two
 * folders each have their own item 0, 1, 2… Sorting a whole suite by it
 * (`ORDER BY sort_order`) therefore runs "the first request of every module,
 * then the second of every module…" — a token created in module 00 arrived
 * after module 03 had already deployed with it. Every reader of a suite's
 * order (Run, Quick Run, Scheduler, export) goes through `orderSuiteItems`.
 *
 * The rule is a depth-first walk of the suite tree:
 *   at every level (the suite root included) the level's own requests run
 *   first, in `sort_order`, then each child folder in `sort_order`, whole.
 * That is the order the APIs folder Run uses (a folder's requests, then its
 * subfolders) and the order the Runner sequence numbers its rows in, so a suite
 * made from a folder runs exactly like that folder does from APIs.
 */

export interface SuiteOrderFolder {
  id: string
  parent_id: string | null
  sort_order: number
  created_at?: number
}

export interface SuiteOrderItem {
  id: string
  folder_id: string | null
  sort_order: number
  created_at?: number
}

const bySibling = (
  a: { sort_order: number; created_at?: number },
  b: { sort_order: number; created_at?: number },
): number => (a.sort_order ?? 0) - (b.sort_order ?? 0) || (a.created_at ?? 0) - (b.created_at ?? 0)

/**
 * Folders in tree order (pre-order: a folder, then its subtree), parents always
 * before children. A folder whose parent is not in the list is treated as a
 * root; folders caught in a `parent_id` cycle are appended last so a corrupt
 * row can neither hang the walk nor vanish.
 */
export function orderSuiteFolders<F extends SuiteOrderFolder>(folders: readonly F[]): F[] {
  const ids = new Set(folders.map((f) => f.id))
  const childrenOf = new Map<string | null, F[]>()
  for (const f of folders) {
    const key = f.parent_id && ids.has(f.parent_id) ? f.parent_id : null
    const list = childrenOf.get(key)
    if (list) list.push(f)
    else childrenOf.set(key, [f])
  }
  for (const list of childrenOf.values()) list.sort(bySibling)

  const out: F[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null): void => {
    for (const f of childrenOf.get(parent) ?? []) {
      if (seen.has(f.id)) continue
      seen.add(f.id)
      out.push(f)
      walk(f.id)
    }
  }
  walk(null)
  for (const f of folders) if (!seen.has(f.id)) out.push(f)
  return out
}

/**
 * Items in execution order (see the module comment). Items whose folder is not
 * part of `folders` (a dangling `folder_id`) run after everything else, in
 * sibling order, rather than disappearing from the run.
 */
export function orderSuiteItems<I extends SuiteOrderItem>(
  items: readonly I[],
  folders: readonly SuiteOrderFolder[],
): I[] {
  const folderIds = new Set(folders.map((f) => f.id))
  const itemsOf = new Map<string | null, I[]>()
  const dangling: I[] = []
  for (const it of items) {
    if (it.folder_id && !folderIds.has(it.folder_id)) {
      dangling.push(it)
      continue
    }
    const key = it.folder_id ?? null
    const list = itemsOf.get(key)
    if (list) list.push(it)
    else itemsOf.set(key, [it])
  }
  for (const list of itemsOf.values()) list.sort(bySibling)

  const childrenOf = new Map<string | null, SuiteOrderFolder[]>()
  for (const f of folders) {
    const key = f.parent_id && folderIds.has(f.parent_id) ? f.parent_id : null
    const list = childrenOf.get(key)
    if (list) list.push(f)
    else childrenOf.set(key, [f])
  }
  for (const list of childrenOf.values()) list.sort(bySibling)

  const out: I[] = []
  const seen = new Set<string>()
  const walk = (folderId: string | null): void => {
    out.push(...(itemsOf.get(folderId) ?? []))
    for (const f of childrenOf.get(folderId) ?? []) {
      if (seen.has(f.id)) continue
      seen.add(f.id)
      walk(f.id)
    }
  }
  walk(null)
  // Folders only reachable through a parent_id cycle.
  for (const f of folders) {
    if (seen.has(f.id)) continue
    seen.add(f.id)
    walk(f.id)
  }
  out.push(...dangling.sort(bySibling))
  return out
}

/**
 * Rows of a self-referencing table (`folders`, `test_suite_folders`) ordered so
 * every row comes after its parent. Import paths insert rows one by one with
 * `foreign_keys = ON`; an export ordered by `sort_order` (sibling index) puts a
 * child with sort_order 0 ahead of a parent with sort_order 3 and the child's
 * INSERT fails with a bare "FOREIGN KEY constraint failed". Relative order is
 * otherwise preserved; a parent outside the list counts as already present.
 */
export function parentsFirst<R extends { id?: unknown; parent_id?: unknown }>(
  rows: readonly R[],
): R[] {
  const byId = new Map<unknown, R>()
  for (const r of rows) byId.set(r.id, r)
  const out: R[] = []
  const done = new Set<R>()
  const visiting = new Set<R>()
  const visit = (r: R): void => {
    if (done.has(r) || visiting.has(r)) return
    visiting.add(r)
    const parent = r.parent_id != null ? byId.get(r.parent_id) : undefined
    if (parent && parent !== r) visit(parent)
    visiting.delete(r)
    done.add(r)
    out.push(r)
  }
  for (const r of rows) visit(r)
  return out
}
