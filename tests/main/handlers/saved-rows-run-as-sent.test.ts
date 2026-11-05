/**
 * A saved request runs as it sends — by protocol, by table.
 *
 * Every row here comes out of the real save path (`saveActiveRequestInPlace`
 * through the real update handlers) from the state the real editor store holds,
 * and is compared on the wire: the same store's real Send against the real
 * `runner:execute`, both hitting one local server. Nothing hand-seeds a request
 * shape, because that is how GraphQL survived: the Run tests seeded a JSON body
 * the GraphQL tab never writes, while the row it does write went out empty.
 *
 * The protocol list comes from `src/shared/request-protocols.ts` and from the
 * `Protocol` union, so a new protocol without a row here fails.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
} from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const { registerRequestHandlers } = await import('../../../src/main/ipc/request.handler')
const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')
const { registerEndpointHandlers } = await import('../../../src/main/ipc/endpoint.handler')
const { registerTestSuiteHandlers } = await import('../../../src/main/ipc/test-suite.handler')
const { RUNNABLE_PROTOCOLS, isRunnableProtocol } =
  await import('../../../src/shared/request-protocols')
const { saveActiveRequestInPlace } = await import('../../../src/renderer/lib/save-active-request')
const { useGraphQLStore } = await import('../../../src/renderer/stores/graphql.store')
const { useSoapStore } = await import('../../../src/renderer/stores/soap.store')
const { useRequestStore } = await import('../../../src/renderer/stores/request.store')
const { useEnvironmentStore } = await import('../../../src/renderer/stores/environment.store')
const { useResponseStore } = await import('../../../src/renderer/stores/response.store')
const { useTabsStore } = await import('../../../src/renderer/stores/tabs.store')
const { useWorkspaceStore } = await import('../../../src/renderer/stores/workspace.store')

interface Wire {
  method: string
  url: string
  headers: Record<string, string>
  body: string
}

let received: Wire[] = []
let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += String(c)))
    req.on('end', () => {
      const headers = { ...req.headers } as Record<string, string>
      received.push({ method: req.method ?? '', url: req.url ?? '', headers, body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const ok = (data: unknown): { success: true; data: unknown } => ({ success: true, data })

let workspaceId = ''
let projectId = ''
let suiteId = ''

function vars(): Record<string, string> {
  return {
    baseUrl: base,
    n: '42',
    token: 'tok-1',
    // Must stay a string once substituted: resolving AFTER the JSON is built breaks on it.
    who: 'R2"D2',
  }
}

beforeEach(() => {
  harness.reset()
  received = []
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  const now = Date.now()
  suiteId = crypto.randomUUID()
  testDb
    .prepare(
      `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, 'S', 0, ?, ?)`,
    )
    .run(suiteId, projectId, now, now)
  testDb
    .prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES ('env1', ?, ?, 'Dev', 1, ?, ?)`,
    )
    .run(workspaceId, projectId, now, now)
  for (const [k, v] of Object.entries(vars())) {
    testDb
      .prepare(
        `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
         VALUES (?, 'env1', ?, ?, 1, 0, NULL)`,
      )
      .run(`v-${k}`, k, v)
  }
  registerRequestHandlers()
  registerRunnerHandlers()
  registerEndpointHandlers()
  registerTestSuiteHandlers()

  // The renderer's side of both paths: the IPC goes straight to the main handler.
  const rowApi = (table: string, channel: string): Record<string, unknown> => ({
    get: async (id: string) =>
      ok(testDb.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)),
    update: (id: string, data: unknown) => harness.invoke(`${channel}:update`, id, data),
  })
  ;(globalThis as unknown as { window: unknown }).window = {
    dispatchEvent: () => true,
    api: {
      request: {
        send: (payload: unknown) => harness.invoke('request:send', payload),
        cancel: vi.fn(),
      },
      endpoint: rowApi('endpoints', 'endpoint'),
      savedRequest: rowApi('saved_requests', 'savedRequest'),
      testSuiteItem: rowApi('test_suite_items', 'testSuiteItem'),
      folder: { list: async () => ok([]) },
      settings: { get: async () => ok(undefined) },
    },
  }
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    globalVariables: [],
    environments: [
      {
        id: 'env1',
        name: 'Dev',
        variables: Object.entries(vars()).map(([key, value]) => ({
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

// ─── Rows ────────────────────────────────────────────────────────

type RowKind = 'endpoint' | 'savedRequest' | 'testSuiteItem'
const ROW_KINDS: RowKind[] = ['endpoint', 'savedRequest', 'testSuiteItem']

/** An empty row of the table, the way New Request leaves one; the save fills it. */
function emptyRow(kind: RowKind, protocol: string): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  if (kind === 'endpoint') {
    testDb
      .prepare(
        `INSERT INTO endpoints
          (id, project_id, folder_id, name, protocol, method, path, status,
           request_schema, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, 'R', ?, 'GET', '', 'developing', '{}', 0, ?, ?)`,
      )
      .run(id, projectId, protocol, now, now)
  } else if (kind === 'savedRequest') {
    testDb
      .prepare(
        `INSERT INTO saved_requests
          (id, project_id, folder_id, name, protocol, method, url, created_at, updated_at)
         VALUES (?, ?, NULL, 'R', ?, 'GET', '', ?, ?)`,
      )
      .run(id, projectId, protocol, now, now)
  } else {
    testDb
      .prepare(
        `INSERT INTO test_suite_items
          (id, suite_id, folder_id, protocol, name, method, url, request_schema, assertions,
           sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, ?, 'R', 'GET', '', '{}', '[]', 0, ?, ?)`,
      )
      .run(id, suiteId, protocol, now, now)
  }
  return id
}

