/**
 * A document with several operations against a real server, from the real editor
 * store through the real handlers: `graphql-js` executes the POST and the real
 * `graphql-ws` server library executes the subscription, so the data that comes
 * back proves which operation ran. A server fed a two-operation document without a
 * name refuses it, so a dropped `operationName` cannot pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { WebSocketServer } from 'ws'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
} from './helpers'
import { startGqlWsFixture, type GqlWsFixture } from '../../helpers/graphql-ws-server'
import type { GqlWsEvent } from '../../../src/shared/graphql-ws'

// Both through CommonJS: `graphql-ws/lib/use/ws` requires `graphql`, and an ESM
// import here would be a second copy of it ("from another module or realm").
const cjs = createRequire(import.meta.url)
const { buildSchema, graphql } = cjs('graphql') as typeof import('graphql')
const { useServer } = cjs('graphql-ws/lib/use/ws') as typeof import('graphql-ws/lib/use/ws')

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
const { registerGraphqlWsHandlers } = await import('../../../src/main/ipc/graphql-ws.handler')
const { gqlWsDisconnectAll } = await import('../../../src/main/protocols/graphql-ws.engine')
const { saveActiveRequestInPlace } = await import('../../../src/renderer/lib/save-active-request')
const { useGraphQLStore } = await import('../../../src/renderer/stores/graphql.store')
const { useRequestStore } = await import('../../../src/renderer/stores/request.store')
const { useEnvironmentStore } = await import('../../../src/renderer/stores/environment.store')
const { useResponseStore } = await import('../../../src/renderer/stores/response.store')
const { useTabsStore } = await import('../../../src/renderer/stores/tabs.store')
const { useWorkspaceStore } = await import('../../../src/renderer/stores/workspace.store')

const schema = buildSchema(`
  type Query { first: String  second: String }
  type Subscription { one: String  two: String }
`)
const roots = {
  query: { first: () => 'ran first', second: () => 'ran second' },
  subscription: {
    one: async function* () {
      yield { one: 'ran one' }
    },
    two: async function* () {
      yield { two: 'ran two' }
    },
  },
}

const DOC = `query First { first }
query Second { second }
subscription One { one }
subscription Two { two }`

let server: http.Server
let dispose: () => Promise<void>
let base = ''
const fixtures: GqlWsFixture[] = []

async function waitFor(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const ok = (data: unknown): { success: true; data: unknown } => ({ success: true, data })
const state = () => useGraphQLStore.getState()

let projectId = ''
let workspaceId = ''
let endpointId = ''

beforeEach(async () => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  registerRequestHandlers()
  registerRunnerHandlers()
  registerEndpointHandlers()
  registerGraphqlWsHandlers()

  server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += String(c)))
    req.on('end', () => {
      const parsed = JSON.parse(body) as { query: string; operationName?: string }
      void graphql({
        schema,
        source: parsed.query,
        operationName: parsed.operationName,
        rootValue: roots.query,
      }).then((result) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      })
    })
  })
  const wss = new WebSocketServer({ server, path: '/graphql' })
  const disposable = useServer({ schema, roots }, wss)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  dispose = async () => {
    await disposable.dispose()
    await new Promise<void>((r) => server.close(() => r()))
  }
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/graphql`

  const listeners = new Set<(e: GqlWsEvent) => void>()
  const sender = {
    id: 11,
    send: (channel: string, payload: unknown) => {
      if (channel === 'graphqlWs:event') for (const cb of [...listeners]) cb(payload as GqlWsEvent)
    },
    on: () => {},
  }
  ;(globalThis as unknown as { window: unknown }).window = {
    dispatchEvent: () => true,
    api: {
      request: {
        send: (payload: unknown) => harness.invoke('request:send', payload),
        cancel: vi.fn(),
      },
      graphqlWs: {
        connect: (p: unknown) => harness.handlers.get('graphqlWs:connect')!({ sender }, p),
        disconnect: (id: string) => harness.handlers.get('graphqlWs:disconnect')!({ sender }, id),
        cancelConnect: (id: string) =>
          harness.handlers.get('graphqlWs:cancelConnect')!({ sender }, id),
        onEvent: (cb: (e: GqlWsEvent) => void) => {
          listeners.add(cb)
          return () => listeners.delete(cb)
        },
      },
      endpoint: {
        get: async (id: string) =>
          ok(testDb.prepare('SELECT * FROM endpoints WHERE id = ?').get(id)),
        update: (id: string, data: unknown) => harness.invoke('endpoint:update', id, data),
      },
      folder: { list: async () => ok([]) },
      settings: { get: async () => ok(undefined) },
    },
  }
  useEnvironmentStore.setState({
    ...useEnvironmentStore.getState(),
    globalVariables: [],
    environments: [],
    activeEnvironmentId: null,
  } as never)
  useResponseStore.setState({ response: null, isLoading: false })
  useWorkspaceStore.setState({ activeWorkspaceId: workspaceId, activeProjectId: projectId })

  endpointId = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'R', 'graphql', 'GET', '', 'developing', '{}', 0, ?, ?)`,
    )
    .run(endpointId, projectId, now, now)
  const tabId = `tab-${endpointId}`
  useTabsStore.setState({
    tabs: [
      {
        id: tabId,
        name: 'R',
        protocol: 'graphql',
        method: 'POST',
        url: '',
        isDirty: true,
        endpointId,
      } as never,
    ],
    activeTabId: tabId,
  })
  useRequestStore.getState().switchToTab(tabId)
  state().switchToTab(tabId)
  useGraphQLStore.setState({
    url: base,
    query: DOC,
    operationName: '',
    variables: '',
    headers: [] as never,
    withheldCredentials: [],
    subscriptionState: 'disconnected',
    subscriptionEvents: [],
    subscriptionError: null,
    subscriptionEnd: null,
    connectionId: null,
  })
})

afterEach(async () => {
  await state().unsubscribe()
  gqlWsDisconnectAll()
  await dispose()
  for (const f of fixtures.splice(0)) await f.close()
  testDb.close()
})

async function sendBody(): Promise<unknown> {
  await state().executeQuery()
  const response = useResponseStore.getState().response
  expect(response?.error).toBeUndefined()
  return JSON.parse(response?.body ?? 'null')
}

async function runBody(): Promise<Record<string, unknown>> {
  const res = (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    endpointIds: [endpointId],
  })) as { success: boolean; data?: { results: Array<Record<string, unknown>> } }
  expect(res.success).toBe(true)
  return res.data!.results[0]
}

describe('the HTTP path', () => {
  it('Send runs the selected query', async () => {
    useGraphQLStore.setState({ operationName: 'Second' })
    expect(await sendBody()).toEqual({ data: { second: 'ran second' } })
  })

  it('with nothing selected, Send runs the first; without a name the server would refuse', async () => {
    expect(await sendBody()).toEqual({ data: { first: 'ran first' } })

    const refused = await graphql({ schema, source: DOC, rootValue: roots.query })
    expect(refused.errors?.[0].message).toMatch(/must provide operation name/i)
  })

  it('Run sends the row exactly as saved by the editor', async () => {
    useGraphQLStore.setState({ operationName: 'Second' })
    expect(await saveActiveRequestInPlace()).toEqual({ success: true })
    const row = await runBody()
    expect(row.error).toBeUndefined()
    expect(row.status).toBe(200)
    expect(JSON.parse(String(row.responseBody ?? row.body))).toEqual({
      data: { second: 'ran second' },
    })
  })

  it('Run skips the row when its selected operation is a subscription', async () => {
    useGraphQLStore.setState({ operationName: 'One' })
    expect(await saveActiveRequestInPlace()).toEqual({ success: true })
    const row = await runBody()
    expect(row.statusText).toBe('UNSUPPORTED')
    expect(row.skipped).toBe(1)
  })
})

describe('the subscription path', () => {
  const dataFrames = (): string[] =>
    state()
      .subscriptionEvents.filter((e) => e.kind === 'data')
      .map((e) => e.data)

  it('Subscribe runs the selected subscription, not the first one', async () => {
    useGraphQLStore.setState({ operationName: 'Two' })
    await state().subscribe()
    expect(state().subscriptionError).toBeNull()
    await waitFor(() => dataFrames().length > 0)
    expect(JSON.parse(dataFrames()[0])).toEqual({ data: { two: 'ran two' } })
  })

  it('a selected query does not subscribe, and a selected subscription does not POST', async () => {
    const send = vi.spyOn(
      (window as unknown as { api: { request: { send: () => unknown } } }).api.request,
      'send',
    )
    useGraphQLStore.setState({ operationName: 'Second' })
    await state().subscribe()
    expect(state().subscriptionState).toBe('disconnected')
    expect(send).not.toHaveBeenCalled()

    useGraphQLStore.setState({ operationName: 'One' })
    await state().subscribe()
    await waitFor(() => dataFrames().length > 0)
    expect(JSON.parse(dataFrames()[0])).toEqual({ data: { one: 'ran one' } })
    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    ['graphql-transport-ws', 'transport' as const, 'subscribe'],
    ['graphql-ws', 'legacy' as const, 'start'],
  ])('%s carries the name in the operation frame', async (_protocol, choose, frame) => {
    const fixture = await startGqlWsFixture({ choose })
    fixtures.push(fixture)
    useGraphQLStore.setState({ url: fixture.url, operationName: 'Two' })
    await state().subscribe()
    expect(state().subscriptionError).toBeNull()
    expect((await fixture.waitForFrame(frame)).payload).toEqual({
      query: DOC,
      operationName: 'Two',
      variables: {},
    })
  })

  it('one subscription: the frame has no name, the same bytes as before', async () => {
    const fixture = await startGqlWsFixture({})
    fixtures.push(fixture)
    useGraphQLStore.setState({
      url: fixture.url,
      query: 'subscription One { one }',
      operationName: 'One',
    })
    await state().subscribe()
    expect((await fixture.waitForFrame('subscribe')).payload).toEqual({
      query: 'subscription One { one }',
      variables: {},
    })
  })

  it('leave while it runs: the tab keeps its operation and its stream', async () => {
    const fixture = await startGqlWsFixture({ streamEveryMs: 20 })
    fixtures.push(fixture)
    useGraphQLStore.setState({ url: fixture.url, operationName: 'Two' })
    const own = state()._currentTabId as string
    await state().subscribe()
    expect(state().subscriptionState).toBe('connected')

    state().switchToTab('another-tab')
    expect(state().operationName).toBe('')
    expect(state().subscriptionEvents).toEqual([])
    const countOnOwnTab = (): number => state()._tabStates.get(own)?.subscriptionEvents.length ?? 0
    const whenLeft = countOnOwnTab()
    await waitFor(() => countOnOwnTab() > whenLeft + 2)

    state().switchToTab(own)
    expect(state().operationName).toBe('Two')
    expect(state().subscriptionState).toBe('connected')
    expect(state().subscriptionEvents.length).toBeGreaterThan(whenLeft + 2)
    expect((await fixture.waitForFrame('subscribe')).payload).toMatchObject({
      operationName: 'Two',
    })
  })

  it('History keeps the selection in the sent snapshot and in `configured`', async () => {
    useGraphQLStore.setState({ operationName: 'Two' })
    await state().subscribe()
    const rows = testDb.prepare('SELECT request_snapshot FROM history').all() as Array<{
      request_snapshot: string
    }>
    const snapshot = JSON.parse(rows[rows.length - 1].request_snapshot) as {
      operationName?: string
      configured?: { meta?: { graphql?: { operationName?: string } } }
    }
    expect(snapshot.operationName).toBe('Two')
    expect(snapshot.configured?.meta?.graphql?.operationName).toBe('Two')
  })
})
