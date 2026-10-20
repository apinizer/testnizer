/**
 * Smoke tests for `mock:*` IPC handlers.
 *
 * We stub the long-running `mockServerManager` (real network listeners would
 * leak between tests) and the OpenAPI/Postman importer helpers. The DB
 * repos are exercised against an in-memory better-sqlite3.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

class FakeMockManager extends EventEmitter {
  private statusMap = new Map<string, 'running' | 'stopped'>()
  start = vi.fn(async (def: { id: string }) => {
    this.statusMap.set(def.id, 'running')
    return { ok: true as const }
  })
  stop = vi.fn(async (id: string) => {
    this.statusMap.set(id, 'stopped')
  })
  status = (id: string): 'running' | 'stopped' => this.statusMap.get(id) ?? 'stopped'
  update = vi.fn(async () => {})
  getLogs = vi.fn(() => [])
  clearLogs = vi.fn(() => {})
}
const fakeManager = new FakeMockManager()

vi.mock('../../../src/main/mock/server', () => ({
  mockServerManager: fakeManager,
}))

vi.mock('../../../src/main/mock/importers', () => ({
  importOpenApi: vi.fn(async () => ({ created: 1 })),
  importPostman: vi.fn(() => ({ created: 1 })),
}))

const { registerMockHandlers } = await import('../../../src/main/ipc/mock.handler')

let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerMockHandlers()
})

describe('mock:server CRUD', () => {
  it('creates and lists a mock server', async () => {
    const created = (await harness.invoke('mock:server:create', {
      projectId,
      name: 'mock-1',
      host: '127.0.0.1',
      port: 3000,
      basePath: '',
    })) as { success: boolean; data?: { id: string } }
    expect(created.success).toBe(true)

    const list = (await harness.invoke('mock:server:list', projectId)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)
    expect(list.data?.length).toBe(1)
  })

  it('returns error envelope on missing required fields', async () => {
    const res = (await harness.invoke('mock:server:create', {})) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
  })

  it('updates an existing server', async () => {
    const created = (await harness.invoke('mock:server:create', {
      projectId,
      name: 'mock-1',
      host: '127.0.0.1',
      port: 3000,
      basePath: '',
    })) as { data: { id: string } }
    const upd = (await harness.invoke('mock:server:update', created.data.id, {
      name: 'renamed',
    })) as { success: boolean }
    expect(upd.success).toBe(true)
  })
})

describe('mock:server lifecycle', () => {
  it('start + stop + status', async () => {
    const created = (await harness.invoke('mock:server:create', {
      projectId,
      name: 'mock-1',
      host: '127.0.0.1',
      port: 3000,
      basePath: '',
    })) as { data: { id: string } }

    const start = (await harness.invoke('mock:server:start', created.data.id)) as {
      success: boolean
      data?: { status: string }
    }
    expect(start.success).toBe(true)

    const status = (await harness.invoke('mock:server:status', created.data.id)) as {
      success: boolean
      data?: { status: string }
    }
    expect(status.success).toBe(true)
    expect(status.data?.status).toBe('running')

    const stop = (await harness.invoke('mock:server:stop', created.data.id)) as {
      success: boolean
    }
    expect(stop.success).toBe(true)
  })
})

describe('mock:endpoint + mock:response', () => {
  it('CRUDs an endpoint under a server', async () => {
    const srv = (await harness.invoke('mock:server:create', {
      projectId,
      name: 'mock-1',
      host: '127.0.0.1',
      port: 3000,
      basePath: '',
    })) as { data: { id: string } }

    const ep = (await harness.invoke('mock:endpoint:create', {
      serverId: srv.data.id,
      method: 'GET',
      path: '/users',
    })) as { success: boolean; data?: { id: string } }
    expect(ep.success).toBe(true)

    const list = (await harness.invoke('mock:endpoint:list', srv.data.id)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)
    expect(list.data?.length).toBe(1)
  })

  it('creates a response under an endpoint', async () => {
    const srv = (await harness.invoke('mock:server:create', {
      projectId,
      name: 'mock-1',
      host: '127.0.0.1',
      port: 3000,
      basePath: '',
    })) as { data: { id: string } }
    const ep = (await harness.invoke('mock:endpoint:create', {
      serverId: srv.data.id,
      method: 'GET',
      path: '/users',
    })) as { data: { id: string } }

    const r = (await harness.invoke('mock:response:create', {
      endpointId: ep.data.id,
      statusCode: 200,
      bodyType: 'json',
      body: '{}',
    })) as { success: boolean; data?: { id: string } }
    expect(r.success).toBe(true)
  })
})

describe('mock:import:* + mock:logs:*', () => {
  it('logs:get + logs:clear return envelopes', async () => {
    const get = (await harness.invoke('mock:logs:get', 'srv')) as { success: boolean }
    expect(get.success).toBe(true)
    const clr = (await harness.invoke('mock:logs:clear', 'srv')) as { success: boolean }
    expect(clr.success).toBe(true)
  })

  it('import:openapi returns success envelope', async () => {
    const res = (await harness.invoke(
      'mock:import:openapi',
      'srv-id',
      'openapi: 3.0',
    )) as { success: boolean; data?: { created: number } }
    expect(res.success).toBe(true)
    expect(res.data?.created).toBe(1)
  })

  it('import:postman returns success envelope', async () => {
    const res = (await harness.invoke(
      'mock:import:postman',
      'srv-id',
      '{}',
    )) as { success: boolean }
    expect(res.success).toBe(true)
  })
})

// ─── Issue #221 (Faz 0): server kind + response stream_config ────

describe('mock server kind + response stream_config (issue #221)', () => {
  type View = { success: boolean; error?: string; data?: Record<string, unknown> }

  const createServer = (over: Record<string, unknown> = {}): Promise<View> =>
    harness.invoke('mock:server:create', {
      projectId,
      name: 'mock-k',
      port: 3100,
      ...over,
    }) as Promise<View>

  it('defaults kind to http when absent — an old caller creates an HTTP server', async () => {
    const r = await createServer()
    expect(r.success).toBe(true)
    expect(r.data?.kind).toBe('http')
    expect(
      testDb.prepare('SELECT kind FROM mock_servers WHERE id = ?').get(r.data!.id as string),
    ).toEqual({ kind: 'http' })
  })

  it('stores sse / ai and returns them from get + list', async () => {
    const sse = await createServer({ kind: 'sse' })
    const ai = await createServer({ kind: 'ai', port: 3101 })
    expect(sse.data?.kind).toBe('sse')
    expect(ai.data?.kind).toBe('ai')
    const got = (await harness.invoke('mock:server:get', sse.data!.id)) as View
    expect(got.data?.kind).toBe('sse')
    const list = (await harness.invoke('mock:server:list', projectId)) as {
      data: { kind: string }[]
    }
    expect(list.data.map((s) => s.kind)).toEqual(['sse', 'ai'])
  })

  it('rejects an unknown kind on create (MCP is its own table) and writes nothing', async () => {
    for (const kind of ['mcp', 'x']) {
      const r = await createServer({ kind })
      expect(r.success).toBe(false)
      expect(r.error).toMatch(/Unknown mock server kind/)
    }
    expect(testDb.prepare('SELECT COUNT(*) AS n FROM mock_servers').get()).toEqual({ n: 0 })
  })

  it('kind is fixed at creation — update ignores it', async () => {
    const r = await createServer({ kind: 'sse' })
    const up = (await harness.invoke('mock:server:update', r.data!.id, {
      name: 'renamed',
      kind: 'ai',
    })) as View
    expect(up.success).toBe(true)
    expect(up.data).toMatchObject({ name: 'renamed', kind: 'sse' })
    expect(
      testDb.prepare('SELECT kind FROM mock_servers WHERE id = ?').get(r.data!.id as string),
    ).toEqual({ kind: 'sse' })
  })

  it('a stored unknown kind (file from another build) reads back as http, raw value untouched', async () => {
    const r = await createServer()
    testDb.prepare("UPDATE mock_servers SET kind = 'future' WHERE id = ?").run(r.data!.id)
    const got = (await harness.invoke('mock:server:get', r.data!.id)) as View
    expect(got.data?.kind).toBe('http')
    expect(
      testDb.prepare('SELECT kind FROM mock_servers WHERE id = ?').get(r.data!.id as string),
    ).toEqual({ kind: 'future' })
  })

  async function endpointId(): Promise<string> {
    const srv = await createServer({ kind: 'sse' })
    const ep = (await harness.invoke('mock:endpoint:create', {
      serverId: srv.data!.id,
      method: 'GET',
      path: '/events',
    })) as { data: { id: string } }
    return ep.data.id
  }

  const STREAM = { intervalMs: 1000, heartbeatMs: 15000, loop: true }

  it('round-trips stream_config on create; absent → null', async () => {
    const ep = await endpointId()
    const plain = (await harness.invoke('mock:response:create', {
      endpointId: ep,
      body: '{}',
      order: 0,
    })) as View
    expect(plain.data?.streamConfig).toBeNull()
    const streamed = (await harness.invoke('mock:response:create', {
      endpointId: ep,
      bodyType: 'json',
      body: 'data: hi',
      streamConfig: STREAM,
      order: 1,
    })) as View
    expect(streamed.success).toBe(true)
    expect(streamed.data?.streamConfig).toEqual(STREAM)
    expect(
      testDb
        .prepare('SELECT stream_config FROM mock_responses WHERE id = ?')
        .get(streamed.data!.id as string),
    ).toEqual({ stream_config: JSON.stringify(STREAM) })
    const list = (await harness.invoke('mock:response:list', ep)) as {
      data: { streamConfig: unknown }[]
    }
    expect(list.data.map((r) => r.streamConfig)).toEqual([null, STREAM])
  })

  it('update: undefined keeps stream_config, an object sets it, null clears it', async () => {
    const ep = await endpointId()
    const r = (await harness.invoke('mock:response:create', {
      endpointId: ep,
      streamConfig: STREAM,
    })) as View
    const id = r.data!.id as string
    const kept = (await harness.invoke('mock:response:update', id, { name: 'n' })) as View
    expect(kept.data?.streamConfig).toEqual(STREAM)
    const set = (await harness.invoke('mock:response:update', id, {
      streamConfig: { intervalMs: 5 },
    })) as View
    expect(set.data?.streamConfig).toEqual({ intervalMs: 5 })
    const cleared = (await harness.invoke('mock:response:update', id, {
      streamConfig: null,
    })) as View
    expect(cleared.data?.streamConfig).toBeNull()
    expect(testDb.prepare('SELECT stream_config FROM mock_responses WHERE id = ?').get(id)).toEqual(
      { stream_config: null },
    )
  })

  it('a stored non-object / corrupt stream_config reads back as null', async () => {
    const ep = await endpointId()
    const r = (await harness.invoke('mock:response:create', { endpointId: ep })) as View
    const id = r.data!.id as string
    for (const raw of ['not json', '[1,2]', '42']) {
      testDb.prepare('UPDATE mock_responses SET stream_config = ? WHERE id = ?').run(raw, id)
      const list = (await harness.invoke('mock:response:list', ep)) as {
        data: { streamConfig: unknown }[]
      }
      expect(list.data[0].streamConfig).toBeNull()
    }
  })
})
