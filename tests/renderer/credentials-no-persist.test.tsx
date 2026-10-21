/**
 * Issue #244 — literal credentials never reach a tab snapshot in localStorage
 * (the Socket.IO pattern of issue #243, applied to every other editor).
 *
 * Stores: request (HTTP auth + credential headers — it backs every tab), MCP
 * (Authorization tab, custom headers, stdio env), WebSocket / SSE custom
 * headers, GraphQL headers, gRPC metadata.
 *
 * Pinned per store:
 *   1. the stored snapshot has no literal credential under ANY localStorage
 *      key — active AND cached tab; memory keeps it; the row and its name
 *      stay; `{{var}}`-only values and non-credential rows are stored;
 *   2. a snapshot an older build wrote is cleaned on load;
 *   3. the data-loss trap: save with the credential → restart (modules
 *      re-imported, stores rehydrate from localStorage) → Ctrl+S → the row
 *      still holds it (endpoint, saved request, suite item);
 *   4. the activation reload restores it without dirtying the tab;
 *   5. an unreadable row blocks the save; an unsaved draft loses the value;
 *   6. per-path markers: editing ANOTHER field after a restart does not
 *      forget the withheld one; editing the withheld one wins;
 *   7. the hint renders under the HTTP Auth tab and the MCP Authorization tab.
 */
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { KeyValuePair, Tab } from '../../src/renderer/types'
import { setLocale } from '../../src/renderer/lib/i18n'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import AuthTab from '../../src/renderer/components/request/AuthTab'
import McpAuthSection from '../../src/renderer/components/protocols/mcp/McpAuthSection'

const SECRET = 'LITERAL-secret-244-a1'
const PASS = 'LITERAL-pass-244-b2'
const HDR = 'LITERAL-header-244-c3'
const ENV = 'LITERAL-env-244-d4'

/** Every localStorage value — no literal may sit under ANY key. */
function allStorage(): string {
  const out: string[] = []
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i)
    if (k) out.push(`${k}=${window.localStorage.getItem(k) ?? ''}`)
  }
  return out.join('\n')
}

function expectNoLiteral(): void {
  const all = allStorage()
  for (const s of [SECRET, PASS, HDR, ENV]) expect(all).not.toContain(s)
}

const kv = (id: string, key: string, value: string): KeyValuePair => ({
  id,
  key,
  value,
  enabled: true,
})

type Row = Record<string, unknown>

/** In-memory rows behind the three IPC families the save/open paths use. */
function installRowApi() {
  const endpoints = new Map<string, Row>()
  const saved = new Map<string, Row>()
  const items = new Map<string, Row>()
  const ok = (data: unknown) => ({ success: true, data })
  const api = {
    endpoint: {
      update: vi.fn(async (id: string, patch: Row) => {
        endpoints.set(id, { ...endpoints.get(id), ...patch })
        return ok(true)
      }),
      get: vi.fn(async (id: string) => ok(endpoints.get(id) ?? null)),
    },
    savedRequest: {
      update: vi.fn(async (id: string, patch: Row) => {
        const next: Row = { ...(saved.get(id) ?? {}) }
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = v
        saved.set(id, next)
        return ok(true)
      }),
      get: vi.fn(async (id: string) => ok(saved.get(id) ?? null)),
    },
    testSuiteItem: {
      update: vi.fn(async (id: string, patch: Row) => {
        items.set(id, { ...items.get(id), ...patch })
        return ok(true)
      }),
      get: vi.fn(async (id: string) => ok(items.get(id) ?? null)),
    },
  }
  ;(window as unknown as { api: typeof api }).api = api
  return { api, endpoints, saved, items }
}

