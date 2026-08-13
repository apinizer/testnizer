/**
 * issue #102 — "Create Test Suite from this folder" imported the ENTIRE folder.
 *
 * The context-menu item used to call testSuite.create + importEndpoints
 * immediately with every request id under the folder. Users who wanted a
 * subset had to create the suite and then prune it by hand. A selection step
 * now sits between the menu item and the create: a checkbox list of the
 * folder's subtree, everything selected by default (so confirming straight
 * away reproduces the old one-click behaviour), folder rows toggling their
 * whole subtree, and Cancel creating nothing at all.
 *
 * The handler lives inside TreeView, so these drive it through the context
 * menu — the way it is actually reached (same approach as the #96 suite).
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const toastCalls: Array<{ kind: string; message: string }> = []
vi.mock('../../src/renderer/lib/toast', () => ({
  toast: {
    success: (m: string) => toastCalls.push({ kind: 'success', message: m }),
    error: (m: string) => toastCalls.push({ kind: 'error', message: m }),
    info: (m: string) => toastCalls.push({ kind: 'info', message: m }),
    warning: (m: string) => toastCalls.push({ kind: 'warning', message: m }),
  },
}))

vi.mock('../../src/renderer/components/shared/MonacoWrapper', () => ({
  default: () => <div data-testid="monaco" />,
}))

// jsdom gives the scroll container a 0px rect, so the real virtualizer renders
// no rows. Same pass-through stub the other tree suites use.
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

import TreeView from '../../src/renderer/components/sidebar/TreeView'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { TreeNode } from '../../src/renderer/types'

const FOLDER = 'Collection A'
const SUBFOLDER_ID = 'folder-sub'
const REQUEST = 'Get one'

/** folder-a { req-1, req-2, folder-sub { req-3 } } — three requests total. */
function tree(): TreeNode[] {
  return [
    {
      id: 'mod',
      type: 'module',
      label: 'Default module',
      children: [
        {
          id: 'folder-a',
          type: 'folder',
          label: FOLDER,
          children: [
            { id: 'req-1', type: 'request', label: REQUEST, method: 'GET', path: '/one' },
            { id: 'req-2', type: 'request', label: 'Make two', method: 'POST', path: '/two' },
            {
              id: SUBFOLDER_ID,
              type: 'folder',
              label: 'Subfolder',
              children: [
                { id: 'req-3', type: 'request', label: 'Get three', method: 'GET', path: '/three' },
              ],
            },
          ],
        },
      ],
    },
  ]
}

const createCalls: Array<Record<string, unknown>> = []
const importCalls: Array<{ suite_id: string; endpoint_ids: string[]; source_folder_id?: string }> =
  []

function installApi(): void {
  const w = window as unknown as { api: Record<string, unknown> }
  w.api = {
    ...(w.api ?? {}),
    testSuite: {
      create: (payload: Record<string, unknown>) => {
        createCalls.push(payload)
        return Promise.resolve({ success: true, data: { id: 'suite-1' } })
      },
      importEndpoints: (payload: {
        suite_id: string
        endpoint_ids: string[]
        source_folder_id?: string
      }) => {
        importCalls.push(payload)
        return Promise.resolve({
          success: true,
          data: { added: payload.endpoint_ids.length, rejected: 0 },
        })
      },
    },
  }
}

/** Right-click a tree row by its visible label and pick a context-menu entry. */
async function pickContextAction(rowLabel: string, action: RegExp): Promise<void> {
  const node = screen.getAllByTestId('tree-node').find((n) => n.textContent?.includes(rowLabel))
  if (!node) throw new Error(`tree node "${rowLabel}" not rendered`)
  fireEvent.contextMenu(node)
  const item = await screen.findByText(action)
  fireEvent.click(item)
}

const openSelection = (): Promise<void> =>
  pickContextAction(FOLDER, /Create Test Suite from this folder/i)

function requestCheckbox(id: string): HTMLInputElement {
  return screen.getByTestId(`suite-select-request-${id}`) as HTMLInputElement
}

beforeEach(() => {
  toastCalls.length = 0
  createCalls.length = 0
  importCalls.length = 0
  useWorkspaceStore.setState({
    activeWorkspaceId: 'ws-1',
    activeProjectId: 'proj-1',
    treeData: tree(),
    openNodeIds: new Set(['mod', 'folder-a', SUBFOLDER_ID]),
    searchQuery: '',
  })
  installApi()
})

