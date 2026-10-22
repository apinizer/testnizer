/**
 * Issue #247 — the fields issue #244 left out: literal credentials in HTTP
 * query params (and the URL), form-data / urlencoded fields, a JSON body,
 * GraphQL `variables`, the MCP server URL / stdio command line / env URL
 * values, the SOAP WS-Security UsernameToken password, and a tab's display
 * url never reach localStorage. Same mechanism (`credential-withhold.ts`
 * spec + `withheld-credentials.ts` adapter + reload before save / send).
 *
 * Pinned per field:
 *   1. no literal under ANY localStorage key (active + cached tab); memory
 *      keeps it; names, `{{var}}` values and other values stay; the URL bar
 *      and the Params tab stay in step;
 *   2. an older snapshot is cleaned on load;
 *   3. the data-loss trap: save → restart → Ctrl+S → the row is intact
 *      (endpoint, saved request, suite item);
 *   4. editing ANOTHER part after the restart keeps the marker; the user's
 *      own edit of the credential wins;
 *   5. restart → immediate Send / Connect → the engine gets the value.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeyValuePair, Tab } from '../../src/renderer/types'

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('../../src/renderer/lib/toast', () => ({ toast: toastMock }))

// Each test re-imports the whole store graph (`vi.resetModules`) — the first
// cold import can pass vitest's 5 s default when the suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 })

const QK = 'LIT-query-247-a1'
const FD = 'LIT-form-247-b2'
const UE = 'LIT-urlenc-247-c3'
const JB = 'LIT-json-247-d4'
const GV = 'LIT-gqlvar-247-e5'
const MU = 'LIT-mcpurl-247-f6'
const MC = 'LIT-mcpcmd-247-g7'
const ME = 'LIT-mcpenv-247-h8'
const SP = 'LIT-soap-247-i9'
const ALL = [QK, FD, UE, JB, GV, MU, MC, ME, SP]

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

const kv = (id: string, key: string, value: string, extra: Partial<KeyValuePair> = {}) =>
  ({ id, key, value, enabled: true, ...extra }) as KeyValuePair

type Row = Record<string, unknown>
type Call = { name: string; args: unknown[] }

/** Real row IPC for the three tables + a recording stub for every engine namespace. */
function installApi() {
  const endpoints = new Map<string, Row>()
  const saved = new Map<string, Row>()
  const items = new Map<string, Row>()
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
    testSuiteItem: table(items),
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
  return {
    endpoints,
    saved,
    items,
    calls,
    endpointApi: known.endpoint as ReturnType<typeof table>,
  }
}

async function launch() {
  vi.resetModules()
  const [tabs, req, mcp, gql, soap, save, ws, activate, reload] = await Promise.all([
    import('../../src/renderer/stores/tabs.store'),
    import('../../src/renderer/stores/request.store'),
    import('../../src/renderer/stores/mcp.store'),
    import('../../src/renderer/stores/graphql.store'),
    import('../../src/renderer/stores/soap.store'),
    import('../../src/renderer/lib/save-active-request'),
    import('../../src/renderer/stores/workspace.store'),
    import('../../src/renderer/lib/activate-tab'),
    import('../../src/renderer/lib/withheld-credentials'),
  ])
  ws.useWorkspaceStore.setState({ refreshTree: async () => {} } as never)
  return {
    useTabsStore: tabs.useTabsStore,
    useRequestStore: req.useRequestStore,
    useMcpStore: mcp.useMcpStore,
    useGraphQLStore: gql.useGraphQLStore,
    useSoapStore: soap.useSoapStore,
    saveActiveRequestInPlace: save.saveActiveRequestInPlace,
    activateTabStores: activate.activateTabStores,
    ensure: (tab: Tab) => reload.ensureWithheldCredentialsLoaded(tab),
  }
}
type App = Awaited<ReturnType<typeof launch>>

let api: ReturnType<typeof installApi>

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  api = installApi()
})

const BINDINGS: Array<{
  name: string
  bind: Partial<Tab>
  rows: () => Map<string, Row>
  id: string
}> = [
  { name: 'endpoint', bind: { endpointId: 'ep-1' }, rows: () => api.endpoints, id: 'ep-1' },
  { name: 'saved request', bind: { savedRequestId: 'sr-1' }, rows: () => api.saved, id: 'sr-1' },
  { name: 'suite item', bind: { testSuiteItemId: 'it-1' }, rows: () => api.items, id: 'it-1' },
]

