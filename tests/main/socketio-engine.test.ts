/**
 * Integration tests for `src/main/protocols/socketio.engine.ts`.
 *
 * Strategy: spin up an in-process `socket.io` Server on a random port and
 * connect through the engine's real `socket.io-client`. No real network
 * required — deterministic, offline.
 *
 * Coverage:
 *   - connect resolves with SocketIOConnectionInfo
 *   - getInfo returns / clears correctly
 *   - emit delivers payload to the server
 *   - subscribe + callback receives server events
 *   - outbound emit fires callback with direction=out
 *   - unsubscribe stops further inbound events
 *   - error cases: emit/subscribe on unknown id, connect to closed port
 *   - connect-time push buffering: events arriving before the renderer attaches
 *     its callback are buffered and flushed in order (regression for the lost
 *     `welcome` event under load)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from 'node:http'
import { Server as SocketIOServer, type Socket } from 'socket.io'
import type { AddressInfo } from 'node:net'
import {
  socketIOConnect,
  socketIODisconnect,
  socketIOEmit,
  socketIOSubscribe,
  socketIOUnsubscribe,
  socketIOSetEventCallback,
  socketIOGetInfo,
  socketIODisconnectAll,
  type SocketIOEvent,
} from '../../src/main/protocols/socketio.engine'

// ─── Test server ──────────────────────────────────────────────
let ioServer: SocketIOServer
let serverPort: number
let httpServer: ReturnType<typeof createServer>

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

beforeAll(async () => {
  httpServer = createServer()
  ioServer = new SocketIOServer(httpServer, { cors: { origin: '*' } })

  // Echo server: re-emits every received event as 'echo' with original event name + data
  ioServer.on('connection', (socket: Socket) => {
    socket.onAny((event: string, data: unknown) => {
      socket.emit('echo', { event, data })
    })
  })

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  serverPort = (httpServer.address() as AddressInfo).port
})

afterAll(async () => {
  socketIODisconnectAll()
  await new Promise<void>((resolve) => ioServer.close(() => resolve()))
  await new Promise<void>((resolve) => httpServer.close(() => resolve()))
})

beforeEach(() => {
  socketIODisconnectAll()
})

const url = () => `http://127.0.0.1:${serverPort}`

// ─── connect / disconnect ─────────────────────────────────────
describe('socketio.engine — connect / disconnect', () => {
  it('resolves with SocketIOConnectionInfo on successful connect', async () => {
    const info = await socketIOConnect({ url: url() })
    expect(info.connectionId).toMatch(/^sio-/)
    expect(info.url).toBe(url())
    expect(info.namespace).toBe('/')
    socketIODisconnect(info.connectionId)
  })

  it('namespace defaults to / when not supplied', async () => {
    const info = await socketIOConnect({ url: url() })
    expect(info.namespace).toBe('/')
    socketIODisconnect(info.connectionId)
  })

  it('getInfo returns ConnectionInfo while connected', async () => {
    const info = await socketIOConnect({ url: url() })
    expect(socketIOGetInfo(info.connectionId)).toEqual(info)
    socketIODisconnect(info.connectionId)
  })

  it('getInfo returns undefined after disconnect', async () => {
    const info = await socketIOConnect({ url: url() })
    socketIODisconnect(info.connectionId)
    expect(socketIOGetInfo(info.connectionId)).toBeUndefined()
  })

  it('multiple concurrent connections get unique ids', async () => {
    const a = await socketIOConnect({ url: url() })
    const b = await socketIOConnect({ url: url() })
    expect(a.connectionId).not.toBe(b.connectionId)
    socketIODisconnect(a.connectionId)
    socketIODisconnect(b.connectionId)
  })

  it('rejects when connecting to a closed port', async () => {
    await expect(
      socketIOConnect({ url: 'http://127.0.0.1:1', }),
    ).rejects.toThrow()
  })
})

// ─── emit / subscribe / callback ─────────────────────────────
describe('socketio.engine — emit / subscribe / callback', () => {
  it('emit delivers payload to the server (confirmed via echo)', async () => {
    const received: SocketIOEvent[] = []
    const info = await socketIOConnect({ url: url() })
    socketIOSetEventCallback(info.connectionId, (evt) => received.push(evt))
    socketIOSubscribe(info.connectionId, 'echo')

    socketIOEmit(info.connectionId, 'ping', { msg: 'hello' })

    await waitFor(() => received.some((e) => e.direction === 'in' && e.event === 'echo'))
    const echo = received.find((e) => e.direction === 'in' && e.event === 'echo')!
    expect(echo.data).toMatchObject({ event: 'ping', data: { msg: 'hello' } })

    socketIODisconnect(info.connectionId)
  })

  it('outbound emit fires callback with direction=out', async () => {
    const outbound: SocketIOEvent[] = []
    const info = await socketIOConnect({ url: url() })
    socketIOSetEventCallback(info.connectionId, (evt) => {
      if (evt.direction === 'out') outbound.push(evt)
    })

    socketIOEmit(info.connectionId, 'greet', 'world')

    await waitFor(() => outbound.length > 0)
    expect(outbound[0].event).toBe('greet')
    expect(outbound[0].data).toBe('world')
    expect(typeof outbound[0].timestamp).toBe('number')

    socketIODisconnect(info.connectionId)
  })

  it('unsubscribe stops receiving the event', async () => {
    const inbound: SocketIOEvent[] = []
    const info = await socketIOConnect({ url: url() })
    socketIOSetEventCallback(info.connectionId, (evt) => {
      if (evt.direction === 'in') inbound.push(evt)
    })
    socketIOSubscribe(info.connectionId, 'echo')

    socketIOEmit(info.connectionId, 'first', 1)
    await waitFor(() => inbound.length >= 1)

    socketIOUnsubscribe(info.connectionId, 'echo')
    const countBefore = inbound.length

    socketIOEmit(info.connectionId, 'second', 2)
    await new Promise((r) => setTimeout(r, 150))
    expect(inbound.length).toBe(countBefore)

    socketIODisconnect(info.connectionId)
  })

  it('callback receives timestamp as a number', async () => {
    const events: SocketIOEvent[] = []
    const info = await socketIOConnect({ url: url() })
    socketIOSetEventCallback(info.connectionId, (evt) => events.push(evt))
    socketIOSubscribe(info.connectionId, 'echo')

    socketIOEmit(info.connectionId, 'ts-test', null)
    await waitFor(() => events.some((e) => e.direction === 'in'))
    expect(typeof events.find((e) => e.direction === 'in')!.timestamp).toBe('number')

    socketIODisconnect(info.connectionId)
  })
})

// ─── connect-time push buffering ──────────────────────────────
describe('socketio.engine — connect-time push buffering', () => {
  // Dedicated server that pushes events the instant a socket connects, then
  // echoes anything it receives. The engine connects before the renderer wires
  // its callback (the IPC roundtrip in the handler), so these pushes must be
  // buffered and replayed on `socketIOSetEventCallback`.
  let pushServer: SocketIOServer
  let pushHttp: ReturnType<typeof createServer>
  let pushPort: number

  beforeAll(async () => {
    pushHttp = createServer()
    pushServer = new SocketIOServer(pushHttp, { cors: { origin: '*' } })
    pushServer.on('connection', (socket: Socket) => {
      // Two ordered server-pushed events fired synchronously on connect.
      socket.emit('welcome', { id: socket.id })
      socket.emit('second', { n: 2 })
      socket.onAny((event: string, data: unknown) => {
        socket.emit('echo', { event, data })
      })
    })
    await new Promise<void>((resolve) => pushHttp.listen(0, '127.0.0.1', resolve))
    pushPort = (pushHttp.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => pushServer.close(() => resolve()))
    await new Promise<void>((resolve) => pushHttp.close(() => resolve()))
  })

  const pushUrl = () => `http://127.0.0.1:${pushPort}`

  it('buffers connect-time pushes and flushes them in order on late callback', async () => {
    const received: SocketIOEvent[] = []
    const info = await socketIOConnect({ url: pushUrl() })

    // Simulate the handler's IPC roundtrip latency: the server may have already
    // pushed `welcome`/`second` by the time the renderer wires its callback.
    await new Promise((r) => setTimeout(r, 150))

    socketIOSetEventCallback(info.connectionId, (evt) => received.push(evt))

    await waitFor(() => received.some((e) => e.event === 'second'))

    const inbound = received.filter((e) => e.direction === 'in')
    const welcomeIdx = inbound.findIndex((e) => e.event === 'welcome')
    const secondIdx = inbound.findIndex((e) => e.event === 'second')
    expect(welcomeIdx).toBeGreaterThanOrEqual(0)
    expect(secondIdx).toBeGreaterThan(welcomeIdx) // arrival order preserved

    socketIODisconnect(info.connectionId)
  })

  it('events after the callback is wired bypass the buffer (no double-delivery)', async () => {
    const received: SocketIOEvent[] = []
    const info = await socketIOConnect({ url: pushUrl() })
    await new Promise((r) => setTimeout(r, 150))

    socketIOSetEventCallback(info.connectionId, (evt) => received.push(evt))
    await waitFor(() => received.some((e) => e.event === 'second'))
    const countAfterFlush = received.length

    // A fresh inbound event (echo of our emit) must arrive exactly once.
    socketIOEmit(info.connectionId, 'ping', { msg: 'hi' })
    await waitFor(() => received.some((e) => e.direction === 'in' && e.event === 'echo'))

    const echoes = received.filter((e) => e.direction === 'in' && e.event === 'echo')
    expect(echoes).toHaveLength(1)
    expect(received.length).toBeGreaterThan(countAfterFlush)

    socketIODisconnect(info.connectionId)
  })
})

// ─── error cases ──────────────────────────────────────────────
describe('socketio.engine — error cases', () => {
  it('emit throws for an unknown connection id', () => {
    expect(() => socketIOEmit('does-not-exist', 'test', {})).toThrow(/Not connected/)
  })

  it('subscribe throws for an unknown connection id', () => {
    expect(() => socketIOSubscribe('does-not-exist', 'event')).toThrow(/Not connected/)
  })

  it('disconnect on unknown id is a no-op (no throw)', () => {
    expect(() => socketIODisconnect('ghost-id')).not.toThrow()
  })
})
