/**
 * APIs tree builds race. `refreshTree` / `setActiveProject` read the active
 * project, await four IPC reads, then wrote the tree unconditionally:
 *   - a refresh of project A still in flight when the user switched to B
 *     wrote A's tree into B's sidebar;
 *   - two refreshes of the same project finishing out of order let the older
 *     tree overwrite the newer one;
 *   - a branch switch during a build wrote the old branch's tree.
 * Each build here is HELD OPEN (deferred `folder.list`) while the switch
 * happens — a switch after the build settled proves nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FolderCall {
  projectId: string
  scope: string | null
  resolve: (folders: Array<Record<string, unknown>>) => void
}

const calls = vi.hoisted(() => [] as FolderCall[])
vi.hoisted(() => {
  const ok = (data: unknown) => Promise.resolve({ success: true, data })
  const stub = {
    folder: {
      list: (projectId: string, scope: string | null) =>
        new Promise((resolve) => {
          calls.push({
            projectId,
            scope,
            resolve: (folders) => resolve({ success: true, data: folders }),
          })
        }),
    },
    endpoint: { listByProject: () => ok([]) },
    savedRequest: { list: () => ok([]) },
  }
  const g = globalThis as unknown as { window?: { api?: unknown } }
  if (!g.window) g.window = { api: stub }
  else g.window.api = stub
})

import {
  useWorkspaceStore,
  _resetProjectTreeSnapshots,
} from '../../src/renderer/stores/workspace.store'
import { useEnvironmentStore } from '../../src/renderer/stores/environment.store'
import { useBranchStore } from '../../src/renderer/stores/branch.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Project } from '../../src/renderer/types'

const projects = [
  { id: 'A', name: 'alpha', display_name: 'alpha' },
  { id: 'B', name: 'beta', display_name: 'beta' },
] as unknown as Project[]

const s = () => useWorkspaceStore.getState()
const folder = (id: string) => [{ id, name: id, parent_id: null, sort_order: 0 }]
/** Let pending awaits run so the next build reaches `folder.list`. */
const flush = () => new Promise((r) => setTimeout(r, 0))
/** Root id + first-level folder ids of the current tree. */
const shown = () => {
  const root = s().treeData[0]
  return [root?.id, ...(root?.children ?? []).map((c) => c.id)]
}
/** The `n`-th `folder.list` call, after letting the build reach it. */
async function call(n: number): Promise<FolderCall> {
  await flush()
  const c = calls[n]
  if (!c) throw new Error(`folder.list call #${n} not made (made ${calls.length})`)
  return c
}

/** Activate A with its tree written, so later builds start from a known state. */
async function enterA(): Promise<void> {
  const p = s().setActiveProject('A')
  ;(await call(0)).resolve(folder('a-initial'))
  await p
  calls.length = 0
}

beforeEach(() => {
  calls.length = 0
  _resetProjectTreeSnapshots()
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useEnvironmentStore.setState({ setCurrentProject: async () => {} } as never)
  useBranchStore.setState({ currentBranch: 'main' })
  useWorkspaceStore.setState({
    projects,
    activeWorkspaceId: 'ws',
    activeProjectId: null,
    openProjectIds: [],
    treeData: [],
    openNodeIds: new Set(),
    searchQuery: '',
    activeNodeId: null,
  })
})

