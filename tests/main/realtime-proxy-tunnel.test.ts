/**
 * What the tunnel has to keep from a direct connection: TLS (verification on and
 * off, a client certificate), reconnection (a new tunnel each time), and the
 * connection's own timeouts while the proxy keeps silent. Engines directly, against
 * real servers and a real CONNECT proxy. The handler battery is
 * `realtime-proxy.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import tls from 'node:tls'
import { WebSocketServer } from 'ws'
import { Server as SocketIOServer } from 'socket.io'
import { startConnectProxy, type ConnectProxy } from '../helpers/connect-proxy'
import { startGqlWsFixture } from '../helpers/graphql-ws-server'
import { startAedesBroker } from '../helpers/mqtt-aedes-broker'
import { startMqtt5StubBroker } from '../helpers/mqtt5-stub-broker'
import { getConnectionErrorInfo } from '../../src/main/lib/error-classifier'
import type { ResolvedProxy } from '../../src/main/lib/proxy-tunnel'

const sent: Array<[string, unknown]> = []
vi.mock('electron', () => {
  const win = {
    id: 1,
    isDestroyed: () => false,
    webContents: { send: (c: string, p: unknown) => sent.push([c, p]) },
  }
  return {
    BrowserWindow: {
      fromId: () => win,
      getAllWindows: () => [win],
      getFocusedWindow: () => null,
      fromWebContents: () => win,
    },
  }
})

const { gqlWsConnect, gqlWsDisconnectAll } =
  await import('../../src/main/protocols/graphql-ws.engine')
const ws = await import('../../src/main/protocols/websocket.engine')
const { socketIOConnect, socketIODisconnect, socketIODisconnectAll } =
  await import('../../src/main/protocols/socketio.engine')
const { mqttConnect, mqttDisconnect, mqttDisconnectAll, mqttIsConnected, mqttPublish } =
  await import('../../src/main/protocols/mqtt.engine')
const sse = await import('../../src/main/protocols/sse.engine')

const CERTS = join(__dirname, '../fixtures/certs')
const SERVER_TLS = {
  key: readFileSync(join(CERTS, 'selfsigned.key')),
  cert: readFileSync(join(CERTS, 'selfsigned.crt')),
}
const CLIENT_TLS = {
  cert: readFileSync(join(CERTS, 'client.crt')),
  key: readFileSync(join(CERTS, 'client.key')),
}
const noop = (): void => {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(pred: () => boolean, what: string, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`)
    await sleep(10)
  }
}
const portOf = (s: net.Server) => (s.address() as AddressInfo).port
const listen = (s: net.Server) => new Promise<void>((r) => s.listen(0, '127.0.0.1', r))

const cleanups: Array<() => unknown> = []
async function proxyAnswering(answer: Parameters<typeof startConnectProxy>[0] = 'tunnel') {
  const p = await startConnectProxy(answer)
  cleanups.push(() => p.close())
  return p
}
const via = (p: ConnectProxy): ResolvedProxy => ({ origin: p.origin })

afterEach(async () => {
  gqlWsDisconnectAll()
  ws.disconnectAll()
  socketIODisconnectAll()
  mqttDisconnectAll()
  sse.disconnectAll()
  for (const c of cleanups.splice(0).reverse()) await c()
  sent.length = 0
})

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run()
  } catch (e) {
    return e
  }
  throw new Error('expected the connection to fail')
}
const kindOf = (e: unknown) => getConnectionErrorInfo(e)?.kind

// ─── TLS ────────────────────────────────────────────────────────────────────

/** A self-signed HTTPS server that records whether the client showed a certificate. */
async function httpsServer(extra: https.ServerOptions = {}, handler?: http.RequestListener) {
  const server = https.createServer({ ...SERVER_TLS, ...extra }, handler)
  const peers: boolean[] = []
  server.on('secureConnection', (socket) => {
    socket.on('error', noop)
    peers.push(!!socket.getPeerCertificate()?.subject)
  })
  await listen(server)
  cleanups.push(() => {
    server.closeAllConnections()
    return new Promise<void>((r) => server.close(() => r()))
  })
  return { server, port: portOf(server), peers }
}

