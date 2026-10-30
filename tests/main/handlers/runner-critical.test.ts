/**
 * Issue #304 — a request marked "Critical" (Settings tab) stops the run when it
 * does not pass, whatever the run-level "Stop on error" switch says.
 *
 * Before: the run stopped only through the run-wide `stopOnError`; a critical
 * flag on the row was not read, so a failing critical request let the run go
 * on and every dependent request fail after it.
 *
 * Real `executeCollection` (`runner:execute`) against a local server that
 * records which paths were requested; `/fail` answers 500, everything else 200.
 * The flag is the row's own top-level `critical` key (request_schema for
 * endpoints / suite items, `metadata` for saved requests — issue #185 shape).
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
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))
class FakeStore {
  get(): unknown {
    return undefined
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')
const trust = await import('../../../src/main/lib/mcp-stdio-trust')

let server: Server
let base = ''
let received: string[] = []

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        received.push(req.url ?? '')
        const fail = req.url?.startsWith('/fail')
        res.writeHead(fail ? 500 : 200, { 'Content-Type': 'text/plain' })
        res.end(fail ? 'boom' : 'ok')
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
  received = []
  // Nothing is trusted: a stdio MCP row cannot run unattended (mcp-stdio-trust).
  const empty = new Map<string, unknown>()
  trust.setStdioTrustStoreForTests({
    get: (k) => empty.get(k),
    set: (k, v) => void empty.set(k, v),
  })
  registerRunnerHandlers()
})
afterEach(() => testDb.close())

interface SeedOpts {
  name: string
  /** Full URL; '' = a row with no URL (config error). */
  url: string
  critical?: boolean
  protocol?: string
}

function seedEndpoint(o: SeedOpts): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = JSON.stringify({
    method: 'GET',
    url: o.url,
    ...(o.critical ? { critical: true } : {}),
  })
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, 'GET', ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, o.name, o.protocol ?? 'http', o.url, schema, now, now)
  return id
}

