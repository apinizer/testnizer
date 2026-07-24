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

describe('scheduler — run lifecycle phases (issue #72)', () => {
  it('stores setup/teardown ids and the run hook scripts', async () => {
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Nightly with cleanup',
      endpointIds: ['flow-1'],
      setupEndpointIds: ['setup-1'],
      teardownEndpointIds: ['cleanup-1', 'cleanup-2'],
      runPreScript: 'pm.environment.set("t", "1")',
      runPostScript: 'pm.environment.unset("t")',
      intervalValue: 1,
      intervalUnit: 'hours',
    })) as {
      success: boolean
      data?: {
        setup_endpoint_ids: string | null
        teardown_endpoint_ids: string | null
        run_pre_script: string | null
        run_post_script: string | null
      }
    }

    expect(created.success).toBe(true)
    // A scheduled run must execute the SAME phases as the interactive run it
    // was created from — sending the flat list would demote cleanup requests to
    // flow requests, whose failures count against the verdict.
    expect(JSON.parse(created.data!.setup_endpoint_ids!)).toEqual(['setup-1'])
    expect(JSON.parse(created.data!.teardown_endpoint_ids!)).toEqual(['cleanup-1', 'cleanup-2'])
    expect(created.data!.run_pre_script).toContain('pm.environment.set')
    expect(created.data!.run_post_script).toContain('pm.environment.unset')
  })

  it('leaves the phase columns NULL for a task created without phases', async () => {
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Plain task',
      endpointIds: ['ep-1'],
      intervalValue: 30,
      intervalUnit: 'minutes',
    })) as {
      success: boolean
      data?: { setup_endpoint_ids: string | null; teardown_endpoint_ids: string | null }
    }

    // Pre-#72 rows behave exactly as before: everything is flow.
    expect(created.data!.setup_endpoint_ids).toBeNull()
    expect(created.data!.teardown_endpoint_ids).toBeNull()
  })
})
