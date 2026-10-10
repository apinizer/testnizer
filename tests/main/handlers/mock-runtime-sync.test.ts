/**
 * Issue #154 A — running mock servers must not outlive (or drift from) their
 * rows. Deleting a project, and a project import that prunes (`replace`, or
 * the pull's `merge` + `base`) or UPDATES a row, used to touch only the DB:
 * the Mock MCP / HTTP mock kept listening with the old config.
 *
 * REAL managers on ephemeral ports — a fake could not prove "port closed".
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

const { registerMockMcpHandlers } = await import('../../../src/main/ipc/mock-mcp.handler')
const { registerMockHandlers } = await import('../../../src/main/ipc/mock.handler')
const { registerProjectHandlers } = await import('../../../src/main/ipc/project.handler')
const { registerWorkspaceHandlers } = await import('../../../src/main/ipc/workspace.handler')
const { exportProjectData, importProjectDataFromJson } =
  await import('../../../src/main/ipc/save.handler')
const { mockMcpServerManager } = await import('../../../src/main/mock-mcp/server')
const { mockServerManager } = await import('../../../src/main/mock/server')

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}
interface McpState {
  serverId: string
  status: string
  url: string | null
  errorMessage: string | null
}

let projectId: string
let workspaceId: string

async function invoke<T>(channel: string, ...args: unknown[]): Promise<Envelope<T>> {
  return (await harness.invoke(channel, ...args)) as Envelope<T>
}
async function ok<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = await invoke<T>(channel, ...args)
  expect(r.error, `${channel} failed`).toBeUndefined()
  return r.data as T
}

async function startMcp(): Promise<{ id: string; url: string }> {
  const created = await ok<{ id: string }>('mockMcp:server:create', {
    projectId,
    name: 'MCP mock',
    port: 0,
  })
  const state = await ok<McpState>('mockMcp:server:start', created.id)
  expect(state.status).toBe('running')
  return { id: created.id, url: state.url as string }
}

async function toolsList(url: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  return res.text()
}

async function freePort(): Promise<number> {
  const srv = net.createServer()
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()))
  const port = (srv.address() as net.AddressInfo).port
  await new Promise<void>((r) => srv.close(() => r()))
  return port
}

/** Export → edit → re-import into the same project (what a git re-import does). */
async function reimport(
  edit: (doc: Record<string, unknown>) => void,
  options: Parameters<typeof importProjectDataFromJson>[2],
): Promise<void> {
  const doc = JSON.parse(JSON.stringify(exportProjectData(projectId))) as Record<string, unknown>
  edit(doc)
  await importProjectDataFromJson(JSON.stringify(doc), projectId, options)
}

const statusEvents: McpState[] = []
const onStatus = (s: McpState): void => {
  statusEvents.push(s)
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  registerMockMcpHandlers()
  registerMockHandlers()
  registerProjectHandlers()
  registerWorkspaceHandlers()
  statusEvents.length = 0
  mockMcpServerManager.on('status', onStatus)
})

afterEach(async () => {
  mockMcpServerManager.off('status', onStatus)
  await mockMcpServerManager.stopAll()
  await mockServerManager.stopAll()
})

