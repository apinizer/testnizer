/**
 * P0 data loss — the request store's per-tab cache cap (`switchToTab`) dropped
 * the oldest cached tab state once more than 20 tabs had been visited. The
 * dropped tab came back as `emptyTabState()` and was never reloaded from its
 * saved row, so:
 *   - reopening a saved endpoint showed an empty URL / script, and Ctrl+S
 *     ("Request saved") wrote that empty state over the row;
 *   - an unsaved draft lost its content while the tab stayed dirty;
 *   - after a restart only ~20 tab states were in the snapshot.
 *
 * The fix treats a dropped (or, after a restart, missing) slice of a tab bound
 * to a saved row like a fully withheld one (#244): it is marked "not loaded"
 * and rehydrated from the row by `ensureWithheldCredentialsLoaded` — on
 * activation and before Ctrl+S / Save As / Send. Dirty and unsaved tabs are
 * never evicted. An unreadable row refuses the in-place save.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../../src/renderer/types'

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('../../src/renderer/lib/toast', () => ({ toast: toastMock }))

// Each test re-imports the whole store graph (`vi.resetModules`).
vi.setConfig({ testTimeout: 30_000 })

type Row = Record<string, unknown>
type Call = { name: string; args: unknown[] }

interface Api {
  endpoints: Map<string, Row>
  savedRequests: Map<string, Row>
  suiteItems: Map<string, Row>
  calls: Call[]
  endpointUpdate: ReturnType<typeof vi.fn>
  savedRequestUpdate: ReturnType<typeof vi.fn>
  suiteItemUpdate: ReturnType<typeof vi.fn>
  /** When set, every row read waits for it (switch-away race). */
  gate: { wait: Promise<void> | null }
  /** When true, every row read fails (unreadable row). */
  broken: { on: boolean }
}

function installApi(): Api {
  const endpoints = new Map<string, Row>()
  const savedRequests = new Map<string, Row>()
  const suiteItems = new Map<string, Row>()
  const calls: Call[] = []
  const gate: Api['gate'] = { wait: null }
  const broken = { on: false }
  const read = (m: Map<string, Row>) =>
    vi.fn(async (id: string) => {
      if (gate.wait) await gate.wait
      if (broken.on) return { success: false, error: 'disk' }
      return { success: true, data: m.get(id) ?? null }
    })
  const write = (m: Map<string, Row>) =>
    vi.fn(async (id: string, patch: Row) => {
      m.set(id, { ...m.get(id), ...patch })
      return { success: true, data: true }
    })
  const endpointUpdate = write(endpoints)
  const savedRequestUpdate = write(savedRequests)
  const suiteItemUpdate = write(suiteItems)
  const named: Record<string, unknown> = {
    endpoint: { get: read(endpoints), update: endpointUpdate },
    savedRequest: { get: read(savedRequests), update: savedRequestUpdate },
    testSuiteItem: { get: read(suiteItems), update: suiteItemUpdate },
  }
  const ns = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) => {
          if (method.startsWith('on')) return () => () => {}
          return (...args: unknown[]) => {
            calls.push({ name: `${name}.${method}`, args })
            return Promise.resolve({ success: false, error: 'stub' })
          }
        },
      },
    )
  const api = new Proxy(named, {
    get: (target, key: string) => (key in target ? target[key] : (target[key] = ns(key))),
  })
  ;(window as unknown as { api: unknown }).api = api
  return {
    endpoints,
    savedRequests,
    suiteItems,
    calls,
    endpointUpdate,
    savedRequestUpdate,
    suiteItemUpdate,
    gate,
    broken,
  }
}

async function launch() {
  vi.resetModules()
  const [tabs, req, ws, save, wsStore, activate, open, withheld] = await Promise.all([
    import('../../src/renderer/stores/tabs.store'),
    import('../../src/renderer/stores/request.store'),
    import('../../src/renderer/stores/websocket.store'),
    import('../../src/renderer/lib/save-active-request'),
    import('../../src/renderer/stores/workspace.store'),
    import('../../src/renderer/lib/activate-tab'),
    import('../../src/renderer/lib/open-endpoint-tab'),
    import('../../src/renderer/lib/withheld-credentials'),
  ])
  wsStore.useWorkspaceStore.setState({ refreshTree: async () => {} } as never)
  return {
    useTabsStore: tabs.useTabsStore,
    useRequestStore: req.useRequestStore,
    useWebSocketStore: ws.useWebSocketStore,
    saveActiveRequestInPlace: save.saveActiveRequestInPlace,
    switchActiveTab: activate.switchActiveTab,
    activateTabStores: activate.activateTabStores,
    openEndpointTab: open.openEndpointTab,
    openSuiteItemTab: open.openSuiteItemTab,
    ensureWithheldCredentialsLoaded: withheld.ensureWithheldCredentialsLoaded,
  }
}
type App = Awaited<ReturnType<typeof launch>>

