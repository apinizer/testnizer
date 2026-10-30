/**
 * Issue #275 — a server-initiated Socket.IO disconnect was invisible: the
 * engine registered only once('connect') / once('connect_error') and onAny,
 * no 'disconnect' listener, so the connection stayed in the map, the UI stayed
 * "connected" and an emit on the dead connection went nowhere without an
 * error.
 *
 * Fail-before: `onClose` never fires, `socketIOGetInfo` still returns the
 * entry, emit does not throw. Real in-process socket.io server, no mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer } from 'node:http'
import { Server as SocketIOServer, type Socket } from 'socket.io'
import type { AddressInfo } from 'node:net'
import {
  socketIOConnect,
  socketIODisconnect,
  socketIOEmit,
  socketIOGetInfo,
  socketIODisconnectAll,
  socketIOSetEventCallback,
  type SocketIOClosedInfo,
  type SocketIOEvent,
} from '../../src/main/protocols/socketio.engine'

let ioServer: SocketIOServer
let httpServer: ReturnType<typeof createServer>
let port: number
const serverSockets: Socket[] = []

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

beforeAll(async () => {
  httpServer = createServer()
  ioServer = new SocketIOServer(httpServer, { cors: { origin: '*' } })
  ioServer.on('connection', (s: Socket) => {
    serverSockets.push(s)
    if (s.handshake.query.kick === 'now') s.disconnect(true)
  })
  await new Promise<void>((r) => httpServer.listen(0, '127.0.0.1', r))
  port = (httpServer.address() as AddressInfo).port
})

afterAll(async () => {
  socketIODisconnectAll()
  await new Promise<void>((r) => ioServer.close(() => r()))
})

beforeEach(() => {
  socketIODisconnectAll()
  serverSockets.length = 0
})

const url = (): string => `http://127.0.0.1:${port}`

describe('socketio.engine: server-initiated disconnect (issue #275)', () => {
  it('reports the close with its reason and drops the connection', async () => {
    const closed: SocketIOClosedInfo[] = []
    const info = await socketIOConnect({ url: url(), onClose: (c) => closed.push(c) })
    await waitFor(() => serverSockets.length === 1)
    expect(socketIOGetInfo(info.connectionId)).toBeDefined()

    serverSockets[0].disconnect(true)

    await waitFor(() => closed.length === 1)
    expect(closed[0]).toEqual({ connectionId: info.connectionId, reason: 'io server disconnect' })
    expect(socketIOGetInfo(info.connectionId)).toBeUndefined()
  })

  it('emit on the dead connection fails with "Not connected"', async () => {
    const closed: SocketIOClosedInfo[] = []
    const info = await socketIOConnect({ url: url(), onClose: (c) => closed.push(c) })
    await waitFor(() => serverSockets.length === 1)
    serverSockets[0].disconnect(true)
    await waitFor(() => closed.length === 1)

    expect(() => socketIOEmit(info.connectionId, 'hello', { a: 1 })).toThrow(/Not connected/)
  })

  it('a transport that dies without reconnection configured is a close too', async () => {
    const closed: SocketIOClosedInfo[] = []
    const info = await socketIOConnect({ url: url(), onClose: (c) => closed.push(c) })
    await waitFor(() => serverSockets.length === 1)
    // Cut the underlying connection without a Socket.IO disconnect packet.
    serverSockets[0].conn.close()
    await waitFor(() => closed.length === 1)
    expect(closed[0].connectionId).toBe(info.connectionId)
    expect(closed[0].reason).toMatch(/transport close|ping timeout|transport error/)
    expect(socketIOGetInfo(info.connectionId)).toBeUndefined()
  })

  it('a user disconnect reports nothing (no duplicate close)', async () => {
    const closed: SocketIOClosedInfo[] = []
    const info = await socketIOConnect({ url: url(), onClose: (c) => closed.push(c) })
    await waitFor(() => serverSockets.length === 1)
    socketIODisconnect(info.connectionId)
    await new Promise((r) => setTimeout(r, 200))
    expect(closed).toEqual([])
  })

  it('a kick right after the handshake is not missed', async () => {
    const closed: SocketIOClosedInfo[] = []
    const events: SocketIOEvent[] = []
    let info: { connectionId: string } | null = null
    try {
      info = await socketIOConnect({
        url: `${url()}?kick=now`,
        onClose: (c) => closed.push(c),
      })
      socketIOSetEventCallback(info.connectionId, (e) => events.push(e))
    } catch {
      // The kick may land before the client saw 'connect' — then connect
      // itself fails, which is the other correct outcome.
      return
    }
    await waitFor(() => closed.length === 1)
    expect(closed[0].connectionId).toBe(info.connectionId)
    expect(socketIOGetInfo(info.connectionId)).toBeUndefined()
  })
})
