/**
 * Issue #314 — a double-click on an APIs tree request opens it pinned.
 *
 * The open is asynchronous (the row is read over IPC before the tab exists),
 * so the double-click usually lands before there is a tab to pin: the mocked
 * reads here resolve only when the test says so.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

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

const reads = vi.hoisted(() => ({
  saved: [] as string[],
  endpoint: [] as string[],
  /** Set → reads wait for `release()`. */
  gate: null as Promise<void> | null,
  release: (): void => undefined,
}))
vi.hoisted(() => {
  const ok = <T,>(data: T) => Promise.resolve({ success: true, data })
  const afterGate = async <T,>(data: T) => {
    if (reads.gate) await reads.gate
    return { success: true, data }
  }
  const stub = {
    folder: { list: () => ok([{ id: 'f1', name: 'CRUD', parent_id: null, sort_order: 0 }]) },
    endpoint: {
      listByProject: () =>
        ok([{ id: 'ep1', name: 'Get one', method: 'GET', path: '/one', folder_id: null }]),
      get: (id: string) => {
        reads.endpoint.push(id)
        return afterGate({
          id,
          name: 'Get one',
          method: 'GET',
          path: '/one',
          protocol: 'http',
          request_schema: '{}',
        })
      },
    },
    savedRequest: {
      list: () =>
        ok([
          { id: 'sr1', name: 'First', method: 'POST', url: '/a', folder_id: null },
          { id: 'sr2', name: 'Second', method: 'GET', url: '/b', folder_id: null },
          { id: 'sr3', name: 'Inner', method: 'GET', url: '/c', folder_id: 'f1' },
        ]),
      get: (id: string) => {
        reads.saved.push(id)
        return afterGate({
          id,
          name: id === 'sr1' ? 'First' : 'Second',
          method: 'GET',
          url: '/x',
          protocol: 'http',
        })
      },
    },
    savedResponse: {
      listByProject: () =>
        ok([
          {
            id: 'ex1',
            owner_type: 'saved_request',
            owner_id: 'sr2',
            name: 'Example 200',
            status_code: 200,
            method: 'GET',
            url: '/b',
            created_at: 1,
          },
        ]),
      list: () => ok([]),
      get: () => ok(null),
    },
  }
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = { api: stub }
  else g.window.api = stub
})

import TreeView from '../../src/renderer/components/sidebar/TreeView'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useBranchStore } from '../../src/renderer/stores/branch.store'

const tabs = () => useTabsStore.getState().tabs
const row = (label: string): HTMLElement =>
  screen.getByText(label).closest('[data-testid="tree-node"]') as HTMLElement

/** What a real double-click dispatches. */
function doubleClick(el: HTMLElement): void {
  fireEvent.click(el)
  fireEvent.click(el)
  fireEvent.doubleClick(el)
}

function holdReads(): void {
  reads.gate = new Promise<void>((resolve) => {
    reads.release = () => {
      reads.gate = null
      resolve()
    }
  })
}

async function renderTree(): Promise<void> {
  await useWorkspaceStore.getState().refreshTree()
  useWorkspaceStore.setState({ openNodeIds: new Set(['project-proj-1']) })
  render(<TreeView />)
  await screen.findByText('First')
}

const openOneClick = async (label: string, savedId: string): Promise<void> => {
  fireEvent.click(row(label))
  await waitFor(() => expect(tabs().some((t) => t.savedRequestId === savedId)).toBe(true))
}

beforeEach(() => {
  reads.saved.length = 0
  reads.endpoint.length = 0
  reads.gate = null
  useBranchStore.setState({ getActiveBranchScope: () => null } as never)
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useWorkspaceStore.setState({
    treeData: [],
    openNodeIds: new Set<string>(),
    searchQuery: '',
    activeProjectId: 'proj-1',
    activeNodeId: null,
    projects: [{ id: 'proj-1', name: 'Proj' } as never],
  })
})
afterEach(() => cleanup())

