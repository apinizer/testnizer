/**
 * Issue #39 — folders under a project must be collapsible/expandable with one
 * action. workspace.store exposes collapseAllNodes / expandAllNodes which drive
 * the LeftPanel toggle button.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { TreeNode } from '../../src/renderer/types'

const tree: TreeNode[] = [
  {
    id: 'default-module',
    label: 'Default module',
    type: 'module',
    children: [
      {
        id: 'f1',
        label: 'Folder 1',
        type: 'folder',
        children: [
          { id: 'f2', label: 'Nested', type: 'folder', children: [] },
          { id: 'e1', label: 'Endpoint', type: 'endpoint' },
        ],
      },
    ],
  },
]

describe('workspace.store collapse/expand all (issue #39)', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      treeData: tree,
      openNodeIds: new Set(['default-module', 'f1', 'f2']),
    })
  })

  it('collapseAllNodes closes every folder but keeps module roots open', () => {
    useWorkspaceStore.getState().collapseAllNodes()
    const open = useWorkspaceStore.getState().openNodeIds
    expect(open.has('default-module')).toBe(true)
    expect(open.has('f1')).toBe(false)
    expect(open.has('f2')).toBe(false)
  })

  it('expandAllNodes opens every node that has children', () => {
    useWorkspaceStore.setState({ openNodeIds: new Set() })
    useWorkspaceStore.getState().expandAllNodes()
    const open = useWorkspaceStore.getState().openNodeIds
    expect(open.has('default-module')).toBe(true)
    expect(open.has('f1')).toBe(true)
    // f2 has an empty children array → nothing to expand, stays closed.
    expect(open.has('f2')).toBe(false)
  })
})