function activeTab(app: App): Tab {
  const s = app.useTabsStore.getState()
  const tab = s.tabs.find((t) => t.id === s.activeTabId)
  if (!tab) throw new Error('no active tab')
  return tab
}

/** What the Workbench's active-tab effect runs (switch, then background reload). */
async function workbenchActivate(app: App, tabId: string): Promise<void> {
  app.switchActiveTab(tabId)
  await app.ensureWithheldCredentialsLoaded(activeTab(app))
}

/** Ctrl+T: a new unsaved HTTP tab, activated like the Workbench does. */
function newTab(app: App, id: string): void {
  app.useTabsStore.getState().openTab({
    id,
    name: 'New Request',
    protocol: 'http',
    method: 'GET',
    url: '',
  } as Tab)
  app.activateTabStores(id)
}

function openMany(app: App, n: number, prefix = 'blank'): void {
  for (let i = 0; i < n; i++) newTab(app, `${prefix}-${i}`)
}

/** Open a saved row from the tree and keep its tab (no preview replacement). */
async function openPinned(app: App, id: string, suite = false): Promise<string> {
  if (suite) await app.openSuiteItemTab(id, { pinned: true })
  else await app.openEndpointTab(id)
  const tabId = app.useTabsStore.getState().activeTabId as string
  app.useTabsStore.getState().pinTab(tabId)
  await workbenchActivate(app, tabId)
  return tabId
}

const ENDPOINT_SCHEMA = {
  url: 'https://probe.test/a',
  method: 'POST',
  params: [],
  headers: [{ id: 'h1', key: 'Accept', value: 'application/json', enabled: true }],
  body: { type: 'json', content: '{"a":1}' },
  auth: { type: 'none' },
  preScript: '',
  postScript: 'pm.test("ok", () => pm.response.to.have.status(200))',
  assertions: [{ id: 'as1', name: 'status', type: 'status_equals', enabled: true, expected: 200 }],
}

function seedEndpoint(api: Api, id = 'ep-a', schema: Row = ENDPOINT_SCHEMA): void {
  api.endpoints.set(id, {
    id,
    name: 'Probe A',
    method: schema.method ?? 'GET',
    path: schema.url,
    protocol: 'http',
    request_schema: JSON.stringify(schema),
  })
}

/**
 * Open `n` more saved endpoints from the tree — idle saved tabs, the only
 * kind the cache cap drops, so the first tab's state is evicted.
 */
async function openManySaved(app: App, api: Api, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    seedEndpoint(api, `fill-${i}`, { ...ENDPOINT_SCHEMA, url: `https://fill.test/${i}` })
    await openPinned(app, `fill-${i}`)
  }
}