describe('Mock MCP servers follow their rows (issue #154 A)', () => {
  it('deleting the project stops its running Mock MCP server (port closed, status event)', async () => {
    const { id, url } = await startMcp()
    expect(await toolsList(url)).toContain('"name":"echo"')

    expect((await invoke('project:delete', projectId)).success).toBe(true)

    expect(mockMcpServerManager.status(id)).toBe('stopped')
    expect(statusEvents.at(-1)).toMatchObject({ serverId: id, status: 'stopped' })
    await expect(fetch(url)).rejects.toThrow()
  })

  it('deleting the WORKSPACE (cascades to its projects) stops a running Mock MCP server', async () => {
    const { id, url } = await startMcp()
    expect((await invoke('workspace:delete', workspaceId)).success).toBe(true)

    expect(testDb.prepare('SELECT id FROM mock_mcp_servers WHERE id = ?').get(id)).toBeUndefined()
    expect(mockMcpServerManager.status(id)).toBe('stopped')
    expect(statusEvents.at(-1)).toMatchObject({ serverId: id, status: 'stopped' })
    await expect(fetch(url)).rejects.toThrow()
  })

  it('a replace import that no longer lists the row stops the server', async () => {
    const { id, url } = await startMcp()
    await reimport(
      (doc) => {
        doc.mockMcpServers = []
      },
      { mode: 'replace' },
    )

    expect(testDb.prepare('SELECT id FROM mock_mcp_servers WHERE id = ?').get(id)).toBeUndefined()
    expect(mockMcpServerManager.status(id)).toBe('stopped')
    expect(statusEvents.at(-1)).toMatchObject({ serverId: id, status: 'stopped' })
    await expect(fetch(url)).rejects.toThrow()
  })

  it('the pull prune (merge + base) that removes the row stops the server', async () => {
    const { id, url } = await startMcp()
    const base = JSON.parse(JSON.stringify(exportProjectData(projectId))) as Record<string, unknown>
    await reimport(
      (doc) => {
        doc.mockMcpServers = []
      },
      { mode: 'merge', base: base as never },
    )

    expect(mockMcpServerManager.status(id)).toBe('stopped')
    await expect(fetch(url)).rejects.toThrow()
  })

  it('a replace import that CHANGES the row hot-reloads the running server (new tools served)', async () => {
    const { id, url } = await startMcp()
    await reimport(
      (doc) => {
        const rows = doc.mockMcpServers as Record<string, unknown>[]
        rows[0].tools_json = JSON.stringify([
          {
            name: 'fresh',
            inputSchema: { type: 'object' },
            response: { kind: 'text', body: 'hi' },
          },
        ])
      },
      { mode: 'replace' },
    )

    expect(mockMcpServerManager.status(id)).toBe('running')
    const text = await toolsList(url)
    expect(text).toContain('"name":"fresh"')
    expect(text).not.toContain('"name":"echo"')
    expect(statusEvents.at(-1)).toMatchObject({ serverId: id, status: 'running' })
  })

  it('an imported row that fails validation stops the server and reports why', async () => {
    const { id, url } = await startMcp()
    await reimport(
      (doc) => {
        const rows = doc.mockMcpServers as Record<string, unknown>[]
        rows[0].protocol_pin = '2099-01-01'
      },
      { mode: 'replace' },
    )

    expect(mockMcpServerManager.status(id)).toBe('stopped')
    expect(statusEvents.at(-1)).toMatchObject({ serverId: id, status: 'error' })
    expect(statusEvents.at(-1)?.errorMessage).toMatch(/2099-01-01/)
    await expect(fetch(url)).rejects.toThrow()
  })

  it('an unchanged row leaves the running server alone (no restart, no status churn)', async () => {
    const { id, url } = await startMcp()
    const before = statusEvents.length
    await reimport(() => {}, { mode: 'replace' })
    expect(mockMcpServerManager.status(id)).toBe('running')
    expect(statusEvents.length).toBe(before)
    expect(await toolsList(url)).toContain('"name":"echo"')
  })
})

describe('HTTP mock servers follow their rows too (same seam)', () => {
  async function startHttp(): Promise<{ id: string; base: string }> {
    const port = await freePort()
    const srv = await ok<{ id: string }>('mock:server:create', { projectId, name: 'HTTP', port })
    const ep = await ok<{ id: string }>('mock:endpoint:create', {
      serverId: srv.id,
      method: 'GET',
      path: '/ping',
    })
    await ok('mock:response:create', { endpointId: ep.id, statusCode: 200, body: 'pong' })
    await ok('mock:server:start', srv.id)
    expect(mockServerManager.status(srv.id)).toBe('running')
    return { id: srv.id, base: `http://127.0.0.1:${port}` }
  }

  it('deleting the project stops its running HTTP mock', async () => {
    const { id, base } = await startHttp()
    expect(await (await fetch(`${base}/ping`)).text()).toBe('pong')
    expect((await invoke('project:delete', projectId)).success).toBe(true)
    expect(mockServerManager.status(id)).toBe('stopped')
    await expect(fetch(`${base}/ping`)).rejects.toThrow()
  })

  it('an imported port change the manager refuses (port held by another mock) stops the stale listener', async () => {
    const a = await startHttp()
    const b = await startHttp()
    const bPort = Number(new URL(b.base).port)
    await reimport(
      (doc) => {
        const rows = doc.mockServers as Record<string, unknown>[]
        const rowA = rows.find((r) => r.id === a.id) as Record<string, unknown>
        rowA.port = bPort
      },
      { mode: 'replace' },
    )
    expect(mockServerManager.status(a.id)).toBe('stopped')
    await expect(fetch(`${a.base}/ping`)).rejects.toThrow()
    expect(mockServerManager.status(b.id)).toBe('running')
  })

  it('a replace import that drops an endpoint stops serving it; dropping the server stops it', async () => {
    const { id, base } = await startHttp()
    await reimport(
      (doc) => {
        doc.mockEndpoints = []
        doc.mockResponses = []
      },
      { mode: 'replace' },
    )
    expect(mockServerManager.status(id)).toBe('running')
    expect((await fetch(`${base}/ping`)).status).not.toBe(200)

    await reimport(
      (doc) => {
        doc.mockServers = []
      },
      { mode: 'replace' },
    )
    expect(mockServerManager.status(id)).toBe('stopped')
    await expect(fetch(`${base}/ping`)).rejects.toThrow()
  })
})