/** Fresh module graph — every store rehydrates from localStorage like a launch. */
async function launch() {
  vi.resetModules()
  const [tabs, req, mcp, ws, sse, gql, grpc, save, wsStore, activate] = await Promise.all([
    import('../../src/renderer/stores/tabs.store'),
    import('../../src/renderer/stores/request.store'),
    import('../../src/renderer/stores/mcp.store'),
    import('../../src/renderer/stores/websocket.store'),
    import('../../src/renderer/stores/sse.store'),
    import('../../src/renderer/stores/graphql.store'),
    import('../../src/renderer/stores/grpc.store'),
    import('../../src/renderer/lib/save-active-request'),
    import('../../src/renderer/stores/workspace.store'),
    import('../../src/renderer/lib/activate-tab'),
  ])
  // Absent before issue #244 — the activation-reload tests need it.
  const reload = await import('../../src/renderer/lib/withheld-credentials').catch(() => null)
  wsStore.useWorkspaceStore.setState({ refreshTree: async () => {} } as never)
  return {
    useTabsStore: tabs.useTabsStore,
    useRequestStore: req.useRequestStore,
    useMcpStore: mcp.useMcpStore,
    useWebSocketStore: ws.useWebSocketStore,
    useSseStore: sse.useSseStore,
    useGraphQLStore: gql.useGraphQLStore,
    useGrpcStore: grpc.useGrpcStore,
    saveActiveRequestInPlace: save.saveActiveRequestInPlace,
    activateTabStores: activate.activateTabStores,
    ensure: (tab: Tab) => {
      if (!reload) throw new Error('lib/withheld-credentials is missing')
      return reload.ensureWithheldCredentialsLoaded(tab)
    },
  }
}
type App = Awaited<ReturnType<typeof launch>>

let rows: ReturnType<typeof installRowApi>

beforeEach(() => {
  window.localStorage.clear()
  rows = installRowApi()
})

/** The JSON a row keeps: `request_schema` (endpoint / item) or the saved request's columns. */
function rowJson(row: Row | undefined, column: 'request_schema' | 'saved'): Row {
  if (column === 'saved') {
    const parse = (v: unknown) => (typeof v === 'string' && v ? JSON.parse(v) : undefined)
    return { auth: parse(row?.auth), headers: parse(row?.headers), metadata: parse(row?.metadata) }
  }
  return JSON.parse(String(row?.request_schema ?? '{}')) as Row
}

const BINDINGS: Array<{
  name: string
  bind: Partial<Tab>
  rowsOf: () => Map<string, Row>
  id: string
  column: 'request_schema' | 'saved'
}> = [
  {
    name: 'endpoint',
    bind: { endpointId: 'ep-1' },
    rowsOf: () => rows.endpoints,
    id: 'ep-1',
    column: 'request_schema',
  },
  {
    name: 'saved request',
    bind: { savedRequestId: 'sr-1' },
    rowsOf: () => rows.saved,
    id: 'sr-1',
    column: 'saved',
  },
  {
    name: 'suite item',
    bind: { testSuiteItemId: 'it-1' },
    rowsOf: () => rows.items,
    id: 'it-1',
    column: 'request_schema',
  },
]

function openTab(app: App, protocol: Tab['protocol'], bind: Partial<Tab> = {}) {
  app.useTabsStore.setState({
    tabs: [
      { id: 'tab-x', name: 'X', protocol, method: 'GET', url: '', isDirty: false, ...bind } as Tab,
    ],
    activeTabId: 'tab-x',
  })
  app.activateTabStores('tab-x')
}

const activeTab = (app: App): Tab => app.useTabsStore.getState().tabs[0]

// ─── HTTP (request store) ──────────────────────────────────────────────

function typeHttpCredentials(app: App) {
  const req = app.useRequestStore.getState()
  req.setAuth({
    type: 'basic',
    basic: { username: 'alice', password: PASS },
    bearer: { token: SECRET },
    oauth2: {
      grantType: 'client_credentials',
      tokenUrl: 'https://idp.test/token',
      clientId: 'cid',
      clientSecret: SECRET,
    },
  })
  req.setHeaders([
    kv('h-auth', 'Authorization', `Bearer ${HDR}`),
    kv('h-tpl', 'X-API-Key', '{{apiKey}}'),
    kv('h-plain', 'Accept', 'application/json'),
  ])
}

