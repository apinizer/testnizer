/**
 * Issue #269 (P0 data loss) — save a request, delete it (or its folder) from
 * the sidebar, keep the tab open, press Ctrl+S: "Request saved", tab clean,
 * nothing written (the row is gone). The in-place save now:
 *   - sees the row is gone (update answers `notFound`, or the reload of a
 *     not-loaded / withheld tab finds no row),
 *   - unbinds the tab (no endpoint / saved request / suite item id, no
 *     not-loaded flags) and keeps it dirty,
 *   - returns `{ notApplicable, orphaned }` so the caller opens Save As.
 * Deleting from the APIs tree or the Tests panel releases matching open tabs
 * (descendants of a deleted folder included) with one rule: a clean tab
 * closes, a dirty one is unbound the same way and stays open. The in-place
 * save never closes a tab, clean or dirty — the row can vanish without the
 * user deleting it (git switch / pull).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab, TreeNode } from '../../src/renderer/types'

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('../../src/renderer/lib/toast', () => ({ toast: toastMock }))

vi.setConfig({ testTimeout: 30_000 })

type Row = Record<string, unknown>

interface Api {
  endpoints: Map<string, Row>
  savedRequests: Map<string, Row>
  suiteItems: Map<string, Row>
  endpointUpdate: ReturnType<typeof vi.fn>
  savedRequestUpdate: ReturnType<typeof vi.fn>
  suiteItemUpdate: ReturnType<typeof vi.fn>
}

/** Mirrors the main handlers: a missing row reads as `data: null` (endpoint /
 *  saved request) or `notFound` (suite item); an update of one answers
 *  `{ success: false, notFound: true }`. */
function installApi(): Api {
  const endpoints = new Map<string, Row>()
  const savedRequests = new Map<string, Row>()
  const suiteItems = new Map<string, Row>()
  const read = (m: Map<string, Row>, notFoundOnMiss = false) =>
    vi.fn(async (id: string) => {
      const row = m.get(id)
      if (!row && notFoundOnMiss) return { success: false, error: 'Item not found', notFound: true }
      return { success: true, data: row ?? null }
    })
  const write = (m: Map<string, Row>) =>
    vi.fn(async (id: string, patch: Row) => {
      if (!m.has(id)) return { success: false, error: 'Not found', notFound: true }
      m.set(id, { ...m.get(id), ...patch })
      return { success: true, data: m.get(id) }
    })
  const endpointUpdate = write(endpoints)
  const savedRequestUpdate = write(savedRequests)
  const suiteItemUpdate = write(suiteItems)
  const named: Record<string, unknown> = {
    endpoint: { get: read(endpoints), update: endpointUpdate },
    savedRequest: { get: read(savedRequests), update: savedRequestUpdate },
    testSuiteItem: { get: read(suiteItems, true), update: suiteItemUpdate },
  }
  const ns = () =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => {
          if (method.startsWith('on')) return () => () => {}
          return () => Promise.resolve({ success: false, error: 'stub' })
        },
      },
    )
  ;(window as unknown as { api: unknown }).api = new Proxy(named, {
    get: (target, key: string) => (key in target ? target[key] : (target[key] = ns())),
  })
  return {
    endpoints,
    savedRequests,
    suiteItems,
    endpointUpdate,
    savedRequestUpdate,
    suiteItemUpdate,
  }
}