/** Open the row in a tab, like a tree click: every store switches to that tab. */
function openTab(kind: RowKind, protocol: string, rowId: string): void {
  const tabId = `tab-${rowId}`
  useTabsStore.setState({
    tabs: [
      {
        id: tabId,
        name: 'R',
        protocol,
        method: 'POST',
        url: '',
        isDirty: true,
        ...(kind === 'endpoint' ? { endpointId: rowId } : {}),
        ...(kind === 'savedRequest' ? { savedRequestId: rowId } : {}),
        ...(kind === 'testSuiteItem' ? { testSuiteItemId: rowId } : {}),
      } as never,
    ],
    activeTabId: tabId,
  })
  useRequestStore.getState().switchToTab(tabId)
  useGraphQLStore.getState().switchToTab(tabId)
  useSoapStore.getState().switchToTab(tabId)
}

const header = (key: string, value: string, enabled = true): Record<string, unknown> => ({
  id: key,
  key,
  value,
  enabled,
})

interface Scenario {
  /** Puts the editor in the state a user typed. */
  fill: () => void
  send: () => Promise<void>
  /** What must be on the wire, so an empty body on both paths cannot pass. */
  sentMatches: (w: Wire) => void
}

function graphqlScenario(): Scenario {
  return {
    fill: () => {
      useGraphQLStore.setState({
        url: '{{baseUrl}}/graphql?trace={{n}}',
        query: 'query Q($n: Int) { hero(name: "{{who}}", n: $n) { id } }',
        variables: '{"n": {{n}}, "label": "{{token}}"}',
        headers: [
          header('Authorization', 'Bearer {{token}}'),
          header('X-Off', 'no', false),
        ] as never,
        withheldCredentials: [],
      })
    },
    send: () => useGraphQLStore.getState().executeQuery(),
    sentMatches: (w) => {
      expect(w.method).toBe('POST')
      expect(w.url).toBe('/graphql?trace=42')
      expect(w.headers.authorization).toBe('Bearer tok-1')
      expect(w.headers['x-off']).toBeUndefined()
      expect(w.headers['content-type']).toMatch(/application\/json/)
      expect(JSON.parse(w.body)).toEqual({
        query: 'query Q($n: Int) { hero(name: "R2"D2", n: $n) { id } }',
        variables: { n: 42, label: 'tok-1' },
      })
    },
  }
}

