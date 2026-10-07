/**
 * `mockMcp:*` IPC handlers (issue #140) — envelopes, validation, and the live
 * lifecycle against the REAL `mockMcpServerManager` on ephemeral ports (a
 * fake manager could not prove "delete stops a running server" or the port
 * conflict message).
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
const { mockMcpServerManager } = await import('../../../src/main/mock-mcp/server')

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}
interface ServerView {
  id: string
  projectId: string
  name: string
  port: number
  path: string
  host: string
  authMode: string
  tools: { name: string }[]
  errorMode: { kind: string }
  protocolPin: string | null
  enabled: boolean
}
interface StateView {
  status: string
  port: number | null
  url: string | null
}

let projectId: string

async function invoke<T>(channel: string, ...args: unknown[]): Promise<Envelope<T>> {
  return (await harness.invoke(channel, ...args)) as Envelope<T>
}

async function create(over: Record<string, unknown> = {}): Promise<ServerView> {
  const r = await invoke<ServerView>('mockMcp:server:create', {
    projectId,
    name: 'MCP mock',
    port: 0,
    ...over,
  })
  if (!r.success || !r.data) throw new Error(r.error)
  return r.data
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerMockMcpHandlers()
})

afterEach(async () => {
  await mockMcpServerManager.stopAll()
})

describe('mockMcp:server CRUD', () => {
  it('creates with defaults (an echo tool, /mcp, 127.0.0.1) and lists / gets it', async () => {
    const created = await create()
    expect(created).toMatchObject({
      projectId,
      name: 'MCP mock',
      host: '127.0.0.1',
      path: '/mcp',
      authMode: 'none',
      errorMode: { kind: 'none' },
      protocolPin: null,
      enabled: true,
    })
    expect(created.tools.map((t) => t.name)).toEqual(['echo'])

    const list = await invoke<ServerView[]>('mockMcp:server:list', projectId)
    expect(list).toMatchObject({ success: true })
    expect(list.data?.map((s) => s.id)).toEqual([created.id])

    const got = await invoke<ServerView>('mockMcp:server:get', created.id)
    expect(got.data).toEqual(created)
    expect(await invoke('mockMcp:server:get', 'missing')).toEqual({ success: true, data: null })
  })

  it('updates with keep-on-undefined semantics and normalises the path', async () => {
    const created = await create({ protocolPin: '2025-06-18' })
    const upd = await invoke<ServerView>('mockMcp:server:update', created.id, {
      name: 'Renamed',
      path: 'tools/',
    })
    expect(upd.success).toBe(true)
    expect(upd.data).toMatchObject({ name: 'Renamed', path: '/tools', protocolPin: '2025-06-18' })

    const cleared = await invoke<ServerView>('mockMcp:server:update', created.id, {
      protocolPin: null,
    })
    expect(cleared.data?.protocolPin).toBeNull()

    expect(await invoke('mockMcp:server:update', 'missing', { name: 'x' })).toEqual({
      success: false,
      error: 'Mock MCP server not found',
    })
  })

  it('returns readable validation errors instead of writing bad rows', async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ name: '' }, /Name is required/],
      [{ port: 70000 }, /Port must be/],
      [{ protocolPin: '2026-07-28' }, /not a version this mock implements/],
      [
        {
          tools: [
            { name: 'a', inputSchema: { type: 'object' }, response: { kind: 'text', body: '' } },
            { name: 'a', inputSchema: { type: 'object' }, response: { kind: 'text', body: '' } },
          ],
        },
        /Duplicate tool name "a"/,
      ],
      [
        {
          tools: [
            { name: 'b', inputSchema: { type: 'string' }, response: { kind: 'text', body: '' } },
          ],
        },
        /"type": "object"/,
      ],
      [
        {
          tools: [
            { name: 'c', inputSchema: { type: 'object' }, response: { kind: 'json', body: '{' } },
          ],
        },
        /not valid JSON/,
      ],
      [{ resources: [{ name: 'r' }] }, /exactly one of uri or uriTemplate/],
      [{ errorMode: { kind: 'http', httpStatus: 200 } }, /httpStatus must be between 400 and 599/],
    ]
    for (const [over, msg] of cases) {
      const r = await invoke('mockMcp:server:create', { projectId, name: 'x', port: 0, ...over })
      expect(r.success, JSON.stringify(over)).toBe(false)
      expect(r.error).toMatch(msg)
    }
    expect((await invoke('mockMcp:server:create', {})).success).toBe(false)
    expect((await invoke<ServerView[]>('mockMcp:server:list', projectId)).data).toEqual([])
  })

  it('rows die with their project (FK cascade)', async () => {
    await create()
    testDb.prepare('DELETE FROM projects WHERE id = ?').run(projectId)
    expect(
      (testDb.prepare('SELECT COUNT(*) AS n FROM mock_mcp_servers').get() as { n: number }).n,
    ).toBe(0)
  })
})

describe('mockMcp:server lifecycle', () => {
  it('start → running with a bound port and URL; status; stop → stopped', async () => {
    const created = await create()
    const started = await invoke<StateView>('mockMcp:server:start', created.id)
    expect(started.success).toBe(true)
    expect(started.data?.status).toBe('running')
    expect(started.data?.port).toBeGreaterThan(0)
    expect(started.data?.url).toBe(`http://127.0.0.1:${started.data?.port}/mcp`)

    // It is a real listener: GET without a session is 405 per Streamable HTTP.
    expect((await fetch(started.data?.url as string)).status).toBe(405)

    const status = await invoke<StateView>('mockMcp:server:status', created.id)
    expect(status.data).toMatchObject({ status: 'running', port: started.data?.port })

    const stopped = await invoke<StateView>('mockMcp:server:stop', created.id)
    expect(stopped.data).toMatchObject({ status: 'stopped', port: null, url: null })
    expect(await invoke('mockMcp:server:start', 'missing')).toEqual({
      success: false,
      error: 'Mock MCP server not found',
    })
  })

  it('delete stops a running server before removing the row', async () => {
    const created = await create()
    const started = await invoke<StateView>('mockMcp:server:start', created.id)
    const url = started.data?.url as string

    expect(await invoke('mockMcp:server:delete', created.id)).toEqual({ success: true, data: true })
    expect(mockMcpServerManager.status(created.id)).toBe('stopped')
    await expect(fetch(url)).rejects.toThrow()
    expect((await invoke<ServerView[]>('mockMcp:server:list', projectId)).data).toEqual([])
  })

  it('a busy port fails the start with a readable message', async () => {
    const blocker = net.createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()))
    const port = (blocker.address() as net.AddressInfo).port
    try {
      const created = await create({ port })
      const r = await invoke('mockMcp:server:start', created.id)
      expect(r.success).toBe(false)
      expect(r.error).toBe(
        `Port ${port} is already in use on 127.0.0.1. Stop whatever is listening there (another mock server or app) or pick a different port.`,
      )
      expect((await invoke<StateView>('mockMcp:server:status', created.id)).data?.status).toBe(
        'stopped',
      )
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()))
    }
  })

  it('update hot-reloads a running server (new tool visible to a fresh tools/list)', async () => {
    const created = await create()
    const started = await invoke<StateView>('mockMcp:server:start', created.id)
    const upd = await invoke('mockMcp:server:update', created.id, {
      tools: [
        { name: 'pong', inputSchema: { type: 'object' }, response: { kind: 'text', body: 'pong' } },
      ],
    })
    expect(upd.success).toBe(true)
    expect(mockMcpServerManager.status(created.id)).toBe('running')

    const res = await fetch(started.data?.url as string, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    const text = await res.text()
    expect(text).toContain('"name":"pong"')
    expect(text).not.toContain('"name":"echo"')
  })
})

describe('mockMcp:logs', () => {
  it('get returns the running server log, clear empties it', async () => {
    const created = await create()
    const started = await invoke<StateView>('mockMcp:server:start', created.id)
    await fetch(started.data?.url as string, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'logged' } },
      }),
    }).then((r) => r.text())

    await expect
      .poll(async () => (await invoke<unknown[]>('mockMcp:logs:get', created.id)).data?.length)
      .toBe(1)
    const logs = await invoke<{ method: string; toolName?: string; ok: boolean }[]>(
      'mockMcp:logs:get',
      created.id,
    )
    expect(logs.data?.[0]).toMatchObject({ method: 'tools/call', toolName: 'echo', ok: true })

    expect(await invoke('mockMcp:logs:clear', created.id)).toEqual({ success: true, data: true })
    expect((await invoke<unknown[]>('mockMcp:logs:get', created.id)).data).toEqual([])
  })
})

describe('project file — Import Project as new (fresh ids)', () => {
  it('copies mock MCP servers into the new project under fresh ids', async () => {
    const { exportProjectData, importProjectAsNew } =
      await import('../../../src/main/ipc/save.handler')
    const created = await create({ authMode: 'bearer', bearerToken: 't', latencyMs: 25 })
    const workspaceId = (
      testDb.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(projectId) as {
        workspace_id: string
      }
    ).workspace_id
    const data = exportProjectData(projectId)
    expect(data.mockMcpServers?.length).toBe(1)

    const { projectId: newProjectId } = importProjectAsNew(data, workspaceId)
    const copies = (await invoke<ServerView[]>('mockMcp:server:list', newProjectId)).data ?? []
    expect(copies.length).toBe(1)
    expect(copies[0].id).not.toBe(created.id)
    expect(copies[0]).toMatchObject({
      name: 'MCP mock',
      authMode: 'bearer',
      projectId: newProjectId,
    })
    expect(copies[0].tools.map((t) => t.name)).toEqual(['echo'])
    // The source keeps its own row.
    expect((await invoke<ServerView[]>('mockMcp:server:list', projectId)).data?.length).toBe(1)
  })
})
