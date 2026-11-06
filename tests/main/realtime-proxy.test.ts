/**
 * The proxy setting on every realtime connection: GraphQL subscriptions, WebSocket,
 * Socket.IO (both clients, both transports), MQTT (TCP, TLS, WebSocket) and SSE (both
 * clients). One battery runs for each, through the real IPC handler with the real
 * engine, library, History repo and Console logger, a real CONNECT proxy and a real
 * server. Only Electron is stubbed.
 *
 * Fail-before: none of these connections took a proxy, so the proxy saw no CONNECT
 * and a hanging proxy had nothing to end.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import net from 'node:net'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import tls from 'node:tls'
import { WebSocketServer } from 'ws'
import { Server as SocketIOServer } from 'socket.io'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './handlers/helpers'
import { closedPort, startConnectProxy, type ConnectProxy } from '../helpers/connect-proxy'
import { startGqlWsFixture, type GqlWsFixture } from '../helpers/graphql-ws-server'
import { startAedesBroker, type AedesTestBroker } from '../helpers/mqtt-aedes-broker'

const harness = setupHandlerHarness()
const consoleEntries: unknown[] = []
const windowSends: Array<[string, unknown]> = []
const win = {
  id: 1,
  isDestroyed: () => false,
  webContents: {
    send: (ch: string, payload: unknown) => {
      if (ch === 'console:log') consoleEntries.push(payload)
      else windowSends.push([ch, payload])
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
const { registerWebSocketHandlers } = await import('../../src/main/ipc/websocket.handler')
const { registerSocketIOHandlers } = await import('../../src/main/ipc/socketio.handler')
const { registerMqttHandlers } = await import('../../src/main/ipc/mqtt.handler')
const { registerSseHandlers } = await import('../../src/main/ipc/sse.handler')
const { gqlWsDisconnectAll } = await import('../../src/main/protocols/graphql-ws.engine')
const { disconnectAll: wsDisconnectAll } = await import('../../src/main/protocols/websocket.engine')
const { socketIODisconnectAll } = await import('../../src/main/protocols/socketio.engine')
const { mqttDisconnectAll } = await import('../../src/main/protocols/mqtt.engine')
const { disconnectAll: sseDisconnectAll } = await import('../../src/main/protocols/sse.engine')

const CERTS = join(__dirname, '../fixtures/certs')
const key = readFileSync(join(CERTS, 'selfsigned.key'))
const cert = readFileSync(join(CERTS, 'selfsigned.crt'))

/** Every character that breaks a proxy URL or a careless header. */
const PASSWORD = 'pr0xy@canary:/%41-pass'
const USER = 'proxy-user'
const AUTH = { username: USER, password: PASSWORD }
const BASIC = Buffer.from(`${USER}:${PASSWORD}`, 'utf-8').toString('base64')
const TOKEN = 'through-the-tunnel-7f3a'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(pred: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`)
    await sleep(10)
  }
}

interface Res {
  success: boolean
  data?: { connectionId: string }
  error?: string
  errorInfo?: { kind?: string; message?: string; detail?: string; target?: string }
}

const senderSends: Array<[string, unknown]> = []
const senderListeners = new Map<string, (...a: unknown[]) => void>()
const sender = {
  id: 7,
  send: (c: string, p: unknown) => senderSends.push([c, p]),
  on: (e: string, l: (...a: unknown[]) => void) => void senderListeners.set(e, l),
}
const call = (channel: string, ...args: unknown[]) =>
  harness.handlers.get(channel)!({ sender }, ...args) as Promise<Res>
const delivered = () => JSON.stringify([...windowSends, ...senderSends])

// ─── Servers ────────────────────────────────────────────────────────────────

let gql: GqlWsFixture
let wsHttp: http.Server
let wss: WebSocketServer
let sioHttp: http.Server
let sio: SocketIOServer
let sioTransports: string[] = []
let broker: AedesTestBroker
let mqttTls: tls.Server
let sseServer: http.Server
let sseHeaders: http.IncomingHttpHeaders[] = []
const portOf = (s: net.Server) => (s.address() as AddressInfo).port
const listen = (s: net.Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', r))

beforeAll(async () => {
  gql = await startGqlWsFixture({ immediateEvents: 1 })

  wsHttp = http.createServer()
  wss = new WebSocketServer({ server: wsHttp })
  wss.on('connection', (socket) => socket.send(TOKEN))
  await listen(wsHttp)

  sioHttp = http.createServer()
  sio = new SocketIOServer(sioHttp, { allowEIO3: true })
  sio.on('connection', (socket) => {
    sioTransports.push(socket.conn.transport.name)
    socket.emit('greet', TOKEN)
  })
  await listen(sioHttp)

  broker = await startAedesBroker()
  mqttTls = tls.createServer({ key, cert }, (socket) => {
    const plain = net.connect(broker.port, '127.0.0.1')
    socket.pipe(plain).pipe(socket)
    socket.on('error', () => plain.destroy())
    plain.on('error', () => socket.destroy())
  })
  await listen(mqttTls)

  sseServer = http.createServer((req, res) => {
    sseHeaders.push(req.headers)
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(`data: ${TOKEN}\n\n`)
  })
  await listen(sseServer)
})

afterAll(async () => {
  await gql.close()
  for (const c of wss.clients) c.terminate()
  await new Promise<void>((r) => wss.close(() => r()))
  await new Promise<void>((r) => wsHttp.close(() => r()))
  await sio.close()
  await broker.close()
  await new Promise<void>((r) => mqttTls.close(() => r()))
  sseServer.closeAllConnections()
  await new Promise<void>((r) => sseServer.close(() => r()))
})

/**
 * A query holding the password under a name no rule covers, so only the value sweep
 * of this connection's secret list can take it out of what gets stored.
 */
let canaryQuery = ''

// ─── The protocols ──────────────────────────────────────────────────────────

interface Case {
  name: string
  target: () => string
  connect: (proxy: unknown, pendingId: string) => Promise<Res>
  cancel: (pendingId: string) => Promise<unknown>
  disconnect: (id: string) => Promise<unknown>
  /** Proof of a server's own bytes arriving. */
  flowed: () => Promise<void>
  /**
   * `eventsource`'s `close()` fires nothing, so this connect stays unanswered after
   * Cancel, with or without a proxy. The store has already moved on by then.
   */
  cancelLeavesConnectPending?: boolean
}

const tokenArrives = () => waitFor(() => delivered().includes(TOKEN), 'the server message')

const graphql: Case = {
  name: 'GraphQL subscription',
  target: () => `127.0.0.1:${gql.port}`,
  connect: (proxy, pendingId) =>
    call('graphqlWs:connect', {
      connectionId: pendingId,
      url: gql.wsUrl + canaryQuery,
      query: 'subscription { tick }',
      proxy,
    }),
  cancel: (id) => call('graphqlWs:cancelConnect', id),
  disconnect: (id) => call('graphqlWs:disconnect', id),
  flowed: () => waitFor(() => /"type":"data"/.test(delivered()), 'a subscription frame'),
}

const websocket: Case = {
  name: 'WebSocket',
  target: () => `127.0.0.1:${portOf(wsHttp)}`,
  connect: (proxy, pendingId) =>
    call('ws:connect', {
      url: `ws://127.0.0.1:${portOf(wsHttp)}${canaryQuery}`,
      proxy,
      _pendingId: pendingId,
    }),
  cancel: (id) => call('ws:cancelConnect', id),
  disconnect: (id) => call('ws:disconnect', id),
  flowed: tokenArrives,
}

