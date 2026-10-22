/**
 * Issue #247 (follow-up) — the connection URLs of the protocol stores
 * (WebSocket, SSE, Socket.IO, GraphQL, SOAP endpoint + WSDL), the MCP
 * tool-call arguments JSON and the SOAP pasted private keys never reach
 * localStorage as typed. Same mechanism as #244 / #247 (`texts` / `fields`
 * spec + adapter + reload before save / send).
 *
 * Per field: no literal under ANY key (active + cached tab), the rest of the
 * URL kept; restart → Ctrl+S keeps the row intact (endpoint, saved request);
 * restart → immediate Connect / Send carries the saved value.
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
// Each test re-imports the whole store graph — the first cold import can pass
// vitest's 5 s default under a parallel run.
vi.setConfig({ testTimeout: 30_000 })

const WS = 'LIT-ws-247-u1'
const SSE = 'LIT-sse-247-u2'
const SIO = 'LIT-sio-247-u3'
const GQL = 'LIT-gql-247-u4'
const SOAPE = 'LIT-soape-247-u5'
const SOAPW = 'LIT-soapw-247-u6'
const ARGS = 'LIT-args-247-u7'
const PEM = '-----BEGIN PRIVATE KEY-----\nLIT-pem-247-u8\n-----END PRIVATE KEY-----'
const KEYPEM = '-----BEGIN PRIVATE KEY-----\nLIT-keypem-247-u9\n-----END PRIVATE KEY-----'
const ALL = [WS, SSE, SIO, GQL, SOAPE, SOAPW, ARGS, 'LIT-pem-247-u8', 'LIT-keypem-247-u9']

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
  for (const s of ALL) expect(all).not.toContain(s)
}

type Row = Record<string, unknown>
type Call = { name: string; args: unknown[] }

function installApi() {
  const endpoints = new Map<string, Row>()
  const saved = new Map<string, Row>()
  const calls: Call[] = []
  const ok = (data: unknown) => ({ success: true, data })
  const table = (m: Map<string, Row>, dropUndefined = false) => ({
    update: vi.fn(async (id: string, patch: Row) => {
      const next: Row = { ...(m.get(id) ?? {}) }
      for (const [k, v] of Object.entries(patch)) if (!dropUndefined || v !== undefined) next[k] = v
      m.set(id, next)
      return ok(true)
    }),
    get: vi.fn(async (id: string) => ok(m.get(id) ?? null)),
  })
  const known: Record<string, unknown> = {
    endpoint: table(endpoints),
    savedRequest: table(saved, true),
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
  const api = new Proxy(known, {
    get: (target, key: string) => (key in target ? target[key] : (target[key] = ns(key))),
  })
  ;(window as unknown as { api: unknown }).api = api
  return { endpoints, saved, calls }
}

async function launch() {
  vi.resetModules()
  const [tabs, ws, sse, sio, gql, soap, mcp, save, wsp, activate] = await Promise.all([
    import('../../src/renderer/stores/tabs.store'),
    import('../../src/renderer/stores/websocket.store'),
    import('../../src/renderer/stores/sse.store'),
    import('../../src/renderer/stores/socketio.store'),
    import('../../src/renderer/stores/graphql.store'),
    import('../../src/renderer/stores/soap.store'),
    import('../../src/renderer/stores/mcp.store'),
    import('../../src/renderer/lib/save-active-request'),
    import('../../src/renderer/stores/workspace.store'),
    import('../../src/renderer/lib/activate-tab'),
  ])
  wsp.useWorkspaceStore.setState({ refreshTree: async () => {} } as never)
  return {
    useTabsStore: tabs.useTabsStore,
    useWebSocketStore: ws.useWebSocketStore,
    useSseStore: sse.useSseStore,
    useSocketIOStore: sio.useSocketIOStore,
    useGraphQLStore: gql.useGraphQLStore,
    useSoapStore: soap.useSoapStore,
    useMcpStore: mcp.useMcpStore,
    saveActiveRequestInPlace: save.saveActiveRequestInPlace,
    activateTabStores: activate.activateTabStores,
  }
}
type App = Awaited<ReturnType<typeof launch>>

let api: ReturnType<typeof installApi>

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  api = installApi()
})

const BINDINGS = [
  { name: 'endpoint', bind: { endpointId: 'ep-1' }, rows: () => api.endpoints, id: 'ep-1' },
  { name: 'saved request', bind: { savedRequestId: 'sr-1' }, rows: () => api.saved, id: 'sr-1' },
] as const

/** The row's protocol metadata block. */
function metaOf(b: (typeof BINDINGS)[number], key: string): Row {
  const row = b.rows().get(b.id) ?? {}
  const parse = (v: unknown) => (typeof v === 'string' && v ? JSON.parse(v) : {})
  const meta =
    b.name === 'saved request' ? parse(row.metadata) : (parse(row.request_schema).metadata ?? {})
  return (meta[key] as Row) ?? {}
}