function seedSavedRequest(o: SeedOpts): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO saved_requests
         (id, project_id, folder_id, name, protocol, method, url, params, headers, body, auth,
          pre_script, post_script, assertions, metadata, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'http', 'GET', ?, '[]', '[]', NULL, NULL, NULL, NULL, '[]', ?, 0, ?, ?)`,
    )
    .run(
      id,
      projectId,
      o.name,
      o.url,
      JSON.stringify(o.critical ? { critical: true } : {}),
      now,
      now,
    )
  return id
}

function seedSuite(): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      'INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    )
    .run(id, projectId, 'Suite', now, now)
  return id
}

function seedSuiteItem(suiteId: string, o: SeedOpts, order: number): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = JSON.stringify(o.critical ? { critical: true } : {})
  testDb
    .prepare(
      `INSERT INTO test_suite_items (id, suite_id, folder_id, protocol, name, method, url, request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'http', ?, 'GET', ?, ?, ?, ?, ?)`,
    )
    .run(id, suiteId, o.name, o.url, schema, order, now, now)
  return id
}

interface Row {
  endpointName: string
  status: number | null
  statusText: string
  skipped: number
  error?: string
  iteration?: number
  phase?: string
  critical?: boolean
  stoppedRun?: boolean
}

interface Exec {
  success: boolean
  error?: string
  data?: {
    stopReason?: string
    passedEndpoints: number
    failedEndpoints: number
    results: Row[]
  }
}

async function run(options: Record<string, unknown>): Promise<NonNullable<Exec['data']>> {
  const res = (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    ...options,
  })) as Exec
  expect(res.success, res.error).toBe(true)
  return res.data!
}

function historyRow(): Record<string, number> {
  return testDb
    .prepare(
      'SELECT passed_endpoints, failed_endpoints, skipped_tests FROM runner_history WHERE project_id = ? ORDER BY started_at DESC LIMIT 1',
    )
    .get(projectId) as Record<string, number>
}

const ran = (rows: Row[]): string[] =>
  rows.filter((r) => r.statusText !== 'NOT_RUN').map((r) => r.endpointName)

describe('issue #304 — a failing critical request stops the run', () => {
  it('(a) critical fails with stopOnError OFF → the run stops, later requests never run', async () => {
    const a = seedEndpoint({ name: 'Login', url: `${base}/fail`, critical: true })
    const b = seedEndpoint({ name: 'Orders', url: `${base}/orders` })
    const data = await run({ endpointIds: [a, b], stopOnError: false })

    expect(received).toEqual(['/fail'])
    expect(data.stopReason).toBe('criticalFailed')
    expect(ran(data.results)).toEqual(['Login'])
    const login = data.results.find((r) => r.endpointName === 'Login')!
    expect(login.critical).toBe(true)
    expect(login.stoppedRun).toBe(true)
    // The request it skipped is reported, not silently missing.
    const orders = data.results.find((r) => r.endpointName === 'Orders')!
    expect(orders.statusText).toBe('NOT_RUN')
    expect(orders.stoppedRun).toBeUndefined()
  })

  it('(b) a non-critical failure with stopOnError OFF → the run continues (unchanged)', async () => {
    const a = seedEndpoint({ name: 'A', url: `${base}/fail` })
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    const data = await run({ endpointIds: [a, b], stopOnError: false })

    expect(received).toEqual(['/fail', '/b'])
    expect(data.stopReason).toBeUndefined()
    expect(data.results.some((r) => r.stoppedRun)).toBe(false)
  })

  it('(c) a non-critical failure with stopOnError ON → stops, reason stays stopOnError', async () => {
    const a = seedEndpoint({ name: 'A', url: `${base}/fail` })
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    const data = await run({ endpointIds: [a, b], stopOnError: true })

    expect(received).toEqual(['/fail'])
    expect(data.stopReason).toBe('stopOnError')
    expect(data.results.some((r) => r.stoppedRun)).toBe(false)
  })

  it('critical failure with stopOnError ON → reported as the critical stop', async () => {
    const a = seedEndpoint({ name: 'Login', url: `${base}/fail`, critical: true })
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    const data = await run({ endpointIds: [a, b], stopOnError: true })

    expect(received).toEqual(['/fail'])
    expect(data.stopReason).toBe('criticalFailed')
  })

  it('(d) a critical request that passes → the run continues; its row carries the flag', async () => {
    const a = seedEndpoint({ name: 'Login', url: `${base}/login`, critical: true })
    const b = seedEndpoint({ name: 'B', url: `${base}/fail` })
    const c = seedEndpoint({ name: 'C', url: `${base}/c` })
    const data = await run({ endpointIds: [a, b, c] })

    expect(received).toEqual(['/login', '/fail', '/c'])
    expect(data.stopReason).toBeUndefined()
    expect(data.results[0].critical).toBe(true)
    expect(data.results[1].critical).toBeUndefined()
  })

  it('(e1) critical with a transport error → stops', async () => {
    // Port 1 on loopback: connection refused, no status.
    const a = seedEndpoint({ name: 'Down', url: 'http://127.0.0.1:1/x', critical: true })
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    const data = await run({ endpointIds: [a, b] })

    expect(received).toEqual([])
    expect(data.stopReason).toBe('criticalFailed')
    expect(data.results[0].error).toBeTruthy()
    expect(data.results[0].stoppedRun).toBe(true)
  })

  it('(e2) critical that could not run (no URL — config error) → stops', async () => {
    const a = seedEndpoint({ name: 'Broken', url: '', critical: true })
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    const data = await run({ endpointIds: [a, b] })

    expect(received).toEqual([])
    expect(data.stopReason).toBe('criticalFailed')
    expect(data.results[0].stoppedRun).toBe(true)
  })

  it('(e2) a NON-critical config error still does not stop the run, even with stopOnError', async () => {
    const a = seedEndpoint({ name: 'Broken', url: '' })
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    const data = await run({ endpointIds: [a, b], stopOnError: true })

    expect(received).toEqual(['/b'])
    expect(data.stopReason).toBeUndefined()
  })

  it('(e3) critical on a protocol the Runner cannot drive (unsupported) → stops', async () => {
    const a = seedEndpoint({
      name: 'Socket',
      url: 'ws://127.0.0.1:1/ws',
      critical: true,
      protocol: 'websocket',
    })
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    const data = await run({ endpointIds: [a, b] })

    expect(received).toEqual([])
    expect(data.stopReason).toBe('criticalFailed')
  })

  it('a NON-critical unsupported row stays a neutral skip (unchanged)', async () => {
    const a = seedEndpoint({ name: 'Socket', url: 'ws://127.0.0.1:1/ws', protocol: 'websocket' })
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    const data = await run({ endpointIds: [a, b], stopOnError: true })

    expect(received).toEqual(['/b'])
    expect(data.stopReason).toBeUndefined()
    // Neutral everywhere: not failed, counted as skipped.
    expect(data.failedEndpoints).toBe(0)
    expect(data.passedEndpoints).toBe(1)
    const { summarizeRun } = await import('../../../src/shared/runner-summary')
    expect(summarizeRun(data.results as never)).toMatchObject({ failed: 0, skipped: 1, passed: 1 })
    const h = historyRow()
    expect(h).toMatchObject({ failed_endpoints: 0, skipped_tests: 1 })
  })

  // Peer review of issue #304: the unsupported critical row stopped the run but
  // kept `skipped: 1`, so it counted as neither passed nor failed — the run's
  // failed count stayed 0 and History showed a green run under a
  // "critical request … failed" line.
  it('(e3) a critical unsupported row that stops the run counts as FAILED everywhere', async () => {
    const a = seedEndpoint({
      name: 'Socket',
      url: 'ws://127.0.0.1:1/ws',
      critical: true,
      protocol: 'websocket',
    })
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    const data = await run({ endpointIds: [a, b] })

    expect(data.stopReason).toBe('criticalFailed')
    expect(data.results[0].stoppedRun).toBe(true)
    // Live counters.
    expect(data.failedEndpoints).toBe(1)
    expect(data.passedEndpoints).toBe(0)
    // Shared summary (renderer results + dot + HTML export counters).
    const { summarizeRun } = await import('../../../src/shared/runner-summary')
    const { isSkippedStep, endpointDidPass } = await import('../../../src/shared/runner-verdict')
    const s = summarizeRun(data.results as never)
    expect(s.failed).toBe(1)
    expect(s.passed).toBe(0)
    // The NOT_RUN row the stop left behind stays neutral.
    expect(s.skipped).toBe(1)
    expect(s.passed + s.failed + s.skipped).toBe(s.total)
    expect(isSkippedStep(data.results[0])).toBe(false)
    // The in-app row badge agrees (red Error, not a grey "Unsupported").
    const { statusBadge } = await import('../../../src/shared/runner-summary')
    expect(statusBadge(data.results[0] as never)?.tone).toBe('error')
    expect(endpointDidPass(data.results[0] as never)).toBe(false)
    // Persisted runner_history — what the History list colours by.
    expect(historyRow()).toMatchObject({
      failed_endpoints: 1,
      passed_endpoints: 0,
      skipped_tests: 1,
    })
    // HTML report: the row is not painted neutral grey, and the header counts it.
    const res = (await harness.invoke('runner:export', {
      format: 'html',
      results: data.results,
    })) as { success: boolean; data: string }
    expect(res.data).not.toContain('- UNSUPPORTED')
    expect(res.data).toContain('- Error')
    expect(res.data).toContain('- NOT RUN')
  })

  it('a critical config-error row already fails (pinned)', async () => {
    const a = seedEndpoint({ name: 'Broken', url: '', critical: true })
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    const data = await run({ endpointIds: [a, b] })
    expect(data.stopReason).toBe('criticalFailed')
    expect(data.failedEndpoints).toBe(1)
    expect(historyRow()).toMatchObject({ failed_endpoints: 1 })
  })

  it('a saved request carries the flag in its metadata', async () => {
    const a = seedSavedRequest({ name: 'Login', url: `${base}/fail`, critical: true })
    const b = seedSavedRequest({ name: 'B', url: `${base}/b` })
    const data = await run({ endpointIds: [a, b] })

    expect(received).toEqual(['/fail'])
    expect(data.stopReason).toBe('criticalFailed')
  })

  it('(f) a suite run reads the suite item’s OWN flag', async () => {
    const suite = seedSuite()
    const critical = seedSuiteItem(suite, { name: 'Login', url: `${base}/fail`, critical: true }, 0)
    const after = seedSuiteItem(suite, { name: 'After', url: `${base}/after` }, 1)
    const data = await run({ endpointIds: [critical, after], source: 'Test Suite' })

    expect(received).toEqual(['/fail'])
    expect(data.stopReason).toBe('criticalFailed')

    // The same request as a NON-critical suite item does not stop the run.
    received = []
    const suite2 = seedSuite()
    const plain = seedSuiteItem(suite2, { name: 'Login', url: `${base}/fail` }, 0)
    const after2 = seedSuiteItem(suite2, { name: 'After', url: `${base}/after` }, 1)
    const data2 = await run({ endpointIds: [plain, after2] })
    expect(received).toEqual(['/fail', '/after'])
    expect(data2.stopReason).toBeUndefined()
  })

  it('(g) iterations: the critical stop ends the whole run, later iterations never start', async () => {
    const a = seedEndpoint({ name: 'A', url: `${base}/a` })
    const b = seedEndpoint({ name: 'Login', url: `${base}/fail`, critical: true })
    const c = seedEndpoint({ name: 'C', url: `${base}/c` })
    const data = await run({ endpointIds: [a, b, c], iterations: 3 })

    expect(received).toEqual(['/a', '/fail'])
    expect(data.stopReason).toBe('criticalFailed')
    // Iteration 1: C not run; iterations 2 and 3: nothing ran.
    const notRun = data.results.filter((r) => r.statusText === 'NOT_RUN')
    expect(notRun.map((r) => `${r.iteration}:${r.endpointName}`)).toEqual([
      '1:C',
      '2:A',
      '2:Login',
      '2:C',
      '3:A',
      '3:Login',
      '3:C',
    ])
    // Rows the run never reached keep their Critical badge.
    expect(notRun.filter((r) => r.critical).length).toBe(2)
  })

  it('teardown still runs after a critical stop; a critical teardown row does not stop cleanup', async () => {
    const a = seedEndpoint({ name: 'Login', url: `${base}/fail`, critical: true })
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    const t1 = seedEndpoint({ name: 'Clean1', url: `${base}/fail-clean`, critical: true })
    const t2 = seedEndpoint({ name: 'Clean2', url: `${base}/clean2` })
    const data = await run({ endpointIds: [a, b], teardownEndpointIds: [t1, t2] })

    expect(received).toEqual(['/fail', '/fail-clean', '/clean2'])
    expect(data.stopReason).toBe('criticalFailed')
    // Only the flow row that stopped the run carries the cause marker.
    expect(data.results.filter((r) => r.stoppedRun).map((r) => r.endpointName)).toEqual(['Login'])
  })

  it('pm.execution.skipRequest() on a critical request is not a failure', async () => {
    const id = crypto.randomUUID()
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO endpoints
          (id, project_id, folder_id, name, protocol, method, path, status,
           request_schema, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, 'Skipped', 'http', 'GET', ?, 'developing', ?, 0, ?, ?)`,
      )
      .run(
        id,
        projectId,
        `${base}/fail`,
        JSON.stringify({
          method: 'GET',
          url: `${base}/fail`,
          critical: true,
          preScript: 'pm.execution.skipRequest()',
        }),
        now,
        now,
      )
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    const data = await run({ endpointIds: [id, b] })

    expect(received).toEqual(['/b'])
    expect(data.stopReason).toBeUndefined()
  })

  it('(h) the persisted runner_history row keeps the stop cause', async () => {
    const a = seedEndpoint({ name: 'Login', url: `${base}/fail`, critical: true })
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    await run({ endpointIds: [a, b] })

    const row = testDb
      .prepare('SELECT results_json FROM runner_history WHERE project_id = ?')
      .get(projectId) as { results_json: string }
    const results = JSON.parse(row.results_json) as Row[]
    const { criticalStopOf } = await import('../../../src/shared/runner-verdict')
    expect(criticalStopOf(results)?.endpointName).toBe('Login')
  })
})