/** The row normalized to `{ url, params, body, meta }` whichever table it is in. */
function stored(b: (typeof BINDINGS)[number]): Row {
  const row = b.rows().get(b.id) ?? {}
  const parse = (v: unknown) => (typeof v === 'string' && v ? JSON.parse(v) : undefined)
  if (b.name === 'saved request') {
    return {
      url: row.url,
      params: parse(row.params),
      body: parse(row.body),
      meta: parse(row.metadata),
    }
  }
  const schema = parse(row.request_schema) ?? {}
  return {
    url: schema.url ?? row.url,
    params: schema.params,
    body: schema.body,
    meta: schema.metadata,
  }
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

const activeTab = (app: App): Tab => app.useTabsStore.getState().tabs[0]

// ─── HTTP: params + URL, form-data, urlencoded, JSON body ──────────────

const HTTP_URL = `https://api.test/v1?page=2&api_key=${QK}&q={{q}}`
const JSON_BODY = `{\n  "user": "alice",\n  "password": "${JB}",\n  "token": "{{tok}}"\n}`

function typeHttp(app: App, body: 'json' | 'form-data' | 'urlencoded' = 'json') {
  const req = app.useRequestStore.getState()
  req.setUrl(HTTP_URL)
  if (body === 'json') req.setBody({ type: 'json', content: JSON_BODY })
  if (body === 'form-data') {
    req.setBody({
      type: 'form-data',
      formData: [
        kv('f1', 'client_secret', FD),
        kv('f2', 'name', 'n'),
        kv('f3', 'key', 'upload.bin', { type: 'file', filePath: '/tmp/upload.bin' }),
      ],
    })
  }
  if (body === 'urlencoded') {
    req.setBody({
      type: 'urlencoded',
      urlEncoded: [kv('u1', 'password', UE), kv('u2', 'grant_type', 'password')],
    })
  }
}

const param = (params: KeyValuePair[] | undefined, key: string) =>
  params?.find((p) => p.key === key)

function httpValues(s: Row) {
  const body = s.body as Row | undefined
  return {
    url: s.url,
    param: param(s.params as KeyValuePair[], 'api_key')?.value,
    json: body?.content,
    form: (body?.formData as KeyValuePair[] | undefined)?.find((r) => r.key === 'client_secret')
      ?.value,
    urlenc: (body?.urlEncoded as KeyValuePair[] | undefined)?.find((r) => r.key === 'password')
      ?.value,
  }
}

describe('HTTP params, URL and body stay out of the snapshot (issue #247)', () => {
  it('blanks the credential param in the row AND the URL; keeps the rest', async () => {
    const app = await launch()
    openTab(app, 'http')
    typeHttp(app)
    expectNoLiteral()
    const snap = JSON.parse(window.localStorage.getItem('testnizer-request') ?? '{}')
    expect(snap.current.url).toBe('https://api.test/v1?page=2&api_key=&q={{q}}')
    expect(param(snap.current.params, 'api_key')?.value).toBe('')
    expect(param(snap.current.params, 'page')?.value).toBe('2')
    expect(param(snap.current.params, 'q')?.value).toBe('{{q}}')
    expect(snap.current.body.content).toBe(
      '{\n  "user": "alice",\n  "password": "",\n  "token": "{{tok}}"\n}',
    )
    // Memory keeps everything.
    const s = app.useRequestStore.getState()
    expect(s.url).toBe(HTTP_URL)
    expect(param(s.params, 'api_key')?.value).toBe(QK)
    app.useRequestStore.getState().switchToTab('tab-other')
    expectNoLiteral()
  })

  it('form-data (not the file row) and urlencoded fields', async () => {
    const app = await launch()
    openTab(app, 'http')
    typeHttp(app, 'form-data')
    expectNoLiteral()
    const fd = JSON.parse(window.localStorage.getItem('testnizer-request') ?? '{}').current.body
      .formData as KeyValuePair[]
    expect(fd.find((r) => r.key === 'key')?.value).toBe('upload.bin')
    expect(fd.find((r) => r.key === 'name')?.value).toBe('n')
    app.useRequestStore
      .getState()
      .setBody({ type: 'urlencoded', urlEncoded: [kv('u1', 'password', UE)] })
    expectNoLiteral()
    expect(allStorage()).toContain('"password"')
  })

  it('an XML / text body is free text and is stored as typed', async () => {
    const app = await launch()
    openTab(app, 'http')
    app.useRequestStore.getState().setBody({ type: 'xml', content: '<p>"password": "x-xml"</p>' })
    expect(allStorage()).toContain('x-xml')
  })

  it('cleans an older snapshot on load', async () => {
    window.localStorage.setItem(
      'testnizer-request',
      JSON.stringify({
        current: {
          url: HTTP_URL,
          params: [kv('p1', 'api_key', QK)],
          body: { type: 'json', content: JSON_BODY },
        },
        _currentTabId: 'tab-x',
        _tabStates: [
          ['tab-2', { body: { type: 'urlencoded', urlEncoded: [kv('u1', 'password', UE)] } }],
        ],
      }),
    )
    window.localStorage.setItem(
      'testnizer-tabs',
      JSON.stringify({
        tabs: [{ id: 'tab-x', name: 'X', url: HTTP_URL, protocol: 'http' }],
        activeTabId: 'tab-x',
      }),
    )
    const app = await launch()
    expect(app.useRequestStore.getState().url).toBe('https://api.test/v1?page=2&api_key=&q={{q}}')
    expect(app.useRequestStore.getState().params[0].value).toBe('')
    expectNoLiteral()
  })

  for (const b of BINDINGS) {
    for (const kind of ['json', 'form-data', 'urlencoded'] as const) {
      it(`${b.name} / ${kind}: restart + Ctrl+S keeps the row intact`, async () => {
        const s1 = await launch()
        openTab(s1, 'http', b.bind)
        typeHttp(s1, kind)
        expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
        const before = httpValues(stored(b))
        expect(before.url).toBe(HTTP_URL)
        expect(before.param).toBe(QK)

        const s2 = await launch()
        expectNoLiteral()
        expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
        expect(httpValues(stored(b))).toEqual(before)
        expect(httpValues(s2.useRequestStore.getState() as unknown as Row)).toEqual(before)
        expectNoLiteral()
      })
    }
  }

  it('editing ANOTHER param after the restart keeps the URL and the param value', async () => {
    const s1 = await launch()
    openTab(s1, 'http', { savedRequestId: 'sr-1' })
    typeHttp(s1)
    expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })

    const s2 = await launch()
    const page = param(s2.useRequestStore.getState().params, 'page')!
    // Rebuilds the URL from the params: `api_key=` turns into a bare `api_key`.
    s2.useRequestStore.getState().updateParam(page.id, { value: '3' })
    expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
    const s = stored(BINDINGS[1])
    expect(s.url).toBe(`https://api.test/v1?page=3&api_key=${QK}&q={{q}}`)
    expect(param(s.params as KeyValuePair[], 'api_key')?.value).toBe(QK)
    // The URL bar and the Params tab agree.
    const live = s2.useRequestStore.getState()
    expect(live.url).toBe(s.url)
  })

  it('editing the URL path after the restart keeps the credential', async () => {
    const s1 = await launch()
    openTab(s1, 'http', { endpointId: 'ep-1' })
    typeHttp(s1)
    expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
    const s2 = await launch()
    s2.useRequestStore.getState().setUrl('https://api.test/v2?page=2&api_key=&q={{q}}')
    expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
    const s = stored(BINDINGS[0])
    expect(s.url).toBe(`https://api.test/v2?page=2&api_key=${QK}&q={{q}}`)
    expect(param(s.params as KeyValuePair[], 'api_key')?.value).toBe(QK)
  })

  it('a credential the user types after the restart wins (URL and param together)', async () => {
    const s1 = await launch()
    openTab(s1, 'http', { endpointId: 'ep-1' })
    typeHttp(s1)
    expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
    const s2 = await launch()
    const key = param(s2.useRequestStore.getState().params, 'api_key')!
    s2.useRequestStore.getState().updateParam(key.id, { value: 'typed-new' })
    expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
    const s = stored(BINDINGS[0])
    expect(s.url).toBe('https://api.test/v1?page=2&api_key=typed-new&q={{q}}')
    expect(param(s.params as KeyValuePair[], 'api_key')?.value).toBe('typed-new')
  })

  it('Duplicate Tab carries the param marker onto the re-stamped ids', async () => {
    const s1 = await launch()
    openTab(s1, 'http', { endpointId: 'ep-1' })
    typeHttp(s1)
    expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
    const s2 = await launch()
    s2.useRequestStore.getState().cloneTabState('tab-x', 'tab-copy')
    const copy = s2.useRequestStore.getState()._tabStates.get('tab-copy')!
    const row = param(copy.params, 'api_key')!
    expect(copy.withheldCredentials).toContain(`params#${row.id}`)
    expect(copy.withheldCredentials).toContain('url')
  })

  it('an unsaved draft loses the typed credential; the URL stays coherent', async () => {
    const s1 = await launch()
    openTab(s1, 'http')
    typeHttp(s1)
    const s2 = await launch()
    expect(await s2.ensure(activeTab(s2))).toEqual({ ok: true })
    expect(s2.useRequestStore.getState().url).toBe('https://api.test/v1?page=2&api_key=&q={{q}}')
    expect(s2.useRequestStore.getState().withheldCredentials).toEqual([])
  })
})