describe('issue #314 — double-click on an APIs tree request', () => {
  it('single click is still a preview, and the next click replaces it', async () => {
    await renderTree()
    await openOneClick('First', 'sr1')
    expect(tabs()[0].isPreview).toBe(true)
    await openOneClick('Second', 'sr2')
    expect(tabs()).toHaveLength(1)
    expect(tabs()[0]).toMatchObject({ savedRequestId: 'sr2', isPreview: true })
  })

  it('pins a saved request whose read is still in flight, with one tab and one read', async () => {
    await renderTree()
    holdReads()
    doubleClick(row('First'))
    expect(tabs()).toHaveLength(0)
    reads.release()
    await waitFor(() => expect(tabs()[0]?.isPreview).toBe(false))
    expect(tabs()).toHaveLength(1)
    expect(tabs()[0].savedRequestId).toBe('sr1')
    expect(reads.saved).toEqual(['sr1'])
  })

  it('pins an endpoint row the same way', async () => {
    await renderTree()
    holdReads()
    doubleClick(row('Get one'))
    reads.release()
    await waitFor(() => expect(tabs()[0]?.isPreview).toBe(false))
    expect(tabs()).toHaveLength(1)
    expect(tabs()[0].endpointId).toBe('ep1')
    expect(reads.endpoint).toEqual(['ep1'])
  })

  it('pins the preview already open on that row, without a second tab', async () => {
    await renderTree()
    await openOneClick('First', 'sr1')
    const id = tabs()[0].id
    doubleClick(row('First'))
    await waitFor(() => expect(tabs()[0].isPreview).toBe(false))
    expect(tabs()).toHaveLength(1)
    expect(tabs()[0].id).toBe(id)
  })

  it('a single click after that opens a new preview and leaves the pinned tab alone', async () => {
    await renderTree()
    doubleClick(row('First'))
    await waitFor(() => expect(tabs()[0]?.isPreview).toBe(false))
    await openOneClick('Second', 'sr2')
    expect(tabs().map((t) => [t.savedRequestId, t.isPreview])).toEqual([
      ['sr1', false],
      ['sr2', true],
    ])
  })

  it('double-click on a pinned row only focuses its tab', async () => {
    await renderTree()
    doubleClick(row('First'))
    await waitFor(() => expect(tabs()[0]?.isPreview).toBe(false))
    await openOneClick('Second', 'sr2')
    doubleClick(row('First'))
    await waitFor(() => expect(useTabsStore.getState().activeTabId).toBe(tabs()[0].id))
    expect(tabs()).toHaveLength(2)
    expect(tabs()[1].isPreview).toBe(true)
  })

  it('double-click on a folder toggles it and opens no tab', async () => {
    await renderTree()
    expect(screen.queryByText('Inner')).toBeNull()
    fireEvent.click(row('CRUD'))
    await screen.findByText('Inner')
    fireEvent.doubleClick(row('CRUD'))
    expect(tabs()).toHaveLength(0)
  })

  it('double-click on the chevron of a request with examples opens nothing', async () => {
    await renderTree()
    const chevron = row('Second').querySelector('[data-testid="tree-node-chevron"]') as HTMLElement
    fireEvent.click(chevron)
    fireEvent.click(chevron)
    fireEvent.doubleClick(chevron)
    await new Promise((r) => setTimeout(r, 0))
    expect(tabs()).toHaveLength(0)
    expect(reads.saved).toEqual([])
  })

  it('double-click on the row while renaming neither opens nor pins', async () => {
    await renderTree()
    fireEvent.contextMenu(row('First'))
    fireEvent.click(await screen.findByText(/^Rename/))
    const input = await screen.findByDisplayValue('First')
    fireEvent.doubleClick(input)
    await new Promise((r) => setTimeout(r, 0))
    expect(tabs()).toHaveLength(0)
  })
})