async function launch() {
  vi.resetModules()
  const [tabs, req, save, ws, activate, open, withheld, orphan] = await Promise.all([
    import('../../src/renderer/stores/tabs.store'),
    import('../../src/renderer/stores/request.store'),
    import('../../src/renderer/lib/save-active-request'),
    import('../../src/renderer/stores/workspace.store'),
    import('../../src/renderer/lib/activate-tab'),
    import('../../src/renderer/lib/open-endpoint-tab'),
    import('../../src/renderer/lib/withheld-credentials'),
    import('../../src/renderer/lib/orphan-tab'),
  ])
  ws.useWorkspaceStore.setState({ refreshTree: async () => {} } as never)
  return {
    useTabsStore: tabs.useTabsStore,
    useRequestStore: req.useRequestStore,
    saveActiveRequestInPlace: save.saveActiveRequestInPlace,
    switchActiveTab: activate.switchActiveTab,
    openEndpointTab: open.openEndpointTab,
    openSuiteItemTab: open.openSuiteItemTab,
    ensureWithheldCredentialsLoaded: withheld.ensureWithheldCredentialsLoaded,
    isTabUnloaded: withheld.isTabUnloaded,
    orphan,
  }
}
type App = Awaited<ReturnType<typeof launch>>

function tabOf(app: App, tabId: string): Tab {
  const tab = app.useTabsStore.getState().tabs.find((t) => t.id === tabId)
  if (!tab) throw new Error(`no tab ${tabId}`)
  return tab
}

async function workbenchActivate(app: App, tabId: string): Promise<void> {
  app.switchActiveTab(tabId)
  await app.ensureWithheldCredentialsLoaded(tabOf(app, tabId))
}

async function openPinned(app: App, id: string, suite = false): Promise<string> {
  if (suite) await app.openSuiteItemTab(id, { pinned: true })
  else await app.openEndpointTab(id)
  const tabId = app.useTabsStore.getState().activeTabId as string
  app.useTabsStore.getState().pinTab(tabId)
  await workbenchActivate(app, tabId)
  return tabId
}

const SCHEMA = {
  url: 'https://probe.test/a',
  method: 'GET',
  params: [],
  headers: [],
  body: { type: 'none' },
  auth: { type: 'none' },
  preScript: '',
  postScript: '',
  assertions: [],
}

function seedEndpoint(api: Api, id: string, url = SCHEMA.url): void {
  api.endpoints.set(id, {
    id,
    name: `Endpoint ${id}`,
    method: 'GET',
    path: url,
    protocol: 'http',
    request_schema: JSON.stringify({ ...SCHEMA, url }),
  })
}