function openTab(app: App, protocol: Tab['protocol'], bind: Partial<Tab> = {}) {
  app.useTabsStore.setState({
    tabs: [
      { id: 'tab-x', name: 'X', protocol, method: 'GET', url: '', isDirty: false, ...bind } as Tab,
    ],
    activeTabId: 'tab-x',
  })
  app.activateTabStores('tab-x')
}

type Store = 'useWebSocketStore' | 'useSseStore' | 'useSocketIOStore' | 'useGraphQLStore'

const getState = (app: App, store: Store | 'useSoapStore' | 'useMcpStore'): Row =>
  app[store].getState() as unknown as Row

const URL_CASES: Array<{
  protocol: Tab['protocol']
  store: Store
  storageKey: string
  metaKey: string
  url: string
  stored: string
  set: (app: App, url: string) => void
  send: (app: App) => Promise<unknown>
  engine: string
  secret: string
}> = [
  {
    protocol: 'websocket',
    store: 'useWebSocketStore',
    storageKey: 'testnizer-websocket',
    metaKey: 'websocket',
    url: `wss://ws.test/live?access_token=${WS}&room=1`,
    stored: 'wss://ws.test/live?access_token=&room=1',
    set: (app, url) => app.useWebSocketStore.getState().setUrl(url),
    send: (app) => app.useWebSocketStore.getState().connect(),
    engine: 'ws.connect',
    secret: WS,
  },
  {
    protocol: 'sse',
    store: 'useSseStore',
    storageKey: 'testnizer-sse',
    metaKey: 'sse',
    url: `https://bob:${SSE}@sse.test/stream`,
    stored: 'https://bob:@sse.test/stream',
    set: (app, url) => app.useSseStore.getState().setUrl(url),
    send: (app) => app.useSseStore.getState().connect(),
    engine: 'sse.connect',
    secret: SSE,
  },
  {
    protocol: 'socketio',
    store: 'useSocketIOStore',
    storageKey: 'testnizer-socketio',
    metaKey: 'socketio',
    url: `http://sio.test?token=${SIO}`,
    stored: 'http://sio.test?token=',
    set: (app, url) => app.useSocketIOStore.getState().setUrl(url),
    send: (app) => app.useSocketIOStore.getState().connect(),
    engine: 'socketio.connect',
    secret: SIO,
  },
  {
    protocol: 'graphql',
    store: 'useGraphQLStore',
    storageKey: 'testnizer-graphql',
    metaKey: 'graphql',
    url: `https://gql.test/graphql?api_key=${GQL}`,
    stored: 'https://gql.test/graphql?api_key=',
    set: (app, url) => {
      app.useGraphQLStore.getState().setUrl(url)
      app.useGraphQLStore.getState().setQuery('{ me { id } }')
    },
    send: (app) => app.useGraphQLStore.getState().executeQuery(),
    engine: 'request.send',
    secret: GQL,
  },
]

