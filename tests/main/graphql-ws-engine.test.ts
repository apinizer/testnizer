/**
 * GraphQL subscriptions over WebSocket — real sockets on both ends, no mocked
 * `ws`. The first part drives the engine against a hand-written fixture for
 * each wire protocol and against the real `graphql-ws` server library. The last
 * part goes through the IPC handler with the real History repo and Console
 * logger; only Electron is stubbed.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { WebSocketServer } from 'ws'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './handlers/helpers'
import { startGqlWsFixture, type GqlWsFixture } from '../helpers/graphql-ws-server'
import {
  gqlWsConnect,
  gqlWsCancelConnect,
  gqlWsDisconnect,
  gqlWsDisconnectAll,
  gqlWsFailureOf,
  type GqlWsConnectOptions,
} from '../../src/main/protocols/graphql-ws.engine'
import { getConnectionErrorInfo } from '../../src/main/lib/error-classifier'
import type { GqlWsEvent } from '../../src/shared/graphql-ws'
import { toGraphqlWsUrl } from '../../src/shared/graphql-ws'

// Both through CommonJS: `graphql-ws/lib/use/ws` requires `graphql`, and an ESM
// import here would be a second copy of it ("from another module or realm").
const cjs = createRequire(import.meta.url)
const { buildSchema } = cjs('graphql') as typeof import('graphql')
const { useServer } = cjs('graphql-ws/lib/use/ws') as typeof import('graphql-ws/lib/use/ws')

const harness = setupHandlerHarness()
const consoleEntries: unknown[] = []
const win = {
  id: 1,
  isDestroyed: () => false,
  webContents: {
    send: (ch: string, payload: unknown) => {
      if (ch === 'console:log') consoleEntries.push(payload)
    },
  },
}
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [win],
    fromWebContents: () => win,
    fromId: () => win,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../src/main/db/database', () => ({ getDb: () => testDb }))

const { registerGraphqlWsHandlers } = await import('../../src/main/ipc/graphql-ws.handler')
const { setConsoleSecretSource } = await import('../../src/main/lib/console-logger')
const { loadSecretInventory } = await import('../../src/main/lib/sensitive-scrub')

const CERTS = join(__dirname, '../fixtures/certs')
const QUERY = 'subscription { tick }'
const PAYLOAD = { query: QUERY, variables: {} }

const fixtures: GqlWsFixture[] = []
async function fixture(opts: Parameters<typeof startGqlWsFixture>[0] = {}): Promise<GqlWsFixture> {
  const f = await startGqlWsFixture(opts)
  fixtures.push(f)
  return f
}

let nextId = 0
function options(url: string, over: Partial<GqlWsConnectOptions> = {}) {
  const events: GqlWsEvent[] = []
  const opts: GqlWsConnectOptions = {
    connectionId: `c${++nextId}`,
    url,
    payload: PAYLOAD,
    onEvent: (e) => events.push(e),
    ...over,
  }
  return { opts, events }
}

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const ofType = <T extends GqlWsEvent['type']>(events: GqlWsEvent[], type: T) =>
  events.filter((e): e is Extract<GqlWsEvent, { type: T }> => e.type === type)

async function failure(opts: GqlWsConnectOptions): Promise<Error> {
  try {
    await gqlWsConnect(opts)
  } catch (e) {
    return e as Error
  }
  throw new Error('connect was expected to fail')
}

afterEach(async () => {
  gqlWsDisconnectAll()
  for (const f of fixtures.splice(0)) await f.close()
})

describe('toGraphqlWsUrl', () => {
  it.each([
    ['http://h/graphql', 'ws://h/graphql'],
    ['https://h/graphql', 'wss://h/graphql'],
    ['HTTPS://h/graphql', 'wss://h/graphql'],
    ['ws://h/graphql', 'ws://h/graphql'],
    ['wss://h/graphql', 'wss://h/graphql'],
    ['localhost:4000/graphql', 'ws://localhost:4000/graphql'],
    ['  http://h  ', 'ws://h'],
    ['', ''],
  ])('%s → %s', (from, to) => {
    expect(toGraphqlWsUrl(from)).toBe(to)
  })
})

describe.each([
  {
    name: 'graphql-transport-ws',
    choose: 'transport' as const,
    start: 'subscribe',
    stop: 'complete',
  },
  { name: 'graphql-ws (legacy)', choose: 'legacy' as const, start: 'start', stop: 'stop' },
])('wire protocol $name', ({ name, choose, start, stop }) => {
  const protocol = name.split(' ')[0]

  it('offers both subprotocols, inits, gets the ack and starts the operation', async () => {
    const f = await fixture({ choose })
    const { opts } = options(f.wsUrl, { payload: { query: QUERY, variables: { room: 'a' } } })
    const info = await gqlWsConnect(opts)
    expect(info.protocol).toBe(protocol)
    expect(f.connections[0].headers['sec-websocket-protocol']).toBe(
      'graphql-transport-ws,graphql-ws',
    )
    expect(f.frames[0]).toEqual({ type: 'connection_init' })
    const startFrame = await f.waitForFrame(start)
    expect(startFrame.payload).toEqual({ query: QUERY, variables: { room: 'a' } })
    expect(typeof startFrame.id).toBe('string')
  })

  it('delivers data frames in order, as the frame payload', async () => {
    const f = await fixture({ choose, immediateEvents: 3 })
    const { opts, events } = options(f.wsUrl)
    await gqlWsConnect(opts)
    await waitFor(() => ofType(events, 'data').length === 3)
    expect(ofType(events, 'data').map((e) => JSON.parse(e.data))).toEqual([
      { data: { tick: 1 } },
      { data: { tick: 2 } },
      { data: { tick: 3 } },
    ])
  })

  it('a server error frame ends the subscription with its message', async () => {
    const f = await fixture({ choose, operationError: 'Cannot query field "nope"' })
    const { opts, events } = options(f.wsUrl)
    await gqlWsConnect(opts)
    await waitFor(() => ofType(events, 'ended').length === 1)
    expect(ofType(events, 'error')[0].message).toBe('Cannot query field "nope"')
    expect(ofType(events, 'error')[0].fatal).toBe(true)
    expect(ofType(events, 'ended')[0].reason).toBe('error')
    await waitFor(() => f.openCount() === 0)
  })

  it('a server complete ends the subscription and closes the socket', async () => {
    const f = await fixture({ choose, immediateEvents: 1, completeAfterEvents: true })
    const { opts, events } = options(f.wsUrl)
    await gqlWsConnect(opts)
    await waitFor(() => ofType(events, 'ended').length === 1)
    expect(ofType(events, 'ended')[0].reason).toBe('complete')
    expect(ofType(events, 'data')).toHaveLength(1)
    await waitFor(() => f.openCount() === 0)
  })

  it(`unsubscribe sends ${stop}, then closes with 1000`, async () => {
    const f = await fixture({ choose, streamEveryMs: 10 })
    const { opts, events } = options(f.wsUrl)
    await gqlWsConnect(opts)
    await waitFor(() => ofType(events, 'data').length > 0)
    const closed = new Promise<number>((r) => f.connections[0].socket.on('close', (c) => r(c)))

    expect(gqlWsDisconnect(opts.connectionId)).toBe(true)
    const stopFrame = await f.waitForFrame(stop)
    expect(stopFrame.id).toBe(f.frames.find((x) => x.type === start)?.id)
    if (protocol === 'graphql-ws') await f.waitForFrame('connection_terminate')
    expect(await closed).toBe(1000)
    // A close the user asked for is not reported back as the server ending it.
    expect(ofType(events, 'ended')).toHaveLength(0)
    expect(gqlWsDisconnect(opts.connectionId)).toBe(false)
  })

  it('no connection_ack within the timeout is a clear error, and the socket goes', async () => {
    const f = await fixture({ choose, noAck: true })
    const { opts } = options(f.wsUrl, { ackTimeoutMs: 100 })
    const err = await failure(opts)
    expect(err.message).toMatch(/no connection_ack/)
    expect(gqlWsFailureOf(err)?.reason).toBe('noAck')
    expect(getConnectionErrorInfo(err)?.kind).toBe('timeout')
    expect(err.message).toContain(`127.0.0.1:${f.port}`)
    await waitFor(() => f.openCount() === 0)
  })
})

describe('negotiation', () => {
  it('a server that returns no subprotocol gets a clear error', async () => {
    const f = await fixture({ choose: 'none' })
    const err = await failure(options(f.wsUrl).opts)
    expect(gqlWsFailureOf(err)?.reason).toBe('noSubprotocol')
    expect(err.message).toMatch(/did not choose a GraphQL subprotocol/)
  })

  it('a server that chooses an unknown subprotocol gets the same error', async () => {
    const f = await fixture({ choose: 'bogus' })
    const err = await failure(options(f.wsUrl).opts)
    expect(gqlWsFailureOf(err)?.reason).toBe('noSubprotocol')
  })

  it('an Apollo-style server on plain ws closes 1002 on the first offer: falls back to legacy once', async () => {
    // `ws`'s default picks the first subprotocol offered and
    // subscriptions-transport-ws then closes 1002 on anything but graphql-ws.
    const f = await fixture({ choose: 'first', legacyServerClose1002: true, immediateEvents: 1 })
    const { opts, events } = options(f.wsUrl)
    const info = await gqlWsConnect(opts)
    expect(info.protocol).toBe('graphql-ws')
    expect(f.connections).toHaveLength(2)
    await waitFor(() => ofType(events, 'data').length === 1)
  })
})

describe('close codes', () => {
  const meanings: Array<[number, RegExp]> = [
    [4400, /Invalid message/],
    [4401, /Unauthorized/],
    [4403, /Forbidden/],
    [4406, /Subprotocol not acceptable/],
    [4408, /Connection initialisation timeout/],
    [4409, /Subscriber already exists/],
    [4429, /Too many initialisation requests/],
  ]

  it.each(meanings)('%i before the ack: the message says what it means', async (code, meaning) => {
    const f = await fixture({ closeOnInit: { code } })
    const err = await failure(options(f.wsUrl).opts)
    expect(err.message).toMatch(meaning)
    expect(err.message).toContain(String(code))
    expect(gqlWsFailureOf(err)).toMatchObject({ reason: 'closed', closeCode: code })
  })

  it.each(meanings)('%i after the ack: the subscription ends with that code', async (code) => {
    const f = await fixture({ streamEveryMs: 10 })
    const { opts, events } = options(f.wsUrl)
    await gqlWsConnect(opts)
    f.closeAll(code, 'server says no')
    await waitFor(() => ofType(events, 'ended').length === 1)
    expect(ofType(events, 'ended')[0]).toMatchObject({
      reason: 'close',
      code,
      closeReason: 'server says no',
    })
  })

  it('a dropped connection ends the subscription with 1006', async () => {
    const f = await fixture({ streamEveryMs: 10 })
    const { opts, events } = options(f.wsUrl)
    await gqlWsConnect(opts)
    f.terminateAll()
    await waitFor(() => ofType(events, 'ended').length === 1)
    expect(ofType(events, 'ended')[0]).toMatchObject({ reason: 'close', code: 1006 })
    expect(gqlWsDisconnect(opts.connectionId)).toBe(false)
  })
})

describe('what the server receives', () => {
  it('the headers go on the handshake', async () => {
    const f = await fixture()
    await gqlWsConnect(
      options(f.wsUrl, { headers: { Authorization: 'Bearer hs', 'X-Tenant': 'acme' } }).opts,
    )
    expect(f.connections[0].headers.authorization).toBe('Bearer hs')
    expect(f.connections[0].headers['x-tenant']).toBe('acme')
  })

  it('the connection_init payload arrives, and only the init carries it', async () => {
    const f = await fixture()
    await gqlWsConnect(options(f.wsUrl, { connectionInit: { authToken: 'abc', n: 1 } }).opts)
    expect(f.connections[0].initPayload).toEqual({ authToken: 'abc', n: 1 })
    expect(f.frames[0]).toEqual({ type: 'connection_init', payload: { authToken: 'abc', n: 1 } })
  })

  it('answers a server ping with a pong carrying its payload', async () => {
    const f = await fixture({ pingAfterAck: true })
    await gqlWsConnect(options(f.wsUrl).opts)
    expect((await f.waitForFrame('pong')).payload).toEqual({ at: 'server' })
  })

  it('legacy keep-alive frames do not reach the event log', async () => {
    const f = await fixture({ choose: 'legacy', immediateEvents: 1 })
    const { opts, events } = options(f.wsUrl)
    await gqlWsConnect(opts)
    await waitFor(() => ofType(events, 'data').length === 1)
    expect(events.map((e) => e.type)).toEqual(['data'])
  })

  it('legacy connection_error is an init rejection with the server text', async () => {
    const f = await fixture({ choose: 'legacy', connectionError: { message: 'bad token' } })
    const err = await failure(options(f.wsUrl).opts)
    expect(gqlWsFailureOf(err)).toMatchObject({ reason: 'initRejected', serverText: 'bad token' })
    expect(err.message).toContain('bad token')
  })

  it('a frame it cannot read is reported and the subscription stays up', async () => {
    const f = await fixture({ streamEveryMs: 5 })
    const { opts, events } = options(f.wsUrl)
    await gqlWsConnect(opts)
    f.connections[0].socket.send('this is not json')
    await waitFor(() => ofType(events, 'error').length === 1)
    expect(ofType(events, 'error')[0].fatal).toBe(false)
    expect(ofType(events, 'ended')).toHaveLength(0)
    const before = ofType(events, 'data').length
    await waitFor(() => ofType(events, 'data').length > before)
  })
})

describe('handshake failures', () => {
  it('a refused port is classified', async () => {
    const srv = net.createServer()
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const { port } = srv.address() as AddressInfo
    await new Promise<void>((r) => srv.close(() => r()))
    const err = await failure(options(`ws://127.0.0.1:${port}/graphql`).opts)
    expect(getConnectionErrorInfo(err)?.kind).toBe('refused')
  })

  it('an HTTP 401 on the upgrade is classified', async () => {
    const srv = http.createServer()
    srv.on('upgrade', (_req, socket) => {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const { port } = srv.address() as AddressInfo
    const err = await failure(options(`ws://127.0.0.1:${port}/graphql`).opts)
    expect(getConnectionErrorInfo(err)?.kind).toBe('unauthorized')
    await new Promise<void>((r) => srv.close(() => r()))
  })

  it('a silent server hits the handshake timeout, naming the time', async () => {
    const sockets: net.Socket[] = []
    const srv = net.createServer((s) => sockets.push(s))
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const { port } = srv.address() as AddressInfo
    const err = await failure(
      options(`ws://127.0.0.1:${port}/graphql`, { handshakeTimeoutMs: 100 }).opts,
    )
    expect(getConnectionErrorInfo(err)?.kind).toBe('timeout')
    expect(err.message).toContain('0.1s')
    for (const s of sockets) s.destroy()
    await new Promise<void>((r) => srv.close(() => r()))
  })

  it('cancelling while waiting for the ack rejects and closes the socket', async () => {
    const f = await fixture({ noAck: true })
    const { opts } = options(f.wsUrl)
    const pending = failure(opts)
    await waitFor(() => f.openCount() === 1)
    expect(gqlWsCancelConnect(opts.connectionId)).toBe(true)
    expect(getConnectionErrorInfo(await pending)?.kind).toBe('aborted')
    await waitFor(() => f.openCount() === 0)
    expect(gqlWsCancelConnect(opts.connectionId)).toBe(false)
  })

  it('an id already in use is refused', async () => {
    const f = await fixture()
    const { opts } = options(f.wsUrl)
    await gqlWsConnect(opts)
    const err = await failure({ ...opts })
    expect(err.message).toMatch(/already/)
    expect(f.connections).toHaveLength(1)
  })
})

describe('TLS', () => {
  async function tlsServer(extra: https.ServerOptions = {}) {
    const server = https.createServer({
      cert: readFileSync(join(CERTS, 'selfsigned.crt')),
      key: readFileSync(join(CERTS, 'selfsigned.key')),
      ...extra,
    })
    const peers: boolean[] = []
    server.on('upgrade', (req) => {
      const socket = req.socket as import('node:tls').TLSSocket
      peers.push(!!socket.getPeerCertificate()?.subject)
    })
    const f = await startGqlWsFixture({ server, path: '/graphql' })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    return {
      url: `wss://127.0.0.1:${port}/graphql`,
      peers,
      fixture: f,
      close: async () => {
        await f.close()
        await new Promise<void>((r) => server.close(() => r()))
      },
    }
  }

  it('verification on refuses a self-signed server, off connects', async () => {
    const s = await tlsServer()
    const err = await failure(options(s.url, { rejectUnauthorized: true }).opts)
    expect(getConnectionErrorInfo(err)?.kind).toBe('tls-untrusted')
    const info = await gqlWsConnect(options(s.url, { rejectUnauthorized: false }).opts)
    expect(info.protocol).toBe('graphql-transport-ws')
    gqlWsDisconnectAll()
    await s.close()
  })

  it('a client certificate reaches the server', async () => {
    const s = await tlsServer({
      requestCert: true,
      rejectUnauthorized: false,
    })
    const info = await gqlWsConnect(
      options(s.url, {
        rejectUnauthorized: false,
        tls: {
          cert: readFileSync(join(CERTS, 'client.crt')),
          key: readFileSync(join(CERTS, 'client.key')),
        },
      }).opts,
    )
    expect(info.protocol).toBe('graphql-transport-ws')
    expect(s.peers).toEqual([true])
    gqlWsDisconnectAll()
    await s.close()
  })
})

describe('against the real graphql-ws server library', () => {
  const schema = buildSchema(`
    type Query { hello: String }
    type Subscription { greetings(name: String): String }
  `)
  const roots = {
    subscription: {
      greetings: async function* (args: { name?: string }) {
        for (const hi of ['Hi', 'Hello']) yield { greetings: `${hi} ${args.name ?? 'you'}` }
      },
    },
  }

  async function realServer(
    hooks: Parameters<typeof useServer>[0] extends infer O ? Partial<O> : never = {},
  ) {
    const server = http.createServer()
    const wss = new WebSocketServer({ server, path: '/graphql' })
    const disposable = useServer({ schema, roots, ...hooks }, wss)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    return {
      url: `ws://127.0.0.1:${port}/graphql`,
      close: async () => {
        await disposable.dispose()
        await new Promise<void>((r) => server.close(() => r()))
      },
    }
  }

  it('negotiates, sends variables, gets every event and the server complete', async () => {
    const s = await realServer()
    const { opts, events } = options(s.url, {
      payload: {
        query: 'subscription S($name: String) { greetings(name: $name) }',
        variables: { name: 'Ada' },
      },
    })
    const info = await gqlWsConnect(opts)
    expect(info.protocol).toBe('graphql-transport-ws')
    await waitFor(() => ofType(events, 'ended').length === 1)
    expect(ofType(events, 'data').map((e) => JSON.parse(e.data).data.greetings)).toEqual([
      'Hi Ada',
      'Hello Ada',
    ])
    expect(ofType(events, 'ended')[0].reason).toBe('complete')
    await s.close()
  })

  it('hands the init payload and handshake header to the server', async () => {
    let seen: { params?: unknown; auth?: unknown } = {}
    const s = await realServer({
      onConnect: (ctx: {
        connectionParams?: unknown
        extra: { request: http.IncomingMessage }
      }) => {
        seen = {
          params: ctx.connectionParams,
          auth: ctx.extra.request.headers.authorization,
        }
        return true
      },
    } as never)
    const { opts, events } = options(s.url, {
      headers: { Authorization: 'Bearer real' },
      connectionInit: { token: 'real-init' },
    })
    await gqlWsConnect(opts)
    await waitFor(() => ofType(events, 'ended').length === 1)
    expect(seen).toEqual({ params: { token: 'real-init' }, auth: 'Bearer real' })
    await s.close()
  })

  it('a refused onConnect is a 4403 with its meaning', async () => {
    const s = await realServer({ onConnect: () => false } as never)
    const err = await failure(options(s.url).opts)
    expect(gqlWsFailureOf(err)?.closeCode).toBe(4403)
    expect(err.message).toMatch(/Forbidden/)
    await s.close()
  })

  it('a query the schema rejects is a server error event', async () => {
    const s = await realServer()
    const { opts, events } = options(s.url, {
      payload: { query: 'subscription { nope }', variables: {} },
    })
    await gqlWsConnect(opts)
    await waitFor(() => ofType(events, 'ended').length === 1)
    expect(ofType(events, 'error')[0].message).toMatch(/nope/)
    expect(ofType(events, 'ended')[0].reason).toBe('error')
    await s.close()
  })
})

describe('through the IPC handler: secrets, routing, lifetime', () => {
  const TOKEN = 'Kq7-header-CANARY-91ab'
  const INIT_SECRET = 'Zx2-init-CANARY-44de'
  const ENV_SECRET = 'Pw9-env-CANARY-77fa'

  beforeEach(() => {
    harness.reset()
    testDb = createTestDb()
    consoleEntries.length = 0
    registerGraphqlWsHandlers()
    // What `ipc/console.handler.ts` registers at startup.
    setConsoleSecretSource(() => loadSecretInventory(testDb).values)
    testDb
      .prepare(
        `INSERT INTO global_variables (id, workspace_id, project_id, key, value, initial_value, secret, enabled)
         VALUES ('g1', 'w1', NULL, 'envSecret', ?, '', 1, 1)`,
      )
      .run(ENV_SECRET)
  })
  afterAll(() => gqlWsDisconnectAll())

  interface Sender {
    id: number
    sent: Array<[string, unknown]>
    send: (c: string, p: unknown) => void
    listeners: Map<string, (...a: unknown[]) => void>
    on: (e: string, l: (...a: unknown[]) => void) => void
  }
  function sender(id = 7): Sender {
    const s: Sender = {
      id,
      sent: [],
      send: (c, p) => s.sent.push([c, p]),
      listeners: new Map(),
      on: (e, l) => void s.listeners.set(e, l),
    }
    return s
  }
  const connect = (s: Sender, payload: Record<string, unknown>) =>
    harness.handlers.get('graphqlWs:connect')!({ sender: s }, payload) as Promise<{
      success: boolean
      data?: { connectionId: string; protocol: string }
      error?: string
      failure?: { reason: string }
      errorInfo?: { message: string; detail?: string }
    }>
  const events = (s: Sender) =>
    s.sent.filter(([c]) => c === 'graphqlWs:event').map(([, p]) => p as GqlWsEvent)
  const stored = () => JSON.stringify(testDb.prepare('SELECT * FROM history').all())
  const logged = () => JSON.stringify(consoleEntries)

  function secretRequest(url: string, connectionId: string) {
    const init = JSON.stringify({
      deep: { nested: { apiKey: INIT_SECRET } },
      authToken: INIT_SECRET,
    })
    return {
      connectionId,
      url,
      headers: { Authorization: `Bearer ${TOKEN}`, 'X-Note': ENV_SECRET },
      query: QUERY,
      variables: JSON.stringify({ password: INIT_SECRET, note: ENV_SECRET }),
      connectionInit: init,
      _tabId: 'tab-a',
      _projectId: 'p1',
      _configured: {
        url,
        meta: {
          graphql: {
            url,
            query: QUERY,
            variables: '{"password":"{{pw}}"}',
            headers: [{ id: 'h', key: 'Authorization', value: `Bearer ${TOKEN}`, enabled: true }],
            connectionInit: init,
          },
        },
      },
    }
  }

  it('no canary in any History row or Console entry, on success with an echo server', async () => {
    const f = await fixture({ immediateEvents: 2, echoRequest: true })
    const s = sender()
    const res = await connect(s, secretRequest(f.url, 'ok-1'))
    expect(res.success, res.error).toBe(true)
    expect(res.data?.protocol).toBe('graphql-transport-ws')
    await waitFor(() => events(s).filter((e) => e.type === 'data').length === 2)
    // The live log shows what the server sent, secrets included: a live pane is not a sink.
    expect(JSON.stringify(events(s))).toContain(INIT_SECRET)
    await harness.handlers.get('graphqlWs:disconnect')!({ sender: s }, 'ok-1')

    const rows = testDb.prepare('SELECT * FROM history').all() as Array<{
      protocol: string
      status_code: number
      url: string
    }>
    expect(rows).toHaveLength(1)
    expect(rows[0].protocol).toBe('graphql')
    expect(rows[0].status_code).toBe(101)
    expect(rows[0].url).toBe(f.wsUrl)
    for (const canary of [TOKEN, INIT_SECRET, ENV_SECRET]) {
      expect(stored()).not.toContain(canary)
      expect(logged()).not.toContain(canary)
    }
    expect(consoleEntries.length).toBeGreaterThanOrEqual(3)
  })

  it('no canary on a failed connect, in History, Console or the error text', async () => {
    const f = await fixture({
      choose: 'legacy',
      connectionError: { message: `token ${INIT_SECRET} refused for ${ENV_SECRET}` },
    })
    const s = sender()
    const res = await connect(s, secretRequest(f.url, 'bad-1'))
    expect(res.success).toBe(false)
    expect(res.failure?.reason).toBe('initRejected')
    expect(res.error).toContain('refused')
    for (const canary of [TOKEN, INIT_SECRET, ENV_SECRET]) {
      expect(JSON.stringify(res)).not.toContain(canary)
      expect(stored()).not.toContain(canary)
      expect(logged()).not.toContain(canary)
    }
    const row = testDb.prepare('SELECT status_code FROM history').get() as { status_code: number }
    expect(row.status_code).toBe(-1)
  })

  it('no canary in a close reason or a server error sent to the renderer', async () => {
    const f = await fixture({ streamEveryMs: 50 })
    const s = sender()
    const res = await connect(s, secretRequest(f.url, 'close-1'))
    expect(res.success, res.error).toBe(true)
    f.closeAll(4403, `denied ${INIT_SECRET}`)
    await waitFor(() => events(s).some((e) => e.type === 'ended'))
    expect(JSON.stringify(events(s).filter((e) => e.type === 'ended'))).not.toContain(INIT_SECRET)
    expect(logged()).not.toContain(INIT_SECRET)
  })

  it('events reach the renderer that connected, tagged with the connection id', async () => {
    const f = await fixture({ immediateEvents: 1 })
    const a = sender(1)
    const b = sender(2)
    await connect(a, { connectionId: 'r-a', url: f.url, query: QUERY, variables: '{}' })
    await connect(b, { connectionId: 'r-b', url: f.url, query: QUERY, variables: '{}' })
    await waitFor(() => events(a).length === 1 && events(b).length === 1)
    expect(events(a)[0].connectionId).toBe('r-a')
    expect(events(b)[0].connectionId).toBe('r-b')
  })

  it.each(['destroyed', 'render-process-gone', 'did-start-navigation'])(
    'the renderer going away (%s) closes its sockets',
    async (signal) => {
      const f = await fixture({ streamEveryMs: 20 })
      const s = sender(40 + signal.length)
      await connect(s, {
        connectionId: `gone-${signal}`,
        url: f.url,
        query: QUERY,
        variables: '{}',
      })
      await waitFor(() => f.openCount() === 1)
      const listener = s.listeners.get(signal)!
      if (signal === 'did-start-navigation') listener({ isMainFrame: true, isSameDocument: false })
      else listener()
      await waitFor(() => f.openCount() === 0)
    },
  )

  it('malformed connection_init is refused before any socket opens', async () => {
    const f = await fixture()
    const res = await connect(sender(), {
      connectionId: 'bad-json',
      url: f.url,
      query: QUERY,
      variables: '{}',
      connectionInit: '[1,2',
    })
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/connection_init/)
    expect(f.connections).toHaveLength(0)
  })

  it('https:// maps to wss://: a TLS client against a plain server fails at TLS', async () => {
    const f = await fixture()
    const res = await connect(sender(), {
      connectionId: 'tls-url',
      url: `https://127.0.0.1:${f.port}/graphql`,
      query: QUERY,
      variables: '{}',
    })
    expect(res.success).toBe(false)
    expect(testDb.prepare('SELECT url FROM history').get()).toEqual({
      url: `wss://127.0.0.1:${f.port}/graphql`,
    })
  })

  it('a project client certificate for the host reaches a wss:// server', async () => {
    const server = https.createServer({
      cert: readFileSync(join(CERTS, 'selfsigned.crt')),
      key: readFileSync(join(CERTS, 'selfsigned.key')),
      requestCert: true,
      rejectUnauthorized: false,
    })
    const peers: boolean[] = []
    server.on('upgrade', (req) => {
      const socket = req.socket as import('node:tls').TLSSocket
      peers.push(!!socket.getPeerCertificate()?.subject)
    })
    const f = await startGqlWsFixture({ server, path: '/graphql' })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    testDb
      .prepare(
        `INSERT INTO certificates (id, project_id, kind, host, crt_path, key_path, enabled, created_at)
         VALUES ('c1', 'p1', 'client', '127.0.0.1', ?, ?, 1, 0)`,
      )
      .run(join(CERTS, 'client.crt'), join(CERTS, 'client.key'))

    const res = await connect(sender(), {
      connectionId: 'mtls',
      url: `wss://127.0.0.1:${port}/graphql`,
      query: QUERY,
      variables: '{}',
      sslVerification: false,
      _projectId: 'p1',
    })
    expect(res.success, res.error).toBe(true)
    expect(peers).toEqual([true])
    gqlWsDisconnectAll()
    await f.close()
    await new Promise<void>((r) => server.close(() => r()))
  })

  it('SSL verification on refuses the same self-signed server', async () => {
    const server = https.createServer({
      cert: readFileSync(join(CERTS, 'selfsigned.crt')),
      key: readFileSync(join(CERTS, 'selfsigned.key')),
    })
    const f = await startGqlWsFixture({ server, path: '/graphql' })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    const res = await connect(sender(), {
      connectionId: 'tls-on',
      url: `wss://127.0.0.1:${port}/graphql`,
      query: QUERY,
      variables: '{}',
      sslVerification: true,
    })
    expect(res.success).toBe(false)
    expect(res.errorInfo).toMatchObject({ kind: 'tls-untrusted' })
    await f.close()
    await new Promise<void>((r) => server.close(() => r()))
  })
})