function socketIoCase(version: '2' | '4', transport: 'polling' | 'websocket'): Case {
  return {
    name: `Socket.IO v${version} ${transport}`,
    target: () => `127.0.0.1:${portOf(sioHttp)}`,
    connect: (proxy, pendingId) =>
      call('socketio:connect', {
        url: `http://127.0.0.1:${portOf(sioHttp)}${canaryQuery}`,
        settings: { version, transport },
        proxy,
        _pendingId: pendingId,
      }),
    cancel: (id) => call('socketio:cancelConnect', id),
    disconnect: (id) => call('socketio:disconnect', id),
    flowed: async () => {
      await tokenArrives()
      expect(sioTransports.at(-1)).toBe(transport)
    },
  }
}

function mqttCase(name: string, url: () => string, port: () => number, extra = {}): Case {
  return {
    name,
    target: () => `127.0.0.1:${port()}`,
    connect: (proxy, pendingId) =>
      call('mqtt:connect', {
        url: url() + canaryQuery,
        version: 4,
        subscriptions: [{ topic: 'proxied/#', qos: 0 }],
        proxy,
        _pendingId: pendingId,
        ...extra,
      }),
    cancel: (id) => call('mqtt:cancelConnect', id),
    disconnect: (id) => call('mqtt:disconnect', id),
    // A round trip: what the broker receives is delivered back to the subscription.
    flowed: async () => {
      const connected = lastResult!.data!.connectionId
      await waitFor(() => delivered().includes('proxied/#'), 'the subscription')
      const pub = await call('mqtt:publish', connected, {
        topic: 'proxied/a',
        content: TOKEN,
        contentType: 'text',
        qos: 0,
        retain: false,
      })
      expect(pub.success, pub.error).toBe(true)
      await tokenArrives()
    },
  }
}

