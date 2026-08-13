/**
 * Issue #107 — "Search results skip requests located directly under a
 * matching folder".
 *
 * Repro: folder "TVS Prod" holds the request "JWT Token Alma" at its root
 * plus sub-folders. Searching "TVS" listed the sub-branches that also matched
 * but dropped the root-level request: in `filterTree` (TreeView.tsx) the
 * ternary `children.length > 0 ? children : selfMatch ? node.children : []`
 * let the filtered-children array win over the self-match, so a folder whose
 * OWN name matched only kept its full subtree when NO descendant matched too.
 *
 * Expected (Postman/Insomnia/Bruno standard): a folder-name match keeps
 * everything underneath it — root-level requests AND non-matching
 * sub-branches — while non-matching sibling folders stay hidden.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'

// jsdom gives the scroll container a 0px rect, so the real virtualizer renders
// no rows at all. Swap it for a pass-through that yields every row — this
// suite is about which rows TreeView asks for, not about windowing.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 30,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * 30,
        size: 30,
      })),
  }),
}))

import TreeView from '../../src/renderer/components/sidebar/TreeView'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { TreeNode } from '../../src/renderer/types'

const tree: TreeNode[] = [
  {
    id: 'f-tvs',
    label: 'TVS Prod',
    type: 'folder',
    icon: 'folder',
    children: [
      // Root-level request whose name does NOT contain the query.
      { id: 'r-jwt', label: 'JWT Token Alma', type: 'request', method: 'POST', path: '/token' },
      // Sub-folder that ALSO matches the query — this is what triggered the
      // bug: a surviving filtered-children array displaced the full subtree.
      {
        id: 'f-tvs-int',
        label: 'TVS Internal',
        type: 'folder',
        icon: 'folder',
        children: [
          { id: 'r-detail', label: 'Get Token Detail', type: 'request', method: 'GET', path: '/detail' },
        ],
      },
      // Non-matching sub-branch — kept because the parent folder matched.
      {
        id: 'f-utils',
        label: 'Utils',
        type: 'folder',
        icon: 'folder',
        children: [{ id: 'r-ping', label: 'Ping', type: 'request', method: 'GET', path: '/ping' }],
      },
    ],
  },
  // Non-matching sibling folder — must stay hidden.
  {
    id: 'f-billing',
    label: 'Billing',
    type: 'folder',
    icon: 'folder',
    children: [
      { id: 'r-invoice', label: 'Invoice', type: 'request', method: 'GET', path: '/invoice' },
    ],
  },
]

describe('APIs tree search — folder-name match keeps root-level requests (issue #107)', () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useWorkspaceStore.setState({
      treeData: tree,
      openNodeIds: new Set(['f-tvs', 'f-billing']),
      searchQuery: 'tvs',
      activeProjectId: 'proj-1',
      activeNodeId: null,
      refreshTree: async () => {},
    })
  })

  afterEach(() => cleanup())

  it('keeps a request that sits directly under the matching folder', () => {
    render(<TreeView />)
    expect(screen.getByText('TVS Prod')).toBeTruthy()
    // The reported repro: this row was silently dropped.
    expect(screen.getByText('JWT Token Alma')).toBeTruthy()
  })

  it('keeps the entire subtree of a matching folder, but not non-matching siblings', () => {
    render(<TreeView />)
    // Matching sub-branch and its contents.
    expect(screen.getByText('TVS Internal')).toBeTruthy()
    expect(screen.getByText('Get Token Detail')).toBeTruthy()
    // Non-matching sub-branch — visible because the parent folder matched.
    expect(screen.getByText('Utils')).toBeTruthy()
    expect(screen.getByText('Ping')).toBeTruthy()
    // Non-matching sibling folder stays filtered out.
    expect(screen.queryByText('Billing')).toBeNull()
    expect(screen.queryByText('Invoice')).toBeNull()
  })
})