for (const c of URL_CASES) {
  describe(`${c.protocol} connection URL (issue #247)`, () => {
    it('the snapshot holds the URL without the credential — active and cached tab', async () => {
      const app = await launch()
      openTab(app, c.protocol)
      c.set(app, c.url)
      expectNoLiteral()
      const snap = JSON.parse(window.localStorage.getItem(c.storageKey) ?? '{}')
      expect(snap.current.url).toBe(c.stored)
      expect(getState(app, c.store).url).toBe(c.url)
      app[c.store].getState().switchToTab('tab-other')
      expectNoLiteral()
    })

    it('an older snapshot is cleaned on load', async () => {
      window.localStorage.setItem(
        c.storageKey,
        JSON.stringify({ current: { url: c.url }, _currentTabId: 'tab-x', _tabStates: [] }),
      )
      const app = await launch()
      expect(getState(app, c.store).url).toBe(c.stored)
      expectNoLiteral()
    })

    for (const b of BINDINGS) {
      it(`${b.name}: restart + Ctrl+S keeps the URL on the row`, async () => {
        const s1 = await launch()
        openTab(s1, c.protocol, b.bind)
        c.set(s1, c.url)
        expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
        expect(metaOf(b, c.metaKey).url).toBe(c.url)
        const s2 = await launch()
        expectNoLiteral()
        expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
        expect(metaOf(b, c.metaKey).url).toBe(c.url)
        expect(getState(s2, c.store).url).toBe(c.url)
      })
    }

    it('restart → immediate Connect / Send carries the saved URL', async () => {
      const s1 = await launch()
      openTab(s1, c.protocol, { endpointId: 'ep-1' })
      c.set(s1, c.url)
      expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
      const s2 = await launch()
      // The value is NOT in the snapshot — the send must reload it.
      expectNoLiteral()
      api.calls.length = 0
      await c.send(s2)
      const sent = api.calls.filter((x) => x.name.startsWith(c.engine))
      expect(sent.length).toBeGreaterThan(0)
      expect(JSON.stringify(sent.map((x) => x.args))).toContain(c.secret)
      expect(toastMock.warning).not.toHaveBeenCalled()
    })
  })
}

// ─── SOAP endpoint / WSDL URLs and private keys ─────────────────────────

function typeSoap(app: App) {
  const soap = app.useSoapStore.getState()
  soap.setMode('manual')
  soap.setEndpointUrl(`https://soap.test/svc?apikey=${SOAPE}`)
  soap.setWsdlUrl(`https://u:${SOAPW}@soap.test/svc?wsdl`)
  soap.setRawXml('<Envelope/>')
  soap.setWsSecurity({
    enabled: true,
    modes: ['sign'],
    sign: {
      privateKeyPem: PEM,
      certPem: '-----BEGIN CERTIFICATE-----\nPUBLIC\n-----END CERTIFICATE-----',
      algorithm: 'RSA-SHA256',
      references: ['Body'],
      keyInfoStrategy: 'BinarySecurityToken',
      keySource: { kind: 'inline', certPem: 'PUBLIC-CERT', keyPem: KEYPEM },
    },
  })
}

function soapValues(block: Row | undefined) {
  const sign = ((block?.wsSecurity as Row | undefined)?.sign as Row | undefined) ?? {}
  return {
    endpointUrl: block?.endpointUrl,
    wsdlUrl: block?.wsdlUrl,
    pem: sign.privateKeyPem,
    keyPem: (sign.keySource as Row | undefined)?.keyPem,
  }
}

const SOAP_STORED = {
  endpointUrl: `https://soap.test/svc?apikey=${SOAPE}`,
  wsdlUrl: `https://u:${SOAPW}@soap.test/svc?wsdl`,
  pem: PEM,
  keyPem: KEYPEM,
}