function soapScenario(): Scenario {
  const xml = (n: string): string =>
    `<soapenv:Envelope xmlns:soapenv="http://www.w3.org/2003/05/soap-envelope"><soapenv:Body><Add><a>${n}</a></Add></soapenv:Body></soapenv:Envelope>`
  return {
    fill: () => {
      useRequestStore.setState({
        method: 'POST',
        headers: [header('X-Custom', '{{n}}')] as never,
        auth: { type: 'none' } as never,
        withheldCredentials: [],
      })
      useSoapStore.setState({
        ...useSoapStore.getState(),
        parsedWsdl: null,
        selectedService: null,
        selectedPort: null,
        selectedOperation: null,
        mode: 'manual',
        rawXml: xml('{{n}}'),
        endpointUrl: '{{baseUrl}}/soap',
        manualSoapAction: 'urn:Add',
        manualSoapVersion: 'soap12',
        withheldCredentials: [],
        wsSecurity: { enabled: false, modes: [] } as never,
      })
    },
    send: () => useSoapStore.getState().sendSoap(),
    sentMatches: (w) => {
      expect(w.url).toBe('/soap')
      expect(w.body).toBe(xml('42'))
      expect(w.headers['content-type']).toContain('application/soap+xml')
      expect(w.headers['content-type']).toContain('urn:Add')
      expect(w.headers['x-custom']).toBe('42')
    },
  }
}

function httpScenario(): Scenario {
  return {
    fill: () => {
      useRequestStore.setState({
        method: 'PUT',
        url: '{{baseUrl}}/http',
        params: [header('q', '{{n}}'), header('off', 'x', false)] as never,
        headers: [header('X-Custom', '{{n}}'), header('X-Off', 'no', false)] as never,
        body: { type: 'json', content: '{"who":"{{n}}"}' } as never,
        auth: { type: 'bearer', bearer: { token: '{{token}}' } } as never,
        preScript: '',
        postScript: '',
        assertions: [],
        withheldCredentials: [],
      })
    },
    send: () => useRequestStore.getState().sendRequest(),
    sentMatches: (w) => {
      expect(w.method).toBe('PUT')
      expect(w.url).toBe('/http?q=42')
      expect(w.body).toBe('{"who":"42"}')
      expect(w.headers.authorization).toBe('Bearer tok-1')
      expect(w.headers['x-custom']).toBe('42')
      expect(w.headers['x-off']).toBeUndefined()
    },
  }
}

/** Every runnable protocol: a wire comparison, or where its own parity test lives. */
const RUNNABLE: Record<string, { scenario: () => Scenario } | { coveredBy: string }> = {
  http: { scenario: httpScenario },
  https: { scenario: httpScenario },
  rest: { scenario: httpScenario },
  '': { scenario: httpScenario },
  graphql: { scenario: graphqlScenario },
  soap: { scenario: soapScenario },
  // Not HTTP on the wire; Send and Run share `src/shared/mcp-call.ts`.
  mcp: { coveredBy: 'tests/main/shared/mcp-call-parity.test.ts' },
}

/** Members of the `Protocol` union that are editors or views, not requests. */
const NOT_A_REQUEST = new Set(['runner', 'mockServer', 'mockMcpServer', 'example'])
const isRequestProtocol = (p: string): boolean => !NOT_A_REQUEST.has(p) && !p.startsWith('tools.')

function protocolUnion(): string[] {
  const types = readFileSync(join(__dirname, '../../../src/renderer/types/index.ts'), 'utf8')
  const block = /export type Protocol =([\s\S]*?)\n\n/.exec(types)?.[1] ?? ''
  return [...block.matchAll(/^\s*\|\s*'([^']+)'/gm)].map((m) => m[1])
}

// ─── The comparison ──────────────────────────────────────────────

async function sendFromEditor(scenario: Scenario): Promise<Wire> {
  const before = received.length
  await scenario.send()
  expect(useResponseStore.getState().response?.error).toBeUndefined()
  expect(received.length).toBe(before + 1)
  return received[received.length - 1]
}

async function runRow(id: string): Promise<Wire> {
  const before = received.length
  const res = (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    endpointIds: [id],
  })) as { success: boolean; data?: { results: Array<Record<string, unknown>> } }
  expect(res.success).toBe(true)
  expect(res.data?.results[0].error).toBeUndefined()
  expect(received.length).toBe(before + 1)
  return received[received.length - 1]
}