function httpCreds(json: Row): { pass: unknown; token: unknown; secret: unknown; hdr: unknown } {
  const auth = json.auth as Row | undefined
  const headers = (json.headers as KeyValuePair[] | undefined) ?? []
  return {
    pass: (auth?.basic as Row | undefined)?.password,
    token: (auth?.bearer as Row | undefined)?.token,
    secret: (auth?.oauth2 as Row | undefined)?.clientSecret,
    hdr: headers.find((h) => h.key === 'Authorization')?.value,
  }
}

const HTTP_STORED = { pass: PASS, token: SECRET, secret: SECRET, hdr: `Bearer ${HDR}` }

describe('HTTP tab snapshot never holds a literal credential (issue #244)', () => {
  it('strips auth secrets and credential header values — active and cached tab', async () => {
    const app = await launch()
    openTab(app, 'http')
    typeHttpCredentials(app)
    expectNoLiteral()
    const stored = allStorage()
    // The rows and the non-secret parts stay.
    expect(stored).toContain('alice')
    expect(stored).toContain('Authorization')
    expect(stored).toContain('{{apiKey}}')
    expect(stored).toContain('application/json')
    // Memory keeps everything — Send in this session uses it.
    expect(httpCreds(app.useRequestStore.getState() as unknown as Row)).toEqual(HTTP_STORED)

    // Background (cached) tab.
    app.useRequestStore.getState().switchToTab('tab-other')
    expectNoLiteral()
    app.useRequestStore.getState().switchToTab('tab-x')
    expect(httpCreds(app.useRequestStore.getState() as unknown as Row)).toEqual(HTTP_STORED)
  })

  it('cleans a snapshot an older build wrote with the credentials, on load', async () => {
    window.localStorage.setItem(
      'testnizer-request',
      JSON.stringify({
        current: {
          url: 'https://api.test/a',
          auth: { type: 'bearer', bearer: { token: SECRET } },
          headers: [kv('h1', 'X-Api-Token', HDR)],
        },
        _currentTabId: 'tab-x',
        _tabStates: [
          ['tab-2', { auth: { type: 'basic', basic: { username: 'u', password: PASS } } }],
        ],
      }),
    )
    const app = await launch()
    const s = app.useRequestStore.getState()
    expect(s.url).toBe('https://api.test/a')
    expect(s.auth.bearer?.token).toBe('')
    expect(s.headers[0]).toMatchObject({ key: 'X-Api-Token', value: '' })
    expect(s._tabStates.get('tab-2')?.auth.basic).toEqual({ username: 'u', password: '' })
    // Rewritten at once.
    expectNoLiteral()
  })
})

async function saveHttpWithCredentials(bind: Partial<Tab>) {
  const s1 = await launch()
  openTab(s1, 'http', bind)
  s1.useRequestStore.getState().setUrl('https://api.test/a')
  typeHttpCredentials(s1)
  expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
  expectNoLiteral()
}

