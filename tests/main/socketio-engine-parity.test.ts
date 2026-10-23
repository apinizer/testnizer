/**
 * Issue #283 — Socket.IO Postman parity in the engine, against a real
 * in-process socket.io server (no mocks):
 *   - handshake headers reach the server (they were never sent: the store
 *     dropped them before the engine ever saw them);
 *   - handshake path, polling-only transport, client version gate;
 *   - listen config filters from the first push (the connect-time `welcome`);
 *   - multiple arguments, binary arguments both ways, ack + ack timeout;
 *   - reconnection rows when the transport drops and retries are configured.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from 'node:http'
import { Server as SocketIOServer, type Socket } from 'socket.io'
import type { AddressInfo } from 'node:net'
import {
  socketIOConnect,
  socketIOEmitWire,
  socketIOSetEventCallback,
  socketIOSetListen,
  socketIODisconnectAll,
  type SocketIOClosedInfo,
  type SocketIOEvent,
} from '../../src/main/protocols/socketio.engine'

let io: SocketIOServer
let ioPath: SocketIOServer
let http: ReturnType<typeof createServer>
let httpPath: ReturnType<typeof createServer>
let port: number
let portPath: number
const sockets: Socket[] = []

async function waitFor(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

function wire(s: Socket): void {
  sockets.push(s)
  s.emit('welcome', { hello: s.handshake.headers['x-team'] ?? null })
  s.emit('noise', 1)
  s.on('ack-me', (...args: unknown[]) => {
    const cb = args.pop() as (...r: unknown[]) => void
    cb({ got: args.length }, 'second')
  })
  s.on('silent', () => {
    /* never acks */
  })
  s.on('multi', (...args: unknown[]) => s.emit('multi-echo', ...args))
  s.on('bin', (buf: Buffer) => s.emit('bin-echo', buf, Buffer.from([0xde, 0xad])))
}

beforeAll(async () => {
  http = createServer()
  io = new SocketIOServer(http)
  io.on('connection', wire)
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r))
  port = (http.address() as AddressInfo).port

  httpPath = createServer()
  ioPath = new SocketIOServer(httpPath, { path: '/custom-io' })
  ioPath.on('connection', wire)
  await new Promise<void>((r) => httpPath.listen(0, '127.0.0.1', r))
  portPath = (httpPath.address() as AddressInfo).port
})

afterAll(async () => {
  socketIODisconnectAll()
  // Polling keep-alive sockets would hold `close` open: drop them.
  for (const [server, srv] of [
    [io, http],
    [ioPath, httpPath],
  ] as const) {
    const done = new Promise<void>((r) => server.close(() => r()))
    srv.closeAllConnections()
    await done
  }
})

beforeEach(() => {
  socketIODisconnectAll()
  sockets.length = 0
})

const url = (): string => `http://127.0.0.1:${port}`

async function open(
  opts: Partial<Parameters<typeof socketIOConnect>[0]> = {},
): Promise<{ id: string; events: SocketIOEvent[] }> {
  const info = await socketIOConnect({ url: url(), ...opts })
  const events: SocketIOEvent[] = []
  socketIOSetEventCallback(info.connectionId, (e) => events.push(e))
  return { id: info.connectionId, events }
}

describe('handshake', () => {
  it('sends the handshake headers to the server', async () => {
    const { events } = await open({ extraHeaders: { 'X-Team': 'blue' } })
    await waitFor(() => events.some((e) => e.event === 'welcome'))
    expect(events.find((e) => e.event === 'welcome')?.data).toEqual({ hello: 'blue' })
  })

  it('uses the handshake path from the settings', async () => {
    const info = await socketIOConnect({
      url: `http://127.0.0.1:${portPath}`,
      settings: { path: '/custom-io' },
    })
    expect(info.connectionId).toMatch(/^sio-/)
  })

  it('connects over long-polling only when asked', async () => {
    const { events } = await open({ settings: { transport: 'polling' } })
    await waitFor(() => sockets.length === 1)
    expect(sockets[0].conn.transport.name).toBe('polling')
    await waitFor(() => events.some((e) => e.event === 'welcome'))
  })

  it('refuses client versions that are not bundled', async () => {
    await expect(open({ settings: { version: '3' } })).rejects.toThrow(/not available yet/)
  })

  it('a handshake that cannot finish in time fails with the timeout', async () => {
    // A server on the default path does not answer the custom one.
    await expect(
      open({ settings: { path: '/nowhere', handshakeTimeout: 300, transport: 'polling' } }),
    ).rejects.toThrow()
  })
})

