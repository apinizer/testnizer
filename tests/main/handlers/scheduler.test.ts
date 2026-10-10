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

describe('scheduler — stopOnError parity', () => {
  /** Reads a task row back through the list handler. */
  async function row(id: string): Promise<Record<string, unknown>> {
    const listed = (await harness.invoke('scheduler:list', projectId)) as {
      data?: Record<string, unknown>[]
    }
    const found = listed.data?.find((t) => t.id === id)
    if (!found) throw new Error(`task ${id} not found`)
    return found
  }

  it('stores the stopOnError choice', async () => {
    const on = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Halting',
      endpointIds: ['ep-1'],
      intervalValue: 1,
      intervalUnit: 'hours',
      stopOnError: true,
    })) as { success: boolean; data?: { id: string; stop_on_error: number } }
    const off = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Carry on',
      endpointIds: ['ep-1'],
      intervalValue: 1,
      intervalUnit: 'hours',
      stopOnError: false,
    })) as { success: boolean; data?: { id: string; stop_on_error: number } }

    expect(on.data!.stop_on_error).toBe(1)
    expect(off.data!.stop_on_error).toBe(0)
  })

  it('defaults to ON when omitted, matching the interactive runner', async () => {
    // A task created before the column existed reads NULL, and the handler's
    // `!== 0` puts it on the same (safer) side as this default.
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Legacy shape',
      endpointIds: ['ep-1'],
      intervalValue: 1,
      intervalUnit: 'hours',
    })) as { success: boolean; data?: { stop_on_error: number } }

    expect(created.data!.stop_on_error).toBe(1)
  })

  it('keeps the run lifecycle when a task is EDITED', async () => {
    // The UPDATE statement used to omit these five columns entirely, so editing
    // a schedule's interval silently demoted its setup/teardown requests back to
    // ordinary flow steps and discarded both hook scripts.
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Nightly',
      endpointIds: ['flow-1'],
      setupEndpointIds: ['setup-1'],
      teardownEndpointIds: ['cleanup-1'],
      runPreScript: 'pm.environment.set("t","1")',
      runPostScript: 'pm.environment.unset("t")',
      intervalValue: 1,
      intervalUnit: 'hours',
      stopOnError: false,
    })) as { success: boolean; data?: { id: string } }
    const id = created.data!.id

    const updated = (await harness.invoke('scheduler:update', {
      id,
      projectId,
      name: 'Nightly (edited)',
      endpointIds: ['flow-1'],
      setupEndpointIds: ['setup-1'],
      teardownEndpointIds: ['cleanup-1'],
      runPreScript: 'pm.environment.set("t","1")',
      runPostScript: 'pm.environment.unset("t")',
      intervalValue: 2,
      intervalUnit: 'hours',
      stopOnError: false,
    })) as { success: boolean }

    expect(updated.success).toBe(true)
    const after = await row(id)
    expect(after.name).toBe('Nightly (edited)')
    expect(JSON.parse(after.setup_endpoint_ids as string)).toEqual(['setup-1'])
    expect(JSON.parse(after.teardown_endpoint_ids as string)).toEqual(['cleanup-1'])
    expect(after.run_pre_script).toContain('pm.environment.set')
    expect(after.run_post_script).toContain('pm.environment.unset')
    expect(after.stop_on_error).toBe(0)
  })
})

describe('scheduler:taskEndpoints — protocol for the chip (issue #173)', () => {
  it('returns each row’s protocol so an MCP item lists as MCP, not its placeholder GET', async () => {
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
         VALUES ('suite-1', ?, 'Suite', 0, ?, ?)`,
      )
      .run(projectId, now, now)
    const item = testDb.prepare(
      `INSERT INTO test_suite_items
         (id, suite_id, folder_id, protocol, name, method, url, request_schema, assertions,
          source_endpoint_id, sort_order, created_at, updated_at)
       VALUES (?, 'suite-1', NULL, ?, ?, 'GET', ?, '{}', NULL, NULL, 0, ?, ?)`,
    )
    item.run('it-mcp', 'mcp', 'Echo tool', 'http://x/mcp', now, now)
    item.run('it-http', 'http', 'Health', 'http://x/health', now, now)
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Nightly',
      suiteId: 'suite-1',
      endpointIds: ['it-mcp', 'it-http'],
      intervalValue: 60,
      intervalUnit: 'minutes',
    })) as { success: boolean; data?: { id: string } }
    const res = (await harness.invoke('scheduler:taskEndpoints', created.data!.id)) as {
      success: boolean
      data?: { items: Array<{ id: string; protocol?: string }> }
    }
    expect(res.data?.items.map((i) => [i.id, i.protocol])).toEqual([
      ['it-mcp', 'mcp'],
      ['it-http', 'http'],
    ])
  })
})
