/**
 * Issue #253 — WebSocket and SSE engines against a REAL closed port / a real
 * server that answers 401: the Error the engine rejects with AND the event it
 * pushes to the renderer carry the classified `{kind, target, hint}`
 * (contract: see `connection-error-classifier.test.ts`).
 *
 * Fail-before: `websocket.engine` kept only `message` ("Connection refused —
 * connect ECONNREFUSED 127.0.0.1:1", the raw text repeated, no host in the
 * hint); `sse.engine` surfaced "TypeError: fetch failed: bad port" and had no
 * kind at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import net from 'node:net'
import { WebSocketServer } from 'ws'

const sent: Array<{ channel: string; payload: Record<string, unknown> }> = []
const win = {
  isDestroyed: () => false,
  webContents: {
    send: (channel: string, payload: Record<string, unknown>) => sent.push({ channel, payload }),
  },
}
vi.mock('electron', () => ({ BrowserWindow: { fromId: () => win } }))

import {
  connect as wsConnect,
  disconnectAll as wsDisconnectAll,
} from '../../src/main/protocols/websocket.engine'
import { connect as sseConnect } from '../../src/main/protocols/sse.engine'
import {
  formatConnectionError,
  getConnectionErrorInfo,
} from '../../src/main/lib/error-classifier'

const CANARY_PASS = 'Pa55w0rdCANARY'
const CANARY_TOKEN = 'TOKENCANARY'

/** Bind then release a port: a port nothing listens on (and not a fetch-blocked one). */
async function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

async function rejection(p: Promise<unknown>): Promise<Error> {
  try {
    await p
  } catch (e) {
    return e as Error
  }
  throw new Error('expected the connect to reject')
}

const eventsOf = (channel: string, type: string): Array<Record<string, unknown>> =>
  sent.filter((s) => s.channel === channel && s.payload.type === type).map((s) => s.payload)

beforeEach(() => {
  sent.length = 0
})
afterEach(() => wsDisconnectAll())

describe('websocket.engine — connect errors', () => {
  it('closed port: rejects with a ConnectionError, the error event carries the same info', async () => {
    const port = await closedPort()
    const err = await rejection(wsConnect({ url: `ws://127.0.0.1:${port}` }, 1))
    const info = getConnectionErrorInfo(err)
    expect(info).toMatchObject({ kind: 'refused', target: `127.0.0.1:${port}` })
    expect(info!.hint).toBeTruthy()
    expect(err.message).toBe(formatConnectionError(info!))
    expect(err.message).toContain(`Connection refused — 127.0.0.1:${port}`)
    // The raw libuv text is not repeated next to the friendly one.
    expect(err.message).not.toMatch(/ECONNREFUSED/)

    const [event] = eventsOf('ws:event', 'error')
    expect(event.data).toBe(err.message)
    expect(event.errorInfo).toEqual(info)
  })

  it('the URL userinfo and query token never reach the message, info or event', async () => {
    const port = await closedPort()
    const err = await rejection(
      wsConnect({ url: `ws://alice:${CANARY_PASS}@127.0.0.1:${port}/x?token=${CANARY_TOKEN}` }, 1),
    )
    const everything = JSON.stringify({ m: err.message, i: getConnectionErrorInfo(err), s: sent })
    expect(everything).not.toContain(CANARY_PASS)
    expect(everything).not.toContain(CANARY_TOKEN)
    expect(getConnectionErrorInfo(err)!.target).toBe(`127.0.0.1:${port}`)
  })

  it('a 401 handshake: unauthorized + status + host:port + Authorization hint', async () => {
    const wss = new WebSocketServer({
      port: 0,
      verifyClient: (_i, cb) => cb(false, 401, 'Unauthorized'),
    })
    await new Promise<void>((r) => wss.on('listening', () => r()))
    const port = (wss.address() as net.AddressInfo).port
    try {
      const err = await rejection(wsConnect({ url: `ws://127.0.0.1:${port}/ws` }, 1))
      const info = getConnectionErrorInfo(err)!
      expect(info).toMatchObject({
        kind: 'unauthorized',
        httpStatus: 401,
        target: `127.0.0.1:${port}`,
      })
      expect(err.message).toMatch(/401/)
      expect(err.message).toMatch(/Authorization/i)
      expect(eventsOf('ws:event', 'error')[0].errorInfo).toEqual(info)
    } finally {
      await new Promise<void>((r) => wss.close(() => r()))
    }
  })
})

