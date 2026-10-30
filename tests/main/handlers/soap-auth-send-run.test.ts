/**
 * SOAP request Auth tab on Send and Run (issue #298 follow-up).
 *
 * The SOAP editor renders the shared Auth tab (request store), and Ctrl+S
 * writes it to `request_schema.auth`. Run sent that auth — resolved through
 * the folder / project chain (`resolveEffectiveAuth`) — but Send
 * (`soap.store.sendSoap`) sent NO auth at all: a SOAP request with Basic /
 * Bearer on its Auth tab, or inheriting a folder's, worked in Run and got a
 * 401 on Send.
 *
 * Send here is the REAL renderer store wired to the REAL `request:send`
 * handler; its folder lookups (`resolveInheritance`) read the same DB rows
 * Run reads. Run is the real `runner:execute` loop. One local server records
 * the Authorization header and body each path put on the wire.
 */
import 'reflect-metadata'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
} from './helpers'

const sentToRenderer: Array<{ channel: string; payload: unknown }> = []

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => sentToRenderer.push({ channel, payload }),
        },
      },
    ],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const { registerRequestHandlers } = await import('../../../src/main/ipc/request.handler')
const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')
const { registerConsoleHandlers } = await import('../../../src/main/ipc/console.handler')
const { useSoapStore } = await import('../../../src/renderer/stores/soap.store')
const { useRequestStore } = await import('../../../src/renderer/stores/request.store')
const { useEnvironmentStore } = await import('../../../src/renderer/stores/environment.store')
const { useResponseStore } = await import('../../../src/renderer/stores/response.store')
const { useTabsStore } = await import('../../../src/renderer/stores/tabs.store')
const { useWorkspaceStore } = await import('../../../src/renderer/stores/workspace.store')
const { restoreProtocolFromMetadata } =
  await import('../../../src/renderer/lib/save-active-request')

const ENVELOPE = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tem="http://tempuri.org/">
   <soapenv:Header/>
   <soapenv:Body><tem:Add><tem:intA>1</tem:intA></tem:Add></soapenv:Body>
</soapenv:Envelope>`

const TOKEN = 'soap-bearer-CANARY-7d21'
const USER = 'soap-basic-user'
const PW = 'soap-basic-pw-CANARY-90af'

interface Received {
  headers: Record<string, string | string[] | undefined>
  body: string
  authorization?: string
}
let received: Received[] = []
let server: Server
let base = ''

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        let body = ''
        req.on('data', (c) => (body += String(c)))
        req.on('end', () => {
          received.push({ body, authorization: req.headers.authorization, headers: req.headers })
          res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
          res.end(
            '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><AddResponse>3</AddResponse></soapenv:Body></soapenv:Envelope>',
          )
        })
      })
      server.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        resolve()
      })
    }),
)
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

let workspaceId: string
let projectId: string

/** The variables both paths resolve: Send from the env store, Run from the DB. */
const VARS: Record<string, string> = { tok: TOKEN, user: USER, pw: PW }

const ok = (data: unknown) => ({ success: true, data })

/** The Headers tab rows of the request under test: Send's request store, Run's `schema.headers`. */
type Row = { id: string; key: string; value: string; enabled: boolean }
let headerRows: Row[] = []

beforeEach(() => {
  harness.reset()
  received = []
  sentToRenderer.length = 0
  headerRows = []
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES ('env1', ?, ?, 'Dev', 1, ?, ?)`,
    )
    .run(workspaceId, projectId, now, now)
  for (const [k, v] of Object.entries(VARS)) {
    testDb
      .prepare(
        `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
         VALUES (?, 'env1', ?, ?, 1, 0, NULL)`,
      )
      .run(`v-${k}`, k, v)
  }
  registerRequestHandlers()
  registerRunnerHandlers()
  registerConsoleHandlers()

  // Renderer side of Send: request:send goes to the main handler; the
  // inheritance lookups read the same rows `runner:execute` walks.
  ;(globalThis as unknown as { window: { api: unknown } }).window = {
    api: {
      request: {
        send: (payload: unknown) => harness.invoke('request:send', payload),
        cancel: vi.fn(),
      },
      endpoint: {
        get: async (id: string) =>
          ok(testDb.prepare('SELECT folder_id FROM endpoints WHERE id = ?').get(id)),
      },
      folder: {
        list: async (pid: string) =>
          ok(testDb.prepare('SELECT * FROM folders WHERE project_id = ?').all(pid)),
      },
      settings: { get: async () => ok({}) },
    },
  }
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    globalVariables: [],
    environments: [
      {
        id: 'env1',
        name: 'Dev',
        variables: Object.entries(VARS).map(([key, value]) => ({
          id: `v-${key}`,
          key,
          value,
          initialValue: '',
          enabled: true,
          secret: false,
        })),
      },
    ] as never,
    activeEnvironmentId: 'env1',
  })
  useResponseStore.setState({ response: null, isLoading: false })
  useWorkspaceStore.setState({ activeWorkspaceId: workspaceId, activeProjectId: projectId })
})