// ─── GraphQL variables ─────────────────────────────────────────────────

const GQL_VARS = `{ "id": 1, "apiKey": "${GV}", "n": {{n}} }`

describe('GraphQL variables (issue #247)', () => {
  it('blanks credential members in the text; formatting kept', async () => {
    const app = await launch()
    openTab(app, 'graphql')
    app.useGraphQLStore.getState().setVariables(GQL_VARS)
    expectNoLiteral()
    const snap = JSON.parse(window.localStorage.getItem('testnizer-graphql') ?? '{}')
    expect(snap.current.variables).toBe('{ "id": 1, "apiKey": "", "n": {{n}} }')
    expect(app.useGraphQLStore.getState().variables).toBe(GQL_VARS)
  })

  for (const b of BINDINGS.slice(0, 2)) {
    it(`${b.name}: restart + Ctrl+S keeps the variables`, async () => {
      const s1 = await launch()
      openTab(s1, 'graphql', b.bind)
      s1.useGraphQLStore.getState().setUrl('https://gql.test/graphql')
      s1.useGraphQLStore.getState().setVariables(GQL_VARS)
      expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
      const vars = () => ((stored(b).meta as Row).graphql as Row).variables
      expect(vars()).toBe(GQL_VARS)
      const s2 = await launch()
      expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
      expect(vars()).toBe(GQL_VARS)
      expect(s2.useGraphQLStore.getState().variables).toBe(GQL_VARS)
    })
  }
})

