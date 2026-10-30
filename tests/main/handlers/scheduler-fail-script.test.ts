/**
 * Issue #267 — a SCHEDULED task persists and executes the run fail script
 * without any window (scheduled runs are the feature's main consumer).
 *
 * ── CONTRACT ───────────────────────────────────────────────────────────────
 *  - DB: `scheduled_tasks.run_fail_script TEXT` (nullable). Production ALTER in
 *    `src/main/db/database.ts` (next to `run_pre_script` / `run_post_script`) AND
 *    the mirror in `tests/main/handlers/helpers.ts` `createTestDb()` (and the
 *    manual copy in `tests/main/schema-sync.test.ts`).
 *  - `scheduler:create` / `scheduler:update` accept `runFailScript?: string`,
 *    store it in `run_fail_script` (`|| null`), and `scheduler:update` keeps it
 *    when the task is edited (the UPDATE statement once dropped the lifecycle
 *    columns — do not repeat that).
 *  - `executeScheduledRun` forwards `runFailScript: task.run_fail_script ||
 *    undefined` to `executeCollectionForScheduler`, so the hook fires exactly as
 *    in an interactive run (semantics: runner-fail-script.test.ts).
 *
 * This file uses the REAL runner (scheduler.test.ts stubs it) and a mocked
 * Electron whose `BrowserWindow.getAllWindows()` is empty: no renderer exists.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
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
vi.mock('../../../src/main/db/database', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/db/database')>()),
  getDb: () => testDb,
}))

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')
const { registerSchedulerHandlers, stopAllSchedulers } = await import(
  '../../../src/main/ipc/scheduler.handler'
)

let server: Server
let port = 0
let received: string[] = []

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      req.resume()
      req.on('end', () => {
        received.push(req.url ?? '/')
        if (req.url === '/fail') {
          res.writeHead(500)
          res.end('boom')
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"ok":true}')
      })
    })
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port
      resolve()
    })
  })
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

let workspaceId: string
let projectId: string

function seedEndpoint(path: string): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = JSON.stringify({
    method: 'GET',
    url: `http://127.0.0.1:${port}${path}`,
    params: [],
    headers: [],
    auth: { type: 'none' },
    assertions: [],
  })
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'http', 'GET', ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, path, path, schema, now, now)
  return id
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  received = []
  registerRunnerHandlers()
  registerSchedulerHandlers()
})

afterEach(() => {
  stopAllSchedulers()
  testDb.close()
})

const HOOK = (path: string): string =>
  `await pm.sendRequest({ url: 'http://127.0.0.1:${port}${path}', method: 'POST', ` +
  `header: { 'Content-Type': 'text/plain' }, body: { mode: 'raw', raw: 'x' } })`

interface TaskRow {
  id: string
  run_fail_script: string | null
}

async function listTask(id: string): Promise<TaskRow> {
  const listed = (await harness.invoke('scheduler:list', projectId)) as { data?: TaskRow[] }
  const found = listed.data?.find((t) => t.id === id)
  if (!found) throw new Error(`task ${id} not found`)
  return found
}

describe('schema mirror — run_fail_script exists in the test DB and in production migrations', () => {
  const cols = (db: { pragma: (s: string) => unknown }): string[] =>
    (db.pragma('table_info(scheduled_tasks)') as Array<{ name: string }>).map((c) => c.name)

  it('createTestDb() (tests/main/handlers/helpers.ts) mirrors the new column', () => {
    expect(cols(testDb)).toContain('run_fail_script')
  })

  it('the real migrations (openAndMigrate) create it', async () => {
    const { openAndMigrate } = await import('../../../src/main/db/database')
    const prod = openAndMigrate(':memory:')
    try {
      expect(cols(prod)).toContain('run_fail_script')
    } finally {
      prod.close()
    }
  })
})

describe('scheduler:create / update persist runFailScript', () => {
  it('create stores it beside the other hook scripts', async () => {
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Nightly',
      endpointIds: ['e1'],
      runPreScript: 'pm.environment.set("a","1")',
      runPostScript: 'pm.environment.unset("a")',
      runFailScript: 'await pm.sendRequest("https://hooks.test/alert")',
      intervalValue: 1,
      intervalUnit: 'hours',
    })) as { success: boolean; data?: TaskRow & { run_pre_script: string; run_post_script: string } }
    expect(created.success).toBe(true)
    expect(created.data!.run_fail_script).toBe('await pm.sendRequest("https://hooks.test/alert")')
    expect(created.data!.run_pre_script).toContain('pm.environment.set')
    expect(created.data!.run_post_script).toContain('pm.environment.unset')
  })

  it('a task created without one stores NULL', async () => {
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Plain',
      endpointIds: ['e1'],
      intervalValue: 1,
      intervalUnit: 'hours',
    })) as { data: TaskRow }
    expect(created.data.run_fail_script).toBeNull()
  })

  it('editing the task keeps the fail script, and clearing it stores NULL', async () => {
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Nightly',
      endpointIds: ['e1'],
      runFailScript: 'pm.test("a", () => {})',
      intervalValue: 1,
      intervalUnit: 'hours',
    })) as { data: TaskRow }
    const id = created.data.id

    const base = {
      id,
      projectId,
      name: 'Nightly (edited)',
      endpointIds: ['e1'],
      intervalValue: 2,
      intervalUnit: 'hours',
    }
    const kept = (await harness.invoke('scheduler:update', {
      ...base,
      runFailScript: 'pm.test("a", () => {})',
    })) as { success: boolean }
    expect(kept.success).toBe(true)
    expect((await listTask(id)).run_fail_script).toBe('pm.test("a", () => {})')

    await harness.invoke('scheduler:update', { ...base, runFailScript: '' })
    expect((await listTask(id)).run_fail_script).toBeNull()
  })
})

describe('scheduled execution — window-less, real runner', () => {
  async function runNow(id: string): Promise<void> {
    const r = (await harness.invoke('scheduler:runNow', id)) as { success: boolean }
    expect(r.success).toBe(true)
  }
  const history = (): Array<{ source: string; results_json: string; failed_endpoints: number }> =>
    testDb.prepare('SELECT * FROM runner_history').all() as never

  it('a red scheduled run executes the fail script exactly once, after the teardown request', async () => {
    const bad = seedEndpoint('/fail')
    const cleanup = seedEndpoint('/cleanup')
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Nightly',
      endpointIds: [bad],
      teardownEndpointIds: [cleanup],
      runFailScript: HOOK('/fail-hook'),
      intervalValue: 1,
      intervalUnit: 'hours',
    })) as { data: TaskRow }

    await runNow(created.data.id)
    await vi.waitFor(() => expect(history().length).toBe(1), { timeout: 8000 })

    expect(received).toEqual(['/fail', '/cleanup', '/fail-hook'])
    const row = history()[0]
    expect(row.source).toBe('Scheduler')
    expect(row.failed_endpoints).toBe(1)
    const stored = JSON.parse(row.results_json) as Array<{ endpointId: string; phase?: string }>
    const hook = stored[stored.length - 1]
    expect(hook.endpointId).toBe('__run_fail_script__')
    expect(hook.phase).toBe('teardown')
  })

  it('a green scheduled run never fires it (the teardown request is the anchor)', async () => {
    const ok = seedEndpoint('/ok')
    const cleanup = seedEndpoint('/cleanup')
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Nightly',
      endpointIds: [ok],
      teardownEndpointIds: [cleanup],
      runFailScript: HOOK('/fail-hook'),
      intervalValue: 1,
      intervalUnit: 'hours',
    })) as { data: TaskRow }

    await runNow(created.data.id)
    await vi.waitFor(() => expect(history().length).toBe(1), { timeout: 8000 })
    expect(received).toEqual(['/ok', '/cleanup'])
  })

  it('the task\'s stopOnError and fail script compose: stopOnError on halts the flow, hook still fires once', async () => {
    const bad = seedEndpoint('/fail')
    const never = seedEndpoint('/never')
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Halting',
      endpointIds: [bad, never],
      runFailScript: HOOK('/fail-hook'),
      stopOnError: true,
      intervalValue: 1,
      intervalUnit: 'hours',
    })) as { data: TaskRow }

    await runNow(created.data.id)
    await vi.waitFor(() => expect(history().length).toBe(1), { timeout: 8000 })
    expect(received).toEqual(['/fail', '/fail-hook'])
  })
})