afterEach(() => {
  testDb.close()
})

// ─── helpers ────────────────────────────────────────────────────

type Auth = Record<string, unknown>
type WsSec = Record<string, unknown> | undefined

function seedFolder(auth: Auth): string {
  const id = crypto.randomUUID()
  testDb
    .prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, sort_order, auth)
       VALUES (?, ?, NULL, 'SOAP services', 0, ?)`,
    )
    .run(id, projectId, JSON.stringify(auth))
  return id
}

/** A SOAP endpoint row as Ctrl+S writes it: Auth tab in `auth`, editor in `metadata.soap`. */
function seedSoapEndpoint(auth: Auth, folderId: string | null, wsSecurity?: WsSec): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = JSON.stringify({
    method: 'POST',
    url: `${base}/svc`,
    params: [],
    headers: headerRows,
    body: { type: 'xml', content: ENVELOPE },
    auth,
    assertions: [],
    metadata: {
      soap: {
        mode: 'manual',
        endpointUrl: `${base}/svc`,
        rawXml: ENVELOPE,
        manualSoapAction: 'http://tempuri.org/Add',
        manualSoapVersion: 'soap11',
        ...(wsSecurity ? { wsSecurity } : {}),
      },
    },
  })
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'Add', 'soap', 'POST', '/svc', 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, folderId, schema, now, now)
  return id
}

/** Send: the SOAP tab bound to the endpoint row, its Auth tab in the request store. */
async function send(endpointId: string, auth: Auth, wsSecurity?: WsSec): Promise<Received> {
  useTabsStore.setState({
    tabs: [
      {
        id: 'soap-tab',
        name: 'Add',
        protocol: 'soap',
        method: 'POST',
        url: `${base}/svc`,
        isDirty: false,
        endpointId,
      } as never,
    ],
    activeTabId: 'soap-tab',
  })
  useRequestStore.getState().switchToTab('soap-tab')
  useRequestStore.setState({
    auth: auth as never,
    headers: headerRows as never,
    withheldCredentials: [],
    unloaded: false,
  })
  useSoapStore.setState({
    ...useSoapStore.getState(),
    parsedWsdl: null,
    selectedService: null,
    selectedPort: null,
    selectedOperation: null,
    mode: 'manual',
    rawXml: ENVELOPE,
    endpointUrl: `${base}/svc`,
    manualSoapAction: 'http://tempuri.org/Add',
    manualSoapVersion: 'soap11',
    withheldCredentials: [],
    wsSecurity: { modes: [], ...(wsSecurity ?? { enabled: false }) } as never,
  })
  const before = received.length
  await useSoapStore.getState().sendSoap()
  expect(useResponseStore.getState().response?.error).toBeUndefined()
  expect(received.length).toBe(before + 1)
  return received[received.length - 1]
}

async function run(endpointId: string): Promise<Received> {
  const before = received.length
  const res = (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    endpointIds: [endpointId],
  })) as { success: boolean; data?: { results: Array<Record<string, unknown>> } }
  expect(res.success).toBe(true)
  expect(res.data?.results[0].error).toBeUndefined()
  expect(received.length).toBe(before + 1)
  return received[received.length - 1]
}

async function bothPaths(
  auth: Auth,
  folderAuth?: Auth,
  wsSecurity?: WsSec,
): Promise<{ s: Received; r: Received }> {
  const folderId = folderAuth ? seedFolder(folderAuth) : null
  const id = seedSoapEndpoint(auth, folderId, wsSecurity)
  const s = await send(id, auth, wsSecurity)
  const r = await run(id)
  return { s, r }
}

const BASIC = `Basic ${Buffer.from(`${USER}:${PW}`).toString('base64')}`

// ─── Send ≡ Run ────────────────────────────────────────────────

describe('SOAP Auth tab reaches the wire on Send AND Run', () => {
  it('Basic on the request ({{var}} resolved) → the same Authorization on both paths', async () => {
    const { s, r } = await bothPaths({
      type: 'basic',
      basic: { username: '{{user}}', password: '{{pw}}' },
    })
    expect(r.authorization).toBe(BASIC)
    expect(s.authorization).toBe(BASIC)
  })

  it('Bearer on the request → the same Authorization on both paths', async () => {
    const { s, r } = await bothPaths({ type: 'bearer', bearer: { token: '{{tok}}' } })
    expect(r.authorization).toBe(`Bearer ${TOKEN}`)
    expect(s.authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('inherit → the folder Bearer on both paths', async () => {
    const { s, r } = await bothPaths(
      { type: 'inherit' },
      { type: 'bearer', bearer: { token: '{{tok}}' } },
    )
    expect(r.authorization).toBe(`Bearer ${TOKEN}`)
    expect(s.authorization).toBe(`Bearer ${TOKEN}`)
  })

  it('none on the request stops the folder auth on both paths', async () => {
    const { s, r } = await bothPaths({ type: 'none' }, { type: 'bearer', bearer: { token: 'x' } })
    expect(r.authorization).toBeUndefined()
    expect(s.authorization).toBeUndefined()
  })

  it('WS-Security as the Auth type: no Authorization header, the UsernameToken in the envelope', async () => {
    const wsSecurity = {
      enabled: true,
      modes: ['username-token'],
      usernameToken: {
        username: '{{user}}',
        password: '{{pw}}',
        passwordType: 'PasswordText',
        nonce: false,
        created: false,
      },
    }
    const { s, r } = await bothPaths(
      { type: 'wsse' },
      { type: 'bearer', bearer: { token: '{{tok}}' } },
      wsSecurity,
    )
    for (const wire of [s, r]) {
      expect(wire.authorization).toBeUndefined()
      expect(wire.body).toContain(`<wsse:Username>${USER}</wsse:Username>`)
    }
  })

  it('a History mask left in the Auth tab is never sent', async () => {
    const id = seedSoapEndpoint({ type: 'bearer', bearer: { token: '••••••' } }, null)
    useTabsStore.setState({
      tabs: [
        { id: 'soap-tab', name: 'Add', protocol: 'soap', isDirty: false, endpointId: id } as never,
      ],
      activeTabId: 'soap-tab',
    })
    useRequestStore.getState().switchToTab('soap-tab')
    useRequestStore.setState({
      auth: { type: 'bearer', bearer: { token: '••••••' } } as never,
      withheldCredentials: [],
      unloaded: false,
    })
    useSoapStore.setState({
      ...useSoapStore.getState(),
      mode: 'manual',
      rawXml: ENVELOPE,
      endpointUrl: `${base}/svc`,
      withheldCredentials: [],
      wsSecurity: { modes: [], enabled: false } as never,
    })
    await useSoapStore.getState().sendSoap()
    expect(useResponseStore.getState().response?.error).toBeTruthy()
    expect(received).toHaveLength(0)
  })
})

// ─── masking ───────────────────────────────────────────────────

describe('the Auth tab credential never reaches a persistent sink', () => {
  function persisted(): string {
    const history = testDb.prepare('SELECT * FROM history').all()
    const runs = testDb.prepare('SELECT results_json FROM runner_history').all()
    return JSON.stringify({ history, runs })
  }
  const consoleEntries = (): string =>
    JSON.stringify(sentToRenderer.filter((s) => s.channel === 'console:log'))

  it('Basic and Bearer: History, runner history and Console hold no password / token', async () => {
    await bothPaths({ type: 'basic', basic: { username: '{{user}}', password: '{{pw}}' } })
    await bothPaths({ type: 'bearer', bearer: { token: '{{tok}}' } })
    expect(received.map((r) => r.authorization).join(' ')).toContain(TOKEN) // it really went out
    expect(persisted().length).toBeGreaterThan(50)
    expect(persisted()).not.toContain(PW)
    expect(persisted()).not.toContain(TOKEN)
    expect(persisted()).not.toContain(Buffer.from(`${USER}:${PW}`).toString('base64'))
    expect(consoleEntries().length).toBeGreaterThan(2)
    expect(consoleEntries()).not.toContain(PW)
    expect(consoleEntries()).not.toContain(TOKEN)
  })
})

// ─── Headers tab ───────────────────────────────────────────────

describe('SOAP Headers tab reaches the wire on Send AND Run', () => {
  const row = (key: string, value: string, enabled = true): Row => ({
    id: `h-${key}`,
    key,
    value,
    enabled,
  })
  const pick = (w: Received) => ({
    custom: w.headers['x-custom'],
    tenant: w.headers['x-tenant'],
    off: w.headers['x-disabled'],
    contentType: w.headers['content-type'],
    soapAction: w.headers['soapaction'],
  })

  it('a custom header and a {{var}} header arrive identically; transport headers stay', async () => {
    headerRows = [
      row('X-Custom', 'plain-value'),
      row('X-Tenant', 'tenant-{{user}}'),
      row('X-Disabled', 'nope', false),
    ]
    const { s, r } = await bothPaths({ type: 'none' })
    expect(pick(r)).toEqual({
      custom: 'plain-value',
      tenant: `tenant-${USER}`,
      off: undefined,
      contentType: 'text/xml; charset=utf-8',
      soapAction: '"http://tempuri.org/Add"',
    })
    expect(pick(s)).toEqual(pick(r))
  })

  it("the user's own Content-Type / SOAPAction win over the transport ones on both paths", async () => {
    headerRows = [row('content-type', 'text/xml; charset=iso-8859-9'), row('SOAPAction', '"urn:x"')]
    const { s, r } = await bothPaths({ type: 'none' })
    expect(r.headers['content-type']).toBe('text/xml; charset=iso-8859-9')
    expect(r.headers['soapaction']).toBe('"urn:x"')
    expect(pick(s)).toEqual(pick(r))
  })

  it('a disabled Content-Type row does not displace the transport one', async () => {
    headerRows = [row('Content-Type', 'application/json', false)]
    const { s, r } = await bothPaths({ type: 'none' })
    expect(r.headers['content-type']).toBe('text/xml; charset=utf-8')
    expect(pick(s)).toEqual(pick(r))
  })
})

// ─── transport headers for rows without a saved action / version ───────

/**
 * Issue #298 follow-up. Run added Content-Type / SOAPAction only when
 * `metadata.soap` carried an action or a version (`soapTransportFromMeta`
 * returned null otherwise); Send always adds them. And Send's restore dropped
 * the saved operation's action / version, so a reopened SOAP 1.2 row Sent as
 * 1.1 with `SOAPAction: ""`. Send here opens the row through the REAL editor
 * restore (request store + `restoreProtocolFromMetadata`, or the raw-XML load
 * the tree uses for a row without metadata) — nothing is hand-set on the SOAP
 * store — then both paths' wire headers are compared.
 */
describe('SOAP transport headers: Send ≡ Run whatever the row saved', () => {
  let tabSeq = 0

  function seedRow(soapMeta: Record<string, unknown> | undefined, headers: Row[]): string {
    const id = crypto.randomUUID()
    const now = Date.now()
    const schema = JSON.stringify({
      method: 'POST',
      url: `${base}/svc`,
      params: [],
      headers,
      body: { type: 'xml', content: ENVELOPE },
      auth: { type: 'none' },
      assertions: [],
      // `metadata.soap` as Ctrl+S writes it (absent: an imported / pre-metadata row).
      ...(soapMeta ? { metadata: { soap: soapMeta } } : {}),
    })
    testDb
      .prepare(
        `INSERT INTO endpoints
          (id, project_id, folder_id, name, protocol, method, path, status,
           request_schema, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, 'Add', 'soap', 'POST', '/svc', 'developing', ?, 0, ?, ?)`,
      )
      .run(id, projectId, schema, now, now)
    return id
  }

  /** Open the row the way the tree does, then Send. */
  async function sendRow(endpointId: string): Promise<Received> {
    const row = testDb
      .prepare('SELECT request_schema FROM endpoints WHERE id = ?')
      .get(endpointId) as { request_schema: string }
    const schema = JSON.parse(row.request_schema) as {
      url: string
      headers: Row[]
      body: { type: string; content?: string }
      metadata?: unknown
    }
    // A fresh tab id and an empty SOAP tab cache: no earlier test's manual
    // action can leak into this tab.
    const tabId = `soap-row-${++tabSeq}`
    useSoapStore.setState({ _tabStates: new Map(), _currentTabId: null } as never)
    useTabsStore.setState({
      tabs: [
        {
          id: tabId,
          name: 'Add',
          protocol: 'soap',
          method: 'POST',
          url: schema.url,
          isDirty: false,
          endpointId,
        } as never,
      ],
      activeTabId: tabId,
    })
    const req = useRequestStore.getState()
    req.switchToTab(tabId)
    req.loadFromEndpoint({
      method: 'POST',
      url: schema.url,
      params: [],
      headers: schema.headers as never,
      body: schema.body as never,
      auth: { type: 'none' } as never,
      preScript: '',
      postScript: '',
      assertions: [],
    } as never)
    useRequestStore.setState({ withheldCredentials: [], unloaded: false })
    if (schema.metadata) {
      restoreProtocolFromMetadata('soap', schema.metadata)
    } else {
      // TreeView: a SOAP row without metadata opens Manual over the raw XML.
      useSoapStore.getState().switchToTab(tabId)
      useSoapStore.getState().loadFromEndpoint({
        url: schema.url,
        body: schema.body,
        headers: schema.headers,
        soap: undefined,
      })
    }
    useSoapStore.setState({ withheldCredentials: [] })
    const before = received.length
    await useSoapStore.getState().sendSoap()
    expect(useResponseStore.getState().response?.error).toBeUndefined()
    expect(received.length).toBe(before + 1)
    return received[received.length - 1]
  }

  const transport = (w: Received) => ({
    contentType: w.headers['content-type'],
    soapAction: w.headers['soapaction'],
  })

  async function both(soapMeta: Record<string, unknown> | undefined, headers: Row[] = []) {
    const id = seedRow(soapMeta, headers)
    const s = await sendRow(id)
    const r = await run(id)
    return { s: transport(s), r: transport(r) }
  }

  const wsdlMeta = {
    mode: 'wsdl',
    wsdlUrl: 'http://example.test/calc?wsdl',
    selectedService: 'Calculator',
    selectedPort: 'CalculatorSoap',
    selectedOperation: 'Add',
    bodyMode: 'raw',
    endpointUrl: '',
    rawXml: ENVELOPE,
  }

  it('WSDL row with no soapAction / soapVersion → SOAP 1.1 text/xml + SOAPAction "" on both', async () => {
    const { s, r } = await both({ ...wsdlMeta, endpointUrl: `${base}/svc` })
    expect(s).toEqual({ contentType: 'text/xml; charset=utf-8', soapAction: '""' })
    expect(r).toEqual(s)
  })

  it('WSDL row saved as SOAP 1.2 with an action → the same 1.2 Content-Type on both', async () => {
    const { s, r } = await both({
      ...wsdlMeta,
      endpointUrl: `${base}/svc`,
      soapVersion: 'soap12',
      soapAction: 'urn:Add',
    })
    expect(r).toEqual({
      contentType: 'application/soap+xml; charset=utf-8; action="urn:Add"',
      soapAction: undefined,
    })
    expect(s).toEqual(r)
  })

  it('WSDL operation without an action falls back to the saved manual action on both', async () => {
    const { s, r } = await both({
      ...wsdlMeta,
      endpointUrl: `${base}/svc`,
      manualSoapAction: 'urn:fallback',
      manualSoapVersion: 'soap11',
    })
    expect(s).toEqual({ contentType: 'text/xml; charset=utf-8', soapAction: '"urn:fallback"' })
    expect(r).toEqual(s)
  })

  it('legacy row (no mode; operationName / soapAction / exampleRequest) → the saved action on both', async () => {
    const { s, r } = await both({
      operationName: 'Add',
      soapAction: 'http://tempuri.org/Add',
      soapVersion: 'soap11',
      endpointUrl: `${base}/svc`,
      exampleRequest: ENVELOPE,
    })
    expect(r).toEqual({
      contentType: 'text/xml; charset=utf-8',
      soapAction: '"http://tempuri.org/Add"',
    })
    expect(s).toEqual(r)
  })

  it('row with no metadata and no transport headers → text/xml + SOAPAction "" on both', async () => {
    const { s, r } = await both(undefined)
    expect(s).toEqual({ contentType: 'text/xml; charset=utf-8', soapAction: '""' })
    expect(r).toEqual(s)
  })

  it('row with no metadata whose stored Content-Type is SOAP 1.2 → no SOAPAction added on either', async () => {
    const ct = 'application/soap+xml; charset=utf-8; action="urn:Add"'
    const { s, r } = await both(undefined, [
      { id: 'h-ct', key: 'Content-Type', value: ct, enabled: true },
    ])
    expect(r).toEqual({ contentType: ct, soapAction: undefined })
    expect(s).toEqual(r)
  })
})
