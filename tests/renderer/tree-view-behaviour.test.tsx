/**
 * APIs sidebar tree behaviour — issues #68, #69, #70.
 *
 * Drives the real TreeView against a stubbed window.api bridge:
 *   #69  right-click folder → Add Request → HTTP must land in the HTTP editor,
 *        i.e. the tab it opens must NOT look like the Workbench's blank
 *        scratch tab (Workbench.tsx: name === 'New Request' && !url → the
 *        protocol picker renders instead of the editor).
 *   #68  Add Folder must prompt with an empty name; Escape creates nothing.
 *   #70  the collapse chevron must work while the search box has text.
 *   #269 deleting a request or folder releases its open tabs: a clean tab
 *        closes, a dirty one stays open, unbound and dirty (Save As next).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
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

const created = vi.hoisted(() => ({
  savedRequests: [] as Array<Record<string, unknown>>,
  folders: [] as Array<Record<string, unknown>>,
  deleted: [] as string[],
}))

vi.hoisted(() => {
  const stub = {
    savedRequest: {
      create: (payload: Record<string, unknown>) => {
        created.savedRequests.push(payload)
        return Promise.resolve({ success: true, data: { id: 'sr-new' } })
      },
      get: (id: string) => {
        const last = created.savedRequests[created.savedRequests.length - 1]
        if (!last) return Promise.resolve({ success: false, data: null })
        return Promise.resolve({
          success: true,
          data: {
            id,
            name: last.name,
            method: last.method,
            url: last.url,
            protocol: last.protocol,
          },
        })
      },
    },
    endpoint: {
      get: () => Promise.resolve({ success: false, data: null }),
      delete: (id: string) => {
        created.deleted.push(id)
        return Promise.resolve({ success: true, data: true })
      },
    },
    folder: {
      create: (payload: Record<string, unknown>) => {
        created.folders.push(payload)
        return Promise.resolve({ success: true, data: { id: 'fld-new' } })
      },
      delete: (id: string) => {
        created.deleted.push(id)
        return Promise.resolve({ success: true, data: true })
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
import { useRequestStore } from '../../src/renderer/stores/request.store'
import type { Tab, TreeNode } from '../../src/renderer/types'

const tree: TreeNode[] = [
  {
    id: 'f1',
    label: 'Payments',
    type: 'folder',
    icon: 'folder',
    children: [
      { id: 'e1', label: 'Charge card', type: 'endpoint', method: 'POST', path: '/charge' },
      { id: 'e2', label: 'Refund', type: 'endpoint', method: 'POST', path: '/refund' },
    ],
  },
]

/** Right-click the row whose label matches and return the opened menu. */
function openContextMenu(label: string): void {
  const row = screen.getByText(label).closest('[data-testid="tree-node"]')
  expect(row).not.toBeNull()
  fireEvent.contextMenu(row as Element)
}

