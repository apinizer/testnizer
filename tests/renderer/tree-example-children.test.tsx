/**
 * Issue #125 follow-up — saved examples as children of their request row in
 * the APIs tree (Postman "Examples" model):
 *   - buildTreeFromDB binds `savedResponse:listByProject` rows under their
 *     owner endpoint / saved request (ONE call per project, never N+1)
 *   - row click on a request opens the LIVE request, the chevron expands;
 *     click on an example child opens the example tab, never the editor
 *   - examples are neither draggable nor drop targets
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

const calls = vi.hoisted(() => ({ listByProject: [] as string[], savedRequestGet: [] as string[] }))
vi.hoisted(() => {
  const ok = <T,>(data: T) => Promise.resolve({ success: true, data })
  const stub = {
    folder: { list: () => ok([{ id: 'f1', name: 'CRUD', parent_id: null, sort_order: 0 }]) },
    endpoint: {
      listByProject: () =>
        ok([
          { id: 'ep1', name: 'Get employee', method: 'GET', path: '/employee/1', folder_id: 'f1' },
        ]),
      get: () => Promise.resolve({ success: false, data: null }),
    },
    savedRequest: {
      list: () =>
        ok([
          {
            id: 'sr1',
            name: 'CreateEmployee',
            method: 'POST',
            url: '{{baseUrl}}/employee',
            folder_id: 'f1',
          },
          { id: 'sr2', name: 'Lonely', method: 'GET', url: '/x', folder_id: null },
        ]),
      get: (id: string) => {
        calls.savedRequestGet.push(id)
        return ok({ id, name: 'CreateEmployee', method: 'POST', url: '{{baseUrl}}/employee' })
      },
    },
    savedResponse: {
      listByProject: (projectId: string) => {
        calls.listByProject.push(projectId)
        return ok([
          {
            id: 'ex1',
            owner_type: 'saved_request',
            owner_id: 'sr1',
            name: '200 OK',
            status_code: 200,
            method: 'POST',
            url: 'https://api.test/employee',
            created_at: 1,
          },
          {
            id: 'ex2',
            owner_type: 'saved_request',
            owner_id: 'sr1',
            name: '400 validation',
            status_code: 400,
            method: 'POST',
            url: 'https://api.test/employee',
            created_at: 2,
          },
          {
            id: 'ex3',
            owner_type: 'endpoint',
            owner_id: 'ep1',
            name: '404',
            status_code: 404,
            method: 'GET',
            url: 'https://api.test/employee/1',
            created_at: 3,
          },
          // Suite items live in the Tests panel — never in the APIs tree.
          {
            id: 'ex4',
            owner_type: 'test_suite_item',
            owner_id: 'item1',
            name: 'suite',
            status_code: 200,
            method: 'GET',
            url: '/',
            created_at: 4,
          },
        ])
      },
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
import type { TreeNode } from '../../src/renderer/types'

function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n
    const hit = n.children ? findNode(n.children, id) : undefined
    if (hit) return hit
  }
  return undefined
}

beforeEach(() => {
  calls.listByProject.length = 0
  calls.savedRequestGet.length = 0
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

describe('buildTreeFromDB binds examples under their owner', () => {
  it('one listByProject call; examples become children of endpoint / saved request rows only', async () => {
    await useWorkspaceStore.getState().refreshTree()
    expect(calls.listByProject).toEqual(['proj-1'])
    const tree = useWorkspaceStore.getState().treeData
    const sr1 = findNode(tree, 'sr1')!
    expect(sr1.children?.map((c) => c.label)).toEqual(['200 OK', '400 validation'])
    expect(sr1.children?.[0]).toMatchObject({
      type: 'example',
      statusCode: 200,
      ownerType: 'saved_request',
      ownerId: 'sr1',
    })
    const ep1 = findNode(tree, 'ep1')!
    expect(ep1.children?.map((c) => c.id)).toEqual(['ex3'])
    // A request without examples stays a leaf.
    expect(findNode(tree, 'sr2')!.children).toBeUndefined()
    // The suite-item example is nowhere in the APIs tree.
    expect(findNode(tree, 'ex4')).toBeUndefined()
  })
})

describe('TreeView click routing for request rows with examples', () => {
  beforeEach(async () => {
    await useWorkspaceStore.getState().refreshTree()
    useWorkspaceStore.setState({ openNodeIds: new Set(['project-proj-1', 'f1']) })
  })

  it('request row click opens the live request and does NOT toggle the example list', async () => {
    render(<TreeView />)
    expect(screen.queryByText('200 OK')).toBeNull()
    fireEvent.click(screen.getByText('CreateEmployee'))
    await waitFor(() => expect(calls.savedRequestGet).toEqual(['sr1']))
    // Still collapsed: the chevron is the only expand target for requests.
    expect(useWorkspaceStore.getState().openNodeIds.has('sr1')).toBe(false)
    expect(screen.queryByText('200 OK')).toBeNull()
    const tab = useTabsStore.getState().tabs[0]
    expect(tab?.savedRequestId).toBe('sr1')
    expect(tab?.protocol).not.toBe('example')
  })

  it('chevron expands the examples; clicking one opens an example tab, not the editor', async () => {
    render(<TreeView />)
    const row = screen
      .getByText('CreateEmployee')
      .closest('[data-testid="tree-node"]') as HTMLElement
    const chevron = row.querySelector('[data-testid="tree-node-chevron"]') as HTMLElement
    expect(chevron).not.toBeNull()
    fireEvent.click(chevron)
    expect(useWorkspaceStore.getState().openNodeIds.has('sr1')).toBe(true)
    // Not opened as a request by the chevron click.
    expect(calls.savedRequestGet).toEqual([])

    const example = await screen.findByText('400 validation')
    const exampleRow = example.closest('[data-testid="tree-node"]') as HTMLElement
    expect(exampleRow.getAttribute('data-node-type')).toBe('example')
    expect(exampleRow.getAttribute('draggable')).toBe('false')
    expect(exampleRow.querySelector('[data-testid="tree-example-status"]')?.textContent).toContain(
      '400',
    )

    fireEvent.click(example)
    const tabs = useTabsStore.getState()
    const tab = tabs.tabs.find((t) => t.savedResponseId === 'ex2')
    expect(tab).toBeDefined()
    expect(tab?.protocol).toBe('example')
    expect(tab?.name).toBe('CreateEmployee · 400 validation')
    expect(tabs.activeTabId).toBe(tab?.id)
    expect(calls.savedRequestGet).toEqual([])
  })

  it('search by example name keeps the parent request visible', async () => {
    useWorkspaceStore.setState({ searchQuery: 'validation' })
    render(<TreeView />)
    expect(await screen.findByText('400 validation')).toBeTruthy()
    expect(screen.getByText('CreateEmployee')).toBeTruthy()
    expect(screen.queryByText('200 OK')).toBeNull()
  })
})