// ─── MCP URL, stdio command line, env URL values ───────────────────────

const MCP_URL = `https://alice:${MU}@mcp.test/mcp?token=${MU}&v=1`
const MCP_CMD = `npx -y @scope/server --api-key ${MC} --port 3000`

function mcpBlock(b: (typeof BINDINGS)[number]): Row {
  return ((stored(b).meta as Row | undefined)?.mcp as Row) ?? {}
}

describe('MCP URL / command line / env URL values (issue #247)', () => {
  it('http: userinfo password and credential query blanked, rest kept', async () => {
    const app = await launch()
    openTab(app, 'mcp')
    app.useMcpStore.getState().setUrl(MCP_URL)
    expectNoLiteral()
    const snap = JSON.parse(window.localStorage.getItem('testnizer-mcp') ?? '{}')
    expect(snap.current.url).toBe('https://alice:@mcp.test/mcp?token=&v=1')
  })

  it('stdio: flag value and env URL credential blanked, names kept', async () => {
    const app = await launch()
    openTab(app, 'mcp')
    app.useMcpStore.getState().setTransport('stdio')
    app.useMcpStore.getState().setUrl(MCP_CMD)
    app.useMcpStore
      .getState()
      .setEnvVars([kv('e1', 'DATABASE_URL', `postgres://u:${ME}@db/x`), kv('e2', 'DEBUG', '1')])
    expectNoLiteral()
    const snap = JSON.parse(window.localStorage.getItem('testnizer-mcp') ?? '{}')
    expect(snap.current.url).toBe('npx -y @scope/server --api-key "" --port 3000')
    expect(snap.current.envVars[0]).toMatchObject({ key: 'DATABASE_URL', value: '' })
    expect(snap.current.envVars[1]).toMatchObject({ key: 'DEBUG', value: '1' })
  })

  for (const b of BINDINGS) {
    it(`${b.name}: stdio restart + Ctrl+S keeps the command line and env`, async () => {
      const s1 = await launch()
      openTab(s1, 'mcp', b.bind)
      s1.useMcpStore.getState().setTransport('stdio')
      s1.useMcpStore.getState().setUrl(MCP_CMD)
      s1.useMcpStore.getState().setEnvVars([kv('e1', 'DATABASE_URL', `postgres://u:${ME}@db/x`)])
      expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
      expect(mcpBlock(b).url).toBe(MCP_CMD)
      expect(stored(b).url).toBe(MCP_CMD)

      const s2 = await launch()
      expectNoLiteral()
      expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
      expect(mcpBlock(b).url).toBe(MCP_CMD)
      expect(stored(b).url).toBe(MCP_CMD)
      expect((mcpBlock(b).envVars as KeyValuePair[])[0].value).toBe(`postgres://u:${ME}@db/x`)
      expect(s2.useMcpStore.getState().url).toBe(MCP_CMD)
      expectNoLiteral()
    })
  }

  it('http: editing the URL path after the restart keeps the saved credentials', async () => {
    const s1 = await launch()
    openTab(s1, 'mcp', { endpointId: 'ep-1' })
    s1.useMcpStore.getState().setUrl(MCP_URL)
    expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
    const s2 = await launch()
    s2.useMcpStore.getState().setUrl('https://alice:@mcp.test/v2?token=&v=1')
    expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
    expect(mcpBlock(BINDINGS[0]).url).toBe(`https://alice:${MU}@mcp.test/v2?token=${MU}&v=1`)
  })
})