/** Row reads of `id` through `endpoint.get` so far. */
function endpointReads(id: string): number {
  const api = (window as unknown as { api: { endpoint: { get: ReturnType<typeof vi.fn> } } }).api
  return api.endpoint.get.mock.calls.filter((c) => c[0] === id).length
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('request tab cache eviction — saved rows are never overwritten with an empty state', () => {
  it('endpoint: back after 22 new tabs → restored from the row; Ctrl+S leaves the row unchanged', async () => {
    const api = installApi()
    seedEndpoint(api)
    const app = await launch()
    const probe = await openPinned(app, 'ep-a')
    expect(app.useRequestStore.getState().url).toBe(ENDPOINT_SCHEMA.url)

    // The reported repro: 22 Ctrl+T tabs — unsaved drafts no longer count
    // against the cap, so the saved tab is not even dropped.
    openMany(app, 22)
    await workbenchActivate(app, probe)
    expect(app.useRequestStore.getState().url).toBe(ENDPOINT_SCHEMA.url)
    expect(endpointReads('ep-a')).toBe(1)

    // 22 more SAVED tabs: now it is dropped, and comes back from its row.
    await openManySaved(app, api, 22)
    await workbenchActivate(app, probe)
    expect(endpointReads('ep-a')).toBe(2)

    const st = app.useRequestStore.getState()
    expect(st.url).toBe(ENDPOINT_SCHEMA.url)
    expect(st.method).toBe('POST')
    expect(st.postScript).toBe(ENDPOINT_SCHEMA.postScript)
    expect(st.assertions).toHaveLength(1)

    const res = await app.saveActiveRequestInPlace()
    expect(res.success).toBe(true)
    const saved = JSON.parse(String(api.endpoints.get('ep-a')?.request_schema))
    expect(saved.url).toBe(ENDPOINT_SCHEMA.url)
    expect(saved.method).toBe('POST')
    expect(saved.postScript).toBe(ENDPOINT_SCHEMA.postScript)
    expect(saved.assertions).toHaveLength(1)
    expect(saved.body).toEqual(ENDPOINT_SCHEMA.body)
  })

  it('saved request: Ctrl+S right after switching back (no background reload) keeps every column', async () => {
    const api = installApi()
    api.savedRequests.set('sr-a', {
      id: 'sr-a',
      name: 'Saved A',
      method: 'PUT',
      url: 'https://probe.test/saved',
      protocol: 'http',
      params: '[]',
      headers: JSON.stringify([{ id: 'h', key: 'X-Trace', value: '1', enabled: true }]),
      body: JSON.stringify({ type: 'json', content: '{"b":2}' }),
      auth: JSON.stringify({ type: 'none' }),
      pre_script: 'console.log("pre")',
      post_script: 'pm.test("saved", () => {})',
      assertions: JSON.stringify([
        { id: 'a1', name: 's', type: 'status_equals', enabled: true, expected: 201 },
      ]),
      metadata: JSON.stringify({ timeout: 4321 }),
    })
    const app = await launch()
    const tabId = await openPinned(app, 'sr-a')
    await openManySaved(app, api, 22)

    // Straight to Ctrl+S — the save path must reload the row itself.
    app.switchActiveTab(tabId)
    const res = await app.saveActiveRequestInPlace()
    expect(res.success).toBe(true)
    const row = api.savedRequests.get('sr-a') as Row
    expect(row.url).toBe('https://probe.test/saved')
    expect(row.method).toBe('PUT')
    expect(row.pre_script).toBe('console.log("pre")')
    expect(row.post_script).toBe('pm.test("saved", () => {})')
    expect(JSON.parse(String(row.assertions))).toHaveLength(1)
    expect(JSON.parse(String(row.body))).toEqual({ type: 'json', content: '{"b":2}' })
    expect(JSON.parse(String(row.headers))[0].key).toBe('X-Trace')
    expect(JSON.parse(String(row.metadata)).timeout).toBe(4321)
  })

  it('test-suite item: Ctrl+S right after switching back keeps url, method, scripts and assertions', async () => {
    const api = installApi()
    api.suiteItems.set('si-a', {
      id: 'si-a',
      suite_id: 's1',
      folder_id: null,
      protocol: 'http',
      name: 'Item A',
      method: 'DELETE',
      url: 'https://probe.test/item',
      request_schema: JSON.stringify({
        params: [],
        headers: [],
        body: { type: 'none' },
        auth: { type: 'none' },
        preScript: '',
        postScript: 'pm.test("item", () => {})',
      }),
      assertions: JSON.stringify([
        { id: 'a1', name: 's', type: 'status_equals', enabled: true, expected: 204 },
      ]),
    })
    const app = await launch()
    const tabId = await openPinned(app, 'si-a', true)
    await openManySaved(app, api, 22)

    app.switchActiveTab(tabId)
    const res = await app.saveActiveRequestInPlace()
    expect(res.success).toBe(true)
    const row = api.suiteItems.get('si-a') as Row
    expect(row.url).toBe('https://probe.test/item')
    expect(row.method).toBe('DELETE')
    expect(JSON.parse(String(row.request_schema)).postScript).toBe('pm.test("item", () => {})')
    expect(JSON.parse(String(row.assertions))).toHaveLength(1)
  })

  it('an unsaved draft and a dirty saved tab survive 22 tab switches', async () => {
    const api = installApi()
    seedEndpoint(api)
    const app = await launch()

    newTab(app, 'draft')
    app.useRequestStore.getState().setUrl('https://draft.test/x')
    app.useRequestStore.getState().setPostScript('// draft script')
    expect(app.useTabsStore.getState().tabs.find((t) => t.id === 'draft')?.isDirty).toBe(true)

    const probe = await openPinned(app, 'ep-a')
    app.useRequestStore.getState().setUrl('https://probe.test/edited')
    expect(app.useTabsStore.getState().tabs.find((t) => t.id === probe)?.isDirty).toBe(true)

    openMany(app, 22)
    await openManySaved(app, api, 22)

    await workbenchActivate(app, 'draft')
    expect(app.useRequestStore.getState().url).toBe('https://draft.test/x')
    expect(app.useRequestStore.getState().postScript).toBe('// draft script')

    await workbenchActivate(app, probe)
    // The unsaved edit wins over the row — it was never evicted.
    expect(app.useRequestStore.getState().url).toBe('https://probe.test/edited')
  })

  it('restart with 30 saved tabs: each restores from its row on activation, and Send carries the right URL', async () => {
    const api = installApi()
    for (let i = 0; i < 30; i++) {
      seedEndpoint(api, `ep-${i}`, { ...ENDPOINT_SCHEMA, url: `https://probe.test/r${i}` })
    }
    const s1 = await launch()
    const ids: string[] = []
    for (let i = 0; i < 30; i++) ids.push(await openPinned(s1, `ep-${i}`))

    // Restart: modules re-imported, stores rehydrate from localStorage.
    const app = await launch()
    expect(app.useTabsStore.getState().tabs).toHaveLength(30)

    // The oldest tab, Send pressed at once (no background reload yet).
    app.switchActiveTab(ids[0])
    await app.useRequestStore.getState().sendRequest()
    const send = api.calls.filter((c) => c.name === 'request.send').pop()
    expect((send?.args[0] as { url?: string } | undefined)?.url).toBe('https://probe.test/r0')

    for (let i = 0; i < 30; i++) {
      await workbenchActivate(app, ids[i])
      expect(app.useRequestStore.getState().url).toBe(`https://probe.test/r${i}`)
      expect(app.useRequestStore.getState().postScript).toBe(ENDPOINT_SCHEMA.postScript)
    }
  })

  it('a WebSocket tab whose protocol slice is missing after a restart restores it from the row', async () => {
    const api = installApi()
    const schema = {
      url: 'wss://saved.test/ws',
      method: 'GET',
      headers: [],
      auth: { type: 'none' },
      metadata: {
        websocket: {
          url: 'wss://saved.test/ws',
          customHeaders: [{ id: 'w1', key: 'X-Room', value: 'blue', enabled: true }],
          composerContent: 'hello',
          composerMode: 'text',
          autoScroll: true,
        },
      },
    }
    api.endpoints.set('ep-ws', {
      id: 'ep-ws',
      name: 'WS',
      method: 'GET',
      path: schema.url,
      protocol: 'websocket',
      request_schema: JSON.stringify(schema),
    })
    const s1 = await launch()
    const wsTab = await openPinned(s1, 'ep-ws')
    expect(s1.useWebSocketStore.getState().url).toBe('wss://saved.test/ws')
    await openManySaved(s1, api, 22)

    // The WebSocket snapshot did not make it to disk (quota, older build).
    localStorage.removeItem('testnizer-websocket')
    const app = await launch()
    await workbenchActivate(app, wsTab)
    expect(app.useWebSocketStore.getState().url).toBe('wss://saved.test/ws')
    expect(app.useWebSocketStore.getState().composerContent).toBe('hello')

    const res = await app.saveActiveRequestInPlace()
    expect(res.success).toBe(true)
    const saved = JSON.parse(String(api.endpoints.get('ep-ws')?.request_schema))
    expect(saved.metadata.websocket.url).toBe('wss://saved.test/ws')
    expect(saved.metadata.websocket.customHeaders[0].value).toBe('blue')
  })

  it('an unreadable row refuses the in-place save instead of writing the empty state', async () => {
    const api = installApi()
    seedEndpoint(api)
    const app = await launch()
    const probe = await openPinned(app, 'ep-a')
    await openManySaved(app, api, 22)

    api.broken.on = true
    app.switchActiveTab(probe)
    const res = await app.saveActiveRequestInPlace()
    expect(res.success).toBe(false)
    expect(res.error).toBeTruthy()
    expect(api.endpointUpdate).not.toHaveBeenCalled()
    const saved = JSON.parse(String(api.endpoints.get('ep-a')?.request_schema))
    expect(saved.url).toBe(ENDPOINT_SCHEMA.url)

    // Readable again → the next activation restores it and saving works.
    api.broken.on = false
    await workbenchActivate(app, probe)
    expect(app.useRequestStore.getState().url).toBe(ENDPOINT_SCHEMA.url)
    expect((await app.saveActiveRequestInPlace()).success).toBe(true)
  })

  it("another project's cached tabs do not make every switch evict the tab just left", async () => {
    const api = installApi()
    seedEndpoint(api, 'ep-a')
    seedEndpoint(api, 'ep-b', { ...ENDPOINT_SCHEMA, url: 'https://probe.test/b' })
    const app = await launch()
    // 21 cached states of tabs not in the open set (the previous project's).
    for (let i = 0; i < 21; i++) app.useRequestStore.getState().switchToTab(`elsewhere-${i}`)

    const a = await openPinned(app, 'ep-a')
    const b = await openPinned(app, 'ep-b')
    await workbenchActivate(app, a)
    await workbenchActivate(app, b)
    await workbenchActivate(app, a)

    expect(app.useRequestStore.getState().url).toBe(ENDPOINT_SCHEMA.url)
    expect(app.useRequestStore.getState().unloaded).toBe(false)
    // Read once, when it was opened — never reloaded after a plain switch.
    const endpointGet = (
      window as unknown as { api: { endpoint: { get: ReturnType<typeof vi.fn> } } }
    ).api.endpoint.get
    expect(endpointGet.mock.calls.filter((c) => c[0] === 'ep-a')).toHaveLength(1)
  })

  it("an MCP call on a dropped tab runs the saved row's scripts and assertions", async () => {
    const api = installApi()
    const schema = {
      url: 'https://mcp.test/mcp',
      method: 'GET',
      headers: [],
      auth: { type: 'none' },
      preScript: '',
      postScript: 'pm.test("mcp", () => {})',
      assertions: [{ id: 'm1', name: 's', type: 'status_equals', enabled: true, expected: 200 }],
      metadata: { mcp: { transport: 'http', url: 'https://mcp.test/mcp' } },
    }
    api.endpoints.set('ep-mcp', {
      id: 'ep-mcp',
      name: 'MCP',
      method: 'GET',
      path: schema.url,
      protocol: 'mcp',
      request_schema: JSON.stringify(schema),
    })
    const app = await launch()
    const mcpTab = await openPinned(app, 'ep-mcp')
    await openManySaved(app, api, 22)

    app.switchActiveTab(mcpTab)
    expect(app.useRequestStore.getState().unloaded).toBe(true)
    const { beginMcpScripts } = await import('../../src/renderer/lib/mcp-send-scripts')
    const ctx = await beginMcpScripts(mcpTab, schema.url)
    expect(ctx.postScripts).toContain('pm.test("mcp", () => {})')
    expect(ctx.assertions).toHaveLength(1)
  })

  it('switching away before the row read resolves leaves the other tab untouched', async () => {
    const api = installApi()
    seedEndpoint(api)
    const app = await launch()
    const probe = await openPinned(app, 'ep-a')
    await openManySaved(app, api, 22)
    newTab(app, 'other')
    app.useRequestStore.getState().setUrl('https://other.test/live')

    let release: () => void = () => {}
    api.gate.wait = new Promise<void>((r) => (release = r))
    app.switchActiveTab(probe)
    const pending = app.ensureWithheldCredentialsLoaded(activeTab(app))
    app.switchActiveTab('other')
    release()
    api.gate.wait = null
    await pending

    expect(app.useRequestStore.getState().url).toBe('https://other.test/live')
    // The probe tab is still waiting; its next activation loads it.
    await workbenchActivate(app, probe)
    expect(app.useRequestStore.getState().url).toBe(ENDPOINT_SCHEMA.url)
  })
})