describe('APIs tree (issues #68 / #69 / #70)', () => {
  beforeEach(() => {
    created.savedRequests.length = 0
    created.folders.length = 0
    created.deleted.length = 0
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useWorkspaceStore.setState({
      treeData: tree,
      openNodeIds: new Set(['f1']),
      searchQuery: '',
      activeProjectId: 'proj-1',
      activeNodeId: null,
      refreshTree: async () => {},
    })
  })

  afterEach(() => cleanup())

  it('#69: Add Request → HTTP opens a tab the Workbench renders as an editor', async () => {
    render(<TreeView />)
    openContextMenu('Payments')
    fireEvent.click(screen.getByText('Add Request'))
    fireEvent.click(screen.getByText('HTTP'))

    await waitFor(() => expect(created.savedRequests).toHaveLength(1))
    expect(created.savedRequests[0].protocol).toBe('http')

    await waitFor(() => expect(useTabsStore.getState().tabs).toHaveLength(1))
    const tab = useTabsStore.getState().tabs[0]
    // Mirror of the Workbench `isNewEmptyTab` guard — when this is true the
    // protocol picker takes over the pane instead of the HTTP editor.
    const rendersProtocolPicker = tab.name === 'New Request' && !tab.url
    expect(rendersProtocolPicker).toBe(false)
  })

  it('#68: Add Folder prompts with an empty name and creates nothing on Escape', async () => {
    render(<TreeView />)
    openContextMenu('Payments')
    fireEvent.click(screen.getByText('Add Folder'))

    const input = await screen.findByTestId('new-folder-input')
    expect((input as HTMLInputElement).value).toBe('')
    expect(created.folders).toHaveLength(0)

    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('new-folder-input')).toBeNull())
    expect(created.folders).toHaveLength(0)
  })

  it('#68: the folder is created only on confirm, with the typed name', async () => {
    render(<TreeView />)
    openContextMenu('Payments')
    fireEvent.click(screen.getByText('Add Folder'))

    const input = await screen.findByTestId('new-folder-input')
    fireEvent.change(input, { target: { value: 'Refunds' } })
    expect(created.folders).toHaveLength(0)
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(created.folders).toHaveLength(1))
    expect(created.folders[0].name).toBe('Refunds')
    expect(created.folders[0].parent_id).toBe('f1')
  })

  it('#68: confirming an empty name creates nothing', async () => {
    render(<TreeView />)
    openContextMenu('Payments')
    fireEvent.click(screen.getByText('Add Folder'))

    const input = await screen.findByTestId('new-folder-input')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByTestId('new-folder-input')).toBeNull())
    expect(created.folders).toHaveLength(0)
  })

  it('#70: a folder can be collapsed while the search box has text', async () => {
    useWorkspaceStore.setState({ searchQuery: 'charge' })
    render(<TreeView />)
    // The filter force-expands so the match is visible.
    expect(screen.getByText('Charge card')).toBeTruthy()

    fireEvent.click(screen.getByText('Payments'))

    await waitFor(() => expect(screen.queryByText('Charge card')).toBeNull())
    // The user's real collapse state is untouched — this is a filter-session
    // override, not a write to openNodeIds.
    expect(useWorkspaceStore.getState().openNodeIds.has('f1')).toBe(true)

    // Clicking again re-expands without clearing the search box.
    fireEvent.click(screen.getByText('Payments'))
    await waitFor(() => expect(screen.getByText('Charge card')).toBeTruthy())
  })

  it('#70: collapse-all / expand-all also work while the search box has text', async () => {
    // The panel button writes `openNodeIds`, which the filtered view does not
    // read — so the per-folder chevron fix left its sibling control just as
    // dead as the chevron had been.
    useWorkspaceStore.setState({ searchQuery: 'charge' })
    render(<TreeView />)
    expect(screen.getByText('Charge card')).toBeTruthy()

    useWorkspaceStore.getState().collapseAllNodes()
    await waitFor(() => expect(screen.queryByText('Charge card')).toBeNull())

    useWorkspaceStore.getState().expandAllNodes()
    await waitFor(() => expect(screen.getByText('Charge card')).toBeTruthy())
  })

  // ─── Issue #269: an explicit delete releases the open tabs ──────────────

  function seedTabs(tabs: Array<Partial<Tab> & { id: string }>, activeTabId: string): void {
    useTabsStore.setState({
      tabs: tabs.map((t) => ({
        name: t.id,
        protocol: 'http',
        isDirty: false,
        isLoading: false,
        ...t,
      })) as Tab[],
      activeTabId,
    })
  }

  const tabOf = (id: string): Tab | undefined =>
    useTabsStore.getState().tabs.find((t) => t.id === id)

  async function deleteNode(label: string, typed: boolean): Promise<void> {
    openContextMenu(label)
    fireEvent.click(screen.getByText('Delete'))
    if (typed) {
      fireEvent.change(await screen.findByTestId('delete-confirm-input'), {
        target: { value: 'delete' },
      })
    }
    fireEvent.click(await screen.findByTestId('delete-confirm-btn'))
  }

  function expectOrphaned(id: string): void {
    const tab = tabOf(id)
    expect(tab).toBeDefined()
    expect(tab?.endpointId).toBeUndefined()
    expect(tab?.isDirty).toBe(true)
    expect(tab?.orphaned).toBe(true)
  }

  it('#269: deleting a request closes its clean tab, without an unsaved-changes prompt', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      seedTabs(
        [
          { id: 'tab-e1', endpointId: 'e1' },
          { id: 'tab-other', endpointId: 'elsewhere' },
        ],
        'tab-e1',
      )
      render(<TreeView />)
      await deleteNode('Charge card', false)

      await waitFor(() => expect(tabOf('tab-e1')).toBeUndefined())
      expect(created.deleted).toEqual(['e1'])
      expect(confirm).not.toHaveBeenCalled()
      // The neighbour became active, protocol stores included.
      expect(useTabsStore.getState().activeTabId).toBe('tab-other')
      expect(useRequestStore.getState()._currentTabId).toBe('tab-other')
      expect(tabOf('tab-other')?.endpointId).toBe('elsewhere')
      expect(tabOf('tab-other')?.isDirty).toBe(false)
    } finally {
      confirm.mockRestore()
    }
  })

  it('#269: deleting a request keeps its dirty tab open, unbound and dirty', async () => {
    seedTabs([{ id: 'tab-e1', endpointId: 'e1', isDirty: true }], 'tab-e1')
    render(<TreeView />)
    await deleteNode('Charge card', false)

    await waitFor(() => expect(tabOf('tab-e1')?.endpointId).toBeUndefined())
    expectOrphaned('tab-e1')
    expect(useTabsStore.getState().activeTabId).toBe('tab-e1')
  })

  it('#269: deleting a folder closes the clean tabs under it and orphans the dirty ones', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      seedTabs(
        [
          { id: 'tab-e1', endpointId: 'e1' },
          { id: 'tab-e2', endpointId: 'e2', isDirty: true },
          { id: 'tab-other', endpointId: 'elsewhere' },
        ],
        'tab-e1',
      )
      render(<TreeView />)
      await deleteNode('Payments', true)

      await waitFor(() => expect(tabOf('tab-e1')).toBeUndefined())
      expect(created.deleted).toEqual(['f1'])
      expect(confirm).not.toHaveBeenCalled()
      expectOrphaned('tab-e2')
      expect(tabOf('tab-other')?.endpointId).toBe('elsewhere')
      expect(tabOf('tab-other')?.isDirty).toBe(false)
      expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(['tab-e2', 'tab-other'])
      expect(useTabsStore.getState().activeTabId).toBe('tab-e2')
      expect(useRequestStore.getState()._currentTabId).toBe('tab-e2')
    } finally {
      confirm.mockRestore()
    }
  })
})
