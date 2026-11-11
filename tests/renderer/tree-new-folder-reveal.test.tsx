/**
 * A new folder is revealed in a long APIs tree (e2e F14 root cause).
 *
 * The folder repo gives a new folder the next `sort_order`, so it lands after
 * its siblings. In a tree longer than the sidebar — a project root with one
 * expanded folder of requests above it — that row is below the virtual
 * window: the virtualizer never renders it, and the folder the user just
 * named seemed not to appear (F14 timed out on exactly this, see the e2e
 * diagnostic: 69 rows, 35 rendered, `New Folder` the 15th root folder).
 * Confirming the name now reveals the created row (select + scroll), the same
 * `revealNode` Reveal in APIs uses.
 *
 * The virtualizer stub WINDOWS like the real one: it renders `WINDOW` rows
 * from its scroll position and `scrollToIndex` moves that position.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

const WINDOW = 10

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => {
    const [start, setStart] = React.useState(0)
    const first = Math.min(start, Math.max(0, count - WINDOW))
    return {
      getTotalSize: () => count * 30,
      getVirtualItems: () =>
        Array.from({ length: Math.min(WINDOW, count - first) }, (_, i) => ({
          key: first + i,
          index: first + i,
          start: (first + i) * 30,
          size: 30,
        })),
      scrollToIndex: (index: number) => setStart(Math.max(0, index - WINDOW / 2)),
    }
  },
}))

const created = vi.hoisted(() => ({ folders: [] as Array<Record<string, unknown>> }))

vi.hoisted(() => {
  const stub = {
    folder: {
      create: (payload: Record<string, unknown>) => {
        created.folders.push(payload)
        return Promise.resolve({ success: true, data: { id: 'fld-new' } })
      },
    },
  }
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = { api: stub }
  else g.window.api = stub
})

import TreeView from '../../src/renderer/components/sidebar/TreeView'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { TreeNode } from '../../src/renderer/types'

/** An expanded folder with 30 requests, then a second root folder. */
function treeWith(extra: TreeNode[] = []): TreeNode[] {
  return [
    {
      id: 'root',
      label: 'Shop',
      type: 'module',
      children: [
        {
          id: 'f-big',
          label: 'Orders',
          type: 'folder',
          children: Array.from({ length: 30 }, (_, i) => ({
            id: `e${i}`,
            label: `Order ${i}`,
            type: 'endpoint' as const,
            method: 'GET',
            path: `/orders/${i}`,
          })),
        },
        { id: 'f-last', label: 'Archive', type: 'folder', children: [] },
        ...extra,
      ],
    },
  ]
}

function rowFor(label: string): Element | null {
  return screen.queryAllByTestId('tree-node').find((el) => el.textContent?.includes(label)) ?? null
}

describe('Add Folder in a long tree', () => {
  beforeEach(() => {
    created.folders.length = 0
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useWorkspaceStore.setState({
      treeData: treeWith(),
      openNodeIds: new Set(['root', 'f-big']),
      searchQuery: '',
      activeProjectId: 'proj-1',
      activeNodeId: null,
      // The store's real refresh re-reads the DB; here the new row appears last.
      refreshTree: async () => {
        useWorkspaceStore.setState({
          treeData: treeWith([{ id: 'fld-new', label: 'Invoices', type: 'folder', children: [] }]),
        })
      },
    })
  })
  afterEach(() => cleanup())

  it('scrolls to and selects the created folder, which sorts below the window', async () => {
    render(<TreeView />)
    fireEvent.contextMenu(rowFor('Shop') as Element)
    fireEvent.click(screen.getByText('Add Folder'))
    const input = await screen.findByTestId('new-folder-input')
    fireEvent.change(input, { target: { value: 'Invoices' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(created.folders).toHaveLength(1))
    await waitFor(() => expect(rowFor('Invoices')).not.toBeNull())
    expect(useWorkspaceStore.getState().activeNodeId).toBe('fld-new')
  })

  it('does not reveal into another project the user switched to while the tree refreshed', async () => {
    // The refresh finishes after the user moved to project B. Like the real
    // `refreshTree` (it writes the tree it started building, whatever is
    // active by then), it leaves a tree holding the new row — so only the
    // project check keeps B's search, selection and scroll untouched.
    useWorkspaceStore.setState({
      refreshTree: async () => {
        useWorkspaceStore.setState({
          activeProjectId: 'proj-2',
          searchQuery: 'invoice',
          activeNodeId: 'e3',
        })
        useWorkspaceStore.setState({
          treeData: treeWith([{ id: 'fld-new', label: 'Invoices', type: 'folder', children: [] }]),
        })
      },
    })
    const revealSeq = useWorkspaceStore.getState().revealCommand.seq
    render(<TreeView />)
    fireEvent.contextMenu(rowFor('Shop') as Element)
    fireEvent.click(screen.getByText('Add Folder'))
    const input = await screen.findByTestId('new-folder-input')
    fireEvent.change(input, { target: { value: 'Invoices' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(created.folders).toHaveLength(1))
    expect(created.folders[0].project_id).toBe('proj-1')
    await waitFor(() => expect(useWorkspaceStore.getState().activeProjectId).toBe('proj-2'))
    // Let the confirm handler's last await settle before asserting nothing moved.
    await new Promise((r) => setTimeout(r, 0))
    const st = useWorkspaceStore.getState()
    expect(st.searchQuery).toBe('invoice')
    expect(st.activeNodeId).toBe('e3')
    expect(st.revealCommand.seq).toBe(revealSeq)
  })
})
