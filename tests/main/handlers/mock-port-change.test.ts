/**
 * Tester finding 11 (critical) — changing a RUNNING mock server's port to a
 * port that is already taken.
 *
 * Mock A on P1 (GET /a → "A"), mock B on P2 (GET /b → "B"), both running.
 * Settings → Port P1 → P2. The handler wrote P2 to the row and returned
 * success although the manager refused the restart: the editor showed
 * ":P2 Running", and `GET :P2/a` reached B (404). When the port was held by
 * something the manager does not know (another app, a Mock MCP server) the
 * manager had already closed A's listener before `listen()` failed, so A
 * stopped serving altogether.
 *
 * The rule now: a host/port change of a running server is applied only if the
 * server can listen there. Otherwise the IPC fails with a readable message,
 * the row keeps its stored values, and the server keeps serving on its old
 * address. A stopped server's port is just saved; Start reports the busy port.
 *
 * REAL managers on free ports — a fake could not prove "still serving".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import net from 'node:net'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
} from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { registerMockHandlers } = await import('../../../src/main/ipc/mock.handler')
const { registerMockMcpHandlers } = await import('../../../src/main/ipc/mock-mcp.handler')
const { mockServerManager } = await import('../../../src/main/mock/server')
const { mockMcpServerManager } = await import('../../../src/main/mock-mcp/server')

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}
interface ServerView {
  id: string
  name: string
  host: string
  port: number
}
interface McpState {
  serverId: string
  status: string
  port: number | null
  url: string | null
}
interface McpConfig {
  id: string
  name: string
  host: string
  port: number
}

let projectId: string

async function invoke<T>(channel: string, ...args: unknown[]): Promise<Envelope<T>> {
  return (await harness.invoke(channel, ...args)) as Envelope<T>
}
async function ok<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = await invoke<T>(channel, ...args)
  expect(r.error, `${channel} failed`).toBeUndefined()
  return r.data as T
}

async function freePort(): Promise<number> {
  const srv = net.createServer()
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as net.AddressInfo).port
  await new Promise<void>((r) => srv.close(() => r()))
  return port
}

/** Something that is not a mock holding a port ("another application"). */
const foreign: net.Server[] = []
async function holdPortElsewhere(): Promise<number> {
  const srv = net.createServer((socket) => socket.end())
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  foreign.push(srv)
  return (srv.address() as net.AddressInfo).port
}

/** An HTTP mock serving `GET <path>` → `text`, started. */
async function startMock(name: string, path: string, text: string): Promise<ServerView> {
  const port = await freePort()
  const srv = await ok<ServerView>('mock:server:create', { projectId, name, port })
  const ep = await ok<{ id: string }>('mock:endpoint:create', {
    serverId: srv.id,
    method: 'GET',
    path,
  })
  await ok('mock:response:create', {
    endpointId: ep.id,
    statusCode: 200,
    bodyType: 'text',
    body: text,
  })
  await ok('mock:server:start', srv.id)
  return srv
}

