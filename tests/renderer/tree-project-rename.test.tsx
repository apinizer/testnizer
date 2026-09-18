/**
 * Issue #126 — the project root in the APIs tree gets "Rename" (inline, like
 * folders) while staying non-deletable and non-draggable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 30,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 30, size: 30 })),
  }),
}))

vi.hoisted(() => {
  const stub = {
    savedRequest: { get: () => Promise.resolve({ success: false, data: null }) },
    endpoint: { get: () => Promise.resolve({ success: false, data: null }) },
    folder: { update: vi.fn(() => Promise.resolve({ success: true })) },
  }
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = { api: stub }
  else g.window.api = stub
})

import TreeView from '../../src/renderer/components/sidebar/TreeView'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { TreeNode } from '../../src/renderer/types'

const tree: TreeNode[] = [
  {
    id: 'project-proj-1',
    label: 'test',
    type: 'module',
    icon: 'folder',
    children: [{ id: 'f1', label: 'Payments', type: 'folder', icon: 'folder', children: [] }],
  },
]

function openContextMenu(label: string): Element {
  const row = screen.getByText(label).closest('[data-testid="tree-node"]')
  expect(row).not.toBeNull()
  fireEvent.contextMenu(row as Element)
  return row as Element
}

describe('APIs tree — project root rename (issue #126)', () => {
  const renameProject = vi.fn(async () => true)
  const refreshTree = vi.fn(async () => {})

  beforeEach(() => {
    renameProject.mockClear()
    refreshTree.mockClear()
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useWorkspaceStore.setState({
      treeData: tree,
      openNodeIds: new Set(['project-proj-1']),
      searchQuery: '',
      activeProjectId: 'proj-1',
      activeNodeId: null,
      refreshTree,
      renameProject,
    } as never)
  })

  afterEach(() => cleanup())

  it('offers Rename on the project root but not Delete', () => {
    render(<TreeView />)
    const row = openContextMenu('test')
    expect(screen.getByText('Rename')).toBeTruthy()
    expect(screen.queryByText('Delete')).toBeNull()
    expect(row.getAttribute('draggable')).not.toBe('true')
  })

  it('renames the project through renameProject and refreshes the tree', async () => {
    render(<TreeView />)
    const row = openContextMenu('test')
    fireEvent.click(screen.getByText('Rename'))
    const input = row.querySelector('input[type="text"]') as HTMLInputElement
    expect(input).not.toBeNull()
    fireEvent.change(input, { target: { value: 'prod' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(renameProject).toHaveBeenCalledWith('proj-1', 'prod'))
    await waitFor(() => expect(refreshTree).toHaveBeenCalled())
  })

  it('folders still rename through the folder API (unchanged)', async () => {
    render(<TreeView />)
    const row = openContextMenu('Payments')
    fireEvent.click(screen.getByText('Rename'))
    const input = row.querySelector('input[type="text"]') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Billing' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const api = (globalThis as unknown as { window: { api: { folder: { update: ReturnType<typeof vi.fn> } } } })
      .window.api
    await waitFor(() => expect(api.folder.update).toHaveBeenCalledWith('f1', { name: 'Billing' }))
    expect(renameProject).not.toHaveBeenCalled()
  })
})
