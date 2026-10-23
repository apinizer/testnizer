/**
 * TestsPanel — manual folder management inside a test suite (issue #56).
 *
 * The backend has supported nested folders all along (`test_suite_folders`
 * with a self-referential `parent_id`, a cycle-guarded move, and the
 * `testSuiteFolder:*` IPC). What issue #56 asks for is the UI: create a folder
 * in a suite, nest a subfolder, put a request INTO a folder, rename, delete,
 * and drag a folder somewhere else.
 *
 * These tests drive the real TestsPanel against a stubbed bridge and assert on
 * the IPC payloads, because that is where the bug would live: an action that
 * silently targets the suite root (`folder_id: null`) instead of the folder the
 * user clicked looks fine on screen and puts the request in the wrong place.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import React from 'react'

interface SuiteRow {
  id: string
  project_id: string
  name: string
  description: string | null
  sort_order: number
  created_at: number
  updated_at: number
}
interface FolderRow {
  id: string
  suite_id: string
  parent_id: string | null
  name: string
  sort_order: number
}
interface ItemRow {
  id: string
  suite_id: string
  folder_id: string | null
  name: string
  protocol: string
  method: string | null
  url: string
  sort_order: number
}

const h = vi.hoisted(() => {
  const state = {
    suites: [] as SuiteRow[],
    folders: [] as FolderRow[],
    items: [] as ItemRow[],
    calls: [] as Array<{ channel: string; payload: unknown }>,
    seq: 0,
    folderSeq: 0,
    itemSeq: 0,
  }
  const ok = <T,>(data: T) => Promise.resolve({ success: true, data })
  const record = (channel: string, payload: unknown): void => {
    state.calls.push({ channel, payload })
  }

  const stub = {
    testSuite: {
      list: () => ok(state.suites.slice()),
      create: (payload: { project_id: string; name: string }) => {
        state.seq += 1
        const row: SuiteRow = {
          id: `suite-${state.seq}`,
          project_id: payload.project_id,
          name: payload.name,
          description: null,
          sort_order: state.suites.length,
          created_at: Date.now() + state.seq,
          updated_at: Date.now() + state.seq,
        }
        state.suites.push(row)
        return ok(row)
      },
      listEndpoints: (suiteId: string) =>
        ok({
          items: state.items.filter((i) => i.suite_id === suiteId),
          folders: state.folders.filter((f) => f.suite_id === suiteId),
        }),
      delete: () => ok(true),
      update: () => ok(undefined),
      duplicate: () => ok(undefined),
    },
    testSuiteItem: {
      create: (payload: Record<string, unknown>) => {
        record('testSuiteItem:create', payload)
        state.itemSeq += 1
        const row: ItemRow = {
          id: `item-${state.itemSeq}`,
          suite_id: String(payload.suite_id),
          folder_id: (payload.folder_id as string | null) ?? null,
          name: String(payload.name),
          protocol: String(payload.protocol ?? 'http'),
          method: (payload.method as string | null) ?? 'GET',
          url: '',
          sort_order: state.items.length,
        }
        state.items.push(row)
        return ok(row)
      },
      update: () => ok(undefined),
      delete: () => ok(true),
      move: (payload: unknown) => {
        record('testSuiteItem:move', payload)
        return ok(undefined)
      },
    },
    testSuiteFolder: {
      create: (payload: { suite_id: string; parent_id: string | null; name: string }) => {
        record('testSuiteFolder:create', payload)
        state.folderSeq += 1
        const row: FolderRow = {
          id: `folder-${state.folderSeq}`,
          suite_id: payload.suite_id,
          parent_id: payload.parent_id,
          name: payload.name,
          sort_order: state.folders.length,
        }
        state.folders.push(row)
        return ok(row)
      },
      rename: (id: string, name: string) => {
        record('testSuiteFolder:rename', { id, name })
        const f = state.folders.find((x) => x.id === id)
        if (f) f.name = name
        return ok(undefined)
      },
      delete: (id: string) => {
        record('testSuiteFolder:delete', { id })
        state.folders = state.folders.filter((x) => x.id !== id)
        state.items = state.items.filter((i) => i.folder_id !== id)
        return ok(true)
      },
      move: (payload: unknown) => {
        record('testSuiteFolder:move', payload)
        return ok(undefined)
      },
    },
    save: { exportTestSuite: () => ok(undefined) },
  }
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = { api: stub }
  else g.window.api = stub
  return { state, stub }
})

import TestsPanel from '../../src/renderer/components/sidebar/TestsPanel'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { toast } from '../../src/renderer/lib/toast'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Tab } from '../../src/renderer/types'

const callsTo = (channel: string): unknown[] =>
  h.state.calls.filter((c) => c.channel === channel).map((c) => c.payload)

beforeEach(() => {
  h.state.suites = []
  h.state.folders = []
  h.state.items = []
  h.state.calls = []
  h.state.seq = 0
  h.state.folderSeq = 0
  h.state.itemSeq = 0
  ;(HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = vi.fn()
  useWorkspaceStore.setState({ activeProjectId: 'p-1' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

/** Render the panel with one suite open, so its contents tree is on screen. */
async function renderWithSuite(): Promise<void> {
  await h.stub.testSuite.create({ project_id: 'p-1', name: 'Payments' })
  render(React.createElement(TestsPanel))
  const suite = await screen.findByText('Payments')
  fireEvent.click(suite) // expand
}