async function tlsTerminator(toPort: number, extra: tls.TlsOptions = {}) {
  const peers: boolean[] = []
  const server = tls.createServer({ ...SERVER_TLS, ...extra }, (socket) => {
    peers.push(!!socket.getPeerCertificate()?.subject)
    const plain = net.connect(toPort, '127.0.0.1')
    socket.pipe(plain).pipe(socket)
    socket.on('error', () => plain.destroy())
    plain.on('error', () => socket.destroy())
  })
  server.on('tlsClientError', noop)
  await listen(server)
  cleanups.push(() => new Promise<void>((r) => server.close(() => r())))
  return { port: portOf(server), peers }
}

describe('TLS inside the tunnel', () => {
  it('GraphQL: verification on and off, and a client certificate', async () => {
    const { server, port, peers } = await httpsServer({
      requestCert: true,
      rejectUnauthorized: false,
    })
    const fixture = await startGqlWsFixture({ server, path: '/graphql' })
    cleanups.push(() => fixture.close())
    const proxy = await proxyAnswering()
    const base = {
      url: `wss://127.0.0.1:${port}/graphql`,
      payload: { query: 'subscription { tick }', variables: {} },
      onEvent: noop,
      proxy: via(proxy),
    }
    const refused = await failure(() =>
      gqlWsConnect({ ...base, connectionId: 'a', rejectUnauthorized: true }),
    )
    // The server's certificate, not the proxy's fault.
    expect(kindOf(refused)).toBe('tls-untrusted')

    await gqlWsConnect({
      ...base,
      connectionId: 'b',
      rejectUnauthorized: false,
      tls: CLIENT_TLS,
    })
    expect(peers.at(-1)).toBe(true)
    expect(proxy.connects.every((c) => c.target === `127.0.0.1:${port}`)).toBe(true)
    expect(proxy.connects.length).toBe(2)
  })

  it('WebSocket: verification on and off', async () => {
    const { server, port } = await httpsServer()
    const wss = new WebSocketServer({ server })
    cleanups.push(() => wss.close())
    const proxy = await proxyAnswering()
    const url = `wss://127.0.0.1:${port}`
    const refused = await failure(() =>
      ws.connect({ url, rejectUnauthorized: true, proxy: via(proxy) }, 1),
    )
    expect(kindOf(refused)).toBe('tls-untrusted')
    await ws.connect({ url, rejectUnauthorized: false, proxy: via(proxy) }, 1)
    expect(proxy.connects.length).toBe(2)
  })

  it.each([
    ['4', 'websocket'],
    ['4', 'polling'],
    ['2', 'websocket'],
    ['2', 'polling'],
  ] as const)('Socket.IO v%s %s: verification on and off', async (version, transport) => {
    const { server, port } = await httpsServer()
    const io = new SocketIOServer(server, { allowEIO3: true })
    cleanups.push(() => io.close())
    const proxy = await proxyAnswering()
    const base = { url: `https://127.0.0.1:${port}`, proxy: via(proxy) }
    const refused = await failure(() =>
      socketIOConnect({ ...base, settings: { version, transport, strictSSL: true } }),
    )
    // Polling reports only "xhr poll error", with or without a proxy. The classifier
    // has the same words either way, and neither blames the proxy.
    const direct = await failure(() =>
      socketIOConnect({ url: base.url, settings: { version, transport, strictSSL: true } }),
    )
    expect(kindOf(refused)).toBe(kindOf(direct))
    expect(kindOf(refused)).toBe(transport === 'polling' ? 'unreachable' : 'tls-untrusted')
    const seen = proxy.connects.length
    expect(seen).toBeGreaterThan(0)
    await socketIOConnect({ ...base, settings: { version, transport, strictSSL: false } })
    expect(proxy.connects.length).toBeGreaterThan(seen)
  })

  it('MQTT over TLS: verification on and off, and a client certificate', async () => {
    const broker = await startAedesBroker()
    cleanups.push(() => broker.close())
    const { port, peers } = await tlsTerminator(broker.port, {
      requestCert: true,
      rejectUnauthorized: false,
    })
    const proxy = await proxyAnswering()
    const base = {
      url: `mqtts://127.0.0.1:${port}`,
      version: 4 as const,
      onEvent: noop,
      proxy: via(proxy),
    }
    const refused = await failure(() => mqttConnect({ ...base, settings: { strictSSL: true } }))
    expect(kindOf(refused)).toBe('tls-untrusted')
    await mqttConnect({
      ...base,
      settings: { strictSSL: false },
      tls: { cert: CLIENT_TLS.cert, key: CLIENT_TLS.key },
    })
    expect(peers.at(-1)).toBe(true)
    expect(proxy.connects.length).toBe(2)
  })

  it('MQTT over wss: verification on and off', async () => {
    const broker = await startAedesBroker()
    cleanups.push(() => broker.close())
    const { port } = await tlsTerminator(broker.wsPort)
    const proxy = await proxyAnswering()
    const base = {
      url: `wss://127.0.0.1:${port}`,
      version: 4 as const,
      onEvent: noop,
      proxy: via(proxy),
    }
    const refused = await failure(() => mqttConnect({ ...base, settings: { strictSSL: true } }))
    expect(kindOf(refused)).toBe('tls-untrusted')
    await mqttConnect({ ...base, settings: { strictSSL: false } })
    expect(proxy.connects.length).toBe(2)
  })

  it.each(['GET', 'POST'] as const)(
    'SSE %s: a server certificate problem names the server, not the proxy',
    async (method) => {
      const { port } = await httpsServer()
      const proxy = await proxyAnswering()
      const refused = await failure(() =>
        sse.connect(
          {
            url: `https://127.0.0.1:${port}/s`,
            method,
            ...(method === 'POST' ? { body: '{}' } : {}),
            proxy: via(proxy),
          },
          1,
        ),
      )
      expect(kindOf(refused)).toBe('tls-untrusted')
      expect(proxy.connects.length).toBe(1)
    },
  )
})

