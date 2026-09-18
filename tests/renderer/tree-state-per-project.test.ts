/**
 * Issue #123 — the APIs sidebar search filter and folder expansion must be
 * scoped per project tab. Typing a search in project A used to keep filtering
 * project B after a header-tab switch, and switching always reset the
 * expansion to defaults so B's folder context was lost.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const ok = (data: unknown) => Promise.resolve({ success: true, data })
  const folders: Record<string, unknown[]> = {
    A: [
      { id: 'fa1', name: 'Payments', parent_id: null, sort_order: 0 },
      { id: 'fa2', name: 'Refunds', parent_id: 'fa1', sort_order: 0 },
    ],
    B: [{ id: 'fb1', name: 'Users', parent_id: null, sort_order: 0 }],
  }
  const stub = {
    folder: { list: (projectId: string) => ok(folders[projectId] ?? []) },
    endpoint: { listByProject: () => ok([]) },
    savedRequest: { list: () => ok([]) },
  }
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = { api: stub }
  else g.window.api = stub
})

import {
  useWorkspaceStore,
  restoreProjectTreeState,
  computeDefaultOpenIds,
  _resetProjectTreeSnapshots,
} from '../../src/renderer/stores/workspace.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Project } from '../../src/renderer/types'

const projects = [
  { id: 'A', name: 'test', display_name: 'test' },
  { id: 'B', name: 'prod', display_name: 'prod' },
] as unknown as Project[]

beforeEach(() => {
  _resetProjectTreeSnapshots()
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useEnvironmentStore.setState({ setCurrentProject: async () => {} } as never)
  useWorkspaceStore.setState({
    projects,
    activeWorkspaceId: 'ws',
    activeProjectId: null,
    openProjectIds: [],
    treeData: [],
    openNodeIds: new Set(),
    searchQuery: '',
    activeNodeId: null,
  })
})

const s = () => useWorkspaceStore.getState()

describe('restoreProjectTreeState (pure)', () => {
  it('defaults: root + first-level folders open, search cleared', () => {
    const tree = [
      {
        id: 'project-X',
        type: 'module' as const,
        label: 'X',
        children: [
          { id: 'f1', type: 'folder' as const, label: 'F1', children: [{ id: 'f2', type: 'folder' as const, label: 'F2' }] },
        ],
      },
    ]
    expect(Array.from(computeDefaultOpenIds(tree))).toEqual(['project-X', 'f1'])
    const r = restoreProjectTreeState('X', tree)
    expect(r.searchQuery).toBe('')
    expect(r.activeNodeId).toBeNull()
    expect(r.openNodeIds.has('f2')).toBe(false)
  })
})

describe('setActiveProject — per-project search + expansion (issue #123)', () => {
  it('does not carry project A search into project B, and restores it on return', async () => {
    await s().setActiveProject('A')
    expect(s().treeData[0]?.id).toBe('project-A')
    // Deep folder opened + a search typed in A.
    s().toggleNode('fa2')
    s().setSearchQuery('delete')
    expect(s().openNodeIds.has('fa2')).toBe(true)

    await s().setActiveProject('B')
    expect(s().treeData[0]?.id).toBe('project-B')
    expect(s().searchQuery).toBe('')
    expect(s().openNodeIds.has('project-B')).toBe(true)
    expect(s().openNodeIds.has('fb1')).toBe(true)

    // Change B's state, then go back to A.
    s().toggleNode('fb1')
    s().setSearchQuery('users')
    await s().setActiveProject('A')
    expect(s().searchQuery).toBe('delete')
    expect(s().openNodeIds.has('fa2')).toBe(true)
    expect(s().openNodeIds.has('project-A')).toBe(true)

    // And B is restored exactly as left.
    await s().setActiveProject('B')
    expect(s().searchQuery).toBe('users')
    expect(s().openNodeIds.has('fb1')).toBe(false)
    expect(s().openNodeIds.has('project-B')).toBe(true)
  })

  it('Home (goHome) keeps the project snapshot for the next visit', async () => {
    await s().setActiveProject('A')
    s().toggleNode('fa2')
    s().setSearchQuery('pay')
    s().goHome()
    expect(s().activeProjectId).toBeNull()
    await s().setActiveProject('A')
    expect(s().searchQuery).toBe('pay')
    expect(s().openNodeIds.has('fa2')).toBe(true)
  })

  it('closing a project tab forgets its snapshot', async () => {
    await s().setActiveProject('A')
    s().setSearchQuery('stale')
    await s().setActiveProject('B')
    s().closeProjectTab('A')
    await s().setActiveProject('A')
    expect(s().searchQuery).toBe('')
    expect(s().openNodeIds.has('fa1')).toBe(true) // defaults again
  })
})
