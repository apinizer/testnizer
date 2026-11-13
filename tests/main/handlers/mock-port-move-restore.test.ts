/**
 * Tester finding 11 — the restore branch of a running mock's port move.
 *
 * The probe says the new port is free, but by the time the real `listen()`
 * runs another process has taken it (EADDRINUSE). The old listener is already
 * closed at that point, so the manager must bring the server back on its old
 * address. Made deterministic by stubbing the probe to "free" while a foreign
 * listener holds the port — exactly the race, without timing.
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

// The probe always answers "free": the race is lost on the real listen().
vi.mock('../../../src/main/lib/listen-address', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/main/lib/listen-address')>()
  return { ...real, probeListen: vi.fn(async () => null) }
})

const { registerMockHandlers } = await import('../../../src/main/ipc/mock.handler')
const { registerMockMcpHandlers } = await import('../../../src/main/ipc/mock-mcp.handler')
const { mockServerManager } = await import('../../../src/main/mock/server')
const { mockMcpServerManager } = await import('../../../src/main/mock-mcp/server')
const { probeListen } = await import('../../../src/main/lib/listen-address')

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
  errorInfo?: unknown
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

const foreign: net.Server[] = []
async function holdPortElsewhere(): Promise<number> {
  const srv = net.createServer((socket) => socket.end())
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  foreign.push(srv)
  return (srv.address() as net.AddressInfo).port
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerMockHandlers()
  registerMockMcpHandlers()
  vi.mocked(probeListen).mockClear()
})

afterEach(async () => {
  await mockServerManager.stopAll()
  await mockMcpServerManager.stopAll()
  await Promise.all(foreign.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))))
})

describe('probe said free, listen() lost the race → the old address comes back', () => {
  it('HTTP mock', async () => {
    const port = await freePort()
    const srv = await ok<{ id: string }>('mock:server:create', { projectId, name: 'A', port })
    const ep = await ok<{ id: string }>('mock:endpoint:create', {
      serverId: srv.id,
      method: 'GET',
      path: '/a',
    })
    await ok('mock:response:create', {
      endpointId: ep.id,
      statusCode: 200,
      bodyType: 'text',
      body: 'A',
    })
    await ok('mock:server:start', srv.id)
    const busy = await holdPortElsewhere()

    const r = await invoke('mock:server:update', srv.id, { port: busy })

    expect(probeListen).toHaveBeenCalled()
    expect(r.success).toBe(false)
    expect(r.errorInfo).toEqual({ kind: 'in-use', host: '127.0.0.1', port: busy })
    expect((await ok<{ port: number }>('mock:server:get', srv.id)).port).toBe(port)
    expect(mockServerManager.status(srv.id)).toBe('running')
    expect(mockServerManager.boundPort(srv.id)).toBe(port)
    const res = await fetch(`http://127.0.0.1:${port}/a`)
    expect(await res.text()).toBe('A')
  })

  it('Mock MCP', async () => {
    const port = await freePort()
    const created = await ok<{ id: string }>('mockMcp:server:create', {
      projectId,
      name: 'M',
      port,
    })
    await ok('mockMcp:server:start', created.id)
    const busy = await holdPortElsewhere()

    const r = await invoke('mockMcp:server:update', created.id, { port: busy })

    expect(probeListen).toHaveBeenCalled()
    expect(r.success).toBe(false)
    expect(r.errorInfo).toEqual({ kind: 'in-use', host: '127.0.0.1', port: busy })
    expect((await ok<{ port: number }>('mockMcp:server:get', created.id)).port).toBe(port)
    const state = await ok<{ status: string; port: number | null }>(
      'mockMcp:server:status',
      created.id,
    )
    expect(state).toMatchObject({ status: 'running', port })
  })
})