// ─── MQTT over TCP: what `mqtt.connect` would have done ─────────────────────

describe('MQTT over TCP keeps what `mqtt.connect` reads from the URL', () => {
  async function loginBroker() {
    const broker = await startAedesBroker({ auth: { username: 'ann', password: 'broker-pw' } })
    cleanups.push(() => broker.close())
    return broker
  }

  it('the login in the options', async () => {
    const broker = await loginBroker()
    const proxy = await proxyAnswering()
    await mqttConnect({
      url: broker.url,
      version: 4,
      username: 'ann',
      password: 'broker-pw',
      onEvent: noop,
      proxy: via(proxy),
    })
    expect(proxy.connects.length).toBe(1)
  })

  it('the login in the URL wins over the options', async () => {
    const broker = await loginBroker()
    const proxy = await proxyAnswering()
    await mqttConnect({
      url: `mqtt://ann:broker-pw@127.0.0.1:${broker.port}`,
      version: 4,
      username: 'someone-else',
      password: 'wrong',
      onEvent: noop,
      proxy: via(proxy),
    })
    expect(proxy.connects.length).toBe(1)
  })

  it('a wrong login is the broker answering, not the proxy', async () => {
    const broker = await loginBroker()
    const proxy = await proxyAnswering()
    const err = await failure(() =>
      mqttConnect({
        url: broker.url,
        version: 4,
        username: 'ann',
        password: 'wrong',
        onEvent: noop,
        proxy: via(proxy),
      }),
    )
    expect(kindOf(err)).not.toBe('proxy')
  })

  it('a `clientId` in the query wins over the options', async () => {
    const broker = await startAedesBroker()
    cleanups.push(() => broker.close())
    const proxy = await proxyAnswering()
    const info = await mqttConnect({
      url: `${broker.url}?clientId=from-url`,
      version: 4,
      clientId: 'from-options',
      onEvent: noop,
      proxy: via(proxy),
    })
    await mqttPublish(info.connectionId, {
      topic: 'who',
      content: 'me',
      contentType: 'text',
      qos: 1,
      retain: false,
    })
    await waitFor(() => broker.published.some((m) => m.topic === 'who'), 'the message')
    expect(broker.published.find((m) => m.topic === 'who')?.clientId).toBe('from-url')
  })

  it('MQTT 5 through the tunnel', async () => {
    const broker = await startMqtt5StubBroker()
    cleanups.push(() => broker.close())
    const proxy = await proxyAnswering()
    const info = await mqttConnect({
      url: broker.url,
      version: 5,
      onEvent: noop,
      proxy: via(proxy),
    })
    expect(info.reasonCode).toBe(0)
    expect(proxy.connects.length).toBe(1)
  })
})