async function get(port: number, path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`)
  return { status: res.status, body: await res.text() }
}

const statusEvents: { serverId: string; status: string }[] = []
const onStatus = (s: { serverId: string; status: string }): void => {
  statusEvents.push(s)
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  const workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  registerMockHandlers()
  registerMockMcpHandlers()
  statusEvents.length = 0
  mockServerManager.on('status', onStatus)
})

afterEach(async () => {
  mockServerManager.off('status', onStatus)
  await mockServerManager.stopAll()
  await mockMcpServerManager.stopAll()
  await Promise.all(foreign.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))))
})

describe('HTTP mock: changing a running server to a busy port', () => {
  it('to the port of another running mock: fails, row and listener stay on the old port', async () => {
    const a = await startMock('A', '/a', 'A')
    const b = await startMock('B', '/b', 'B')
    statusEvents.length = 0

    const r = await invoke<ServerView>('mock:server:update', a.id, { port: b.port, name: 'A2' })

    expect(r.success).toBe(false)
    expect(r.error).toContain(String(b.port))
    expect(r.error).toMatch(/already in use/i)
    // Nothing of the refused patch is stored — not the port, not the name sent with it.
    const stored = await ok<ServerView>('mock:server:get', a.id)
    expect(stored.port).toBe(a.port)
    expect(stored.name).toBe('A')
    // A still answers on its old port, B on its own.
    expect(mockServerManager.status(a.id)).toBe('running')
    expect(await get(a.port, '/a')).toEqual({ status: 200, body: 'A' })
    expect(await get(b.port, '/b')).toEqual({ status: 200, body: 'B' })
    expect(statusEvents.filter((e) => e.serverId === a.id && e.status === 'error')).toEqual([])
  })

  it('to a port held by another application: fails, A keeps serving on the old port', async () => {
    const a = await startMock('A', '/a', 'A')
    const busy = await holdPortElsewhere()
    statusEvents.length = 0

    const r = await invoke<ServerView>('mock:server:update', a.id, { port: busy })

    expect(r.success).toBe(false)
    expect(r.error).toContain(String(busy))
    expect(r.error).toMatch(/already in use/i)
    expect((await ok<ServerView>('mock:server:get', a.id)).port).toBe(a.port)
    expect(mockServerManager.status(a.id)).toBe('running')
    expect(await get(a.port, '/a')).toEqual({ status: 200, body: 'A' })
    expect(statusEvents.filter((e) => e.serverId === a.id && e.status === 'error')).toEqual([])
  })

  it('to a port held by a running Mock MCP server: fails, A keeps serving', async () => {
    const a = await startMock('A', '/a', 'A')
    const mcp = await ok<{ id: string }>('mockMcp:server:create', {
      projectId,
      name: 'MCP',
      port: 0,
    })
    const mcpState = await ok<McpState>('mockMcp:server:start', mcp.id)
    const mcpPort = mcpState.port as number

    const r = await invoke<ServerView>('mock:server:update', a.id, { port: mcpPort })

    expect(r.success).toBe(false)
    expect(r.error).toContain(String(mcpPort))
    expect((await ok<ServerView>('mock:server:get', a.id)).port).toBe(a.port)
    expect(await get(a.port, '/a')).toEqual({ status: 200, body: 'A' })
    expect(mockMcpServerManager.status(mcp.id)).toBe('running')
  })

  /*
   * Node binds with SO_REUSEADDR: on macOS 127.0.0.1:P and 0.0.0.0:P can BOTH
   * be bound, so neither the probe nor listen() fails — two mocks would be
   * "Running" on one port and loopback traffic would reach only one of them.
   */
  it.each([
    ['0.0.0.0', '127.0.0.1'],
    ['127.0.0.1', '0.0.0.0'],
  ] as const)('B on %s, A on %s moved to B’s port: refused (overlapping hosts)', async (hb, ha) => {
    const a = await startMock('A', '/a', 'A')
    if (ha !== '127.0.0.1') await ok('mock:server:update', a.id, { host: ha })
    const b = await startMock('B', '/b', 'B')
    await ok('mock:server:update', b.id, { host: hb })

    const r = await invoke<ServerView>('mock:server:update', a.id, { port: b.port })

    expect(r.success).toBe(false)
    expect(r.error).toContain(String(b.port))
    expect((await ok<ServerView>('mock:server:get', a.id)).port).toBe(a.port)
    expect(await get(a.port, '/a')).toEqual({ status: 200, body: 'A' })
    expect(await get(b.port, '/b')).toEqual({ status: 200, body: 'B' })
  })

  it('Start refuses a port another mock holds on an overlapping host', async () => {
    const b = await startMock('B', '/b', 'B')
    await ok('mock:server:update', b.id, { host: '0.0.0.0' })
    const a = await ok<ServerView>('mock:server:create', { projectId, name: 'A', port: b.port })

    const r = await invoke('mock:server:start', a.id)

    expect(r.success).toBe(false)
    expect(r.error).toContain(`Port ${b.port} is already in use by mock server "B"`)
  })

  it('to a free port: moves the listener and stores the new port', async () => {
    const a = await startMock('A', '/a', 'A')
    const next = await freePort()

    const r = await invoke<ServerView>('mock:server:update', a.id, { port: next })

    expect(r.success).toBe(true)
    expect(r.data?.port).toBe(next)
    expect((await ok<ServerView>('mock:server:get', a.id)).port).toBe(next)
    expect(mockServerManager.status(a.id)).toBe('running')
    expect(await get(next, '/a')).toEqual({ status: 200, body: 'A' })
    await expect(get(a.port, '/a')).rejects.toThrow()
  })

  it('a host-only change on the same port restarts on the new host', async () => {
    const a = await startMock('A', '/a', 'A')

    const r = await invoke<ServerView>('mock:server:update', a.id, { host: '0.0.0.0' })

    expect(r.success).toBe(true)
    expect(r.data?.host).toBe('0.0.0.0')
    expect(mockServerManager.status(a.id)).toBe('running')
    expect(await get(a.port, '/a')).toEqual({ status: 200, body: 'A' })
  })

  it('a STOPPED server saves the busy port; Start then says the port is in use', async () => {
    const a = await startMock('A', '/a', 'A')
    await ok('mock:server:stop', a.id)
    const busy = await holdPortElsewhere()

    const saved = await ok<ServerView>('mock:server:update', a.id, { port: busy })
    expect(saved.port).toBe(busy)

    const start = await invoke('mock:server:start', a.id)
    expect(start.success).toBe(false)
    // Readable, not the raw "listen EADDRINUSE: address already in use …".
    expect(start.error).toContain(`Port ${busy} is already in use`)
    expect(start.error).not.toMatch(/EADDRINUSE/)
  })
})

describe('Mock MCP: changing a running server to a busy port', () => {
  async function startMcp(name: string): Promise<{ id: string; port: number; url: string }> {
    const port = await freePort()
    const created = await ok<McpConfig>('mockMcp:server:create', { projectId, name, port })
    const state = await ok<McpState>('mockMcp:server:start', created.id)
    expect(state.status).toBe('running')
    return { id: created.id, port: state.port as number, url: state.url as string }
  }

  async function toolsList(url: string): Promise<string> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    return res.text()
  }

  it('to the port of another Mock MCP server: fails, row and listener stay', async () => {
    const a = await startMcp('MCP A')
    const b = await startMcp('MCP B')

    const r = await invoke<McpConfig>('mockMcp:server:update', a.id, {
      port: b.port,
      name: 'MCP A2',
    })

    expect(r.success).toBe(false)
    expect(r.error).toContain(String(b.port))
    const stored = await ok<McpConfig>('mockMcp:server:get', a.id)
    expect(stored.port).toBe(a.port)
    expect(stored.name).toBe('MCP A')
    expect(mockMcpServerManager.status(a.id)).toBe('running')
    expect(await toolsList(a.url)).toContain('"name":"echo"')
  })

  it('to a port held by another application: fails, the server keeps serving', async () => {
    const a = await startMcp('MCP A')
    const busy = await holdPortElsewhere()

    const r = await invoke<McpConfig>('mockMcp:server:update', a.id, { port: busy })

    expect(r.success).toBe(false)
    expect(r.error).toContain(`Port ${busy} is already in use`)
    expect((await ok<McpConfig>('mockMcp:server:get', a.id)).port).toBe(a.port)
    expect(mockMcpServerManager.status(a.id)).toBe('running')
    expect(await toolsList(a.url)).toContain('"name":"echo"')
  })

  it('to a free port: moves and stores it', async () => {
    const a = await startMcp('MCP A')
    const next = await freePort()

    const r = await invoke<McpConfig>('mockMcp:server:update', a.id, { port: next })

    expect(r.success).toBe(true)
    expect((await ok<McpConfig>('mockMcp:server:get', a.id)).port).toBe(next)
    const state = await ok<McpState>('mockMcp:server:status', a.id)
    expect(state.port).toBe(next)
    expect(await toolsList(state.url as string)).toContain('"name":"echo"')
  })
})