function seedMcpEndpoint(name: string, commandLine: string, critical: boolean): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = {
    url: commandLine,
    method: 'GET',
    assertions: [],
    ...(critical ? { critical: true } : {}),
    metadata: {
      mcp: {
        transport: 'stdio',
        url: commandLine,
        customHeaders: [],
        envVars: [],
        auth: { type: 'none' },
        protocol: 'legacy',
        call: { capabilityTab: 'tools', selectedTool: 'ping', toolArgs: '{}' },
      },
    },
  }
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'mcp', 'GET', ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, name, commandLine, JSON.stringify(schema), now, now)
  return id
}

describe('issue #304 — critical MCP requests', () => {
  it('(e2) a critical stdio MCP row the Run may not spawn (untrusted) → stops', async () => {
    const a = seedMcpEndpoint('Tools', `${process.execPath} /nonexistent-${Date.now()}.js`, true)
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    const data = await run({ endpointIds: [a, b] })

    expect(received).toEqual([])
    expect(data.stopReason).toBe('criticalFailed')
    expect(data.results[0].stoppedRun).toBe(true)
    expect(data.results[1].statusText).toBe('NOT_RUN')
  })

  it('(e2) a critical MCP row with no server URL → stops; unmarked, the run goes on', async () => {
    const a = seedMcpEndpoint('Empty', '', true)
    const b = seedEndpoint({ name: 'B', url: `${base}/b` })
    expect((await run({ endpointIds: [a, b] })).stopReason).toBe('criticalFailed')
    expect(received).toEqual([])

    const c = seedMcpEndpoint('Empty2', '', false)
    const d = seedEndpoint({ name: 'D', url: `${base}/d` })
    expect((await run({ endpointIds: [c, d], stopOnError: true })).stopReason).toBeUndefined()
    expect(received).toEqual(['/d'])
  })
})