// ─── SOAP WS-Security UsernameToken ────────────────────────────────────

function typeSoap(app: App) {
  const soap = app.useSoapStore.getState()
  soap.setMode('manual')
  soap.setEndpointUrl('https://soap.test/svc')
  soap.setRawXml('<Envelope/>')
  soap.setWsSecurity({
    enabled: true,
    modes: ['username-token'],
    usernameToken: {
      username: 'alice',
      password: SP,
      passwordType: 'PasswordText',
      nonce: false,
      created: false,
    },
  })
}

const soapPassword = (block: Row | undefined) =>
  ((block?.wsSecurity as Row | undefined)?.usernameToken as Row | undefined)?.password

describe('SOAP UsernameToken password (issue #247)', () => {
  it('blanked in the snapshot, username kept, memory keeps it', async () => {
    const app = await launch()
    openTab(app, 'soap')
    typeSoap(app)
    expectNoLiteral()
    expect(allStorage()).toContain('alice')
    expect(app.useSoapStore.getState().wsSecurity.usernameToken?.password).toBe(SP)
    app.useSoapStore.getState().switchToTab('tab-other')
    expectNoLiteral()
  })

  it('cleans an older snapshot on load', async () => {
    window.localStorage.setItem(
      'testnizer-soap',
      JSON.stringify({
        current: { wsSecurity: { enabled: true, usernameToken: { username: 'u', password: SP } } },
        _currentTabId: 'tab-x',
        _tabStates: [['tab-2', { wsSecurity: { enabled: true, password: SP } }]],
      }),
    )
    const app = await launch()
    expect(app.useSoapStore.getState().wsSecurity.usernameToken?.password).toBe('')
    expectNoLiteral()
  })

  for (const b of BINDINGS) {
    it(`${b.name}: restart + Ctrl+S keeps the password`, async () => {
      const s1 = await launch()
      openTab(s1, 'soap', b.bind)
      typeSoap(s1)
      expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
      const pw = () => soapPassword((stored(b).meta as Row).soap as Row)
      expect(pw()).toBe(SP)
      const s2 = await launch()
      expectNoLiteral()
      expect(await s2.saveActiveRequestInPlace()).toEqual({ success: true })
      expect(pw()).toBe(SP)
      expect(s2.useSoapStore.getState().wsSecurity.usernameToken?.password).toBe(SP)
    })
  }
})

// ─── Tab display url ───────────────────────────────────────────────────