describe('sse.engine — connect errors', () => {
  it('closed port: refused + host:port (was "TypeError: fetch failed: …")', async () => {
    const port = await closedPort()
    const err = await rejection(sseConnect({ url: `http://127.0.0.1:${port}/stream` }, 1))
    const info = getConnectionErrorInfo(err)
    expect(info).toMatchObject({ kind: 'refused', target: `127.0.0.1:${port}` })
    expect(err.message).toContain(`Connection refused — 127.0.0.1:${port}`)
    expect(err.message).not.toMatch(/fetch failed|TypeError/)

    const [event] = eventsOf('sse:event', 'error')
    expect(event.data).toBe(err.message)
    expect(event.errorInfo).toEqual(info)
    expect(event.httpStatus).toBeUndefined()
  })

  it('port 1 is a port fetch refuses to use: "bad port", NOT connection refused', async () => {
    const err = await rejection(sseConnect({ url: 'http://127.0.0.1:1/stream' }, 1))
    const info = getConnectionErrorInfo(err)
    expect(info).toMatchObject({ kind: 'bad-port', target: '127.0.0.1:1' })
    expect(err.message).not.toMatch(/refused/i)
    expect(err.message).toMatch(/port/i)
    expect(eventsOf('sse:event', 'error')[0].errorInfo).toMatchObject({ kind: 'bad-port' })
  })

  it('credentials in the URL never reach the message or the event', async () => {
    const port = await closedPort()
    const err = await rejection(
      sseConnect(
        { url: `http://alice:${CANARY_PASS}@127.0.0.1:${port}/s?token=${CANARY_TOKEN}` },
        1,
      ),
    )
    const everything = JSON.stringify({ m: err.message, s: sent })
    expect(everything).not.toContain(CANARY_PASS)
    expect(everything).not.toContain(CANARY_TOKEN)
  })

  describe('against a server that answers with a status', () => {
    let server: Server
    let port: number
    beforeEach(async () => {
      server = createServer((req, res) => {
        res.writeHead(req.url === '/missing' ? 404 : 401, { 'Content-Type': 'text/plain' })
        res.end('nope')
      })
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
      port = (server.address() as net.AddressInfo).port
    })
    afterEach(async () => {
      server.closeAllConnections?.()
      await new Promise<void>((r) => server.close(() => r()))
    })

    it('401 → unauthorized, httpStatus 401, host:port, the event keeps httpStatus', async () => {
      const err = await rejection(sseConnect({ url: `http://127.0.0.1:${port}/stream` }, 1))
      const info = getConnectionErrorInfo(err)!
      expect(info).toMatchObject({
        kind: 'unauthorized',
        httpStatus: 401,
        target: `127.0.0.1:${port}`,
      })
      expect(info.hint).toMatch(/Authorization/i)
      const [event] = eventsOf('sse:event', 'error')
      expect(event.httpStatus).toBe(401)
      expect(event.errorInfo).toEqual(info)
    })

    it('404 → not-found with a URL hint', async () => {
      const err = await rejection(sseConnect({ url: `http://127.0.0.1:${port}/missing` }, 1))
      const info = getConnectionErrorInfo(err)!
      expect(info).toMatchObject({ kind: 'not-found', httpStatus: 404 })
      expect(info.hint).toMatch(/URL/i)
    })
  })
})
