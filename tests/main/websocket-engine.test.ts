/**
 * Integration tests for the WebSocket engine (`src/main/protocols/websocket.engine.ts`).
 *
 * Strategy: stand up an in-process `ws` server on a random port, mock
 * `electron`'s BrowserWindow so we can capture the events the engine routes
 * back to the renderer, and exercise the full connect → send → receive →
 * disconnect lifecycle. No real network access required, so the suite is
 * deterministic and runs offline.
 *
 * Behavioural coverage:
 *   - connect resolves with WsConnectionInfo on `open` event
 *   - sendMessage delivers payload to the server
 *   - server-pushed text + JSON + binary frames produce the right
 *     `contentType` discrimination on the renderer event payload
 *   - server-initiated close propagates the close code/reason
 *   - disconnect() removes the connection from the active map and emits a
 *     close event with code 1000
 *   - sendMessage on an unknown id throws
 *   - getActiveConnections reports the right count across concurrent connections
 *   - connect() rejects on connection failure (bad URL)
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { WebSocketServer, WebSocket as WsClient } from 'ws'
import { AddressInfo } from 'net'

// ─── Mock electron BEFORE importing the engine ────────────────
const sentEvents: Array<{ channel: string; payload: any }> = []
const mockWin = {
  isDestroyed: () => false,
  webContents: {
    send: (channel: string, payload: unknown) => {
      sentEvents.push({ channel, payload })
    },
  },
}

vi.mock('electron', () => ({
  BrowserWindow: {
    fromId: (_id: number) => mockWin,
  },
}))

// Import AFTER vi.mock so the engine binds to the mocked electron.
import {
  connect,
  disconnect,
  sendMessage,
  getActiveConnections,
  getConnectionInfo,
  disconnectAll,
  describeWebSocketError,
} from '../../src/main/protocols/websocket.engine'

// ─── Test server fixture ──────────────────────────────────────
let server: WebSocketServer
let serverPort: number

/** Wait until the predicate returns true or `timeoutMs` elapses. */
async function waitFor(pred: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out')
    }
    await new Promise((r) => setTimeout(r, 10))
  }
}

beforeAll(async () => {
  server = new WebSocketServer({ port: 0 })
  await new Promise<void>((resolve) => server.on('listening', () => resolve()))
  serverPort = (server.address() as AddressInfo).port
})