function sseCase(method: 'GET' | 'POST'): Case {
  return {
    name: method === 'GET' ? 'SSE (eventsource)' : 'SSE (streaming POST)',
    target: () => `127.0.0.1:${portOf(sseServer)}`,
    connect: (proxy, pendingId) =>
      call('sse:connect', {
        url: `http://127.0.0.1:${portOf(sseServer)}/s${canaryQuery}`,
        method,
        ...(method === 'POST' ? { body: '{}' } : {}),
        proxy,
        _pendingId: pendingId,
      }),
    cancel: (id) => call('sse:cancelConnect', id),
    disconnect: (id) => call('sse:disconnect', id),
    flowed: tokenArrives,
    cancelLeavesConnectPending: method === 'GET',
  }
}

let lastResult: Res | null = null
const CASES: Case[] = [
  graphql,
  websocket,
  socketIoCase('4', 'websocket'),
  socketIoCase('4', 'polling'),
  socketIoCase('2', 'websocket'),
  socketIoCase('2', 'polling'),
  mqttCase(
    'MQTT over TCP',
    () => broker.url,
    () => broker.port,
  ),
  mqttCase(
    'MQTT over TLS',
    () => `mqtts://127.0.0.1:${portOf(mqttTls)}`,
    () => portOf(mqttTls),
    { settings: { strictSSL: false } },
  ),
  mqttCase(
    'MQTT over WebSocket',
    () => broker.wsUrl,
    () => broker.wsPort,
  ),
  sseCase('GET'),
  sseCase('POST'),
]

// ─── The battery ────────────────────────────────────────────────────────────

const proxies: ConnectProxy[] = []
async function proxyAnswering(answer: Parameters<typeof startConnectProxy>[0]) {
  const p = await startConnectProxy(answer)
  proxies.push(p)
  return p
}
const stored = () => JSON.stringify(testDb.prepare('SELECT * FROM history').all())
const logged = () => JSON.stringify(consoleEntries)
function expectNoCredential(text: string): void {
  expect(text).not.toContain(PASSWORD)
  expect(text).not.toContain(encodeURIComponent(PASSWORD))
  expect(text).not.toContain(BASIC)
}
const everywhere = (res: Res) => [JSON.stringify(res), stored(), logged(), delivered()].join('\n')

let nextId = 0
const pendingId = () => `pending-${++nextId}`

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  consoleEntries.length = 0
  windowSends.length = 0
  senderSends.length = 0
  sioTransports = []
  sseHeaders = []
  lastResult = null
  registerGraphqlWsHandlers()
  registerWebSocketHandlers()
  registerSocketIOHandlers()
  registerMqttHandlers()
  registerSseHandlers()
})

