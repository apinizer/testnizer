/**
 * Issue #115 — "Reveal in APIs" on a Run-results row.
 *
 * Clicking a result row opens the details pane and must keep doing so, so
 * navigating to the request's place in the APIs tree is a separate control.
 * Revealing has to do three things at once or it lands on nothing:
 *
 *   - open every ancestor folder (a collapsed parent hides the row),
 *   - clear the search box (a filtered tree force-expands only its own
 *     matches and ignores `openNodeIds` entirely — issue #70's mechanism),
 *   - select the row and signal TreeView to scroll it into view.
 *
 * And it has to fail honestly: a suite item, or a request deleted since the
 * run, is not in the tree, and the caller shows a message rather than
 * navigating to a node that is not there.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore, ancestorPath } from '../../src/renderer/stores/workspace.store'
import type { TreeNode } from '../../src/renderer/types'

const TREE: TreeNode[] = [
  {
    id: 'default-module',
    type: 'module',
    label: 'Default module',
    children: [
      {
        id: 'folder-a',
        type: 'folder',
        label: 'Users',
        children: [
          {
            id: 'folder-b',
            type: 'folder',
            label: 'Admin',
            children: [{ id: 'ep-deep', type: 'endpoint', label: 'Delete user', method: 'DELETE' }],
          },
          { id: 'ep-shallow', type: 'endpoint', label: 'List users', method: 'GET' },
        ],
      },
      { id: 'ep-root', type: 'endpoint', label: 'Health', method: 'GET' },
    ],
  },
]

beforeEach(() => {
  useWorkspaceStore.setState({
    treeData: TREE,
    openNodeIds: new Set(['default-module']),
    activeNodeId: null,
    searchQuery: '',
    revealCommand: { nodeId: '', seq: 0 },
  })
})

describe('ancestorPath', () => {
  it('lists the folders to open, outermost first', () => {
    expect(ancestorPath(TREE, 'ep-deep')).toEqual(['default-module', 'folder-a', 'folder-b'])
  })

  it('returns an empty path — not null — for a root node', () => {
    // A root node IS revealable; only a missing node is not. Collapsing the
    // two would make every top-level request report "not found".
    expect(ancestorPath(TREE, 'default-module')).toEqual([])
  })

  it('returns null for an id that is not in the tree', () => {
    expect(ancestorPath(TREE, 'suite-item-1')).toBeNull()
  })
})

describe('revealNode', () => {
  it('opens every ancestor folder of the target', () => {
    expect(useWorkspaceStore.getState().revealNode('ep-deep')).toBe(true)

    const open = useWorkspaceStore.getState().openNodeIds
    expect(open.has('folder-a')).toBe(true)
    expect(open.has('folder-b')).toBe(true)
  })

  it('selects the revealed request', () => {
    useWorkspaceStore.getState().revealNode('ep-deep')
    expect(useWorkspaceStore.getState().activeNodeId).toBe('ep-deep')
  })

  it('clears the search box, which would otherwise hide the row', () => {
    useWorkspaceStore.setState({ searchQuery: 'health' })
    useWorkspaceStore.getState().revealNode('ep-deep')
    expect(useWorkspaceStore.getState().searchQuery).toBe('')
  })

  it('bumps the reveal command so TreeView scrolls to it', () => {
    useWorkspaceStore.getState().revealNode('ep-deep')
    const first = useWorkspaceStore.getState().revealCommand
    expect(first).toEqual({ nodeId: 'ep-deep', seq: 1 })

    // Revealing the SAME node twice must still signal — a user who scrolled
    // away and clicked again expects to be taken back.
    useWorkspaceStore.getState().revealNode('ep-deep')
    expect(useWorkspaceStore.getState().revealCommand.seq).toBe(2)
  })

  it('keeps folders the user already had open', () => {
    useWorkspaceStore.setState({ openNodeIds: new Set(['default-module', 'other-folder']) })
    useWorkspaceStore.getState().revealNode('ep-shallow')
    expect(useWorkspaceStore.getState().openNodeIds.has('other-folder')).toBe(true)
  })

  it('reports false and changes nothing for a request that is not in the tree', () => {
    const before = useWorkspaceStore.getState()
    expect(useWorkspaceStore.getState().revealNode('suite-item-1')).toBe(false)

    const after = useWorkspaceStore.getState()
    expect(after.activeNodeId).toBe(before.activeNodeId)
    expect(after.revealCommand.seq).toBe(0)
  })

  it('works for a root-level request with no folders to open', () => {
    expect(useWorkspaceStore.getState().revealNode('ep-root')).toBe(true)
    expect(useWorkspaceStore.getState().activeNodeId).toBe('ep-root')
  })
})
