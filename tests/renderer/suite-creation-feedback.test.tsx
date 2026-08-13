/**
 * issue #96 — "Create Test Suite from this folder" said nothing, ever.
 *
 * Four outcomes shared one behaviour: an empty folder made the menu item look
 * broken, a failed create dropped the user back on the APIs tree with no
 * explanation, the import's result was discarded (so a partial copy read as a
 * clean one), and the catch reached devtools only.
 *
 * The handler lives inside TreeView, so these drive it through the context
 * menu — the way it is actually reached.
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

type CreateResult = { success: boolean; data?: { id: string }; error?: string }
type ImportResult = {
  success: boolean
  data?: { added: number; rejected: number }
  error?: string
}

const FOLDER = 'Collection A'
const REQUEST = 'Get one'

function tree(withRequest = true): TreeNode[] {
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
          children: withRequest
            ? [{ id: 'req-1', type: 'request', label: REQUEST, method: 'GET', path: '/one' }]
            : [],
        },
      ],
    },
  ]
}

function installApi(create: CreateResult, importRes: ImportResult): void {
  const w = window as unknown as { api: Record<string, unknown> }
  w.api = {
    ...(w.api ?? {}),
    testSuite: {
      create: () => Promise.resolve(create),
      importEndpoints: () => Promise.resolve(importRes),
    },
  }
}

/**
 * Right-click the folder and pick "Create Test Suite from this folder".
 * Since #102 a request-selection modal sits between the menu item and the
 * create; confirming its default (everything selected) reproduces the old
 * one-click behaviour these tests were written against. The empty-folder case
 * never reaches the modal, so it passes `confirmModal: false`.
 */
async function createSuiteFromFolder(confirmModal = true): Promise<void> {
  const node = screen.getAllByTestId('tree-node').find((n) => n.textContent?.includes(FOLDER))
  if (!node) throw new Error('folder node not rendered')
  fireEvent.contextMenu(node)
  const item = await screen.findByText(/Create Test Suite from this folder/i)
  fireEvent.click(item)
  if (confirmModal) {
    fireEvent.click(await screen.findByTestId('suite-select-confirm'))
  }
}

beforeEach(() => {
  toastCalls.length = 0
  useWorkspaceStore.setState({
    activeWorkspaceId: 'ws-1',
    activeProjectId: 'proj-1',
    treeData: tree(),
    openNodeIds: new Set(['mod', 'folder-a']),
    searchQuery: '',
  })
  installApi(
    { success: true, data: { id: 'suite-1' } },
    { success: true, data: { added: 1, rejected: 0 } },
  )
})

afterEach(cleanup)

describe('creating a test suite from a folder reports what happened (#96)', () => {
  it('confirms success, naming the suite and how much went into it', async () => {
    render(<TreeView />)
    await createSuiteFromFolder()

    await waitFor(() => expect(toastCalls.some((c) => c.kind === 'success')).toBe(true))
    const msg = toastCalls.find((c) => c.kind === 'success')!.message
    expect(msg).toContain(FOLDER)
    expect(msg).toContain('1')
  })

  it('says an empty folder is empty instead of doing nothing', async () => {
    useWorkspaceStore.setState({ treeData: tree(false) })
    render(<TreeView />)
    await createSuiteFromFolder(false)

    // The reported symptom is a menu item that appears broken. Any message is
    // better than none; it must not be an error, since nothing went wrong.
    await waitFor(() => expect(toastCalls.length).toBeGreaterThan(0))
    expect(toastCalls[0].kind).not.toBe('success')
    expect(toastCalls[0].kind).not.toBe('error')
  })

  it('surfaces a failed create, with the reason', async () => {
    installApi(
      { success: false, error: 'name already taken' },
      { success: true, data: { added: 0, rejected: 0 } },
    )
    render(<TreeView />)
    await createSuiteFromFolder()

    await waitFor(() => expect(toastCalls.some((c) => c.kind === 'error')).toBe(true))
    expect(toastCalls.find((c) => c.kind === 'error')!.message).toContain('name already taken')
    // A failure must not also claim success.
    expect(toastCalls.some((c) => c.kind === 'success')).toBe(false)
  })

  it('surfaces a failed import', async () => {
    installApi(
      { success: true, data: { id: 'suite-1' } },
      { success: false, error: 'suite not found' },
    )
    render(<TreeView />)
    await createSuiteFromFolder()

    await waitFor(() => expect(toastCalls.some((c) => c.kind === 'error')).toBe(true))
    expect(toastCalls.find((c) => c.kind === 'error')!.message).toContain('suite not found')
    expect(toastCalls.some((c) => c.kind === 'success')).toBe(false)
  })

  it('does NOT report a partial copy as a clean one', async () => {
    // The quiet one: a suite built from a folder of 1 that copied 0 used to be
    // indistinguishable from a complete success, and only showed up later as a
    // run that came up short.
    installApi(
      { success: true, data: { id: 'suite-1' } },
      { success: true, data: { added: 0, rejected: 1 } },
    )
    render(<TreeView />)
    await createSuiteFromFolder()

    await waitFor(() => expect(toastCalls.length).toBeGreaterThan(0))
    expect(toastCalls.some((c) => c.kind === 'success')).toBe(false)
    expect(toastCalls.some((c) => c.kind === 'warning')).toBe(true)
  })

  it('reports a thrown error instead of leaving it in devtools', async () => {
    const w = window as unknown as { api: Record<string, unknown> }
    w.api = {
      ...(w.api ?? {}),
      testSuite: {
        create: () => Promise.reject(new Error('bridge exploded')),
        importEndpoints: () => Promise.resolve({ success: true, data: { added: 0, rejected: 0 } }),
      },
    }
    render(<TreeView />)
    await createSuiteFromFolder()

    await waitFor(() => expect(toastCalls.some((c) => c.kind === 'error')).toBe(true))
    expect(toastCalls.find((c) => c.kind === 'error')!.message).toContain('bridge exploded')
  })
})