afterEach(async () => {
  gqlWsDisconnectAll()
  wsDisconnectAll()
  socketIODisconnectAll()
  mqttDisconnectAll()
  sseDisconnectAll()
  await Promise.all(proxies.splice(0).map((p) => p.close()))
})

describe('the server never sees the proxy credential', () => {
  it.each([graphql, sseCase('GET'), sseCase('POST')])('$name', async (c) => {
    const proxy = await proxyAnswering('tunnel')
    gql.connections.length = 0
    const res = await c.connect(proxy.setting(AUTH), pendingId())
    expect(res.success, res.error).toBe(true)
    await c.flowed()
    const seen = c === graphql ? gql.connections.map((x) => x.headers) : sseHeaders
    expect(seen.length).toBeGreaterThan(0)
    for (const headers of seen) expect(headers['proxy-authorization']).toBeUndefined()
  })
})

describe('leaving a connection through the owning page going away', () => {
  it.each([graphql, CASES.find((c) => c.name === 'MQTT over TCP')!])('$name', async (c) => {
    const proxy = await proxyAnswering('hang')
    void c.connect(proxy.setting(AUTH), pendingId())
    await waitFor(() => proxy.connects.length > 0, 'the CONNECT')
    senderListeners.get('destroyed')?.()
    await waitFor(() => proxy.openSockets() === 0, 'the socket to close')
  })
})

describe.each(CASES)('$name with no proxy setting: the environment is not read', (c) => {
  const NAMES = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY']
  const ALL_NAMES = [...NAMES, ...NAMES.map((n) => n.toLowerCase())]
  let saved: Record<string, string | undefined>
  beforeEach(() => {
    saved = Object.fromEntries(ALL_NAMES.map((n) => [n, process.env[n]]))
    for (const n of ALL_NAMES) delete process.env[n]
  })
  afterEach(() => {
    for (const n of ALL_NAMES) {
      if (saved[n] === undefined) delete process.env[n]
      else process.env[n] = saved[n]
    }
  })

  it.each([undefined, { mode: 'system' as const }])(
    'setting %j goes straight to the server, as before this feature',
    async (setting) => {
      const proxy = await proxyAnswering('tunnel')
      process.env.HTTP_PROXY = proxy.origin
      process.env.HTTPS_PROXY = proxy.origin
      process.env.ALL_PROXY = proxy.origin
      const res = await c.connect(setting, pendingId())
      lastResult = res
      expect(res.success, res.error).toBe(true)
      expect(proxy.connects).toEqual([])
    },
  )
})

describe.each(CASES)('$name with the target on the bypass list', (c) => {
  it('goes straight to the server, and the proxy sees nothing', async () => {
    const proxy = await proxyAnswering('tunnel')
    const res = await c.connect(
      { ...proxy.setting(AUTH), bypass: 'localhost, 127.0.0.1' },
      pendingId(),
    )
    lastResult = res
    expect(res.success, res.error).toBe(true)
    expect(proxy.connects).toEqual([])
  })

  it('another entry on the list leaves it going through the proxy', async () => {
    const proxy = await proxyAnswering('tunnel')
    const res = await c.connect({ ...proxy.setting(AUTH), bypass: '*.internal' }, pendingId())
    lastResult = res
    expect(res.success, res.error).toBe(true)
    expect(proxy.connects.length).toBeGreaterThan(0)
  })
})