describe('the table covers every protocol', () => {
  it('has a row for every runnable protocol, and no row for one that is not', () => {
    expect(Object.keys(RUNNABLE).sort()).toEqual([...RUNNABLE_PROTOCOLS].sort())
  })

  it('reads a non-empty Protocol union (a renamed type must not empty the unsupported table)', () => {
    expect(protocolUnion()).toEqual(expect.arrayContaining(['http', 'graphql', 'websocket']))
  })

  for (const [protocol, row] of Object.entries(RUNNABLE)) {
    if ('coveredBy' in row) {
      it(`${protocol}: its parity test exists`, () => {
        expect(existsSync(join(__dirname, '../../..', row.coveredBy))).toBe(true)
      })
    }
  }
})

describe('a saved row sends the same bytes from Run as from Send', () => {
  for (const [protocol, row] of Object.entries(RUNNABLE)) {
    if (!('scenario' in row)) continue
    for (const kind of ROW_KINDS) {
      it(`${protocol || '(empty protocol)'} / ${kind}`, async () => {
        const scenario = row.scenario()
        const id = emptyRow(kind, protocol)
        openTab(kind, protocol, id)
        scenario.fill()

        const sent = await sendFromEditor(scenario)
        scenario.sentMatches(sent)

        expect(await saveActiveRequestInPlace()).toEqual({ success: true })

        const ran = await runRow(id)
        expect(ran).toEqual(sent)
      })
    }
  }
})

describe('a protocol the Runner cannot run says so', () => {
  const unsupported = (): string[] =>
    protocolUnion().filter((p) => isRequestProtocol(p) && !(p in RUNNABLE))

  it('every other request protocol is reported unsupported by the shared rule', () => {
    for (const p of unsupported()) expect(isRunnableProtocol(p), p).toBe(false)
    expect(unsupported().length).toBeGreaterThan(0)
  })

  for (const protocol of unsupported()) {
    it(`${protocol}: the saved row is skipped with a message, and nothing is sent`, async () => {
      const id = emptyRow('endpoint', protocol)
      openTab('endpoint', protocol, id)
      useRequestStore.setState({ url: `${base}/never` })
      await saveActiveRequestInPlace()

      const res = (await harness.invoke('runner:execute', {
        projectId,
        workspaceId,
        endpointIds: [id],
      })) as { data: { results: Array<{ error?: string; statusText?: string; skipped: number }> } }

      const step = res.data.results[0]
      expect(step.statusText).toBe('UNSUPPORTED')
      expect(step.skipped).toBe(1)
      expect(step.error).toBe(
        `Protocol "${protocol}" is not supported in the collection runner yet`,
      )
      expect(received).toEqual([])
    })
  }
})

describe('a GraphQL row and inherited auth', () => {
  function inFolderWithAuth(id: string): void {
    const folderId = crypto.randomUUID()
    testDb
      .prepare(
        `INSERT INTO folders (id, project_id, parent_id, name, sort_order, auth)
         VALUES (?, ?, NULL, 'F', 0, ?)`,
      )
      .run(
        folderId,
        projectId,
        JSON.stringify({ type: 'bearer', bearer: { token: 'folder-token' } }),
      )
    testDb.prepare('UPDATE endpoints SET folder_id = ? WHERE id = ?').run(folderId, id)
  }

  it('control: an HTTP row in that folder does inherit it', async () => {
    const id = emptyRow('endpoint', 'http')
    openTab('endpoint', 'http', id)
    useRequestStore.setState({
      method: 'GET',
      url: `${base}/control`,
      auth: { type: 'inherit' } as never,
      withheldCredentials: [],
    })
    expect(await saveActiveRequestInPlace()).toEqual({ success: true })
    inFolderWithAuth(id)

    expect((await runRow(id)).headers.authorization).toBe('Bearer folder-token')
  })

  it('the tab has no Auth section and Send sends none, so Run adds none from the folder', async () => {
    const scenario: Scenario = {
      fill: () => {
        useGraphQLStore.setState({
          url: `${base}/graphql`,
          query: '{ ping }',
          variables: '',
          headers: [] as never,
          withheldCredentials: [],
        })
      },
      send: () => useGraphQLStore.getState().executeQuery(),
      sentMatches: () => {},
    }
    const id = emptyRow('endpoint', 'graphql')
    openTab('endpoint', 'graphql', id)
    useRequestStore.setState({ auth: { type: 'inherit' } as never, withheldCredentials: [] })
    scenario.fill()

    const sent = await sendFromEditor(scenario)
    expect(sent.headers.authorization).toBeUndefined()
    expect(await saveActiveRequestInPlace()).toEqual({ success: true })
    inFolderWithAuth(id)

    expect(await runRow(id)).toEqual(sent)
  })
})

