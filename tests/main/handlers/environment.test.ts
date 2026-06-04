/**
 * Smoke tests for `environment:*`, `envVariable:*` and `globalVariable:*`
 * IPC handlers.
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

const { registerEnvironmentHandlers } = await import(
  '../../../src/main/ipc/environment.handler'
)

let workspaceId: string
let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  registerEnvironmentHandlers()
})

describe('environment:create + list', () => {
  it('creates an environment and lists it back', async () => {
    const created = (await harness.invoke('environment:create', {
      workspace_id: workspaceId,
      project_id: projectId,
      name: 'dev',
    })) as { success: boolean; data?: { id: string } }
    expect(created.success).toBe(true)
    expect(typeof created.data?.id).toBe('string')

    const list = (await harness.invoke('environment:list', workspaceId)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)
    expect(Array.isArray(list.data)).toBe(true)
    expect(list.data!.length).toBeGreaterThan(0)
  })

  it('lists by project', async () => {
    await harness.invoke('environment:create', {
      workspace_id: workspaceId,
      project_id: projectId,
      name: 'dev',
    })
    const list = (await harness.invoke('environment:listByProject', projectId)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)
  })

  it('returns error envelope on missing required workspace_id', async () => {
    const res = (await harness.invoke('environment:create', { name: 'x' })) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
    expect(typeof res.error).toBe('string')
  })
})

describe('environment:update + setActive + delete', () => {
  it('flows through the lifecycle', async () => {
    const e = (await harness.invoke('environment:create', {
      workspace_id: workspaceId,
      name: 'e',
    })) as { data: { id: string } }

    const upd = (await harness.invoke('environment:update', e.data.id, {
      name: 'r',
    })) as { success: boolean }
    expect(upd.success).toBe(true)

    const set = (await harness.invoke(
      'environment:setActive',
      workspaceId,
      e.data.id,
    )) as { success: boolean }
    expect(set.success).toBe(true)

    const del = (await harness.invoke('environment:delete', e.data.id)) as {
      success: boolean
    }
    expect(del.success).toBe(true)
  })
})

describe('envVariable:* and globalVariable:*', () => {
  it('creates and lists environment variables', async () => {
    const env = (await harness.invoke('environment:create', {
      workspace_id: workspaceId,
      name: 'e',
    })) as { data: { id: string } }

    const v = (await harness.invoke('envVariable:create', {
      environment_id: env.data.id,
      key: 'k',
      value: 'v',
    })) as { success: boolean; data?: { id: string } }
    expect(v.success).toBe(true)

    const list = (await harness.invoke('envVariable:list', env.data.id)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)
  })

  it('creates and lists global variables', async () => {
    const g = (await harness.invoke('globalVariable:create', {
      workspace_id: workspaceId,
      project_id: projectId,
      key: 'KEY',
      value: 'VAL',
    })) as { success: boolean; data?: { id: string } }
    expect(g.success).toBe(true)

    const list = (await harness.invoke('globalVariable:list', workspaceId)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)

    const projList = (await harness.invoke('globalVariable:listByProject', projectId)) as {
      success: boolean
      data?: unknown[]
    }
    expect(projList.success).toBe(true)
  })

  it('returns error envelope on bogus envVariable payload', async () => {
    const res = (await harness.invoke('envVariable:create', {})) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
  })
})
