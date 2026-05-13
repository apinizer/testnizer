/**
 * Smoke tests for `scheduler:*` IPC handlers.
 *
 * `runner.handler` is imported lazily by the scheduler when a task fires —
 * we stub it so the import doesn't drag in the entire runner stack.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

vi.mock('../../../src/main/ipc/runner.handler', () => ({
  executeCollectionForScheduler: async () => ({ results: [], summary: {} }),
  registerRunnerHandlers: () => {},
}))

const schedulerModule = await import('../../../src/main/ipc/scheduler.handler')
const { registerSchedulerHandlers, stopAllSchedulers } = schedulerModule

let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerSchedulerHandlers()
})

afterEach(() => {
  // Each `scheduler:create` spawns a setInterval — clean those up so they
  // don't fire after the suite ends or leak handles between tests.
  stopAllSchedulers()
})

describe('scheduler:create + list', () => {
  it('creates a task and lists it back', async () => {
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Daily ping',
      endpointIds: ['ep-1', 'ep-2'],
      intervalValue: 60,
      intervalUnit: 'minutes',
    })) as { success: boolean; data?: { id: string } }
    expect(created.success).toBe(true)
    expect(typeof created.data?.id).toBe('string')

    const list = (await harness.invoke('scheduler:list', projectId)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)
    expect(Array.isArray(list.data)).toBe(true)
    expect(list.data!.length).toBeGreaterThan(0)
  })

  it('returns an empty list for an unknown project', async () => {
    const res = (await harness.invoke('scheduler:list', 'no-such-project')) as {
      success: boolean
      data?: unknown[]
    }
    expect(res.success).toBe(true)
    expect(res.data).toEqual([])
  })
})

describe('scheduler:toggle + delete', () => {
  it('toggles enabled state and deletes the task', async () => {
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'T',
      endpointIds: ['ep'],
      intervalValue: 60,
      intervalUnit: 'minutes',
    })) as { data: { id: string } }

    const t1 = (await harness.invoke('scheduler:toggle', created.data.id)) as {
      success: boolean
      data?: { enabled: number }
    }
    expect(t1.success).toBe(true)
    expect(t1.data?.enabled).toBe(0)

    const t2 = (await harness.invoke('scheduler:toggle', created.data.id)) as {
      data?: { enabled: number }
    }
    expect(t2.data?.enabled).toBe(1)

    const del = (await harness.invoke('scheduler:delete', created.data.id)) as {
      success: boolean
    }
    expect(del.success).toBe(true)
  })

  it('toggle returns error envelope for unknown task', async () => {
    const res = (await harness.invoke('scheduler:toggle', 'no-such-id')) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
  })
})
