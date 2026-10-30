/**
 * Mixed folder / endpoint / saved-request fixture for issue #257 (export item
 * order = APIs tree order). Shared by
 *   - tests/renderer/tree-order-257.test.ts      (pins what the APIs tree renders)
 *   - tests/main/export-order-tree-257.test.ts   (asserts Postman v2.1 + v3 match it)
 *
 * `sort` values are the raw `sort_order` columns. They are deliberately NOT in
 * tree order, and every divergence between the tree and the exports is hit:
 *
 *  - inside a folder the tree lists the requests BEFORE the sub-folders
 *    (Alpha: E-alpha-1, E-alpha-2, S-alpha, then Alpha-Sub1, Alpha-Sub2);
 *    exports put sub-folders first;
 *  - the tree lists a level's endpoints BEFORE its saved requests, whatever
 *    their sort_order (S-alpha=4 < E-alpha-2=6, yet E-alpha-2 comes first);
 *    exports merge the two tables by sort_order;
 *  - at the ROOT the tree lists folders first, then endpoints, then saved
 *    requests (Alpha, Beta, E-root, S-root) — the one place exports already
 *    agree on for v2.1.
 */
export interface FxFolder {
  name: string
  parent: string | null
  sort: number
}
export interface FxRequest {
  name: string
  folder: string | null
  sort: number
}

export const FOLDERS: FxFolder[] = [
  { name: 'Alpha', parent: null, sort: 0 },
  { name: 'Beta', parent: null, sort: 1 },
  { name: 'Alpha-Sub1', parent: 'Alpha', sort: 2 },
  { name: 'Alpha-Sub2', parent: 'Alpha', sort: 3 },
]

export const ENDPOINTS: FxRequest[] = [
  { name: 'E-alpha-1', folder: 'Alpha', sort: 0 },
  { name: 'E-sub1', folder: 'Alpha-Sub1', sort: 1 },
  { name: 'E-beta', folder: 'Beta', sort: 2 },
  { name: 'E-root', folder: null, sort: 3 },
  { name: 'E-alpha-2', folder: 'Alpha', sort: 6 },
]

export const SAVED: FxRequest[] = [
  { name: 'S-alpha', folder: 'Alpha', sort: 4 },
  { name: 'S-sub2', folder: 'Alpha-Sub2', sort: 5 },
  { name: 'S-root', folder: null, sort: 7 },
]

/** A request is a string, a folder is `{ [folderName]: children }`. */
export type OrderNode = string | { [folder: string]: OrderNode[] }

/** The order the APIs tree shows today (the contract the exports must follow). */
export const EXPECTED_TREE_ORDER: OrderNode[] = [
  {
    Alpha: [
      'E-alpha-1',
      'E-alpha-2',
      'S-alpha',
      { 'Alpha-Sub1': ['E-sub1'] },
      { 'Alpha-Sub2': ['S-sub2'] },
    ],
  },
  { Beta: ['E-beta'] },
  'E-root',
  'S-root',
]