// ─── Reconnection ───────────────────────────────────────────────────────────

describe('a reconnection opens a new tunnel', () => {
  it('GraphQL: the retry with the other subprotocol', async () => {
    const fixture = await startGqlWsFixture({ choose: 'first', legacyServerClose1002: true })
    cleanups.push(() => fixture.close())
    const proxy = await proxyAnswering()
    const info = await gqlWsConnect({
      connectionId: 'retry',
      url: fixture.wsUrl,
      payload: { query: 'subscription { tick }', variables: {} },
      onEvent: noop,
      proxy: via(proxy),
    })
    expect(info.protocol).toBe('graphql-ws')
    expect(proxy.connects.length).toBe(2)
  })

  async function wsServer() {
    const server = http.createServer()
    const wss = new WebSocketServer({ server })
    await listen(server)
    cleanups.push(async () => {
      for (const c of wss.clients) c.terminate()
      await new Promise<void>((r) => wss.close(() => r()))
      await new Promise<void>((r) => server.close(() => r()))
    })
    return { wss, url: `ws://127.0.0.1:${portOf(server)}` }
  }

  it('WebSocket: and Disconnect ends a reconnection the proxy keeps waiting', async () => {
    const { wss, url } = await wsServer()
    const proxy = await proxyAnswering()
    const info = await ws.connect({ url, retryCount: 5, retryDelay: 10, proxy: via(proxy) }, 1)
    expect(proxy.connects.length).toBe(1)

    for (const c of wss.clients) c.terminate()
    await waitFor(() => proxy.connects.length === 2 && wss.clients.size === 1, 'the new tunnel')

    proxy.answer = 'hang'
    for (const c of wss.clients) c.terminate()
    await waitFor(() => proxy.connects.length === 3, 'the CONNECT that hangs')
    ws.disconnect(info.connectionId)
    await waitFor(() => proxy.openSockets() === 0, 'the waiting socket to close')
  })

  it.each([
    ['4', 'websocket'],
    ['2', 'polling'],
  ] as const)(
    'Socket.IO v%s %s: and Disconnect ends a reconnection the proxy keeps waiting',
    async (version, transport) => {
      const server = http.createServer()
      const io = new SocketIOServer(server, { allowEIO3: true })
      await listen(server)
      cleanups.push(async () => {
        await io.close()
      })
      const proxy = await proxyAnswering()
      const info = await socketIOConnect({
        url: `http://127.0.0.1:${portOf(server)}`,
        settings: { version, transport, retryCount: 5, retryDelay: 10 },
        proxy: via(proxy),
      })
      const first = proxy.connects.length

      proxy.dropTunnels()
      await waitFor(() => proxy.connects.length > first, 'the new tunnel')
      await waitFor(() => io.sockets.sockets.size >= 1, 'the session to come back')

      proxy.answer = 'hang'
      const before = proxy.connects.length
      proxy.dropTunnels()
      await waitFor(() => proxy.connects.length > before, 'the CONNECT that hangs')
      socketIODisconnect(info.connectionId)
      await waitFor(() => proxy.openSockets() === 0, 'the waiting socket to close')
    },
  )

  it.each(['tcp', 'ws'] as const)(
    'MQTT over %s: and Disconnect ends a reconnection the proxy keeps waiting',
    async (kind) => {
      const broker = await startAedesBroker()
      cleanups.push(() => broker.close())
      const proxy = await proxyAnswering()
      const info = await mqttConnect({
        url: kind === 'tcp' ? broker.url : broker.wsUrl,
        version: 4,
        clientId: `reconnect-${kind}`,
        settings: { autoReconnect: true },
        onEvent: noop,
        proxy: via(proxy),
      })
      expect(proxy.connects.length).toBe(1)

      broker.dropClient(`reconnect-${kind}`)
      await waitFor(() => proxy.connects.length === 2, 'the new tunnel', 6000)

      proxy.answer = 'hang'
      await sleep(100)
      broker.dropClient(`reconnect-${kind}`)
      await waitFor(() => proxy.connects.length === 3, 'the CONNECT that hangs', 6000)
      mqttDisconnect(info.connectionId)
      await waitFor(() => proxy.openSockets() === 0, 'the waiting socket to close')
    },
    15_000,
  )

  it('MQTT over TCP: traffic flows on the new tunnel', async () => {
    const broker = await startAedesBroker()
    cleanups.push(() => broker.close())
    const proxy = await proxyAnswering()
    const info = await mqttConnect({
      url: broker.url,
      version: 4,
      settings: { autoReconnect: true },
      onEvent: noop,
      proxy: via(proxy),
    })
    proxy.dropTunnels()
    await waitFor(() => proxy.connects.length === 2, 'the new tunnel', 6000)
    await waitFor(() => mqttIsConnected(info.connectionId), 'the session', 6000)
    await mqttPublish(info.connectionId, {
      topic: 'again',
      content: 'second life',
      contentType: 'text',
      qos: 1,
      retain: false,
    })
    await waitFor(
      () => broker.published.some((m) => m.payload === 'second life'),
      'the broker to receive it',
    )
  }, 15_000)

  it('SSE: the library retry goes through the proxy again', async () => {
    let requests = 0
    const server = http.createServer((_req, res) => {
      requests += 1
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('retry: 20\ndata: hi\n\n')
    })
    await listen(server)
    cleanups.push(() => {
      server.closeAllConnections()
      return new Promise<void>((r) => server.close(() => r()))
    })
    const proxy = await proxyAnswering()
    await sse.connect({ url: `http://127.0.0.1:${portOf(server)}/s`, proxy: via(proxy) }, 1)
    await waitFor(() => requests === 1, 'the first request')
    proxy.dropTunnels()
    await waitFor(() => requests === 2, 'the retry')
    expect(proxy.connects.length).toBe(2)
  })
})

