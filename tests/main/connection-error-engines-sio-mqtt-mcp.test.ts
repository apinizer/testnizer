/**
 * Issue #253 — Socket.IO, MQTT and MCP engines against a REAL closed port (a
 * port that was bound and released) and real servers answering 401 / a login
 * refusal: the rejection is a `ConnectionError` carrying the classified
 * `{kind, target, hint}` (contract: `connection-error-classifier.test.ts`).
 *
 * Fail-before:
 *   Socket.IO  "websocket error" (no host, no cause)
 *   MCP        "fetch failed"
 *   MQTT       "connect ECONNREFUSED 127.0.0.1:1" / "Connection refused: Bad
 *              username or password" (an auth failure worded as a refusal)
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import net from 'node:net'
import {
  socketIOConnect,
  socketIODisconnectAll,
} from '../../src/main/protocols/socketio.engine'
import { mqttConnect, mqttDisconnectAll } from '../../src/main/protocols/mqtt.engine'
import { mcpConnect, mcpDisconnectAll } from '../../src/main/protocols/mcp.engine'
import {
  formatConnectionError,
  getConnectionErrorInfo,
} from '../../src/main/lib/error-classifier'
import { startAedesBroker } from '../helpers/mqtt-aedes-broker'

const CANARY_PASS = 'Pa55w0rdCANARY'
const CANARY_TOKEN = 'TOKENCANARY'
const CANARY_ARG = 'ARGSECRETCANARY'

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

afterEach(() => {
  socketIODisconnectAll()
  mqttDisconnectAll()
  mcpDisconnectAll()
})

describe('socketio.engine — connect errors', () => {
  it('WebSocket transport, closed port: refused + host:port (was "websocket error")', async () => {
    const port = await closedPort()
    const err = await rejection(
      socketIOConnect({ url: `http://127.0.0.1:${port}`, settings: { transport: 'websocket' } }),
    )
    const info = getConnectionErrorInfo(err)
    expect(info).toMatchObject({ kind: 'refused', target: `127.0.0.1:${port}` })
    expect(info!.hint).toBeTruthy()
    expect(err.message).toBe(formatConnectionError(info!))
    expect(err.message).toContain(`Connection refused — 127.0.0.1:${port}`)
    expect(err.message).not.toMatch(/websocket error/i)
  })

  it('default transports and long-polling: still names the host:port and a next step', async () => {
    const port = await closedPort()
    for (const transport of ['auto', 'polling'] as const) {
      const err = await rejection(
        socketIOConnect({ url: `http://127.0.0.1:${port}`, settings: { transport } }),
      )
      const info = getConnectionErrorInfo(err)!
      expect(['refused', 'unreachable'], transport).toContain(info.kind)
      expect(info.target, transport).toBe(`127.0.0.1:${port}`)
      expect(info.hint, transport).toBeTruthy()
      expect(err.message, transport).not.toMatch(/xhr poll error|^websocket error$/i)
    }
  })

  it('the URL token and userinfo never reach the message', async () => {
    const port = await closedPort()
    const err = await rejection(
      socketIOConnect({
        url: `http://alice:${CANARY_PASS}@127.0.0.1:${port}/?token=${CANARY_TOKEN}`,
        auth: { token: CANARY_TOKEN },
        settings: { transport: 'websocket' },
      }),
    )
    expect(err.message).not.toContain(CANARY_PASS)
    expect(err.message).not.toContain(CANARY_TOKEN)
    expect(JSON.stringify(getConnectionErrorInfo(err))).not.toContain(CANARY_TOKEN)
  })
})

describe('mqtt.engine — connect errors', () => {
  it('closed port: refused + host:port', async () => {
    const port = await closedPort()
    const err = await rejection(
      mqttConnect({ url: `mqtt://127.0.0.1:${port}`, version: 4, onEvent: () => {} }),
    )
    const info = getConnectionErrorInfo(err)
    expect(info).toMatchObject({ kind: 'refused', target: `127.0.0.1:${port}` })
    expect(err.message).toContain(`Connection refused — 127.0.0.1:${port}`)
    expect(err.message).not.toMatch(/ECONNREFUSED/)
  })

  it('a refused login is an authentication failure (not "connection refused"), no password echoed', async () => {
    const broker = await startAedesBroker({ auth: { username: 'alice', password: 's3cret-pw' } })
    try {
      const err = await rejection(
        mqttConnect({
          url: broker.url,
          version: 4,
          username: 'alice',
          password: CANARY_PASS,
          onEvent: () => {},
        }),
      )
      const info = getConnectionErrorInfo(err)
      expect(info).toMatchObject({ kind: 'unauthorized', target: `127.0.0.1:${broker.port}` })
      expect(err.message).not.toMatch(/^Connection refused/)
      expect(err.message).not.toContain(CANARY_PASS)
      expect(info!.hint).toMatch(/credentials|password/i)
    } finally {
      await broker.close()
    }
  })
})

describe('mcp.engine — connect errors', () => {
  it('Streamable HTTP, closed port: refused + host:port (was "fetch failed")', async () => {
    const port = await closedPort()
    const err = await rejection(mcpConnect({ transport: 'http', url: `http://127.0.0.1:${port}/mcp` }))
    const info = getConnectionErrorInfo(err)
    expect(info).toMatchObject({ kind: 'refused', target: `127.0.0.1:${port}` })
    expect(err.message).toContain(`Connection refused — 127.0.0.1:${port}`)
    expect(err.message).not.toMatch(/^fetch failed$/)
  })

  it('legacy SSE transport, closed port: refused + host:port', async () => {
    const port = await closedPort()
    const err = await rejection(mcpConnect({ transport: 'sse', url: `http://127.0.0.1:${port}/sse` }))
    expect(getConnectionErrorInfo(err)).toMatchObject({
      kind: 'refused',
      target: `127.0.0.1:${port}`,
    })
  })

  it('userinfo and a credential query value in the server URL never reach the message', async () => {
    const port = await closedPort()
    const err = await rejection(
      mcpConnect({
        transport: 'http',
        url: `http://alice:${CANARY_PASS}@127.0.0.1:${port}/mcp?api_key=${CANARY_TOKEN}`,
      }),
    )
    const text = JSON.stringify({ m: err.message, i: getConnectionErrorInfo(err) })
    expect(text).not.toContain(CANARY_PASS)
    expect(text).not.toContain(CANARY_TOKEN)
  })

  it('stdio: a missing command is "spawn-failed" with NO host:port and no argument secrets', async () => {
    const err = await rejection(
      mcpConnect({
        transport: 'stdio',
        url: '',
        command: 'definitely-not-a-command-253',
        args: ['--api-key', CANARY_ARG],
      }),
    )
    const info = getConnectionErrorInfo(err)
    expect(info?.kind).toBe('spawn-failed')
    expect(info?.target).toBeUndefined()
    expect(err.message).toContain('definitely-not-a-command-253')
    expect(err.message).not.toContain(CANARY_ARG)
  })

  describe('a server that answers 401', () => {
    let server: Server | undefined
    afterEach(async () => {
      server?.closeAllConnections?.()
      await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
      server = undefined
    })

    it('unauthorized + status + host:port, and the original 401 markers survive (the OAuth offer keys on them)', async () => {
      server = createServer((_req, res) => {
        res.writeHead(401, { 'WWW-Authenticate': 'Bearer', 'Content-Type': 'application/json' })
        res.end('{"error":"unauthorized"}')
      })
      await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
      const port = (server.address() as net.AddressInfo).port
      const err = await rejection(mcpConnect({ transport: 'http', url: `http://127.0.0.1:${port}/mcp` }))
      const info = getConnectionErrorInfo(err)!
      expect(info).toMatchObject({
        kind: 'unauthorized',
        httpStatus: 401,
        target: `127.0.0.1:${port}`,
      })
      const markers = err as unknown as { status?: unknown; code?: unknown; name?: unknown }
      expect(markers.status === 401 || markers.code === 401 || markers.name === 'UnauthorizedError').toBe(
        true,
      )
    })
  })
})