/** The folder row in the suite tree (its default name is 'New Folder'). */
async function findFolderNode(): Promise<HTMLElement> {
  const nodes = await screen.findAllByText('New Folder')
  // The suite context-menu entry has the same label; take the tree row, which
  // is the one that is NOT inside the menu.
  const row = nodes.find((n) => !n.closest('[data-context-menu]'))
  return (row ?? nodes[0]) as HTMLElement
}

function openSuiteMenu(): void {
  fireEvent.contextMenu(screen.getByText('Payments'))
}

describe('TestsPanel — folder management (issue #56)', () => {
  it('creates a folder at the root of the suite', async () => {
    await renderWithSuite()
    openSuiteMenu()
    fireEvent.click(await screen.findByText('New Folder'))

    await waitFor(() => expect(callsTo('testSuiteFolder:create')).toHaveLength(1))
    expect(callsTo('testSuiteFolder:create')[0]).toMatchObject({
      suite_id: 'suite-1',
      parent_id: null,
    })
  })

  it('nests a subfolder under the folder that was right-clicked', async () => {
    await renderWithSuite()
    openSuiteMenu()
    fireEvent.click(await screen.findByText('New Folder'))
    const folderNode = await findFolderNode()
    fireEvent.contextMenu(folderNode)
    fireEvent.click(await screen.findByText('New Subfolder'))

    await waitFor(() => expect(callsTo('testSuiteFolder:create').length).toBeGreaterThan(1))
    const nested = callsTo('testSuiteFolder:create')[1] as { parent_id: string | null }
    // The whole point of the issue: the second folder is a CHILD, not another
    // root-level folder.
    expect(nested.parent_id).toBe('folder-1')
  })

  it('adds a request INTO the folder, not into the suite root', async () => {
    await renderWithSuite()
    openSuiteMenu()
    fireEvent.click(await screen.findByText('New Folder'))
    const folderNode = await findFolderNode()
    fireEvent.contextMenu(folderNode)
    fireEvent.click(await screen.findByText('New Request'))

    await waitFor(() => expect(callsTo('testSuiteItem:create')).toHaveLength(1))
    // `handleAddItem` used to hard-code folder_id: null, which silently put the
    // request at the suite root while the user watched a folder menu.
    expect(callsTo('testSuiteItem:create')[0]).toMatchObject({
      suite_id: 'suite-1',
      folder_id: 'folder-1',
    })
  })

  it('renames a folder through the IPC', async () => {
    await renderWithSuite()
    openSuiteMenu()
    fireEvent.click(await screen.findByText('New Folder'))
    const folderNode = await findFolderNode()
    fireEvent.contextMenu(folderNode)
    fireEvent.click(await screen.findByText('Rename'))
    const input = await screen.findByDisplayValue(/New Folder/)
    fireEvent.change(input, { target: { value: 'Refunds' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(callsTo('testSuiteFolder:rename')).toHaveLength(1))
    expect(callsTo('testSuiteFolder:rename')[0]).toMatchObject({ name: 'Refunds' })
  })

  it('deletes a folder (its contents cascade in the repo)', async () => {
    await renderWithSuite()
    openSuiteMenu()
    fireEvent.click(await screen.findByText('New Folder'))
    const folderNode = await findFolderNode()
    fireEvent.contextMenu(folderNode)
    fireEvent.click(await screen.findByText('Delete Folder'))
    const confirm = screen.queryByRole('button', { name: /Delete|Confirm/i })
    if (confirm) fireEvent.click(confirm)

    await waitFor(() => expect(callsTo('testSuiteFolder:delete')).toHaveLength(1))
    expect(callsTo('testSuiteFolder:delete')[0]).toMatchObject({ id: 'folder-1' })
  })
})

// Issue #197 — Postman / Insomnia carry HTTP requests only. The suite export
// returns the items it left out (MCP, WebSocket, …) and the panel names them
// in a warning instead of dropping them silently.
describe('TestsPanel — suite export reports items left out (issue #197)', () => {
  it('warns with the skipped item names after a Postman export', async () => {
    const warn = vi.spyOn(toast, 'warning').mockImplementation(() => {})
    const original = h.stub.save.exportTestSuite
    h.stub.save.exportTestSuite = () =>
      Promise.resolve({
        success: true,
        data: {
          path: '/tmp/suite.json',
          skipped: [{ name: 'Tools list', protocol: 'mcp', reason: 'unsupported-protocol' }],
        },
      }) as unknown as ReturnType<typeof original>
    try {
      await renderWithSuite()
      openSuiteMenu()
      fireEvent.click(await screen.findByText('Export as Postman v2.1'))
      await waitFor(() =>
        expect(warn).toHaveBeenCalledWith(
          '1 item(s) left out of the Postman v2.1 export: Tools list (MCP)',
        ),
      )
    } finally {
      h.stub.save.exportTestSuite = original
      warn.mockRestore()
    }
  })

  it('stays quiet when nothing was left out', async () => {
    const warn = vi.spyOn(toast, 'warning').mockImplementation(() => {})
    try {
      await renderWithSuite()
      openSuiteMenu()
      fireEvent.click(await screen.findByText('Export as Postman v2.1'))
      await waitFor(() => expect(screen.queryByText('Export as Postman v2.1')).toBeNull())
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

// Issue #269 — an explicit delete in the Tests panel (item, folder, suite)
// releases the open tabs of the deleted items: a clean tab closes, one with
// unsaved edits stays open, unbound and dirty (Ctrl+S goes to Save As). The
// item delete used to close dirty tabs too, dropping the edits; the folder
// and suite deletes used to keep clean tabs open and mark them dirty.
describe('TestsPanel — deleting items with open tabs (issue #269)', () => {
  function seedItem(id: string, name: string, folderId: string | null): void {
    h.state.items.push({
      id,
      suite_id: 'suite-1',
      folder_id: folderId,
      name,
      protocol: 'http',
      method: 'POST',
      url: '',
      sort_order: h.state.items.length,
    })
  }

  function seedFolder(): void {
    h.state.folders.push({
      id: 'folder-x',
      suite_id: 'suite-1',
      parent_id: null,
      name: 'Cards',
      sort_order: 0,
    })
    seedItem('item-a', 'Charge card', 'folder-x')
    seedItem('item-b', 'Refund card', 'folder-x')
  }

  const tabOf = (id: string): Tab | undefined =>
    useTabsStore.getState().tabs.find((t) => t.id === id)

  /** One open tab per item; `dirty` lists the tabs with unsaved edits. */
  function openTabs(itemIds: string[], dirty: string[] = []): void {
    useTabsStore.setState({
      tabs: itemIds.map(
        (id) =>
          ({
            id: `tab-${id}`,
            name: id,
            protocol: 'http',
            testSuiteItemId: id,
            isDirty: dirty.includes(id),
            isLoading: false,
          }) as Tab,
      ),
      activeTabId: `tab-${itemIds[0]}`,
    })
  }

  function expectOrphaned(id: string): void {
    expect(tabOf(id)).toBeDefined()
    expect(tabOf(id)?.testSuiteItemId).toBeUndefined()
    expect(tabOf(id)?.isDirty).toBe(true)
    expect(tabOf(id)?.orphaned).toBe(true)
  }

  async function deleteItem(): Promise<void> {
    await renderWithSuite()
    fireEvent.contextMenu(await screen.findByText('Charge card'))
    fireEvent.click(await screen.findByText('Delete'))
  }

  it('item: a dirty tab stays open, unbound and dirty', async () => {
    seedItem('item-a', 'Charge card', null)
    openTabs(['item-a'], ['item-a'])
    await deleteItem()

    // (Expanding the suite also opens the runner tab — look the item tab up by id.)
    await waitFor(() => expect(tabOf('tab-item-a')?.testSuiteItemId).toBeUndefined())
    expectOrphaned('tab-item-a')
  })

  it('item: a clean tab still closes', async () => {
    seedItem('item-a', 'Charge card', null)
    openTabs(['item-a'])
    await deleteItem()

    await waitFor(() => expect(tabOf('tab-item-a')).toBeUndefined())
  })

  it('folder: clean tabs of its items close, dirty ones are orphaned', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      seedFolder()
      seedItem('item-out', 'Outside', null)
      openTabs(['item-a', 'item-b', 'item-out'], ['item-b'])
      await renderWithSuite()
      fireEvent.contextMenu(await screen.findByText('Cards'))
      fireEvent.click(await screen.findByText('Delete Folder'))

      await waitFor(() => expect(callsTo('testSuiteFolder:delete')).toHaveLength(1))
      await waitFor(() => expect(tabOf('tab-item-a')).toBeUndefined())
      expectOrphaned('tab-item-b')
      expect(tabOf('tab-item-out')?.testSuiteItemId).toBe('item-out')
      expect(tabOf('tab-item-out')?.isDirty).toBe(false)
      expect(confirm).not.toHaveBeenCalled()
    } finally {
      confirm.mockRestore()
    }
  })

  it('suite: clean tabs of its items close, dirty ones are orphaned', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      seedFolder()
      openTabs(['item-a', 'item-b'], ['item-b'])
      await renderWithSuite()
      await screen.findByText('Cards') // contents loaded
      openSuiteMenu()
      fireEvent.click(await screen.findByText('Delete'))
      fireEvent.click(await screen.findByTestId('delete-confirm-btn'))

      await waitFor(() => expect(tabOf('tab-item-a')).toBeUndefined())
      expectOrphaned('tab-item-b')
      expect(confirm).not.toHaveBeenCalled()
    } finally {
      confirm.mockRestore()
    }
  })
})