describe('HTTP: restart + Ctrl+S keeps the credentials on the row (issue #244)', () => {
  for (const b of BINDINGS) {
    it(`${b.name}: the untouched empty fields do not wipe the saved values`, async () => {
      await saveHttpWithCredentials(b.bind)
      expect(httpCreds(rowJson(b.rowsOf().get(b.id), b.column))).toEqual(HTTP_STORED)

      const s2 = await launch()
      expectNoLiteral()
      expect(s2.useRequestStore.getState().auth.basic?.password).toBe('')
      // Ctrl+S straight away — no activation reload ran.
      expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
      expect(httpCreds(rowJson(b.rowsOf().get(b.id), b.column))).toEqual(HTTP_STORED)
      expect(httpCreds(s2.useRequestStore.getState() as unknown as Row)).toEqual(HTTP_STORED)
      expectNoLiteral()
    })
  }

  it('editing another field after a restart does not forget the withheld password', async () => {
    await saveHttpWithCredentials({ endpointId: 'ep-1' })
    const s2 = await launch()
    const auth = s2.useRequestStore.getState().auth
    // A username keystroke replaces the whole auth object.
    s2.useRequestStore.getState().setAuth({ ...auth, basic: { ...auth.basic!, username: 'bob' } })
    s2.useRequestStore.getState().updateHeader('h-plain', { value: 'text/plain' })
    expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
    const stored = rowJson(rows.endpoints.get('ep-1'), 'request_schema')
    expect(httpCreds(stored)).toEqual(HTTP_STORED)
    expect(((stored.auth as Row).basic as Row).username).toBe('bob')
  })

  it('a bulk header edit that re-mints the row ids keeps the marker', async () => {
    await saveHttpWithCredentials({ endpointId: 'ep-1' })
    const s2 = await launch()
    const reminted = s2.useRequestStore
      .getState()
      .headers.map((h, i) => ({ ...h, id: `bulk-${i}` }))
    s2.useRequestStore.getState().setHeaders(reminted)
    expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
    expect(httpCreds(rowJson(rows.endpoints.get('ep-1'), 'request_schema')).hdr).toBe(
      `Bearer ${HDR}`,
    )
  })

  it('a value the user edits after the restart wins over the saved one', async () => {
    await saveHttpWithCredentials({ endpointId: 'ep-1' })
    const s2 = await launch()
    const auth = s2.useRequestStore.getState().auth
    s2.useRequestStore.getState().setAuth({ ...auth, bearer: { token: 'typed-after-restart' } })
    // Typed and deleted again: a deliberate clear.
    s2.useRequestStore.getState().updateHeader('h-auth', { value: 'x' })
    s2.useRequestStore.getState().updateHeader('h-auth', { value: '' })
    expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
    const c = httpCreds(rowJson(rows.endpoints.get('ep-1'), 'request_schema'))
    expect(c.token).toBe('typed-after-restart')
    expect(c.hdr).toBe('')
    expect(c.pass).toBe(PASS)
  })

  it('the activation reload brings the values back without dirtying the tab', async () => {
    await saveHttpWithCredentials({ endpointId: 'ep-1' })
    const s2 = await launch()
    expect(await s2.ensure(activeTab(s2))).toEqual({ ok: true })
    expect(httpCreds(s2.useRequestStore.getState() as unknown as Row)).toEqual(HTTP_STORED)
    expect(s2.useRequestStore.getState().withheldCredentials).toEqual([])
    expect(activeTab(s2).isDirty).toBe(false)
    expectNoLiteral()
  })

  it('a row that cannot be read blocks the save instead of writing empty values', async () => {
    await saveHttpWithCredentials({ endpointId: 'ep-1' })
    const s2 = await launch()
    rows.api.endpoint.get.mockResolvedValueOnce({ success: false } as never)
    const res = await s2.saveActiveRequestInPlace()
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/could not reload the saved request credentials/i)
    expect(httpCreds(rowJson(rows.endpoints.get('ep-1'), 'request_schema'))).toEqual(HTTP_STORED)
  })

  it('an unsaved draft simply has no credentials after a restart', async () => {
    const s1 = await launch()
    openTab(s1, 'http')
    typeHttpCredentials(s1)
    const s2 = await launch()
    expect(await s2.ensure(activeTab(s2))).toEqual({ ok: true })
    expect(s2.useRequestStore.getState().auth.basic?.password).toBe('')
    expect(s2.useRequestStore.getState().withheldCredentials).toEqual([])
  })

  it('Duplicate Tab carries the marker onto the re-stamped header ids', async () => {
    await saveHttpWithCredentials({ endpointId: 'ep-1' })
    const s2 = await launch()
    s2.useRequestStore.getState().cloneTabState('tab-x', 'tab-copy')
    const copy = s2.useRequestStore.getState()._tabStates.get('tab-copy')!
    const authRow = copy.headers.find((h) => h.key === 'Authorization')!
    expect(authRow.id).not.toBe('h-auth')
    expect(copy.withheldCredentials).toContain(`headers#${authRow.id}`)
    expect(copy.withheldCredentials).toContain('auth.basic.password')
  })
})