function expectOrphaned(app: App, tabId: string): void {
  const tab = tabOf(app, tabId)
  expect(tab.endpointId).toBeUndefined()
  expect(tab.savedRequestId).toBeUndefined()
  expect(tab.testSuiteItemId).toBeUndefined()
  expect(tab.isDirty).toBe(true)
  expect(tab.orphaned).toBe(true)
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('in-place save of a request whose row is gone (issue #269)', () => {
  it('endpoint deleted → Ctrl+S reports orphaned, writes nothing, tab unbound and dirty', async () => {
    const api = installApi()
    seedEndpoint(api, 'ep-a')
    const app = await launch()
    const tabId = await openPinned(app, 'ep-a')
    app.useRequestStore.getState().setUrl('https://probe.test/edited')
    expect(tabOf(app, tabId).isDirty).toBe(true)

    api.endpoints.delete('ep-a') // deleted from the sidebar
    const res = await app.saveActiveRequestInPlace()

    expect(res).toMatchObject({ success: false, notApplicable: true, orphaned: true })
    expectOrphaned(app, tabId)
    // The tab stays open and keeps the edit.
    expect(app.useRequestStore.getState().url).toBe('https://probe.test/edited')
    expect(api.endpoints.has('ep-a')).toBe(false)
  })

  it('a CLEAN tab whose row vanished (git switch / pull) is orphaned by Ctrl+S, never closed', async () => {
    const api = installApi()
    seedEndpoint(api, 'ep-a')
    const app = await launch()
    const tabId = await openPinned(app, 'ep-a')
    expect(tabOf(app, tabId).isDirty).toBe(false)

    api.endpoints.delete('ep-a') // gone without a sidebar delete
    const res = await app.saveActiveRequestInPlace()

    expect(res).toMatchObject({ success: false, notApplicable: true, orphaned: true })
    expectOrphaned(app, tabId)
    expect(app.useTabsStore.getState().activeTabId).toBe(tabId)
  })

  it('saved request deleted → orphaned (no "Request saved", no clean flag)', async () => {
    const api = installApi()
    const app = await launch()
    app.useTabsStore.getState().openTab({
      id: 'tab-sr',
      name: 'Saved',
      protocol: 'http',
      method: 'GET',
      url: 'https://x.test',
      savedRequestId: 'sr-gone',
    } as Tab)
    app.switchActiveTab('tab-sr')
    app.useRequestStore.getState().setUrl('https://x.test/edited')

    const res = await app.saveActiveRequestInPlace()

    expect(api.savedRequestUpdate).toHaveBeenCalledTimes(1)
    expect(res).toMatchObject({ success: false, notApplicable: true, orphaned: true })
    expectOrphaned(app, 'tab-sr')
  })

  it('suite item deleted → orphaned', async () => {
    const api = installApi()
    api.suiteItems.set('si-a', {
      id: 'si-a',
      name: 'Item',
      protocol: 'http',
      method: 'GET',
      url: 'https://suite.test',
      request_schema: JSON.stringify(SCHEMA),
      assertions: '[]',
    })
    const app = await launch()
    const tabId = await openPinned(app, 'si-a', true)
    app.useRequestStore.getState().setUrl('https://suite.test/edited')

    api.suiteItems.delete('si-a')
    const res = await app.saveActiveRequestInPlace()

    expect(res).toMatchObject({ success: false, notApplicable: true, orphaned: true })
    expectOrphaned(app, tabId)
  })

  it('a not-loaded tab (cache cap) whose row vanished is orphaned, not refused as not-loaded', async () => {
    const api = installApi()
    seedEndpoint(api, 'ep-a')
    const app = await launch()
    const probe = await openPinned(app, 'ep-a')
    for (let i = 0; i < 22; i++) {
      seedEndpoint(api, `fill-${i}`, `https://fill.test/${i}`)
      await openPinned(app, `fill-${i}`)
    }
    api.endpoints.delete('ep-a')
    await workbenchActivate(app, probe)

    const res = await app.saveActiveRequestInPlace()

    expect(res).toMatchObject({ success: false, notApplicable: true, orphaned: true })
    expectOrphaned(app, probe)
    expect(app.isTabUnloaded(probe)).toBe(false)
    expect(api.endpointUpdate).not.toHaveBeenCalled()
  })

  it('an unreadable row (IPC failure) is still refused — never orphaned', async () => {
    const api = installApi()
    seedEndpoint(api, 'ep-a')
    const app = await launch()
    const probe = await openPinned(app, 'ep-a')
    for (let i = 0; i < 22; i++) {
      seedEndpoint(api, `fill-${i}`, `https://fill.test/${i}`)
      await openPinned(app, `fill-${i}`)
    }
    const w = window as unknown as { api: { endpoint: { get: ReturnType<typeof vi.fn> } } }
    w.api.endpoint.get.mockResolvedValue({ success: false, error: 'disk' })
    await workbenchActivate(app, probe)

    const res = await app.saveActiveRequestInPlace()

    expect(res.success).toBe(false)
    expect(res.orphaned).toBeFalsy()
    expect(tabOf(app, probe).endpointId).toBe('ep-a')
  })
})

describe('deleting from the sidebar releases matching open tabs (issue #269)', () => {
  const tree: TreeNode[] = [
    {
      id: 'f1',
      type: 'folder',
      label: 'Payments',
      children: [
        { id: 'ep-1', type: 'endpoint', label: 'Pay', method: 'POST' },
        {
          id: 'f2',
          type: 'folder',
          label: 'Nested',
          children: [
            {
              id: 'sr-1',
              type: 'request',
              label: 'Refund',
              method: 'POST',
              children: [{ id: 'ex-1', type: 'example', label: 'Example' }],
            },
          ],
        },
      ],
    },
    { id: 'ep-out', type: 'endpoint', label: 'Outside', method: 'GET' },
  ]

  /** t1 (clean) and t2 (dirty) live under f1; t3 is outside; t4 is a suite item. */
  function seedTabs(app: App, dirty: string[] = []): void {
    app.useTabsStore.setState({
      tabs: [
        { id: 't1', name: 'Pay', protocol: 'http', endpointId: 'ep-1' },
        { id: 't2', name: 'Refund', protocol: 'http', savedRequestId: 'sr-1' },
        { id: 't3', name: 'Outside', protocol: 'http', endpointId: 'ep-out' },
        { id: 't4', name: 'Suite', protocol: 'http', testSuiteItemId: 'si-1' },
      ].map((t) => ({ ...t, isDirty: dirty.includes(t.id), isLoading: false })) as Tab[],
      activeTabId: 't1',
    })
  }

  const ids = (app: App): string[] => app.useTabsStore.getState().tabs.map((t) => t.id)

  it('folder delete closes the clean descendant tabs and orphans the dirty ones', async () => {
    installApi()
    const app = await launch()
    seedTabs(app, ['t2'])
    const confirm = vi.spyOn(window, 'confirm')

    const released = app.orphan.releaseTabsForTreeNode(tree, 'f1')

    expect(released).toEqual({ closed: ['t1'], orphaned: ['t2'] })
    expect(ids(app)).toEqual(['t2', 't3', 't4'])
    expectOrphaned(app, 't2')
    expect(tabOf(app, 't3').endpointId).toBe('ep-out')
    expect(tabOf(app, 't3').isDirty).toBe(false)
    // The closed tab was active: its neighbour takes over, protocol stores too.
    expect(app.useTabsStore.getState().activeTabId).toBe('t2')
    expect(app.useRequestStore.getState()._currentTabId).toBe('t2')
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('a single endpoint delete releases only its tab', async () => {
    installApi()
    const app = await launch()
    seedTabs(app)

    expect(app.orphan.releaseTabsForTreeNode(tree, 'ep-out')).toEqual({
      closed: ['t3'],
      orphaned: [],
    })
    expect(ids(app)).toEqual(['t1', 't2', 't4'])
    expect(tabOf(app, 't1').endpointId).toBe('ep-1')
    // An inactive tab closing leaves the active one alone.
    expect(app.useTabsStore.getState().activeTabId).toBe('t1')
  })

  it('a dirty single endpoint tab is orphaned, not closed', async () => {
    installApi()
    const app = await launch()
    seedTabs(app, ['t3'])

    app.orphan.releaseTabsForTreeNode(tree, 'ep-out')

    expectOrphaned(app, 't3')
    expect(ids(app)).toHaveLength(4)
  })

  it('suite item ids (Tests item / folder / suite delete) follow the same rule', async () => {
    installApi()
    const app = await launch()
    seedTabs(app)
    app.orphan.releaseTabsForDeletedRows({ testSuiteItemIds: ['si-1'] })
    expect(ids(app)).toEqual(['t1', 't2', 't3'])

    seedTabs(app, ['t4'])
    app.orphan.releaseTabsForDeletedRows({ testSuiteItemIds: ['si-1'] })
    expectOrphaned(app, 't4')
    expect(tabOf(app, 't1').endpointId).toBe('ep-1')
  })

  it('suite folder subtree item ids include nested folders', async () => {
    installApi()
    const app = await launch()
    const ids = app.orphan.suiteFolderItemIds(
      {
        folders: [
          { id: 'a', parent_id: null },
          { id: 'b', parent_id: 'a' },
          { id: 'c', parent_id: null },
        ],
        items: [
          { id: 'i1', folder_id: 'a' },
          { id: 'i2', folder_id: 'b' },
          { id: 'i3', folder_id: 'c' },
          { id: 'i4', folder_id: null },
        ],
      },
      'a',
    )
    expect(ids.sort()).toEqual(['i1', 'i2'])
  })
})
