/**
 * Issue #283 follow-up — a Socket.IO request picks its client by the saved
 * version (`src/main/protocols/socketio-client.ts`): "2" → socket.io-client
 * 2.5 (EIO=3, v2 servers), "3" / "4" → socket.io-client 4. What differs
 * between the clients is mapped there and nowhere else; these cases pin the
 * differences, against a real in-process socket.io server that accepts both
 * protocols (`allowEIO3`, the documented v2-client compatibility path).
 *
 * The connect / emit / ack / multi-argument / binary / listen / reconnect /
 * kick battery runs for both clients in `socketio-engine-parity.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from 'node:http'
import { createServer as createTcpServer, type Server as TcpServer } from 'node:net'
import { Server as SocketIOServer, type Socket } from 'socket.io'
import type { AddressInfo } from 'node:net'
import {
  SIO_ACK_TIMEOUT_MS,
  SIO_CANCELLED_MESSAGE,
  socketIOCancelConnect,
  socketIOConnect,
  socketIODisconnectAll,
  socketIOEmitArgs,
  socketIOSetEventCallback,
  type SocketIOClosedInfo,
  type SocketIOEvent,
} from '../../src/main/protocols/socketio.engine'
import { SIO_ACK_TIMEOUT_MESSAGE, sioTarget } from '../../src/main/protocols/socketio-client'

let io: SocketIOServer
let http: ReturnType<typeof createServer>
let port: number
let silent: TcpServer
let silentPort: number
const silentConns: Array<{ destroy: () => void }> = []
const sockets: Socket[] = []

async function waitFor(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

beforeAll(async () => {
  http = createServer()
  io = new SocketIOServer(http, { allowEIO3: true })
  const track = (s: Socket): void => {
    sockets.push(s)
    s.on('silent', () => {
      /* never acks */
    })
  }
  io.on('connection', track)
  const chat = io.of('/chat')
  chat.use((s, next) => (s.handshake.query.deny ? next(new Error('not allowed here')) : next()))
  chat.on('connection', track)
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
  port = (http.address() as AddressInfo).port

  // Accepts TCP and never answers: a handshake that stays pending.
  silent = createTcpServer((c) => silentConns.push(c))
  await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r))
  silentPort = (silent.address() as AddressInfo).port
})

afterAll(async () => {
  socketIODisconnectAll()
  const done = new Promise<void>((r) => io.close(() => r()))
  http.closeAllConnections()
  await done
  for (const c of silentConns) c.destroy()
  await new Promise<void>((r) => silent.close(() => r()))
})

beforeEach(() => {
  socketIODisconnectAll()
  sockets.length = 0
})

const url = (): string => `http://127.0.0.1:${port}`

describe('the client follows the saved version', () => {
  it.each([
    ['2', 3],
    ['3', 4],
    ['4', 4],
  ] as const)('version "%s" speaks EIO=%i', async (version, eio) => {
    await socketIOConnect({ url: url(), settings: { version } })
    await waitFor(() => sockets.length === 1)
    expect(sockets[0].conn.protocol).toBe(eio)
  })
})

describe('handshake token', () => {
  it('v3 / v4 send it in the auth packet', async () => {
    await socketIOConnect({ url: url(), auth: { token: 's3cr3t-tok' }, settings: { version: '4' } })
    await waitFor(() => sockets.length === 1)
    expect(sockets[0].handshake.auth).toEqual({ token: 's3cr3t-tok' })
  })

  it('v2 has no auth packet: the token is the `token` query parameter', async () => {
    const info = await socketIOConnect({
      url: url(),
      auth: { token: 's3cr3t-tok' },
      settings: { version: '2' },
    })
    await waitFor(() => sockets.length === 1)
    expect(sockets[0].handshake.query.token).toBe('s3cr3t-tok')
    // Never in what the engine reports back (History / Console use it).
    expect(info.url).not.toContain('s3cr3t-tok')
  })

  it('v2 keeps both the URL params and the token (one query, not the URL replacing it)', async () => {
    await socketIOConnect({
      url: `${url()}/?team=blue&lang=tr`,
      auth: { token: 's3cr3t-tok' },
      settings: { version: '2' },
    })
    await waitFor(() => sockets.length === 1)
    expect(sockets[0].handshake.query).toMatchObject({
      team: 'blue',
      lang: 'tr',
      token: 's3cr3t-tok',
    })
  })
})