afterAll(async () => {
  disconnectAll()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(async () => {
  // Drain any lingering connections + late events from previous tests so each
  // test starts from a clean slate.
  disconnectAll()
  await waitFor(() => getActiveConnections().length === 0).catch(() => undefined)
  sentEvents.length = 0
})

const wsUrl = () => `ws://127.0.0.1:${serverPort}`

describe('websocket.engine — connect / send / receive', () => {
  it('connects to an in-process server and emits an "open" event', async () => {
    const info = await connect({ url: wsUrl() }, 1)
    expect(info.connectionId).toBeTruthy()
    expect(info.url).toBe(wsUrl())
    expect(info.readyState).toBe(WsClient.OPEN)

    await waitFor(() => sentEvents.some((e) => (e.payload as any).type === 'open'))
    const open = sentEvents.find((e) => (e.payload as any).type === 'open')!
    expect(open.channel).toBe('ws:event')
    expect((open.payload as any).connectionId).toBe(info.connectionId)

    expect(disconnect(info.connectionId)).toBe(true)
  })

  it('sendMessage delivers a payload that is observable on the server', async () => {
    const received: string[] = []
    const onConn = (sock: WsClient): void => {
      sock.on('message', (data) => received.push(data.toString()))
    }
    server.on('connection', onConn)

    const info = await connect({ url: wsUrl() }, 1)
    expect(sendMessage(info.connectionId, 'hello-server')).toBe(true)

    await waitFor(() => received.includes('hello-server'))
    expect(received).toContain('hello-server')

    server.off('connection', onConn)
    disconnect(info.connectionId)
  })

  it('classifies inbound text vs. JSON vs. binary frames correctly', async () => {
    let serverSock: WsClient | null = null
    const onConn = (s: WsClient): void => {
      serverSock = s
    }
    server.on('connection', onConn)

    const info = await connect({ url: wsUrl() }, 1)
    await waitFor(() => serverSock !== null)

    serverSock!.send('plain text')
    serverSock!.send(JSON.stringify({ ok: true }))
    serverSock!.send(Buffer.from([0xde, 0xad, 0xbe, 0xef]), { binary: true })

    await waitFor(() => sentEvents.filter((e) => (e.payload as any).type === 'message').length >= 3)

    const messages = sentEvents
      .filter((e) => (e.payload as any).type === 'message')
      .map((e) => e.payload as any)

    const text = messages.find((m) => m.contentType === 'text')
    const json = messages.find((m) => m.contentType === 'json')
    const binary = messages.find((m) => m.contentType === 'binary')

    expect(text?.data).toBe('plain text')
    expect(json?.data).toBe('{"ok":true}')
    expect(binary?.data).toBe(Buffer.from([0xde, 0xad, 0xbe, 0xef]).toString('base64'))
    expect(messages.every((m) => typeof m.messageId === 'string')).toBe(true)

    server.off('connection', onConn)
    disconnect(info.connectionId)
  })
})

describe('websocket.engine — close / disconnect / errors', () => {
  it('disconnect() removes the connection from the active map and emits a close event', async () => {
    const info = await connect({ url: wsUrl() }, 1)
    expect(getConnectionInfo(info.connectionId)).not.toBeNull()

    expect(disconnect(info.connectionId)).toBe(true)
    expect(getConnectionInfo(info.connectionId)).toBeNull()

    await waitFor(() =>
      sentEvents.some(
        (e) =>
          (e.payload as any).type === 'close' &&
          (e.payload as any).connectionId === info.connectionId
      )
    )
    const close = sentEvents.find(
      (e) =>
        (e.payload as any).type === 'close' &&
        (e.payload as any).connectionId === info.connectionId
    )!
    expect((close.payload as any).code).toBe(1000)
  })

  it('propagates server-initiated close codes & reasons', async () => {
    let serverSock: WsClient | null = null
    const onConn = (s: WsClient): void => {
      serverSock = s
    }
    server.on('connection', onConn)

    const info = await connect({ url: wsUrl() }, 1)
    await waitFor(() => serverSock !== null)
    serverSock!.close(4001, 'bye')

    // Filter by THIS connection's id so any late close from a previous test
    // doesn't get picked up.
    await waitFor(() =>
      sentEvents.some(
        (e) =>
          (e.payload as any).type === 'close' &&
          (e.payload as any).connectionId === info.connectionId
      )
    )
    const close = sentEvents.find(
      (e) =>
        (e.payload as any).type === 'close' &&
        (e.payload as any).connectionId === info.connectionId
    )!.payload as any
    expect(close.code).toBe(4001)
    expect(close.reason).toBe('bye')
    expect(getConnectionInfo(info.connectionId)).toBeNull()

    server.off('connection', onConn)
  })

  it('disconnect() returns false for an unknown connection id', () => {
    expect(disconnect('does-not-exist')).toBe(false)
  })

  it('sendMessage throws for an unknown connection id', () => {
    expect(() => sendMessage('nope', 'x')).toThrow(/No active connection/)
  })

  it('connect() rejects when the URL points at a closed port', async () => {
    // ws://127.0.0.1:1 — almost certainly nothing listening; engine surfaces
    // ECONNREFUSED via the `error` handler before the 15s timeout fires.
    // Now classified through `describeWebSocketError` so the user sees a
    // human-readable "Connection refused" instead of the raw libuv code.
    await expect(connect({ url: 'ws://127.0.0.1:1' }, 1)).rejects.toThrow(
      /Connection refused|ECONNREFUSED/i,
    )
  })
})

describe('websocket.engine — describeWebSocketError', () => {
  it('formats handshake 401 with an Authorization hint', () => {
    expect(describeWebSocketError(new Error('Unexpected server response: 401'))).toMatch(
      /401.*Authorization/i,
    )
  })

  it('formats handshake 404 with a URL hint', () => {
    expect(describeWebSocketError(new Error('Unexpected server response: 404'))).toMatch(
      /404.*URL/i,
    )
  })

  it('classifies ECONNREFUSED transport errors', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), {
      code: 'ECONNREFUSED',
    })
    expect(describeWebSocketError(err)).toMatch(/Connection refused/)
  })
})

describe('websocket.engine — getActiveConnections', () => {
  it('reports the right count across concurrent connections', async () => {
    expect(getActiveConnections().length).toBe(0)

    const a = await connect({ url: wsUrl() }, 1)
    const b = await connect({ url: wsUrl() }, 1)

    const active = getActiveConnections()
    expect(active.length).toBe(2)
    const ids = active.map((c) => c.connectionId)
    expect(ids).toContain(a.connectionId)
    expect(ids).toContain(b.connectionId)

    disconnect(a.connectionId)
    disconnect(b.connectionId)
    await waitFor(() => getActiveConnections().length === 0)
  })
})