describe('SOAP URLs and pasted private keys (issue #247)', () => {
  it('the snapshot holds neither; the public certificates stay', async () => {
    const app = await launch()
    openTab(app, 'soap')
    typeSoap(app)
    expectNoLiteral()
    expect(allStorage()).toContain('PUBLIC-CERT')
    expect(allStorage()).toContain('https://soap.test/svc?apikey=')
    expect(soapValues(getState(app, 'useSoapStore'))).toEqual(SOAP_STORED)
  })

  for (const b of BINDINGS) {
    it(`${b.name}: restart + Ctrl+S keeps the row intact`, async () => {
      const s1 = await launch()
      openTab(s1, 'soap', b.bind)
      typeSoap(s1)
      expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
      expect(soapValues(metaOf(b, 'soap'))).toEqual(SOAP_STORED)
      const s2 = await launch()
      expectNoLiteral()
      expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
      expect(soapValues(metaOf(b, 'soap'))).toEqual(SOAP_STORED)
      expect(soapValues(getState(s2, 'useSoapStore'))).toEqual(SOAP_STORED)
    })
  }

  it('restart → immediate Send goes to the saved endpoint URL', async () => {
    const s1 = await launch()
    openTab(s1, 'soap', { endpointId: 'ep-1' })
    typeSoap(s1)
    expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
    const s2 = await launch()
    // The value is NOT in the snapshot — the send must reload it.
    expectNoLiteral()
    api.calls.length = 0
    await s2.useSoapStore.getState().sendSoap()
    const sent = api.calls.filter((x) => x.name === 'request.send')
    expect(JSON.stringify(sent.map((x) => x.args))).toContain(SOAPE)
  })
})

// ─── MCP tool-call arguments ────────────────────────────────────────────

const TOOL_ARGS = `{\n  "query": "x",\n  "api_key": "${ARGS}"\n}`

describe('MCP tool-call arguments (issue #247)', () => {
  it('credential-named members are blanked in the snapshot, formatting kept', async () => {
    const app = await launch()
    openTab(app, 'mcp')
    app.useMcpStore.getState().setToolArgs(TOOL_ARGS)
    expectNoLiteral()
    const snap = JSON.parse(window.localStorage.getItem('testnizer-mcp') ?? '{}')
    expect(snap.current.toolArgs).toBe('{\n  "query": "x",\n  "api_key": ""\n}')
  })

  for (const b of BINDINGS) {
    it(`${b.name}: restart + Ctrl+S keeps the arguments on the row`, async () => {
      const s1 = await launch()
      openTab(s1, 'mcp', b.bind)
      s1.useMcpStore.getState().setUrl('https://mcp.test/mcp')
      s1.useMcpStore.getState().setToolArgs(TOOL_ARGS)
      expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
      const args = () => (metaOf(b, 'mcp').call as Row | undefined)?.toolArgs
      expect(args()).toBe(TOOL_ARGS)
      const s2 = await launch()
      expectNoLiteral()
      expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
      expect(args()).toBe(TOOL_ARGS)
      expect(s2.useMcpStore.getState().toolArgs).toBe(TOOL_ARGS)
    })
  }

  it('restart → a tool call reloads the arguments before it goes out', async () => {
    const s1 = await launch()
    openTab(s1, 'mcp', { endpointId: 'ep-1' })
    s1.useMcpStore.getState().setUrl('https://mcp.test/mcp')
    s1.useMcpStore.getState().setToolArgs(TOOL_ARGS)
    expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
    const s2 = await launch()
    expectNoLiteral()
    // A live connection (it never survives a restart; set here to reach the call).
    s2.useMcpStore.setState({
      connectionId: 'c1',
      selectedTool: 'search',
      tools: [{ name: 'search' }],
    } as never)
    api.calls.length = 0
    await s2.useMcpStore.getState().callTool({ force: true })
    const sent = api.calls.filter((x) => x.name === 'mcp.callTool')
    expect(sent).toHaveLength(1)
    expect(JSON.stringify(sent[0].args)).toContain(ARGS)
  })
})
