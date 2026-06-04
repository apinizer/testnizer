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