// ─── MCP ───────────────────────────────────────────────────────────────

function typeMcpCredentials(app: App) {
  const mcp = app.useMcpStore.getState()
  mcp.setUrl('https://mcp.test/mcp')
  mcp.setAuth({
    type: 'bearer',
    bearer: { token: SECRET },
    basic: { username: 'alice', password: PASS },
    apiKey: { key: 'X-Key', value: SECRET, in: 'header' },
  })
  mcp.setHeaders([kv('m1', 'X-Gateway-Key', HDR), kv('m2', 'X-Trace', 'abc')])
  mcp.setEnvVars([
    kv('e1', 'GITHUB_TOKEN', ENV),
    kv('e2', 'API_KEY', '{{apiKey}}'),
    kv('e3', 'DEBUG', '1'),
  ])
}

function mcpCreds(block: Row | undefined) {
  const auth = block?.auth as Row | undefined
  return {
    token: (auth?.bearer as Row | undefined)?.token,
    pass: (auth?.basic as Row | undefined)?.password,
    key: (auth?.apiKey as Row | undefined)?.value,
    hdr: (block?.customHeaders as KeyValuePair[] | undefined)?.find(
      (h) => h.key === 'X-Gateway-Key',
    )?.value,
    env: (block?.envVars as KeyValuePair[] | undefined)?.find((h) => h.key === 'GITHUB_TOKEN')
      ?.value,
  }
}
const MCP_STORED = { token: SECRET, pass: PASS, key: SECRET, hdr: HDR, env: ENV }

const metaOf = (json: Row): Row | undefined => json.metadata as Row | undefined

describe('MCP tab snapshot never holds a literal credential (issue #244)', () => {
  it('strips auth secrets, credential headers and credential env values', async () => {
    const app = await launch()
    openTab(app, 'mcp')
    typeMcpCredentials(app)
    expectNoLiteral()
    const stored = allStorage()
    for (const keep of ['GITHUB_TOKEN', 'X-Gateway-Key', '{{apiKey}}', 'DEBUG', 'abc', 'alice']) {
      expect(stored).toContain(keep)
    }
    expect(mcpCreds(app.useMcpStore.getState() as unknown as Row)).toEqual(MCP_STORED)
    app.useMcpStore.getState().switchToTab('tab-other')
    expectNoLiteral()
  })

  it('cleans a snapshot an older build wrote, on load', async () => {
    window.localStorage.setItem(
      'testnizer-mcp',
      JSON.stringify({
        current: {
          url: 'https://mcp.test/mcp',
          auth: { type: 'bearer', bearer: { token: SECRET } },
          envVars: [kv('e1', 'DB_PASSWORD', ENV)],
        },
        _currentTabId: 'tab-x',
        _tabStates: [['tab-2', { customHeaders: [kv('m1', 'Authorization', `Bearer ${HDR}`)] }]],
      }),
    )
    const app = await launch()
    const s = app.useMcpStore.getState()
    expect(s.url).toBe('https://mcp.test/mcp')
    expect(s.auth.bearer?.token).toBe('')
    expect(s.envVars[0]).toMatchObject({ key: 'DB_PASSWORD', value: '' })
    expect(s._tabStates.get('tab-2')?.customHeaders[0]).toMatchObject({
      key: 'Authorization',
      value: '',
    })
    expectNoLiteral()
  })

  for (const b of BINDINGS) {
    it(`${b.name}: restart + Ctrl+S keeps the credentials on the row`, async () => {
      const s1 = await launch()
      openTab(s1, 'mcp', b.bind)
      typeMcpCredentials(s1)
      expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
      expect(mcpCreds(metaOf(rowJson(b.rowsOf().get(b.id), b.column))?.mcp as Row)).toEqual(
        MCP_STORED,
      )

      const s2 = await launch()
      expectNoLiteral()
      expect(s2.useMcpStore.getState().auth.bearer?.token).toBe('')
      expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
      expect(mcpCreds(metaOf(rowJson(b.rowsOf().get(b.id), b.column))?.mcp as Row)).toEqual(
        MCP_STORED,
      )
      expect(mcpCreds(s2.useMcpStore.getState() as unknown as Row)).toEqual(MCP_STORED)
    })
  }

  it('the activation reload restores without dirtying; an unreadable row blocks the save', async () => {
    const s1 = await launch()
    openTab(s1, 'mcp', { endpointId: 'ep-1' })
    typeMcpCredentials(s1)
    expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })

    const s2 = await launch()
    rows.api.endpoint.get.mockResolvedValueOnce({ success: false } as never)
    const res = await s2.saveActiveRequestInPlace()
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/MCP credentials/)

    expect(await s2.ensure(activeTab(s2))).toEqual({ ok: true })
    expect(mcpCreds(s2.useMcpStore.getState() as unknown as Row)).toEqual(MCP_STORED)
    expect(activeTab(s2).isDirty).toBe(false)
  })

  it('an unsaved draft loses the literal credentials on restart', async () => {
    const s1 = await launch()
    openTab(s1, 'mcp')
    typeMcpCredentials(s1)
    const s2 = await launch()
    expect(await s2.ensure(activeTab(s2))).toEqual({ ok: true })
    expect(s2.useMcpStore.getState().auth.bearer?.token).toBe('')
    expect(s2.useMcpStore.getState().withheldCredentials).toEqual([])
  })
})