afterEach(cleanup)

describe('folder → test suite goes through a selection step (#102)', () => {
  it('opens the selection modal instead of creating immediately, everything checked', async () => {
    render(<TreeView />)
    await openSelection()

    await screen.findByTestId('suite-select-modal')
    // Nothing has been created yet — that is the whole point of the issue.
    expect(createCalls).toHaveLength(0)
    expect(importCalls).toHaveLength(0)

    // Default = all selected, so one more click reproduces the old behaviour.
    for (const id of ['req-1', 'req-2', 'req-3']) {
      expect(requestCheckbox(id).checked).toBe(true)
    }
    expect(screen.getByTestId('suite-select-count').textContent).toContain('3/3')
  })

  it('confirming the default selection recreates the old full-folder result', async () => {
    render(<TreeView />)
    await openSelection()

    fireEvent.click(await screen.findByTestId('suite-select-confirm'))

    await waitFor(() => expect(importCalls).toHaveLength(1))
    expect(createCalls).toHaveLength(1)
    expect(createCalls[0].name).toBe(FOLDER)
    expect(importCalls[0].endpoint_ids).toEqual(['req-1', 'req-2', 'req-3'])
    // The suite IS this folder — subfolders land at the suite root (issue #94).
    expect(importCalls[0].source_folder_id).toBe('folder-a')
  })

  it('confirming a subset passes ONLY the selected ids to the create flow', async () => {
    render(<TreeView />)
    await openSelection()
    await screen.findByTestId('suite-select-modal')

    fireEvent.click(requestCheckbox('req-2'))
    expect(screen.getByTestId('suite-select-count').textContent).toContain('2/3')
    fireEvent.click(screen.getByTestId('suite-select-confirm'))

    await waitFor(() => expect(importCalls).toHaveLength(1))
    expect(importCalls[0].endpoint_ids).toEqual(['req-1', 'req-3'])
  })

  it('a folder row toggles its whole subtree on and off', async () => {
    render(<TreeView />)
    await openSelection()
    await screen.findByTestId('suite-select-modal')

    const sub = screen.getByTestId(`suite-select-folder-${SUBFOLDER_ID}`) as HTMLInputElement
    fireEvent.click(sub)
    expect(requestCheckbox('req-3').checked).toBe(false)
    expect(screen.getByTestId('suite-select-count').textContent).toContain('2/3')

    fireEvent.click(sub)
    expect(requestCheckbox('req-3').checked).toBe(true)
    expect(screen.getByTestId('suite-select-count').textContent).toContain('3/3')
  })

  it('select all / deselect all flips everything, and 0 selected blocks Create', async () => {
    render(<TreeView />)
    await openSelection()
    await screen.findByTestId('suite-select-modal')

    fireEvent.click(screen.getByTestId('suite-select-toggle-all'))
    for (const id of ['req-1', 'req-2', 'req-3']) {
      expect(requestCheckbox(id).checked).toBe(false)
    }
    const confirm = screen.getByTestId('suite-select-confirm') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(createCalls).toHaveLength(0)

    fireEvent.click(screen.getByTestId('suite-select-toggle-all'))
    expect(requestCheckbox('req-2').checked).toBe(true)
    expect(confirm.disabled).toBe(false)
  })

  it('cancelling creates nothing', async () => {
    render(<TreeView />)
    await openSelection()
    await screen.findByTestId('suite-select-modal')

    fireEvent.click(screen.getByTestId('suite-select-cancel'))

    await waitFor(() => expect(screen.queryByTestId('suite-select-modal')).toBeNull())
    expect(createCalls).toHaveLength(0)
    expect(importCalls).toHaveLength(0)
    expect(toastCalls).toHaveLength(0)
  })

  it('a single request keeps the direct path — nothing to choose from', async () => {
    render(<TreeView />)
    await pickContextAction(REQUEST, /Create Test Suite from this request/i)

    await waitFor(() => expect(importCalls).toHaveLength(1))
    expect(screen.queryByTestId('suite-select-modal')).toBeNull()
    expect(importCalls[0].endpoint_ids).toEqual(['req-1'])
  })
})
