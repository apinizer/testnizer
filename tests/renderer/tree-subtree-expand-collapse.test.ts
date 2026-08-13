/**
 * Issue #106 — folder right-click → "Collapse All" / "Expand All".
 *
 * Store-level contract for the recursive open/close actions:
 *   - collapseSubtree(id): closes every open DESCENDANT of the folder but
 *     leaves the folder's own open-state untouched — the user keeps seeing its
 *     direct children, now all collapsed. Siblings/ancestors are untouched.
 *   - expandSubtree(id): opens the folder itself AND every descendant with
 *     children. Including the folder is deliberate: expanding only the
 *     descendants of a closed folder would visibly do nothing (the #39/#70
 *     dead-control class).
 *   - Unknown ids and leaf nodes are no-ops.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { TreeNode } from '../../src/renderer/types'

const tree: TreeNode[] = [
  {
    id: 'm1',
    label: 'Project',
    type: 'module',
    children: [
      {
        id: 'a',
        label: 'TVS Prod',
        type: 'folder',
        icon: 'folder',
        children: [
          { id: 'r1', label: 'JWT Token Alma', type: 'request', method: 'POST', path: '/token' },
          {
            id: 'b',
            label: 'Internal',
            type: 'folder',
            icon: 'folder',
            children: [
              {
                id: 'c',
                label: 'Deep',
                type: 'folder',
                icon: 'folder',
                children: [
                  { id: 'r2', label: 'Ping', type: 'request', method: 'GET', path: '/ping' },
                ],
              },
            ],
          },
          { id: 'empty', label: 'Empty Folder', type: 'folder', icon: 'folder', children: [] },
        ],
      },
      {
        id: 'd',
        label: 'Billing',
        type: 'folder',
        icon: 'folder',
        children: [
          { id: 'r3', label: 'Invoice', type: 'request', method: 'GET', path: '/invoice' },
        ],
      },
    ],
  },
]

const openIds = () => useWorkspaceStore.getState().openNodeIds

describe('workspace.store collapseSubtree / expandSubtree (issue #106)', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      treeData: tree,
      openNodeIds: new Set(['m1', 'a', 'b', 'c', 'd']),
    })
  })

  it('collapseSubtree closes every descendant but not the folder itself, its siblings, or ancestors', () => {
    useWorkspaceStore.getState().collapseSubtree('a')
    expect(openIds()).toEqual(new Set(['m1', 'a', 'd']))
  })

  it('expandSubtree opens the folder itself and every descendant with children', () => {
    useWorkspaceStore.setState({ openNodeIds: new Set(['m1']) })
    useWorkspaceStore.getState().expandSubtree('a')
    // 'a' itself included (expanding a closed folder must be visible),
    // 'empty' and requests are not expandable, sibling 'd' untouched.
    expect(openIds()).toEqual(new Set(['m1', 'a', 'b', 'c']))
  })

  it('collapseSubtree then expandSubtree round-trips the subtree', () => {
    useWorkspaceStore.getState().collapseSubtree('a')
    useWorkspaceStore.getState().expandSubtree('a')
    expect(openIds()).toEqual(new Set(['m1', 'a', 'b', 'c', 'd']))
  })

  it('is a no-op for unknown ids', () => {
    useWorkspaceStore.getState().collapseSubtree('nope')
    expect(openIds()).toEqual(new Set(['m1', 'a', 'b', 'c', 'd']))
    useWorkspaceStore.getState().expandSubtree('nope')
    expect(openIds()).toEqual(new Set(['m1', 'a', 'b', 'c', 'd']))
  })

  it('is a no-op for leaf nodes (requests, empty folders)', () => {
    useWorkspaceStore.getState().collapseSubtree('r1')
    useWorkspaceStore.getState().expandSubtree('empty')
    expect(openIds()).toEqual(new Set(['m1', 'a', 'b', 'c', 'd']))
  })
})