// ─── WebSocket / SSE / GraphQL / gRPC header rows ──────────────────────

type RowStore = 'useWebSocketStore' | 'useSseStore' | 'useGraphQLStore' | 'useGrpcStore'

const ROW_STORES: Array<{
  protocol: Tab['protocol']
  store: RowStore
  key: string
  list: string
  metaKey: string
}> = [
  {
    protocol: 'websocket',
    store: 'useWebSocketStore',
    key: 'testnizer-websocket',
    list: 'customHeaders',
    metaKey: 'websocket',
  },
  {
    protocol: 'sse',
    store: 'useSseStore',
    key: 'testnizer-sse',
    list: 'customHeaders',
    metaKey: 'sse',
  },
  {
    protocol: 'graphql',
    store: 'useGraphQLStore',
    key: 'testnizer-graphql',
    list: 'headers',
    metaKey: 'graphql',
  },
  {
    protocol: 'grpc',
    store: 'useGrpcStore',
    key: 'testnizer-grpc',
    list: 'metadata',
    metaKey: 'grpc',
  },
]

const ROWS = [
  kv('r1', 'Authorization', `Bearer ${HDR}`),
  kv('r2', 'X-Api-Key', '{{key}}'),
  kv('r3', 'X-Trace', 'abc'),
]

function setRows(app: App, store: RowStore, list: string) {
  // Through `setState`: one path for the four stores (gRPC has no bulk setter).
  ;(app[store] as unknown as { setState: (p: Row) => void }).setState({ [list]: ROWS })
}

function liveRows(app: App, store: RowStore, list: string): KeyValuePair[] {
  return (app[store].getState() as unknown as Row)[list] as KeyValuePair[]
}

const authValue = (list: KeyValuePair[] | undefined) =>
  list?.find((h) => h.key === 'Authorization')?.value