describe.each(['4', '2'] as const)('client v%s', (version) => {
  it('a namespace with URL params reaches the namespace, params intact', async () => {
    const info = await socketIOConnect({
      url: `${url()}?team=blue`,
      namespace: '/chat',
      settings: { version },
    })
    // A v2 client also joins `/` implicitly (2.x protocol), so look the
    // namespace socket up by name.
    await waitFor(() => sockets.some((s) => s.nsp.name === '/chat'))
    expect(sockets.find((s) => s.nsp.name === '/chat')?.handshake.query.team).toBe('blue')
    expect(info.namespace).toBe('/chat')
  })

  it("a namespace middleware's refusal fails the connect with its message", async () => {
    await expect(
      socketIOConnect({ url: `${url()}?deny=1`, namespace: '/chat', settings: { version } }),
    ).rejects.toThrow('not allowed here')
  })

  it('an unreachable server fails the connect with a message', async () => {
    await expect(
      socketIOConnect({ url: 'http://127.0.0.1:1', settings: { version } }),
    ).rejects.toThrow(/\w/)
  })

  it('a handshake that never completes fails with "timeout"', async () => {
    await expect(
      socketIOConnect({
        url: `http://127.0.0.1:${silentPort}`,
        settings: { version, handshakeTimeout: 200, transport: 'polling' },
      }),
    ).rejects.toThrow('timeout')
  })

  it('an ack that never arrives is reported with the same text', async () => {
    const info = await socketIOConnect({ url: url(), settings: { version } })
    const events: SocketIOEvent[] = []
    socketIOSetEventCallback(info.connectionId, (e) => events.push(e))
    socketIOEmitArgs(info.connectionId, 'silent', ['x'], { ack: true, ackTimeoutMs: 100 })
    await waitFor(() => events.some((e) => e.direction === 'ack'))
    expect(events.find((e) => e.direction === 'ack')).toMatchObject({
      event: 'silent',
      data: null,
      error: SIO_ACK_TIMEOUT_MESSAGE,
    })
    expect(SIO_ACK_TIMEOUT_MS).toBeGreaterThan(100)
  })

  it('Cancel ends a pending handshake: the connect rejects instead of hanging', async () => {
    const pending = socketIOConnect({
      url: `http://127.0.0.1:${silentPort}`,
      settings: { version, handshakeTimeout: 60_000, transport: 'polling' },
      pendingId: `cancel-${version}`,
    })
    await new Promise((r) => setTimeout(r, 50))
    expect(socketIOCancelConnect(`cancel-${version}`)).toBe(true)
    await expect(pending).rejects.toThrow(SIO_CANCELLED_MESSAGE)
    expect(socketIOCancelConnect(`cancel-${version}`)).toBe(false)
  })

  it('a transport that dies without reconnection configured is a close', async () => {
    const closed: SocketIOClosedInfo[] = []
    await socketIOConnect({ url: url(), settings: { version }, onClose: (c) => closed.push(c) })
    await waitFor(() => sockets.length === 1)
    sockets[0].conn.close()
    await waitFor(() => closed.length === 1)
    expect(closed[0].reason).toBe('transport close')
  })

  it('a retry interval of 0 reconnects at once (no 1 s floor)', async () => {
    const info = await socketIOConnect({
      url: url(),
      settings: { version, retryCount: 2, retryDelay: 0 },
    })
    const events: SocketIOEvent[] = []
    socketIOSetEventCallback(info.connectionId, (e) => events.push(e))
    await waitFor(() => sockets.length === 1)
    const dropped = Date.now()
    sockets[0].conn.close()
    await waitFor(() => events.some((e) => e.event === 'reconnected'))
    expect(Date.now() - dropped).toBeLessThan(700)
    expect(events.find((e) => e.event === 'reconnect_attempt')?.data).toBe(1)
  })
})

describe('sioTarget', () => {
  it('puts the namespace on the path and keeps the query apart', () => {
    expect(sioTarget('http://h:1/?a=1&b=two', '/chat')).toEqual({
      url: 'http://h:1/chat',
      search: 'a=1&b=two',
      query: { a: '1', b: 'two' },
    })
    expect(sioTarget('http://h:1/', '/')).toEqual({ url: 'http://h:1', search: '', query: {} })
    expect(sioTarget('http://h:1#frag', 'chat').url).toBe('http://h:1/chat')
  })
})
