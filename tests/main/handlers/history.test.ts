/**
 * Smoke tests for `history:*` IPC handlers.
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

const { registerHistoryHandlers } = await import('../../../src/main/ipc/history.handler')

let workspaceId: string
let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  registerHistoryHandlers()
})

describe('history:add + list', () => {
  it('adds an entry and lists it back', async () => {
    const added = (await harness.invoke('history:add', {
      workspace_id: workspaceId,
      project_id: projectId,
      protocol: 'http',
      method: 'GET',
      url: 'https://example.com',
      status_code: 200,
      duration_ms: 12,
      request_snapshot: '{}',
    })) as { success: boolean; data?: { id: string } }
    expect(added.success).toBe(true)
    expect(typeof added.data?.id).toBe('string')

    const listed = (await harness.invoke('history:list', {
      workspace_id: workspaceId,
    })) as { success: boolean; data?: unknown[] }
    expect(listed.success).toBe(true)
    expect(Array.isArray(listed.data)).toBe(true)
    expect(listed.data!.length).toBeGreaterThan(0)
  })

  it('errors when required fields are missing', async () => {
    const res = (await harness.invoke('history:add', {})) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
  })
})

describe('history:get + delete + clear + prune', () => {
  it('round-trips a get + delete', async () => {
    const added = (await harness.invoke('history:add', {
      protocol: 'http',
      method: 'GET',
      url: 'https://example.com',
      request_snapshot: '{}',
    })) as { data: { id: string } }

    const got = (await harness.invoke('history:get', added.data.id)) as {
      success: boolean
      data?: { id: string }
    }
    expect(got.success).toBe(true)
    expect(got.data?.id).toBe(added.data.id)

    const del = (await harness.invoke('history:delete', added.data.id)) as {
      success: boolean
    }
    expect(del.success).toBe(true)
  })

  it('clears and prunes without throwing', async () => {
    const clear = (await harness.invoke('history:clear', { workspace_id: workspaceId })) as {
      success: boolean
    }
    expect(clear.success).toBe(true)

    const prune = (await harness.invoke('history:prune', 10, workspaceId)) as {
      success: boolean
    }
    expect(prune.success).toBe(true)
  })
})
