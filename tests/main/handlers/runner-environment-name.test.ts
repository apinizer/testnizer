/**
 * Issue #307 — a run records the NAME of the environment it actually used.
 *
 * Before: the results header said the fixed word "Active", All Runs and
 * scheduled history rows said "-", and `runner_history.environment_name` held
 * `options.environmentId` — an id, and only the explicit one (a run that fell
 * back to the project's active environment stored NULL).
 *
 * ── CONTRACT ───────────────────────────────────────────────────────────────
 *  - `runner_history.environment_name` (existing column, no schema change) is a
 *    snapshot taken at run start: the environment's name, or '' when the run
 *    used no environment. A later rename / delete never rewrites it.
 *  - `RunnerReport.environmentName` carries the same value ('' = none), so the
 *    live results header shows it right after the run.
 *  - Readers (`runner:history`, both argument forms, and `scheduler:history`)
 *    return `environment_name` resolved in MAIN: a name as stored; '' as ''; a
 *    LEGACY row holding an environment id → that environment's current name, or
 *    null when it no longer exists; a legacy NULL → null (unknown).
 *  - `buildRunReport` (`runner:export` + `pm.run.export*`) prints the
 *    environment: HTML "Environment: <name>" / "Environment: No environment";
 *    JSON stays an array of rows, each row carrying `environmentName`
 *    (string, or null for "no environment").
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
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
const { registerSchedulerHandlers, stopAllSchedulers } =
  await import('../../../src/main/ipc/scheduler.handler')

let server: Server
let base = ''
const bodies: Record<string, string[]> = {}

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        let body = ''
        req.on('data', (c) => (body += String(c)))
        req.on('end', () => {
          const path = req.url ?? '/'
          ;(bodies[path] ??= []).push(body)
          const fail = path.startsWith('/fail')
          res.writeHead(fail ? 500 : 200, { 'Content-Type': 'text/plain' })
          res.end(fail ? 'boom' : 'ok')
        })
      })
      server.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        resolve()
      })
    }),
)
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

let workspaceId: string
let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  for (const k of Object.keys(bodies)) delete bodies[k]
  registerRunnerHandlers()
  registerSchedulerHandlers()
})
afterEach(() => {
  stopAllSchedulers()
  testDb.close()
})

function seedEnv(name: string, active: boolean, id: string = crypto.randomUUID()): string {
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, projectId, name, active ? 1 : 0, now, now)
  return id
}

function seedEndpoint(path = '/ok'): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const url = `${base}${path}`
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'http', 'GET', ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, path, url, JSON.stringify({ method: 'GET', url }), now, now)
  return id
}

function seedSuiteItem(path = '/ok'): string {
  const suiteId = crypto.randomUUID()
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      'INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    )
    .run(suiteId, projectId, 'Suite', now, now)
  testDb
    .prepare(
      `INSERT INTO test_suite_items (id, suite_id, folder_id, protocol, name, method, url, request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'http', ?, 'GET', ?, '{}', 0, ?, ?)`,
    )
    .run(id, suiteId, path, `${base}${path}`, now, now)
  return id
}

interface Report {
  environmentName?: string
  results: Array<{ endpointId: string }>
}

async function run(options: Record<string, unknown>): Promise<Report> {
  const res = (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    ...options,
  })) as { success: boolean; error?: string; data?: Report }
  expect(res.success, res.error).toBe(true)
  return res.data!
}

function storedName(): string | null {
  const row = testDb
    .prepare(
      'SELECT environment_name FROM runner_history WHERE project_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1',
    )
    .get(projectId) as { environment_name: string | null }
  return row.environment_name
}

async function exportReport(
  report: Report,
  format: 'html' | 'json',
  environmentName: string | null | undefined,
): Promise<string> {
  const res = (await harness.invoke('runner:export', {
    results: report.results,
    format,
    environmentName,
  })) as { success: boolean; data: string }
  expect(res.success).toBe(true)
  return res.data
}

describe('a run records the name of the environment it used (issue #307)', () => {
  it('explicit environment: name stored, on the report, and in HTML + JSON exports', async () => {
    seedEnv('Active One', true)
    const staging = seedEnv('Staging', false)
    const report = await run({ endpointIds: [seedEndpoint()], environmentId: staging })

    expect(storedName()).toBe('Staging')
    expect(report.environmentName).toBe('Staging')

    const html = await exportReport(report, 'html', report.environmentName)
    expect(html).toContain('data-testid="report-environment"')
    expect(html).toContain('Environment: Staging')
    const json = JSON.parse(await exportReport(report, 'json', report.environmentName)) as Array<{
      environmentName?: string | null
    }>
    expect(Array.isArray(json)).toBe(true)
    expect(json.every((r) => r.environmentName === 'Staging')).toBe(true)
  })

  it('no explicit environment: the project active environment the run fell back to is recorded', async () => {
    seedEnv('Fallback Env', true)
    const report = await run({ endpointIds: [seedEndpoint()] })
    expect(storedName()).toBe('Fallback Env')
    expect(report.environmentName).toBe('Fallback Env')
  })

  it('no environment at all: stored as "" and exports say "No environment"', async () => {
    const report = await run({ endpointIds: [seedEndpoint()] })
    expect(storedName()).toBe('')
    expect(report.environmentName).toBe('')

    const html = await exportReport(report, 'html', report.environmentName)
    expect(html).toContain('Environment: No environment')
    const json = JSON.parse(await exportReport(report, 'json', report.environmentName)) as Array<{
      environmentName?: string | null
    }>
    expect(json.every((r) => r.environmentName === null)).toBe(true)
  })

  it('an explicit environment id that no longer exists records "no environment", not the id', async () => {
    const gone = crypto.randomUUID()
    const report = await run({ endpointIds: [seedEndpoint()], environmentId: gone })
    expect(storedName()).toBe('')
    expect(report.environmentName).toBe('')
  })

  it('the name is a snapshot: renaming or deleting the environment later does not rewrite history', async () => {
    const env = seedEnv('Before', true)
    await run({ endpointIds: [seedEndpoint()] })
    testDb.prepare('UPDATE environments SET name = ? WHERE id = ?').run('After', env)
    const listed = (await harness.invoke('runner:history', {
      projectId,
      tab: 'Functional',
    })) as { data: { rows: Array<{ environment_name: string | null }> } }
    expect(listed.data.rows[0].environment_name).toBe('Before')
    testDb.prepare('DELETE FROM environments WHERE id = ?').run(env)
    const again = (await harness.invoke('runner:history', {
      projectId,
      tab: 'Functional',
    })) as { data: { rows: Array<{ environment_name: string | null }> } }
    expect(again.data.rows[0].environment_name).toBe('Before')
  })

  it('a Test Suite item run records the name (same path)', async () => {
    seedEnv('Suite Env', true)
    const report = await run({ endpointIds: [seedSuiteItem()] })
    expect(storedName()).toBe('Suite Env')
    expect(report.environmentName).toBe('Suite Env')
  })

  it('the run fail script exports (pm.run.exportHtml/exportJson) carry the environment', async () => {
    seedEnv('Hook Env', true)
    const post = (path: string, expr: string): string =>
      `await pm.sendRequest({ url: '${base}${path}', method: 'POST', ` +
      `header: { 'Content-Type': 'text/plain' }, body: { mode: 'raw', raw: ${expr} } })`
    await run({
      endpointIds: [seedEndpoint('/fail')],
      stopOnError: false,
      runFailScript: `${post('/hook-html', 'pm.run.exportHtml()')}\n${post('/hook-json', 'pm.run.exportJson()')}`,
    })
    expect(bodies['/hook-html']?.[0]).toContain('Environment: Hook Env')
    const json = JSON.parse(bodies['/hook-json']![0]) as Array<{ environmentName?: string | null }>
    expect(json.every((r) => r.environmentName === 'Hook Env')).toBe(true)
  })

  it('a scheduled run (scheduler:runNow) records the task environment name', async () => {
    seedEnv('Other', true)
    const nightly = seedEnv('Nightly Env', false)
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Nightly',
      endpointIds: [seedEndpoint()],
      environmentId: nightly,
      intervalValue: 1,
      intervalUnit: 'hours',
    })) as { success: boolean; data: { id: string } }
    expect(created.success).toBe(true)
    await harness.invoke('scheduler:runNow', created.data.id)
    await vi.waitFor(
      () => {
        const n = testDb.prepare('SELECT COUNT(*) AS n FROM runner_history').get() as { n: number }
        expect(n.n).toBe(1)
      },
      { timeout: 5000 },
    )
    expect(storedName()).toBe('Nightly Env')
    const hist = (await harness.invoke('scheduler:history', created.data.id)) as {
      data: Array<{ environment_name: string | null }>
    }
    expect(hist.data[0].environment_name).toBe('Nightly Env')
  })
})

describe('legacy rows (environment id or NULL) are resolved in main (issue #307)', () => {
  function insertLegacy(environmentName: string | null, opts: { taskId?: string } = {}): string {
    const id = crypto.randomUUID()
    testDb
      .prepare(
        `INSERT INTO runner_history (id, project_id, environment_name, source, results_json, started_at, scheduled_task_id)
         VALUES (?, ?, ?, ?, '[]', ?, ?)`,
      )
      .run(
        id,
        projectId,
        environmentName,
        opts.taskId ? 'Scheduler' : 'Runner',
        Date.now(),
        opts.taskId ?? null,
      )
    return id
  }

  async function names(): Promise<Record<string, string | null>> {
    const res = (await harness.invoke('runner:history', {
      projectId,
      tab: 'Functional',
    })) as { data: { rows: Array<{ id: string; environment_name: string | null }> } }
    return Object.fromEntries(res.data.rows.map((r) => [r.id, r.environment_name]))
  }

  it('an id of an existing environment shows its CURRENT name; a deleted id and NULL show unknown (null)', async () => {
    const env = seedEnv('Renamed Later', false)
    const live = insertLegacy(env)
    const deleted = insertLegacy(crypto.randomUUID())
    const unknown = insertLegacy(null)
    const none = insertLegacy('')
    const named = insertLegacy('QA')

    testDb.prepare('UPDATE environments SET name = ? WHERE id = ?').run('Current Name', env)
    const got = await names()
    expect(got[live]).toBe('Current Name')
    expect(got[deleted]).toBeNull()
    expect(got[unknown]).toBeNull()
    expect(got[none]).toBe('')
    expect(got[named]).toBe('QA')
  })

  it('the legacy runner:history(projectId) form resolves too', async () => {
    const env = seedEnv('Legacy Form', false)
    const live = insertLegacy(env)
    const res = (await harness.invoke('runner:history', projectId)) as {
      data: Array<{ id: string; environment_name: string | null }>
    }
    expect(res.data.find((r) => r.id === live)?.environment_name).toBe('Legacy Form')
  })

  it('scheduler:history resolves a legacy id row', async () => {
    const env = seedEnv('Sched Legacy', false)
    const taskId = crypto.randomUUID()
    const live = insertLegacy(env, { taskId })
    const res = (await harness.invoke('scheduler:history', taskId)) as {
      data: Array<{ id: string; environment_name: string | null }>
    }
    expect(res.data.find((r) => r.id === live)?.environment_name).toBe('Sched Legacy')
  })
})

describe('scheduler:list resolves the task environment name in main (issue #307 follow-up)', () => {
  async function createTask(name: string, environmentId?: string): Promise<string> {
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name,
      endpointIds: ['e1'],
      ...(environmentId ? { environmentId } : {}),
      intervalValue: 1,
      intervalUnit: 'hours',
    })) as { success: boolean; data: { id: string } }
    expect(created.success).toBe(true)
    return created.data.id
  }

  async function listed(): Promise<Record<string, { environment_name?: string | null }>> {
    const res = (await harness.invoke('scheduler:list', projectId)) as {
      data: Array<{ id: string; environment_name?: string | null }>
    }
    return Object.fromEntries(res.data.map((t) => [t.id, t]))
  }

  it('current name / "" for no environment / null for a deleted environment — never the id', async () => {
    const env = seedEnv('Task Env', false)
    const gone = seedEnv('Gone Env', false)
    const named = await createTask('Named', env)
    const deleted = await createTask('Deleted', gone)
    const none = await createTask('None')

    testDb.prepare('UPDATE environments SET name = ? WHERE id = ?').run('Task Env Renamed', env)
    testDb.prepare('DELETE FROM environments WHERE id = ?').run(gone)

    const got = await listed()
    expect(got[named].environment_name).toBe('Task Env Renamed')
    expect(got[deleted].environment_name).toBeNull()
    expect(got[none].environment_name).toBe('')
  })
})
