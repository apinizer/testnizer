/**
 * Issue #282 — WebSocket Postman parity in the engine, against real
 * in-process `ws` servers (no network mocks; only electron's BrowserWindow is
 * stubbed to capture the renderer events):
 *   - binary frames are sent from main (base64 / hex decoded there) — before,
 *     `ws.send(message)` only ever sent the text;
 *   - TLS verification follows the setting (self-signed wss://);
 *   - the handshake timeout and the max message size are configurable;
 *   - an unexpected close reconnects up to N times; a user disconnect never.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

const sent: Array<{ channel: string; payload: Record<string, unknown> }> = []
vi.mock('electron', () => ({
  BrowserWindow: {
    fromId: () => ({
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: Record<string, unknown>) =>
          sent.push({ channel, payload }),
      },
    }),
  },
}))

import {
  connect,
  disconnect,
  sendMessage,
  disconnectAll,
} from '../../src/main/protocols/websocket.engine'

const CERTS = join(__dirname, '../fixtures/certs')
let server: WebSocketServer
let port: number
const clients: ServerSocket[] = []
const received: Array<{ data: Buffer; isBinary: boolean }> = []

let tls: HttpsServer
let tlsWss: WebSocketServer
let tlsPort: number

let silent: NetServer
let silentPort: number
const silentSockets: Socket[] = []

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

const events = (type: string, id?: string) =>
  sent.filter((e) => e.payload.type === type && (!id || e.payload.connectionId === id))

beforeAll(async () => {
  server = new WebSocketServer({ port: 0 })
  server.on('connection', (ws) => {
    clients.push(ws)
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      received.push({ data, isBinary })
      if (!isBinary && data.toString() === 'big') ws.send('x'.repeat(2 * 1024 * 1024))
    })
  })
  await new Promise<void>((r) => server.on('listening', () => r()))
  port = (server.address() as AddressInfo).port

  tls = createHttpsServer({
    cert: readFileSync(join(CERTS, 'selfsigned.crt')),
    key: readFileSync(join(CERTS, 'selfsigned.key')),
  })
  tlsWss = new WebSocketServer({ server: tls })
  await new Promise<void>((r) => tls.listen(0, '127.0.0.1', r))
  tlsPort = (tls.address() as AddressInfo).port

  // Accepts TCP and never answers the HTTP upgrade.
  silent = createNetServer((s) => silentSockets.push(s))
  await new Promise<void>((r) => silent.listen(0, '127.0.0.1', r))
  silentPort = (silent.address() as AddressInfo).port
})

afterAll(async () => {
  disconnectAll()
  for (const s of silentSockets) s.destroy()
  await new Promise<void>((r) => server.close(() => r()))
  tlsWss.close()
  tls.closeAllConnections()
  await new Promise<void>((r) => tls.close(() => r()))
  await new Promise<void>((r) => silent.close(() => r()))
})

beforeEach(() => {
  disconnectAll()
  sent.length = 0
  received.length = 0
  clients.length = 0
})

const url = (): string => `ws://127.0.0.1:${port}`

describe('binary frames', () => {
  it('sends hex and base64 content as binary frames', async () => {
    const info = await connect({ url: url() }, 1)
    sendMessage(info.connectionId, 'de ad be ef', { binary: 'hex' })
    sendMessage(info.connectionId, 'AQID', { binary: 'base64' })
    sendMessage(info.connectionId, 'plain')
    await waitFor(() => received.length === 3)
    expect(received[0]).toEqual({ data: Buffer.from([0xde, 0xad, 0xbe, 0xef]), isBinary: true })
    expect(received[1]).toEqual({ data: Buffer.from([1, 2, 3]), isBinary: true })
    expect(received[2].isBinary).toBe(false)
  })

  it('refuses content that is not valid hex / base64', async () => {
    const info = await connect({ url: url() }, 1)
    expect(() => sendMessage(info.connectionId, 'xyz', { binary: 'hex' })).toThrow(/hexadecimal/)
    expect(() => sendMessage(info.connectionId, 'a', { binary: 'base64' })).toThrow(/Base64/)
  })

  it('reports a received binary frame as base64 binary', async () => {
    const info = await connect({ url: url() }, 1)
    await waitFor(() => clients.length === 1)
    clients[0].send(Buffer.from([0, 255]), { binary: true })
    await waitFor(() => events('message', info.connectionId).length === 1)
    expect(events('message')[0].payload).toMatchObject({ contentType: 'binary', data: 'AP8=' })
  })
})

describe('settings', () => {
  it('TLS verification on rejects a self-signed server; off connects', async () => {
    await expect(
      connect({ url: `wss://127.0.0.1:${tlsPort}`, rejectUnauthorized: true }, 1),
    ).rejects.toThrow()
    const info = await connect({ url: `wss://127.0.0.1:${tlsPort}`, rejectUnauthorized: false }, 1)
    expect(info.connectionId).toBeTruthy()
  })

  it('the handshake timeout is the configured one', async () => {
    const started = Date.now()
    await expect(
      connect({ url: `ws://127.0.0.1:${silentPort}`, handshakeTimeout: 300 }, 1),
    ).rejects.toThrow(/timeout \(0\.3s\)/)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('a message above the max size is refused and ends the connection', async () => {
    const info = await connect({ url: url(), maxPayload: 1024 * 1024 }, 1)
    sendMessage(info.connectionId, 'big')
    await waitFor(() => events('close', info.connectionId).length === 1)
    expect(events('message', info.connectionId)).toHaveLength(0)
    expect(String(events('error', info.connectionId)[0]?.payload.data)).toMatch(/payload/i)
  })

  it('maxPayload 0 means unlimited', async () => {
    const info = await connect({ url: url(), maxPayload: 0 }, 1)
    sendMessage(info.connectionId, 'big')
    await waitFor(() => events('message', info.connectionId).length === 1)
  })
})

describe('reconnection', () => {
  it('an unexpected close reconnects and keeps the connection id', async () => {
    const info = await connect({ url: url(), retryCount: 2, retryDelay: 20 }, 1)
    await waitFor(() => clients.length === 1)
    clients[0].terminate()
    await waitFor(() => events('open', info.connectionId).length === 2)
    expect(events('reconnecting', info.connectionId)[0].payload.attempt).toBe(1)
    expect(events('open', info.connectionId)[1].payload.reconnected).toBe(true)
    expect(events('close', info.connectionId)).toHaveLength(0)
    // The connection works again under the same id.
    await waitFor(() => clients.length === 2)
    sendMessage(info.connectionId, 'again')
    await waitFor(() => received.some((r) => r.data.toString() === 'again'))
  })

  it('gives up after the configured attempts with a final close', async () => {
    const lonely = new WebSocketServer({ port: 0 })
    await new Promise<void>((r) => lonely.on('listening', () => r()))
    const lonelyPort = (lonely.address() as AddressInfo).port
    const info = await connect(
      { url: `ws://127.0.0.1:${lonelyPort}`, retryCount: 2, retryDelay: 20 },
      1,
    )
    for (const c of lonely.clients) c.terminate()
    await new Promise<void>((r) => lonely.close(() => r()))
    await waitFor(() => events('close', info.connectionId).length === 1, 5000)
    expect(events('reconnecting', info.connectionId).map((e) => e.payload.attempt)).toEqual([1, 2])
  })

  it('a user disconnect never reconnects', async () => {
    const info = await connect({ url: url(), retryCount: 3, retryDelay: 20 }, 1)
    disconnect(info.connectionId)
    await new Promise((r) => setTimeout(r, 150))
    expect(events('reconnecting', info.connectionId)).toHaveLength(0)
  })
})
