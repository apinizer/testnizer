// Issue #269 (P0 data loss) — a tab whose saved row is gone.
//
// A request can lose its row while its tab stays open: deleted from the APIs
// tree (itself or a folder above it), from the Tests panel (item, folder,
// suite), or dropped by a git switch / pull replace. Ctrl+S used to "save"
// such a tab in place: the update hit no row, main answered success, the tab
// was marked clean and the edits were lost on close.
//
// Two entry points, one rule each:
//
//  - `orphanTab` — the in-place save found the row missing (git switch / pull,
//    a delete elsewhere). The tab is ORPHANED: it keeps its content, loses its
//    binding (endpoint / saved request / suite item id and the not-loaded
//    marks of issue #259, which would otherwise wait for a row that will never
//    come back) and is marked dirty, so the next save goes through Save As. It
//    is never closed and never marked clean.
//
//  - `releaseTabsForDeletedRows` — the user deleted the row on purpose (APIs
//    tree item or folder, Tests item, folder or suite). Every delete path calls
//    it. A CLEAN tab bound to a deleted row has nothing to lose, so it closes
//    like the tab-strip X would (protocol state torn down, the next tab
//    activated, no unsaved-changes prompt). A DIRTY tab is orphaned as above.

import { useTabsStore } from '../stores/tabs.store'
import { useRequestStore } from '../stores/request.store'
import { activateTabStores, forgetProtocolLost } from './activate-tab'
import { closeTabSafely } from './cleanup-tab-state'
import type { Tab, TreeNode } from '../types'

/** Unbind one tab from its row; keeps it open and dirty. */
export function orphanTab(tabId: string): void {
  const tabs = useTabsStore.getState()
  if (!tabs.tabs.some((t) => t.id === tabId)) return
  tabs.updateTab(tabId, {
    endpointId: undefined,
    savedRequestId: undefined,
    testSuiteItemId: undefined,
    // A preview tab would be replaced by the next single click in the tree.
    isPreview: false,
    isDirty: true,
    // Ctrl+S / Save use it to say why Save As opens for this tab.
    orphaned: true,
  })
  useRequestStore.getState().forgetUnloaded(tabId)
  forgetProtocolLost(tabId)
}

export interface RowRefs {
  endpointIds?: Iterable<string>
  savedRequestIds?: Iterable<string>
  testSuiteItemIds?: Iterable<string>
}

/** What `releaseTabsForDeletedRows` did with the open tabs of the deleted rows. */
export interface ReleasedTabs {
  /** Clean tabs, closed. */
  closed: string[]
  /** Dirty tabs, unbound and kept open (Save As on the next save). */
  orphaned: string[]
}

/**
 * The user deleted these rows: close every clean tab bound to one of them and
 * orphan every dirty one. The single rule for every sidebar delete path.
 */
export function releaseTabsForDeletedRows(refs: RowRefs): ReleasedTabs {
  const endpoints = new Set(refs.endpointIds ?? [])
  const saved = new Set(refs.savedRequestIds ?? [])
  const items = new Set(refs.testSuiteItemIds ?? [])
  const released: ReleasedTabs = { closed: [], orphaned: [] }
  if (endpoints.size + saved.size + items.size === 0) return released
  const bound = (t: Tab): boolean =>
    (!!t.endpointId && endpoints.has(t.endpointId)) ||
    (!!t.savedRequestId && saved.has(t.savedRequestId)) ||
    (!!t.testSuiteItemId && items.has(t.testSuiteItemId))
  const before = useTabsStore.getState()
  for (const t of before.tabs.filter(bound)) {
    if (t.isDirty) released.orphaned.push(t.id)
    else released.closed.push(t.id)
  }
  for (const id of released.orphaned) orphanTab(id)
  // `force`: a clean tab has nothing to confirm. Tears down its protocol
  // slices first (`cleanupTabState` needs the tab still in the store).
  for (const id of released.closed) closeTabSafely(id, { force: true })
  // Same as the tab-strip close: point the protocol stores at the tab that
  // became active (Workbench also does it on `activeTabId` change, but the
  // sidebar must not depend on that being mounted).
  const nextActive = useTabsStore.getState().activeTabId
  if (released.closed.length > 0 && nextActive && nextActive !== before.activeTabId) {
    activateTabStores(nextActive)
  }
  return released
}

function findNode(nodes: readonly TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = n.children ? findNode(n.children, id) : undefined
    if (hit) return hit
  }
  return undefined
}

/**
 * The endpoint and saved-request ids at and under `nodeId` in the APIs tree.
 * Read from the UNFILTERED tree: a node handed over by the search view has
 * its non-matching children pruned. Example rows are not requests.
 */
export function treeRowIds(
  tree: readonly TreeNode[],
  nodeId: string,
): { endpointIds: string[]; savedRequestIds: string[] } {
  const endpointIds: string[] = []
  const savedRequestIds: string[] = []
  const walk = (n: TreeNode): void => {
    if (n.type === 'endpoint') endpointIds.push(n.id)
    else if (n.type === 'request') savedRequestIds.push(n.id)
    for (const c of n.children ?? []) walk(c)
  }
  const root = findNode(tree, nodeId)
  if (root) walk(root)
  return { endpointIds, savedRequestIds }
}

/** APIs tree delete of `nodeId` (request, endpoint or folder): release its open tabs. */
export function releaseTabsForTreeNode(tree: readonly TreeNode[], nodeId: string): ReleasedTabs {
  return releaseTabsForDeletedRows(treeRowIds(tree, nodeId))
}

/** The suite item ids inside a Tests folder and every folder beneath it. */
export function suiteFolderItemIds(
  contents: {
    folders: ReadonlyArray<{ id: string; parent_id: string | null }>
    items: ReadonlyArray<{ id: string; folder_id: string | null }>
  },
  folderId: string,
): string[] {
  const subtree = new Set([folderId])
  for (let grew = true; grew; ) {
    grew = false
    for (const f of contents.folders) {
      if (f.parent_id && subtree.has(f.parent_id) && !subtree.has(f.id)) {
        subtree.add(f.id)
        grew = true
      }
    }
  }
  return contents.items.filter((i) => i.folder_id && subtree.has(i.folder_id)).map((i) => i.id)
}
