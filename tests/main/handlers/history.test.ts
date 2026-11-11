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

  it('history:count reports exactly what history:clear then deletes (same scope rule)', async () => {
    const otherProject = seedProject(testDb, workspaceId, 'Project 2')
    const add = (project_id: string | undefined, ws: string | undefined) =>
      harness.invoke('history:add', {
        workspace_id: ws,
        project_id,
        protocol: 'http',
        method: 'GET',
        url: 'https://example.com',
        request_snapshot: '{}',
      })
    await add(projectId, workspaceId)
    await add(projectId, workspaceId)
    await add(otherProject, workspaceId)
    await add(undefined, undefined) // no workspace: only an unscoped clear removes it

    const count = (scope?: unknown) =>
      harness.invoke('history:count', scope) as Promise<{ success: boolean; data: number }>

    expect((await count({ project_id: projectId })).data).toBe(2)
    // A bare workspace id string is the sidebar's call — every project in it.
    expect((await count(workspaceId)).data).toBe(3)
    expect((await count()).data).toBe(4)

    // The History sidebar + Settings → Data scope: one project; the other keeps its row.
    const byProject = (await harness.invoke('history:clear', { project_id: projectId })) as {
      data: number
    }
    expect(byProject.data).toBe(2)
    expect((await count({ project_id: projectId })).data).toBe(0)
    expect((await count({ project_id: otherProject })).data).toBe(1)

    const cleared = (await harness.invoke('history:clear', workspaceId)) as { data: number }
    expect(cleared.data).toBe(1)
    expect((await count(workspaceId)).data).toBe(0)
    expect((await count()).data).toBe(1)
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