describe('issue #304 — the exported report says why the run stopped', () => {
  const rows = [
    {
      endpointId: '1',
      endpointName: 'Login',
      method: 'POST',
      url: '/login',
      status: 500,
      statusText: 'ERR',
      duration: 5,
      passed: 0,
      failed: 0,
      skipped: 0,
      assertions: [],
      phase: 'main',
      critical: true,
      stoppedRun: true,
    },
    {
      endpointId: '2',
      endpointName: 'Orders',
      method: '',
      url: '',
      status: null,
      statusText: 'NOT_RUN',
      duration: 0,
      passed: 0,
      failed: 0,
      skipped: 1,
      assertions: [],
      phase: 'main',
    },
  ]

  it('(h) HTML: a stop line naming the critical request + a Critical badge', async () => {
    const res = (await harness.invoke('runner:export', { format: 'html', results: rows })) as {
      success: boolean
      data: string
    }
    expect(res.success).toBe(true)
    expect(res.data).toContain('Stopped: critical request &quot;Login&quot; failed')
    expect(res.data).toContain('data-critical="true"')
    // The row the stop skipped is not painted "Passed".
    expect(res.data).toContain('- NOT RUN')
    expect(res.data).not.toContain('- Passed')
  })

  it('(h) JSON: the rows carry the flag and the cause marker', async () => {
    const res = (await harness.invoke('runner:export', { format: 'json', results: rows })) as {
      success: boolean
      data: string
    }
    const parsed = JSON.parse(res.data) as Row[]
    expect(parsed[0].critical).toBe(true)
    expect(parsed[0].stoppedRun).toBe(true)
  })
})