describe('a GraphQL run stays masked now that its headers and variables go out', () => {
  it('History keeps neither the Authorization value nor a credential-named variable', async () => {
    const id = emptyRow('endpoint', 'graphql')
    openTab('endpoint', 'graphql', id)
    const secret = 'Kq7-graphql-CANARY-71c2'
    useGraphQLStore.setState({
      url: `${base}/graphql`,
      query: '{ ping }',
      variables: JSON.stringify({ password: secret }),
      headers: [header('Authorization', `Bearer ${secret}`)] as never,
      withheldCredentials: [],
    })
    expect(await saveActiveRequestInPlace()).toEqual({ success: true })

    const wire = await runRow(id)
    expect(wire.headers.authorization).toBe(`Bearer ${secret}`)
    expect(JSON.parse(wire.body).variables.password).toBe(secret)

    const rows = testDb.prepare('SELECT * FROM history').all()
    expect(rows.length).toBeGreaterThan(0)
    expect(JSON.stringify(rows)).not.toContain(secret)
  })
})

describe('a saved GraphQL subscription', () => {
  it.each(ROW_KINDS)('%s: Run says why it cannot run and POSTs nothing', async (kind) => {
    const id = emptyRow(kind, 'graphql')
    openTab(kind, 'graphql', id)
    useGraphQLStore.setState({
      url: `${base}/graphql`,
      query: '# the feed\nsubscription Feed { tick }',
      variables: '',
      headers: [] as never,
      withheldCredentials: [],
    })
    expect(await saveActiveRequestInPlace()).toEqual({ success: true })

    const res = (await harness.invoke('runner:execute', {
      projectId,
      workspaceId,
      endpointIds: [id],
    })) as { success: boolean; data?: { results: Array<Record<string, unknown>> } }
    expect(res.success).toBe(true)

    expect(received).toEqual([])
    const row = res.data?.results[0] ?? {}
    expect(row.statusText).toBe('UNSUPPORTED')
    expect(row.skipped).toBe(1)
    expect(String(row.error)).toMatch(/subscriptions cannot run in the collection runner/i)
  })

  it.each(ROW_KINDS)('%s: clearing connection_init removes it from the saved row', async (kind) => {
    const table = { endpoint: 'endpoints', savedRequest: 'saved_requests', testSuiteItem: 'test_suite_items' }[kind]
    const row = (): string =>
      JSON.stringify(testDb.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id))
    const id = emptyRow(kind, 'graphql')
    openTab(kind, 'graphql', id)
    useGraphQLStore.setState({
      url: `${base}/graphql`,
      query: 'subscription { tick }',
      connectionInit: '{"tenant":"t-canary"}',
      withheldCredentials: [],
    })
    expect(await saveActiveRequestInPlace()).toEqual({ success: true })
    expect(row()).toContain('t-canary')

    useGraphQLStore.setState({ connectionInit: '' })
    expect(await saveActiveRequestInPlace()).toEqual({ success: true })
    expect(row()).not.toContain('t-canary')
    expect(row()).not.toContain('connectionInit')
  })

  it.each(ROW_KINDS)(
    '%s: a selected query in a mixed document runs, on Send and on Run',
    async (kind) => {
      const id = emptyRow(kind, 'graphql')
      openTab(kind, 'graphql', id)
      useGraphQLStore.setState({
        url: `${base}/graphql`,
        query: 'subscription Feed { tick }\nquery Now { now }',
        operationName: 'Now',
        variables: '',
        headers: [] as never,
        withheldCredentials: [],
      })
      expect(await saveActiveRequestInPlace()).toEqual({ success: true })
      const sent = await sendFromEditor({
        fill: () => {},
        send: () => useGraphQLStore.getState().executeQuery(),
        sentMatches: () => {},
      })
      const run = await runRow(id)
      expect(sent.body).toBe(
        '{"query":"subscription Feed { tick }\\nquery Now { now }","operationName":"Now","variables":{}}',
      )
      expect(run.body).toBe(sent.body)
    },
  )

  it.each(ROW_KINDS)('%s: a selected subscription in a mixed document is skipped', async (kind) => {
    const id = emptyRow(kind, 'graphql')
    openTab(kind, 'graphql', id)
    useGraphQLStore.setState({
      url: `${base}/graphql`,
      query: 'query Now { now }\nsubscription Feed { tick }',
      operationName: 'Feed',
      variables: '',
      headers: [] as never,
      withheldCredentials: [],
    })
    expect(await saveActiveRequestInPlace()).toEqual({ success: true })
    const res = (await harness.invoke('runner:execute', {
      projectId,
      workspaceId,
      endpointIds: [id],
    })) as { data?: { results: Array<Record<string, unknown>> } }
    expect(received).toEqual([])
    expect(res.data?.results[0].statusText).toBe('UNSUPPORTED')
    expect(res.data?.results[0].skipped).toBe(1)
  })

  it.each(ROW_KINDS)('%s: no selection in a mixed document runs the first one', async (kind) => {
    const id = emptyRow(kind, 'graphql')
    openTab(kind, 'graphql', id)
    useGraphQLStore.setState({
      url: `${base}/graphql`,
      query: 'query A { a }\nquery B { b }',
      operationName: '',
      variables: '',
      headers: [] as never,
      withheldCredentials: [],
    })
    expect(await saveActiveRequestInPlace()).toEqual({ success: true })
    expect(JSON.parse((await runRow(id)).body).operationName).toBe('A')
  })

  it.each(ROW_KINDS)('%s: one operation stays byte-identical, row and wire', async (kind) => {
    const table = {
      endpoint: 'endpoints',
      savedRequest: 'saved_requests',
      testSuiteItem: 'test_suite_items',
    }[kind]
    const id = emptyRow(kind, 'graphql')
    openTab(kind, 'graphql', id)
    useGraphQLStore.setState({
      url: `${base}/graphql`,
      query: 'query Only { only }',
      // A selection left from when the document had more: it is not written or sent.
      operationName: 'Only',
      variables: '{"a":1}',
      headers: [] as never,
      withheldCredentials: [],
    })
    expect(await saveActiveRequestInPlace()).toEqual({ success: true })
    expect(JSON.stringify(testDb.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id))).not.toContain(
      'operationName',
    )
    const sent = await sendFromEditor({
      fill: () => {},
      send: () => useGraphQLStore.getState().executeQuery(),
      sentMatches: () => {},
    })
    const run = await runRow(id)
    expect(sent.body).toBe('{"query":"query Only { only }","variables":{"a":1}}')
    expect(run.body).toBe(sent.body)
  })

  it('a selection the document lost: Send and Run both use the first, the row keeps nothing', async () => {
    const id = emptyRow('endpoint', 'graphql')
    openTab('endpoint', 'graphql', id)
    useGraphQLStore.setState({
      url: `${base}/graphql`,
      query: 'query A { a }\nquery C { c }',
      operationName: 'B',
      variables: '',
      headers: [] as never,
      withheldCredentials: [],
    })
    expect(await saveActiveRequestInPlace()).toEqual({ success: true })
    const stored = JSON.stringify(testDb.prepare('SELECT * FROM endpoints WHERE id = ?').get(id))
    expect(stored).not.toContain('operationName')
    const sent = await sendFromEditor({
      fill: () => {},
      send: () => useGraphQLStore.getState().executeQuery(),
      sentMatches: () => {},
    })
    expect(JSON.parse(sent.body).operationName).toBe('A')
    expect(JSON.parse((await runRow(id)).body).operationName).toBe('A')
  })

  it('a query whose text only mentions a subscription still runs', async () => {
    const id = emptyRow('endpoint', 'graphql')
    openTab('endpoint', 'graphql', id)
    useGraphQLStore.setState({
      url: `${base}/graphql`,
      query: 'query { subscription: ping } # subscription { tick }',
      variables: '',
      headers: [] as never,
      withheldCredentials: [],
    })
    expect(await saveActiveRequestInPlace()).toEqual({ success: true })
    expect((await runRow(id)).method).toBe('POST')
  })
})