describe('a tab display url never holds the credential (issue #247)', () => {
  it('open tabs (testnizer-tabs)', async () => {
    const app = await launch()
    app.useTabsStore.setState({
      tabs: [
        {
          id: 't1',
          name: 'A',
          protocol: 'http',
          method: 'GET',
          url: HTTP_URL,
          isDirty: false,
        } as Tab,
      ],
      activeTabId: 't1',
    })
    expectNoLiteral()
    expect(allStorage()).toContain('api_key=')
  })

  it('the per-project tab stash (testnizer-tabs-by-project), cleaned on load', async () => {
    const tab = { id: 't9', name: 'B', protocol: 'mcp', url: MCP_CMD }
    window.localStorage.setItem(
      'testnizer-tabs-by-project',
      JSON.stringify({ 'proj-2': { tabs: [tab], activeTabId: 't9' } }),
    )
    await launch()
    expectNoLiteral()
    const stash = JSON.parse(window.localStorage.getItem('testnizer-tabs-by-project') ?? '{}')
    expect(stash['proj-2'].tabs[0]).toMatchObject({
      id: 't9',
      url: 'npx -y @scope/server --api-key "" --port 3000',
    })
  })
})

// ─── Send / Connect right after a restart ──────────────────────────────

const engineCalls = (prefix: string) => api.calls.filter((c) => c.name.startsWith(prefix))

describe('restart → immediate Send / Connect carries the saved value (issue #247)', () => {
  async function saveAndRestart(protocol: Tab['protocol'], setup: (app: App) => void) {
    const s1 = await launch()
    openTab(s1, protocol, { endpointId: 'ep-1' })
    setup(s1)
    expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
    expectNoLiteral()
    const s2 = await launch()
    api.calls.length = 0
    return s2
  }

  it('HTTP: the URL carries the query credential exactly once, the params and body too', async () => {
    const s2 = await saveAndRestart('http', (app) => typeHttp(app))
    await s2.useRequestStore.getState().sendRequest()
    const sent = engineCalls('request.send')
    expect(sent).toHaveLength(1)
    const payload = sent[0].args[0] as Row
    expect(String(payload.url).split(QK)).toHaveLength(2)
    expect(JSON.stringify(payload.params)).toContain(QK)
    expect(JSON.stringify(payload.body)).toContain(JB)
    expect(toastMock.warning).not.toHaveBeenCalled()
  })

  it('GraphQL: variables', async () => {
    const s2 = await saveAndRestart('graphql', (app) => {
      app.useGraphQLStore.getState().setUrl('https://gql.test/graphql')
      app.useGraphQLStore.getState().setQuery('{ me { id } }')
      app.useGraphQLStore.getState().setVariables(`{ "apiKey": "${GV}" }`)
    })
    await s2.useGraphQLStore.getState().executeQuery()
    expect(JSON.stringify(engineCalls('request.send').map((c) => c.args))).toContain(GV)
  })

  it('MCP stdio: the command line', async () => {
    const s2 = await saveAndRestart('mcp', (app) => {
      app.useMcpStore.getState().setTransport('stdio')
      app.useMcpStore.getState().setUrl(MCP_CMD)
    })
    await s2.useMcpStore.getState().connect()
    const sent = engineCalls('mcp.connect')
    expect(sent.length).toBeGreaterThan(0)
    expect(JSON.stringify(sent.map((c) => c.args))).toContain(MC)
  })

  it('SOAP: the UsernameToken password', async () => {
    const s2 = await saveAndRestart('soap', typeSoap)
    await s2.useSoapStore.getState().sendSoap()
    expect(JSON.stringify(engineCalls('request.send').map((c) => c.args))).toContain(SP)
  })

  it('an unreadable row: the save is refused instead of writing the blanks', async () => {
    const s1 = await launch()
    openTab(s1, 'http', { endpointId: 'ep-1' })
    typeHttp(s1)
    expect(await s1.saveActiveRequestInPlace()).toEqual({ success: true })
    const s2 = await launch()
    api.endpointApi.get.mockResolvedValueOnce({ success: false } as never)
    const res = await s2.saveActiveRequestInPlace()
    expect(res.success).toBe(false)
    expect(stored(BINDINGS[0]).url).toBe(HTTP_URL)
  })
})
