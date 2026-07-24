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
    endpoint: { get: () => Promise.resolve({ success: false, data: null }) },
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

const tree: TreeNode[] = [
  {
    id: 'f1',
    label: 'Payments',
    type: 'folder',
    icon: 'folder',
    children: [
      { id: 'e1', label: 'Charge card', type: 'endpoint', method: 'POST', path: '/charge' },
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
})
