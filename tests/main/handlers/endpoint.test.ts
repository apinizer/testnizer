/**
 * Smoke tests for `endpoint:*`, `endpointCase:*`, `savedRequest:*` and
 * `tree:move` IPC handlers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { registerEndpointHandlers } = await import('../../../src/main/ipc/endpoint.handler')

let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerEndpointHandlers()
})

describe('endpoint:create + listByProject + get', () => {
  it('creates and retrieves an endpoint', async () => {
    const created = (await harness.invoke('endpoint:create', {
      project_id: projectId,
      name: 'List users',
      method: 'GET',
      path: '/users',
    })) as { success: boolean; data?: { id: string } }
    expect(created.success).toBe(true)
    expect(typeof created.data?.id).toBe('string')

    const got = (await harness.invoke('endpoint:get', created.data!.id)) as {
      success: boolean
      data?: { method: string }
    }
    expect(got.data?.method).toBe('GET')

    const list = (await harness.invoke('endpoint:listByProject', projectId)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)
    expect(Array.isArray(list.data)).toBe(true)
  })

  it('rejects missing required fields with error envelope', async () => {
    const res = (await harness.invoke('endpoint:create', {
      name: 'no project',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
  })
})

describe('endpoint:update + delete', () => {
  it('updates and deletes endpoints', async () => {
    const created = (await harness.invoke('endpoint:create', {
      project_id: projectId,
      name: 'E',
      method: 'GET',
      path: '/x',
    })) as { data: { id: string } }

    const upd = (await harness.invoke('endpoint:update', created.data.id, {
      name: 'Renamed',
    })) as { success: boolean }
    expect(upd.success).toBe(true)

    const del = (await harness.invoke('endpoint:delete', created.data.id)) as {
      success: boolean
    }
    expect(del.success).toBe(true)
  })
})

describe('endpointCase:* and savedRequest:*', () => {
  it('creates cases and lists them', async () => {
    const ep = (await harness.invoke('endpoint:create', {
      project_id: projectId,
      name: 'E',
      method: 'GET',
      path: '/x',
    })) as { data: { id: string } }

    const c = (await harness.invoke('endpointCase:create', {
      endpoint_id: ep.data.id,
      name: 'case1',
    })) as { success: boolean; data?: { id: string } }
    expect(c.success).toBe(true)

    const list = (await harness.invoke('endpointCase:list', ep.data.id)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)
  })

  it('creates and lists saved requests', async () => {
    const sr = (await harness.invoke('savedRequest:create', {
      project_id: projectId,
      name: 'SR',
      method: 'GET',
      url: 'https://example.com',
    })) as { success: boolean; data?: { id: string } }
    expect(sr.success).toBe(true)

    const list = (await harness.invoke('savedRequest:list', projectId)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)
  })
})

describe('tree:move', () => {
  it('returns success: false when the source node does not exist', async () => {
    const res = (await harness.invoke('tree:move', {
      nodeId: 'no-such-node',
      nodeType: 'endpoint',
      targetFolderId: null,
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toBeDefined()
  })
})
