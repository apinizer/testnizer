/**
 * Issue #257 (export order) — GUARD for the "tree order" half of the contract.
 *
 * The decision: a Postman export lists items in the order the APIs tree shows
 * them. This test pins that order against the REAL tree builder
 * (`workspace.store.refreshTree` -> `buildTreeFromDB`) with mocked list IPCs,
 * using the shared fixture. tests/main/export-order-tree-257.test.ts asserts
 * the exports against the SAME `EXPECTED_TREE_ORDER`, so if the tree order ever
 * changes the two files fail together and the export cannot drift silently.
 *
 * Green now (this documents today's tree); it must stay green unless the
 * decision is deliberately revisited.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import type { TreeNode } from '../../src/renderer/types'
import {
  ENDPOINTS,
  EXPECTED_TREE_ORDER,
  FOLDERS,
  SAVED,
  type OrderNode,
} from '../fixtures/export-order-257'

const PID = 'p-order'
const folderId = (name: string): string => `f:${name}`
const bySort = <T extends { sort: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.sort - b.sort)

function ok<T>(data: T): Promise<{ success: boolean; data: T }> {
  return Promise.resolve({ success: true, data })
}

function toOrder(nodes: TreeNode[]): OrderNode[] {
  return nodes.map((n) =>
    n.type === 'folder' ? { [n.label]: toOrder(n.children ?? []) } : n.label,
  )
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    folder: {
      list: () =>
        ok(
          bySort(FOLDERS).map((f) => ({
            id: folderId(f.name),
            project_id: PID,
            parent_id: f.parent ? folderId(f.parent) : null,
            name: f.name,
            sort_order: f.sort,
          })),
        ),
    },
    endpoint: {
      listByProject: () =>
        ok(
          bySort(ENDPOINTS).map((e) => ({
            id: `e:${e.name}`,
            project_id: PID,
            folder_id: e.folder ? folderId(e.folder) : null,
            name: e.name,
            method: 'GET',
            path: `/${e.name}`,
            protocol: 'http',
            request_schema: null,
          })),
        ),
    },
    savedRequest: {
      list: () =>
        ok(
          bySort(SAVED).map((s) => ({
            id: `s:${s.name}`,
            project_id: PID,
            folder_id: s.folder ? folderId(s.folder) : null,
            name: s.name,
            method: 'GET',
            url: `/${s.name}`,
            protocol: 'http',
            metadata: null,
          })),
        ),
    },
    savedResponse: { listByProject: () => ok([]) },
  }
  useWorkspaceStore.setState({
    activeProjectId: PID,
    projects: [{ id: PID, name: 'order', display_name: 'order' }] as never,
    treeData: [],
  })
})

describe('the APIs tree order (what exports must reproduce)', () => {
  it('root: folders, then endpoints, then saved requests; folder: requests, then sub-folders', async () => {
    await useWorkspaceStore.getState().refreshTree()
    const root = useWorkspaceStore.getState().treeData[0]
    expect(root.type).toBe('module')
    expect(toOrder(root.children ?? [])).toEqual(EXPECTED_TREE_ORDER)
  })
})