describe('listen config', () => {
  it('forwards only listened events — from the connect-time push on', async () => {
    const { id, events } = await open({ listen: { all: false, events: ['noise'] } })
    await waitFor(() => events.some((e) => e.event === 'noise'))
    expect(events.some((e) => e.event === 'welcome')).toBe(false)

    socketIOSetListen(id, { all: true, events: [] })
    socketIOEmitWire(id, 'multi', [{ content: '1', contentType: 'json' }])
    await waitFor(() => events.some((e) => e.event === 'multi-echo'))
  })

  it('without a listen config every event is forwarded (pre-#283 callers)', async () => {
    const { events } = await open()
    await waitFor(
      () => events.some((e) => e.event === 'welcome') && events.some((e) => e.event === 'noise'),
    )
  })
})

describe('emit', () => {
  it('sends several arguments in their formats', async () => {
    const { id, events } = await open()
    socketIOEmitWire(id, 'multi', [
      { content: '{"a":1}', contentType: 'json' },
      { content: 'plain', contentType: 'text' },
      { content: '42', contentType: 'json' },
    ])
    await waitFor(() => events.some((e) => e.event === 'multi-echo'))
    const echo = events.find((e) => e.event === 'multi-echo')!
    expect(echo.args).toEqual([{ a: 1 }, 'plain', 42])
    const out = events.find((e) => e.direction === 'out')!
    expect(out.args).toEqual([{ a: 1 }, 'plain', 42])
  })

  it('sends binary arguments as binary and tags received binary for display', async () => {
    const { id, events } = await open()
    socketIOEmitWire(id, 'bin', [{ content: '01 02 ff', contentType: 'hex' }])
    await waitFor(() => events.some((e) => e.event === 'bin-echo'))
    const echo = events.find((e) => e.event === 'bin-echo')!
    expect(echo.args).toEqual([
      { $binary: 'AQL/', size: 3 },
      { $binary: '3q0=', size: 2 },
    ])
    expect(events.find((e) => e.direction === 'out')?.data).toEqual({ $binary: 'AQL/', size: 3 })
  })

  it('rejects an invalid JSON or hex argument before sending', async () => {
    const { id } = await open()
    expect(() => socketIOEmitWire(id, 'x', [{ content: '{', contentType: 'json' }])).toThrow(
      /Argument 1 is not valid JSON/,
    )
    expect(() => socketIOEmitWire(id, 'x', [{ content: 'zz', contentType: 'hex' }])).toThrow(
      /Argument 1: Invalid hexadecimal/,
    )
  })

  it('an ack emit gets the server reply as an ack row', async () => {
    const { id, events } = await open()
    socketIOEmitWire(id, 'ack-me', [{ content: 'x', contentType: 'text' }], { ack: true })
    await waitFor(() => events.some((e) => e.direction === 'ack'))
    const ack = events.find((e) => e.direction === 'ack')!
    expect(ack.event).toBe('ack-me')
    expect(ack.args).toEqual([{ got: 1 }, 'second'])
  })
})

describe('reconnection', () => {
  it('a dropped transport with retries configured reconnects and says so', async () => {
    const closed: SocketIOClosedInfo[] = []
    const { events } = await open({
      settings: { retryCount: 3, retryDelay: 50 },
      onClose: (c) => closed.push(c),
    })
    await waitFor(() => sockets.length === 1)
    sockets[0].conn.close()
    await waitFor(() => events.some((e) => e.event === 'reconnected'))
    expect(events.some((e) => e.direction === 'system' && e.event === 'reconnecting')).toBe(true)
    expect(closed).toEqual([])
  })

  it('a server kick never reconnects, even with retries configured', async () => {
    const closed: SocketIOClosedInfo[] = []
    await open({ settings: { retryCount: 3, retryDelay: 50 }, onClose: (c) => closed.push(c) })
    await waitFor(() => sockets.length === 1)
    sockets[0].disconnect(true)
    await waitFor(() => closed.length === 1)
    expect(closed[0].reason).toBe('io server disconnect')
  })
})