// ─── Timeouts ───────────────────────────────────────────────────────────────

describe("the connection's own timeout runs while the proxy keeps silent", () => {
  it('GraphQL', async () => {
    const proxy = await proxyAnswering('hang')
    const err = await failure(() =>
      gqlWsConnect({
        connectionId: 'slow',
        url: 'ws://192.0.2.1/graphql',
        payload: { query: 'subscription { tick }', variables: {} },
        onEvent: noop,
        handshakeTimeoutMs: 200,
        proxy: via(proxy),
      }),
    )
    expect(kindOf(err)).toBe('proxy')
    expect(getConnectionErrorInfo(err)?.target).toBe(`127.0.0.1:${proxy.port}`)
    await waitFor(() => proxy.openSockets() === 0, 'the socket to close')
  })

  it('WebSocket', async () => {
    const proxy = await proxyAnswering('hang')
    const err = await failure(() =>
      ws.connect({ url: 'ws://192.0.2.1/', handshakeTimeout: 200, proxy: via(proxy) }, 1),
    )
    expect(kindOf(err)).toBe('proxy')
    await waitFor(() => proxy.openSockets() === 0, 'the socket to close')
  })

  it.each(['4', '2'] as const)('Socket.IO v%s', async (version) => {
    const proxy = await proxyAnswering('hang')
    const err = await failure(() =>
      socketIOConnect({
        url: 'http://192.0.2.1',
        settings: { version, handshakeTimeout: 200 },
        proxy: via(proxy),
      }),
    )
    expect(kindOf(err)).toBe('proxy')
    await waitFor(() => proxy.openSockets() === 0, 'the socket to close')
  })

  it.each(['mqtt://192.0.2.1', 'ws://192.0.2.1'])('MQTT %s', async (url) => {
    const proxy = await proxyAnswering('hang')
    const err = await failure(() =>
      mqttConnect({
        url,
        version: 4,
        settings: { connectionTimeout: 200 },
        onEvent: noop,
        proxy: via(proxy),
      }),
    )
    expect(kindOf(err)).toBe('proxy')
    await waitFor(() => proxy.openSockets() === 0, 'the socket to close')
  })
})