for (const p of ROW_STORES) {
  describe(`${p.protocol}: credential rows stay out of the snapshot (issue #244)`, () => {
    it('blanks the literal value, keeps the row, {{var}} rows and others', async () => {
      const app = await launch()
      openTab(app, p.protocol)
      setRows(app, p.store, p.list)
      expectNoLiteral()
      const stored = window.localStorage.getItem(p.key) ?? ''
      for (const keep of ['Authorization', '{{key}}', 'X-Trace', 'abc'])
        expect(stored).toContain(keep)
      expect(authValue(liveRows(app, p.store, p.list))).toBe(`Bearer ${HDR}`)
      app[p.store].getState().switchToTab('tab-other')
      expectNoLiteral()
    })

    it('cleans an older snapshot on load', async () => {
      window.localStorage.setItem(
        p.key,
        JSON.stringify({
          current: { [p.list]: ROWS },
          _currentTabId: 'tab-x',
          _tabStates: [['tab-2', { [p.list]: ROWS }]],
        }),
      )
      const app = await launch()
      expect(authValue(liveRows(app, p.store, p.list))).toBe('')
      expectNoLiteral()
    })

    for (const b of [BINDINGS[0], BINDINGS[1]]) {
      it(`${b.name}: restart + Ctrl+S keeps the value; activation reload restores it`, async () => {
        const s1 = await launch()
        openTab(s1, p.protocol, b.bind)
        setRows(s1, p.store, p.list)
        expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
        const storedRows = () =>
          (metaOf(rowJson(b.rowsOf().get(b.id), b.column))?.[p.metaKey] as Row)?.[
            p.list
          ] as KeyValuePair[]
        expect(authValue(storedRows())).toBe(`Bearer ${HDR}`)

        const s2 = await launch()
        expect(authValue(liveRows(s2, p.store, p.list))).toBe('')
        expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
        expect(authValue(storedRows())).toBe(`Bearer ${HDR}`)
        expect(authValue(liveRows(s2, p.store, p.list))).toBe(`Bearer ${HDR}`)

        const s3 = await launch()
        expect(await s3.ensure(activeTab(s3))).toEqual({ ok: true })
        expect(authValue(liveRows(s3, p.store, p.list))).toBe(`Bearer ${HDR}`)
        expect(activeTab(s3).isDirty).toBe(false)
      })
    }
  })
}

// ─── Hints ─────────────────────────────────────────────────────────────
// Static module graph (the components' React must be the test's React).
// `React.createElement`, not JSX: the import is then used (no unused-import
// warning) while vitest's classic JSX transform still finds React.

describe('credential restart hint (issue #244)', () => {
  const reset = () => {
    cleanup()
    useUIStore.setState({ locale: 'en' })
    setLocale('en')
  }

  for (const [locale, text] of [
    ['en', /not kept after a restart unless the request is saved/],
    ['tr', /istek kaydedilmedikçe yeniden başlatmadan sonra korunmaz/],
  ] as const) {
    it(`renders under the HTTP Auth tab and the MCP Authorization tab in ${locale}`, () => {
      useUIStore.setState({ locale })
      setLocale(locale)
      useRequestStore.setState({ auth: { type: 'bearer', bearer: { token: '' } } })
      useMcpStore.setState({
        transport: 'http',
        auth: { type: 'basic', basic: { username: '', password: '' } },
      })

      render(React.createElement(AuthTab))
      const hint = screen.getByTestId('auth-credential-restart-hint')
      expect(hint.textContent).toMatch(text)
      expect(hint.textContent).toContain(locale === 'en' ? '{{variable}}' : '{{değişken}}')
      expect(screen.getByTestId('auth-bearer-token').getAttribute('aria-describedby')).toBe(hint.id)
      cleanup()

      render(React.createElement(McpAuthSection))
      const mcpHint = screen.getByTestId('mcp-auth-restart-hint')
      expect(mcpHint.textContent).toMatch(text)
      expect(screen.getByTestId('mcp-auth-basic-password').getAttribute('aria-describedby')).toBe(
        mcpHint.id,
      )
      reset()
    })
  }

  it('no hint when the request has no own credential (none / inherit)', () => {
    useRequestStore.setState({ auth: { type: 'inherit' } })
    render(React.createElement(AuthTab))
    expect(screen.queryByTestId('auth-credential-restart-hint')).toBeNull()
    reset()
  })
})
