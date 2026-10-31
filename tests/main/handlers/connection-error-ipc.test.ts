/**
 * Issue #253 — the IPC layer. Every realtime `*:connect` handler answers a
 * failed connect with `{ success:false, error, errorInfo }`: `error` is the
 * one-line English text (`formatConnectionError(errorInfo)`), `errorInfo` is
 * the classified `{ kind, target, hint, httpStatus? }` the renderer maps to
 * EN/TR text. Real handlers, real engines, a real closed port; only Electron
 * is stubbed.
 *
 * `mcp:connect` keeps its extra `unauthorized: true` (the OAuth offer, issue
 * #141) next to the new `errorInfo`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import net from 'node:net'
import { createServer, type Server } from 'node:http'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
const win = {
  id: 1,
  isDestroyed: () => false,
  webContents: { send: () => {} },
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
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const { registerWebSocketHandlers } = await import('../../../src/main/ipc/websocket.handler')
const { registerSseHandlers } = await import('../../../src/main/ipc/sse.handler')
const { registerSocketIOHandlers } = await import('../../../src/main/ipc/socketio.handler')
const { registerMqttHandlers } = await import('../../../src/main/ipc/mqtt.handler')
const { registerMcpHandlers } = await import('../../../src/main/ipc/mcp.handler')
const { formatConnectionError } = await import('../../../src/main/lib/error-classifier')

type Res = {
  success: boolean
  error?: string
  unauthorized?: boolean
  errorInfo?: {
    kind: string
    target?: string
    hint?: string
    httpStatus?: number
    message: string
  }
}

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

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  registerWebSocketHandlers()
  registerSseHandlers()
  registerSocketIOHandlers()
  registerMqttHandlers()
  registerMcpHandlers()
})

function expectRefused(res: Res, port: number): void {
  expect(res.success).toBe(false)
  expect(res.errorInfo).toMatchObject({ kind: 'refused', target: `127.0.0.1:${port}` })
  expect(res.errorInfo!.hint).toBeTruthy()
  expect(res.error).toBe(formatConnectionError(res.errorInfo as never))
  expect(res.error).toContain(`Connection refused — 127.0.0.1:${port}`)
}

describe('failed connect → { error, errorInfo } on every realtime channel', () => {
  it('ws:connect', async () => {
    const port = await closedPort()
    expectRefused((await harness.invoke('ws:connect', { url: `ws://127.0.0.1:${port}` })) as Res, port)
  })

  it('sse:connect', async () => {
    const port = await closedPort()
    expectRefused(
      (await harness.invoke('sse:connect', { url: `http://127.0.0.1:${port}/stream` })) as Res,
      port,
    )
  })

  it('socketio:connect', async () => {
    const port = await closedPort()
    expectRefused(
      (await harness.invoke('socketio:connect', {
        url: `http://127.0.0.1:${port}`,
        settings: { transport: 'websocket' },
      })) as Res,
      port,
    )
  })

  it('mqtt:connect', async () => {
    const port = await closedPort()
    expectRefused(
      (await harness.invoke('mqtt:connect', { url: `mqtt://127.0.0.1:${port}`, version: 4 })) as Res,
      port,
    )
  })

  it('mcp:connect (Streamable HTTP)', async () => {
    const port = await closedPort()
    expectRefused(
      (await harness.invoke('mcp:connect', {
        transport: 'http',
        url: `http://127.0.0.1:${port}/mcp`,
      })) as Res,
      port,
    )
  })

  it('mcp:connect (stdio): spawn-failed, no target', async () => {
    const res = (await harness.invoke('mcp:connect', {
      transport: 'stdio',
      url: '',
      command: 'definitely-not-a-command-253',
      args: [],
    })) as Res
    expect(res.success).toBe(false)
    expect(res.errorInfo?.kind).toBe('spawn-failed')
    expect(res.errorInfo?.target).toBeUndefined()
  })
})

describe('mcp:connect against a 401', () => {
  let server: Server | undefined
  it('keeps `unauthorized: true` and adds the classified info', async () => {
    server = createServer((_req, res) => {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' })
      res.end('{}')
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    const port = (server.address() as net.AddressInfo).port
    try {
      const res = (await harness.invoke('mcp:connect', {
        transport: 'http',
        url: `http://127.0.0.1:${port}/mcp`,
      })) as Res
      expect(res.success).toBe(false)
      expect(res.unauthorized).toBe(true)
      expect(res.errorInfo).toMatchObject({
        kind: 'unauthorized',
        httpStatus: 401,
        target: `127.0.0.1:${port}`,
      })
    } finally {
      server.closeAllConnections?.()
      await new Promise<void>((r) => server!.close(() => r()))
    }
  })
})

describe('non-connection failures are untouched', () => {
  it('a missing broker URL stays a plain { error } (no errorInfo)', async () => {
    const res = (await harness.invoke('mqtt:connect', { url: '' })) as Res
    expect(res.success).toBe(false)
    expect(res.error).toBe('Broker URL is required')
    expect(res.errorInfo).toBeUndefined()
  })
})
