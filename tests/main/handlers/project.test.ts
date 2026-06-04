/**
 * Smoke tests for `project:*` and `folder:*` IPC handlers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedWorkspace,
} from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { registerProjectHandlers } = await import('../../../src/main/ipc/project.handler')

let workspaceId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  registerProjectHandlers()
})

describe('project:create + list + get', () => {
  it('round-trips a project through create/get/list', async () => {
    const created = (await harness.invoke('project:create', {
      workspace_id: workspaceId,
      name: 'Proj',
    })) as { success: boolean; data?: { id: string } }
    expect(created.success).toBe(true)

    const got = (await harness.invoke('project:get', created.data!.id)) as {
      success: boolean
      data?: { name: string }
    }
    expect(got.data?.name).toBe('Proj')

    const list = (await harness.invoke('project:list', workspaceId)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)
    expect(Array.isArray(list.data)).toBe(true)
    expect(list.data!.length).toBeGreaterThan(0)
  })

  it('fails with error envelope when workspace_id is missing', async () => {
    const res = (await harness.invoke('project:create', { name: 'x' })) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
    expect(typeof res.error).toBe('string')
  })
})

describe('project:update + delete', () => {
  it('updates and then deletes a project', async () => {
    const created = (await harness.invoke('project:create', {
      workspace_id: workspaceId,
      name: 'Proj',
    })) as { data: { id: string } }
    const upd = (await harness.invoke('project:update', created.data.id, {
      name: 'New',
    })) as { success: boolean }
    expect(upd.success).toBe(true)

    const del = (await harness.invoke('project:delete', created.data.id)) as {
      success: boolean
    }
    expect(del.success).toBe(true)
  })
})

describe('folder:create + list', () => {
  it('creates and lists folders for a project', async () => {
    const proj = (await harness.invoke('project:create', {
      workspace_id: workspaceId,
      name: 'P',
    })) as { data: { id: string } }
    const fol = (await harness.invoke('folder:create', {
      project_id: proj.data.id,
      name: 'Folder',
    })) as { success: boolean; data?: { id: string } }
    expect(fol.success).toBe(true)

    const list = (await harness.invoke('folder:list', proj.data.id)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)
    expect(Array.isArray(list.data)).toBe(true)
  })

  it('errors when required folder fields are missing', async () => {
    const res = (await harness.invoke('folder:create', { name: 'x' })) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
  })
})