describe('APIs tree build race', () => {
  it('refresh of A in flight → switch to B → A lands late: the sidebar keeps B', async () => {
    await enterA()
    const refreshA = s().refreshTree()
    const aCall = await call(0)
    expect(aCall.projectId).toBe('A')

    const enterB = s().setActiveProject('B')
    const bCall = await call(1)
    expect(bCall.projectId).toBe('B')
    bCall.resolve(folder('b-folder'))
    await enterB
    expect(shown()).toEqual(['project-B', 'b-folder'])

    aCall.resolve(folder('a-late'))
    await refreshA
    expect(shown()).toEqual(['project-B', 'b-folder'])
    expect(s().activeProjectId).toBe('B')
  })

  it('switch to A in flight → switch to B → A lands late: B tree and B expansion stay', async () => {
    const enterA2 = s().setActiveProject('A')
    const aCall = await call(0)
    const enterB = s().setActiveProject('B')
    const bCall = await call(1)
    bCall.resolve(folder('b-folder'))
    await enterB

    aCall.resolve(folder('a-late'))
    await enterA2
    expect(shown()).toEqual(['project-B', 'b-folder'])
    expect(s().openNodeIds.has('a-late')).toBe(false)
    expect(s().openNodeIds.has('b-folder')).toBe(true)
  })

  it('two refreshes of the same project resolve out of order: the newer tree wins', async () => {
    await enterA()
    const older = s().refreshTree()
    const olderCall = await call(0)
    const newer = s().refreshTree()
    const newerCall = await call(1)

    newerCall.resolve(folder('a-new'))
    await newer
    olderCall.resolve(folder('a-old'))
    await older
    // `await refreshTree()` of the older caller still sees a tree at least
    // as new as its own read.
    expect(shown()).toEqual(['project-A', 'a-new'])
  })

  it('two refreshes resolving in order: each writes, the newer ends on top', async () => {
    await enterA()
    const older = s().refreshTree()
    const olderCall = await call(0)
    const newer = s().refreshTree()
    const newerCall = await call(1)

    olderCall.resolve(folder('a-old'))
    await older
    expect(shown()).toEqual(['project-A', 'a-old'])
    newerCall.resolve(folder('a-new'))
    await newer
    expect(shown()).toEqual(['project-A', 'a-new'])
  })

  it('branch scope changes during a build: the old-branch tree is dropped, the new branch is built', async () => {
    await enterA()
    const refresh = s().refreshTree()
    const mainCall = await call(0)
    expect(mainCall.scope).toBeNull()

    useBranchStore.setState({ currentBranch: 'feature' })
    mainCall.resolve(folder('main-only'))
    const featureCall = await call(1)
    expect(featureCall.scope).toBe('feature')
    // The main-branch result never reached the sidebar.
    expect(shown()).toEqual(['project-A', 'a-initial'])

    featureCall.resolve(folder('feature-folder'))
    await refresh
    expect(shown()).toEqual(['project-A', 'feature-folder'])
  })

  it('switch to B while the branch store loads B’s branch: B still gets its own tree', async () => {
    await enterA()
    useBranchStore.setState({ currentBranch: 'feature' }) // left over from A
    const enterB = s().setActiveProject('B')
    const staleScope = await call(0)
    expect(staleScope).toMatchObject({ projectId: 'B', scope: 'feature' })

    useBranchStore.setState({ currentBranch: 'main' }) // B's branch arrives
    staleScope.resolve(folder('b-stale-scope'))
    const bCall = await call(1)
    expect(bCall).toMatchObject({ projectId: 'B', scope: null })
    bCall.resolve(folder('b-folder'))
    await enterB
    expect(shown()).toEqual(['project-B', 'b-folder'])
    expect(s().openNodeIds.has('b-folder')).toBe(true)
  })

  it('setActiveProject superseded by a later refresh still restores the project’s expansion', async () => {
    const enter = s().setActiveProject('A')
    const enterCall = await call(0)
    const refresh = s().refreshTree()
    const refreshCall = await call(1)

    refreshCall.resolve(folder('a-folder'))
    await refresh
    enterCall.resolve(folder('a-folder'))
    await enter
    expect(shown()).toEqual(['project-A', 'a-folder'])
    // Default expansion of the entered project (root + first-level folders).
    expect(s().openNodeIds.has('project-A')).toBe(true)
    expect(s().openNodeIds.has('a-folder')).toBe(true)
  })

  it('re-entry superseded by a refresh with a NEW first-level folder opens it in the kept tree', async () => {
    await enterA()
    const reenter = s().setActiveProject('A') // same-project re-entry (pull / switch)
    const reenterCall = await call(0)
    const refresh = s().refreshTree()
    const refreshCall = await call(1)
    refreshCall.resolve([...folder('a-initial'), ...folder('a-new-on-branch')])
    await refresh

    reenterCall.resolve(folder('a-initial'))
    await reenter
    expect(shown()).toEqual(['project-A', 'a-initial', 'a-new-on-branch'])
    expect(s().openNodeIds.has('a-new-on-branch')).toBe(true)
  })

  it('an older entry landing after a newer one does not undo the expansion + search', async () => {
    const older = s().setActiveProject('A')
    const olderCall = await call(0)
    const newer = s().setActiveProject('A')
    const newerCall = await call(1)
    newerCall.resolve(folder('a-folder'))
    await newer
    s().setSearchQuery('typed after entering')

    olderCall.resolve(folder('a-folder'))
    await older
    expect(s().searchQuery).toBe('typed after entering')
  })

  it('a switch that moved on during the environment load writes nothing', async () => {
    await enterA()
    let releaseEnv: () => void = () => {}
    useEnvironmentStore.setState({
      setCurrentProject: (id: string | null) =>
        id === null ? new Promise<void>((r) => (releaseEnv = r)) : Promise.resolve(),
    } as never)
    const toHome = s().setActiveProject(null)
    await flush()
    const enterB = s().setActiveProject('B')
    ;(await call(0)).resolve(folder('b-folder'))
    await enterB

    releaseEnv()
    await toHome
    expect(shown()).toEqual(['project-B', 'b-folder'])
  })

  it('a build in flight does not overwrite a direct setTreeData', async () => {
    await enterA()
    const refresh = s().refreshTree()
    const refreshCall = await call(0)
    s().setTreeData([{ id: 'project-A', type: 'module', label: 'alpha', children: [] }])
    refreshCall.resolve(folder('a-stale'))
    await refresh
    expect(shown()).toEqual(['project-A'])
  })

  it('a single refresh still writes its tree', async () => {
    await enterA()
    const refresh = s().refreshTree()
    ;(await call(0)).resolve(folder('a-fresh'))
    await refresh
    expect(shown()).toEqual(['project-A', 'a-fresh'])
  })
})