describe.each(CASES)('$name through the proxy', (c) => {
  it('asks the proxy for a tunnel with the credentials, and traffic flows', async () => {
    const proxy = await proxyAnswering('tunnel')
    const res = await c.connect(proxy.setting(AUTH), pendingId())
    lastResult = res
    expect(res.success, res.error).toBe(true)
    await c.flowed()

    expect(proxy.plainRequests).toEqual([])
    expect(proxy.connects.length).toBeGreaterThan(0)
    for (const seen of proxy.connects) {
      expect(seen.target).toBe(c.target())
      expect(seen.authorization).toBe(`Basic ${BASIC}`)
    }
    expectNoCredential(everywhere(res))
    await c.disconnect(res.data?.connectionId ?? '')
    await waitFor(() => proxy.openSockets() === 0, 'the tunnel to close')
    expectNoCredential(everywhere(res))
  })

  it('the password is in the secret list of History and the Console', async () => {
    const proxy = await proxyAnswering('tunnel')
    canaryQuery = `?note=${PASSWORD}&basic=${encodeURIComponent(BASIC)}&raw=${BASIC}`
    try {
      const res = await c.connect(proxy.setting(AUTH), pendingId())
      expect(res.success, res.error).toBe(true)
      await c.disconnect(res.data?.connectionId ?? '')
      await sleep(20)

      const failedProxy = await proxyAnswering('407')
      const failed = await c.connect(failedProxy.setting(AUTH), pendingId())
      expect(failed.success).toBe(false)
    } finally {
      canaryQuery = ''
    }
    expect(stored()).toContain('note=')
    for (const text of [stored(), logged()]) {
      expect(text).not.toContain(PASSWORD)
      expect(text).not.toContain(BASIC)
    }
  })

  it('sends no Proxy-Authorization for a proxy with no credentials', async () => {
    const proxy = await proxyAnswering('tunnel')
    const res = await c.connect(proxy.setting(), pendingId())
    expect(res.success, res.error).toBe(true)
    expect(proxy.connects[0].authorization).toBeUndefined()
  })

  it('"No proxy" goes straight to the server', async () => {
    const proxy = await proxyAnswering('tunnel')
    const res = await c.connect({ mode: 'none', host: '127.0.0.1', port: proxy.port }, pendingId())
    lastResult = res
    expect(res.success, res.error).toBe(true)
    await c.flowed()
    expect(proxy.connects).toEqual([])
    expect(proxy.openSockets()).toBe(0)
  })

  it('a 407 fails naming the proxy, with no credential anywhere', async () => {
    const proxy = await proxyAnswering('407')
    const res = await c.connect(proxy.setting(AUTH), pendingId())
    expect(res.success).toBe(false)
    expect(proxy.connects[0].authorization).toBe(`Basic ${BASIC}`)
    expect(res.errorInfo?.kind).toBe('proxy')
    expect(res.errorInfo?.detail).toMatch(/rejected the credentials/)
    expect(res.errorInfo?.target).toBe(`127.0.0.1:${proxy.port}`)
    expectNoCredential(everywhere(res))
  })

  it('a refused tunnel says so', async () => {
    const proxy = await proxyAnswering('502')
    const res = await c.connect(proxy.setting(AUTH), pendingId())
    expect(res.success).toBe(false)
    expect(res.errorInfo?.kind).toBe('proxy')
    expect(res.errorInfo?.detail).toMatch(/refused the tunnel/)
    expectNoCredential(everywhere(res))
  })

  it('a closed proxy port fails naming the proxy, not the server', async () => {
    const port = await closedPort()
    const res = await c.connect(
      { mode: 'custom', host: '127.0.0.1', port, auth: AUTH },
      pendingId(),
    )
    expect(res.success).toBe(false)
    expect(res.errorInfo?.kind).toBe('proxy')
    expect(res.errorInfo?.target).toBe(`127.0.0.1:${port}`)
    expect(res.error).not.toContain(c.target())
    expectNoCredential(everywhere(res))
  })

  it('Cancel while the proxy never answers leaves no socket', async () => {
    const proxy = await proxyAnswering('hang')
    const id = pendingId()
    let settled: Res | null = null
    const connecting = c.connect(proxy.setting(AUTH), id).then((r) => (settled = r))
    await waitFor(() => proxy.connects.length > 0, 'the CONNECT')
    await c.cancel(id)
    await waitFor(() => proxy.openSockets() === 0, 'the socket to close')
    if (!c.cancelLeavesConnectPending) {
      await connecting
      expect((settled as Res | null)?.success).toBe(false)
    }
    // Nothing retries behind the user's back.
    const seen = proxy.connects.length
    await sleep(400)
    expect(proxy.connects.length).toBe(seen)
    expect(proxy.openSockets()).toBe(0)
  })
})
