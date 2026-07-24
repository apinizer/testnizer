/**
 * Integration tests for the Runner's RUN LIFECYCLE — run-level setup,
 * guaranteed teardown, and the phase-aware verdict (issue #72).
 *
 * MKK model Setup / Flow / Teardown as folders. Before this, a run that halted
 * early (stopOnError, a transport error, or the user pressing Stop) simply
 * never reached the teardown requests, so fixtures leaked. These tests pin the
 * guarantee: teardown executes on EVERY exit path, exactly once, without
 * masking the failure that stopped the run.
 *
 * Same idiom as `runner-execute.test.ts`: a real local HTTP server, endpoints
 * seeded straight into the `endpoints` table, and the REAL executeCollection
 * loop (http.engine is deliberately NOT mocked).
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
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')

// ─── Local server ────────────────────────────────────────────────

let server: Server
let port = 0
/** A port nothing listens on — used to force a genuine transport failure. */
let deadPort = 0
let received: string[] = []

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/'
      req.resume()
      req.on('end', () => {
        received.push(url)
        // /stop → the user pressed Stop while this request was in flight.
        // /stop2 → they pressed it twice (abort teardown as well).
        if (url.startsWith('/stop')) {
          void harness.invoke('runner:stop')
          // /stop2 → pressed twice during the FLOW (cleanup must still run).
          // /stopTeardown → pressed while cleanup itself is running, which is
          // the only case that abandons the remaining teardown steps.
          if (url.startsWith('/stop2')) void harness.invoke('runner:stop')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end('{"ok":true}')
          return
        }
        if (url.startsWith('/fail')) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('boom')
          return
        }
        if (url.startsWith('/missing')) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end('{"error":"not found"}')
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, path: url }))
      })
    })
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port
      resolve()
    })
  })
  // Claim a second port, then release it: nothing will answer there, so a
  // request to it fails at the transport layer (ECONNREFUSED).
  await new Promise<void>((resolve) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      deadPort = (probe.address() as AddressInfo).port
      probe.close(() => resolve())
    })
  })
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

// ─── Seed helpers ────────────────────────────────────────────────

let workspaceId: string
let projectId: string

interface SeedEndpointOpts {
  name?: string
  method?: string
  url: string
  assertions?: Array<Record<string, unknown>>
  preScript?: string
  postScript?: string
}

function seedEndpoint(opts: SeedEndpointOpts): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = JSON.stringify({
    method: opts.method ?? 'GET',
    url: opts.url,
    params: [],
    headers: [],
    auth: { type: 'none' },
    assertions: opts.assertions ?? [],
    preScript: opts.preScript,
    postScript: opts.postScript,
  })
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'http', ?, ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, opts.name ?? 'EP', opts.method ?? 'GET', opts.url, schema, now, now)
  return id
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  received = []
  registerRunnerHandlers()
})

afterEach(() => {
  testDb.close()
})

interface RunResultRow {
  endpointId: string
  endpointName: string
  status: number | null
  statusText?: string
  passed: number
  failed: number
  skipped?: number
  error?: string
  iteration?: number
  phase?: 'setup' | 'main' | 'teardown'
}

interface ExecResult {
  success: boolean
  error?: string
  data?: {
    totalEndpoints: number
    passedEndpoints: number
    failedEndpoints: number
    totalAssertions: number
    passedAssertions: number
    failedAssertions: number
    teardownPassedEndpoints?: number
    teardownFailedEndpoints?: number
    stopReason?: string
    results: RunResultRow[]
  }
}

function run(options: Record<string, unknown>): Promise<ExecResult> {
  return harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    ...options,
  }) as Promise<ExecResult>
}

const teardownRows = (res: ExecResult): RunResultRow[] =>
  (res.data?.results ?? []).filter((r) => r.phase === 'teardown')

// ─── a. Happy path ───────────────────────────────────────────────

describe('run lifecycle — normal run', () => {
  it('runs setup → main → teardown in order, once each', async () => {
    const setupId = seedEndpoint({ name: 'Setup', url: `http://127.0.0.1:${port}/setup` })
    const mainId = seedEndpoint({ name: 'Main', url: `http://127.0.0.1:${port}/main` })
    const teardownId = seedEndpoint({ name: 'Cleanup', url: `http://127.0.0.1:${port}/cleanup` })

    const res = await run({
      endpointIds: [mainId],
      setupEndpointIds: [setupId],
      teardownEndpointIds: [teardownId],
    })

    expect(res.success).toBe(true)
    expect(received).toEqual(['/setup', '/main', '/cleanup'])
    expect(res.data?.results.map((r) => r.phase)).toEqual(['setup', 'main', 'teardown'])
    // Setup + main count toward the verdict; teardown is tallied apart.
    expect(res.data?.passedEndpoints).toBe(2)
    expect(res.data?.failedEndpoints).toBe(0)
    expect(res.data?.teardownPassedEndpoints).toBe(1)
    expect(res.data?.teardownFailedEndpoints).toBe(0)
  })

  it('runs teardown ONCE for a multi-iteration, multi-endpoint run', async () => {
    const a = seedEndpoint({ name: 'A', url: `http://127.0.0.1:${port}/a` })
    const b = seedEndpoint({ name: 'B', url: `http://127.0.0.1:${port}/b` })
    const teardownId = seedEndpoint({ name: 'Cleanup', url: `http://127.0.0.1:${port}/cleanup` })

    const res = await run({
      endpointIds: [a, b],
      teardownEndpointIds: [teardownId],
      iterations: 3,
    })

    expect(res.success).toBe(true)
    // Teardown is per-RUN, not per-iteration.
    expect(received.filter((u) => u === '/cleanup').length).toBe(1)
    expect(teardownRows(res).length).toBe(1)
    // ...and it is the last thing that happened.
    expect(received[received.length - 1]).toBe('/cleanup')
    // Teardown carries no iteration index — it belongs to no iteration.
    expect(teardownRows(res)[0].iteration).toBeUndefined()
  })
})

// ─── b. Teardown survives every early exit ───────────────────────

describe('run lifecycle — guaranteed teardown', () => {
  it('still runs teardown when stopOnError aborts the flow mid-way', async () => {
    const failing = seedEndpoint({ name: 'Fails', url: `http://127.0.0.1:${port}/fail` })
    const never = seedEndpoint({ name: 'Never', url: `http://127.0.0.1:${port}/never` })
    const teardownId = seedEndpoint({ name: 'Cleanup', url: `http://127.0.0.1:${port}/cleanup` })

    const res = await run({
      endpointIds: [failing, never],
      teardownEndpointIds: [teardownId],
      stopOnError: true,
    })

    expect(res.success).toBe(true)
    // The flow halted — /never was never requested — but cleanup still ran.
    expect(received).toEqual(['/fail', '/cleanup'])
    expect(res.data?.stopReason).toBe('stopOnError')
    expect(res.data?.failedEndpoints).toBe(1)
    expect(teardownRows(res).length).toBe(1)
    expect(teardownRows(res)[0].status).toBe(200)
  })

  it('still runs teardown after a transport error', async () => {
    const dead = seedEndpoint({ name: 'Dead', url: `http://127.0.0.1:${deadPort}/unreachable` })
    const teardownId = seedEndpoint({ name: 'Cleanup', url: `http://127.0.0.1:${port}/cleanup` })

    const res = await run({
      endpointIds: [dead],
      teardownEndpointIds: [teardownId],
      stopOnError: true,
    })

    expect(res.success).toBe(true)
    const main = res.data?.results.find((r) => r.phase === 'main')
    expect(main?.error).toBeTruthy()
    expect(res.data?.failedEndpoints).toBe(1)
    // Cleanup happened despite the connection failure.
    expect(received).toEqual(['/cleanup'])
    expect(teardownRows(res).length).toBe(1)
  })

  it('still runs teardown when the user presses Stop', async () => {
    const stopper = seedEndpoint({ name: 'Stopper', url: `http://127.0.0.1:${port}/stop` })
    const never = seedEndpoint({ name: 'Never', url: `http://127.0.0.1:${port}/never` })
    const teardownId = seedEndpoint({ name: 'Cleanup', url: `http://127.0.0.1:${port}/cleanup` })

    const res = await run({
      endpointIds: [stopper, never],
      teardownEndpointIds: [teardownId],
    })

    expect(res.success).toBe(true)
    expect(received).toEqual(['/stop', '/cleanup'])
    expect(res.data?.stopReason).toBe('cancelled')
    expect(teardownRows(res).length).toBe(1)
  })

  it('impatient double-Stop during the FLOW still runs cleanup', async () => {
    // The first Stop cannot cancel the request already on the wire, so nothing
    // appears to happen and users click again. That must not silently cancel a
    // teardown they have not even seen start — cleanup is the whole point of
    // the feature.
    const stopper = seedEndpoint({ name: 'Stopper', url: `http://127.0.0.1:${port}/stop2` })
    const never = seedEndpoint({ name: 'Never', url: `http://127.0.0.1:${port}/never` })
    const teardownId = seedEndpoint({ name: 'Cleanup', url: `http://127.0.0.1:${port}/cleanup` })

    const res = await run({
      endpointIds: [stopper, never],
      teardownEndpointIds: [teardownId],
    })

    expect(res.success).toBe(true)
    expect(received).toEqual(['/stop2', '/cleanup'])
    expect(teardownRows(res).length).toBe(1)
    expect(res.data?.stopReason).toBe('cancelled')
  })

  it('a Stop pressed DURING teardown abandons the rest of it (never hang the UI)', async () => {
    // `/stopTeardown` is itself a cleanup request that presses Stop while it
    // runs — the escape hatch for a cleanup endpoint that will not answer.
    const mainId = seedEndpoint({ name: 'Main', url: `http://127.0.0.1:${port}/main` })
    const cleanup1 = seedEndpoint({
      name: 'Cleanup 1',
      url: `http://127.0.0.1:${port}/stopTeardown`,
    })
    const cleanup2 = seedEndpoint({ name: 'Cleanup 2', url: `http://127.0.0.1:${port}/cleanup` })

    const res = await run({
      endpointIds: [mainId],
      teardownEndpointIds: [cleanup1, cleanup2],
    })

    expect(res.success).toBe(true)
    // The first cleanup ran; the SECOND was abandoned.
    expect(received).toEqual(['/main', '/stopTeardown'])
    expect(teardownRows(res).length).toBe(1)
    expect(res.data?.stopReason).toBe('teardownAborted')
  })

  it('runs teardown even when the setup phase fails under stopOnError', async () => {
    const setupId = seedEndpoint({ name: 'Setup', url: `http://127.0.0.1:${port}/fail` })
    const mainId = seedEndpoint({ name: 'Main', url: `http://127.0.0.1:${port}/main` })
    const teardownId = seedEndpoint({ name: 'Cleanup', url: `http://127.0.0.1:${port}/cleanup` })

    const res = await run({
      endpointIds: [mainId],
      setupEndpointIds: [setupId],
      teardownEndpointIds: [teardownId],
      stopOnError: true,
    })

    expect(res.success).toBe(true)
    // Main flow skipped (its fixtures never materialised), cleanup still ran.
    expect(received).toEqual(['/fail', '/cleanup'])
    expect(res.data?.failedEndpoints).toBe(1)
    expect(teardownRows(res).length).toBe(1)
  })
})

// ─── c. Teardown must not rewrite the run's verdict ───────────────

describe('run lifecycle — teardown does not mask the primary result', () => {
  it('reports a failing teardown without touching the primary failure', async () => {
    const failing = seedEndpoint({ name: 'Fails', url: `http://127.0.0.1:${port}/fail` })
    const badCleanup = seedEndpoint({ name: 'Cleanup', url: `http://127.0.0.1:${port}/fail` })

    const res = await run({
      endpointIds: [failing],
      teardownEndpointIds: [badCleanup],
      stopOnError: true,
    })

    expect(res.success).toBe(true)
    // The original failure is still THE failure of this run...
    expect(res.data?.failedEndpoints).toBe(1)
    expect(res.data?.passedEndpoints).toBe(0)
    // ...and the broken cleanup is reported on its own tally.
    expect(res.data?.teardownFailedEndpoints).toBe(1)
    expect(teardownRows(res)[0].status).toBe(500)
  })

  it('a failing teardown does not turn a green run red', async () => {
    const ok = seedEndpoint({ name: 'OK', url: `http://127.0.0.1:${port}/ok` })
    const badCleanup = seedEndpoint({ name: 'Cleanup', url: `http://127.0.0.1:${port}/fail` })

    const res = await run({ endpointIds: [ok], teardownEndpointIds: [badCleanup] })

    expect(res.data?.passedEndpoints).toBe(1)
    expect(res.data?.failedEndpoints).toBe(0)
    expect(res.data?.teardownFailedEndpoints).toBe(1)
  })

  it('scores teardown with endpointDidPass semantics (assertion-driven 400 = passed)', async () => {
    const ok = seedEndpoint({ name: 'OK', url: `http://127.0.0.1:${port}/ok` })
    // The classic idempotent cleanup DELETE: 400/404 is a perfectly good
    // outcome when the test says so (issue #16 rule, applied to teardown).
    const cleanup = seedEndpoint({
      name: 'Delete if exists',
      method: 'DELETE',
      url: `http://127.0.0.1:${port}/missing`,
      postScript: `pm.test('idempotent delete', function () {
        pm.expect([200, 204, 404, 400]).to.include(pm.response.code)
      })`,
    })

    const res = await run({ endpointIds: [ok], teardownEndpointIds: [cleanup] })

    const row = teardownRows(res)[0]
    expect(row.status).toBe(400)
    expect(row.failed).toBe(0)
    expect(res.data?.teardownPassedEndpoints).toBe(1)
    expect(res.data?.teardownFailedEndpoints).toBe(0)
    // A bare 400 with no assertions would still be a teardown failure — the
    // status fallback is intact.
    expect(res.data?.failedEndpoints).toBe(0)
  })
})

// ─── d. Run-level hook scripts ───────────────────────────────────

describe('run lifecycle — run-level pre/post scripts', () => {
  it('runs the pre script once before setup and shares its variables with every phase', async () => {
    const mainId = seedEndpoint({ name: 'Main', url: `http://127.0.0.1:${port}/m?r={{runTag}}` })
    const teardownId = seedEndpoint({
      name: 'Cleanup',
      url: `http://127.0.0.1:${port}/c?r={{runTag}}`,
    })

    const res = await run({
      endpointIds: [mainId],
      teardownEndpointIds: [teardownId],
      runPreScript: `pm.environment.set('runTag', 'RUN-1')`,
    })

    expect(res.success).toBe(true)
    expect(received).toEqual(['/m?r=RUN-1', '/c?r=RUN-1'])
    // The hook surfaces as its own setup-phase row.
    const hook = res.data?.results.find((r) => r.statusText === 'SCRIPT')
    expect(hook?.phase).toBe('setup')
  })

  it('runs the post script at the very end — even after a stopOnError abort', async () => {
    const failing = seedEndpoint({ name: 'Fails', url: `http://127.0.0.1:${port}/fail` })

    const res = await run({
      endpointIds: [failing],
      stopOnError: true,
      runPostScript: `pm.test('cleanup ran', function () { pm.expect(1).to.equal(1) })`,
    })

    expect(res.success).toBe(true)
    const hook = res.data?.results.find((r) => r.statusText === 'SCRIPT')
    expect(hook?.phase).toBe('teardown')
    expect(hook?.passed).toBe(1)
    // The hook's test passing must not rescue the run.
    expect(res.data?.failedEndpoints).toBe(1)
    expect(res.data?.passedEndpoints).toBe(0)
  })

  it('a failing post-script test is reported but never flips the verdict', async () => {
    const ok = seedEndpoint({ name: 'OK', url: `http://127.0.0.1:${port}/ok` })

    const res = await run({
      endpointIds: [ok],
      runPostScript: `pm.test('cleanup check', function () { pm.expect(1).to.equal(2) })`,
    })

    const hook = res.data?.results.find((r) => r.statusText === 'SCRIPT')
    expect(hook?.failed).toBe(1)
    expect(res.data?.failedEndpoints).toBe(0)
    expect(res.data?.passedEndpoints).toBe(1)
    expect(res.data?.teardownFailedEndpoints).toBe(1)
  })
})

// ─── e. Ownership guard covers the new id lists ──────────────────

describe('run lifecycle — validation', () => {
  it('refuses teardown ids that belong to another project', async () => {
    const mainId = seedEndpoint({ name: 'Main', url: `http://127.0.0.1:${port}/main` })

    const res = await run({
      endpointIds: [mainId],
      teardownEndpointIds: ['some-foreign-id'],
    })

    expect(res.success).toBe(false)
    expect(res.error).toMatch(/does not belong to project/)
    // Nothing was executed — the guard runs before the first request.
    expect(received).toEqual([])
  })
})

// ─── f. HTML report shows teardown as its own phase ──────────────

describe('run lifecycle — HTML export', () => {
  it('renders a Teardown section and keeps it out of the pass/fail headline', async () => {
    const res = (await harness.invoke('runner:export', {
      format: 'html',
      results: [
        {
          endpointId: '1',
          endpointName: 'Main',
          method: 'GET',
          url: '/main',
          status: 200,
          statusText: 'OK',
          duration: 5,
          passed: 0,
          failed: 0,
          skipped: 0,
          assertions: [],
          phase: 'main',
        },
        {
          endpointId: '2',
          endpointName: 'Cleanup',
          method: 'DELETE',
          url: '/cleanup',
          status: 500,
          statusText: 'ERR',
          duration: 5,
          passed: 0,
          failed: 0,
          skipped: 0,
          assertions: [],
          phase: 'teardown',
        },
      ],
    })) as { success: boolean; data?: string }

    expect(res.success).toBe(true)
    const html = res.data ?? ''
    expect(html).toContain('Teardown')
    // Headline: 1 passed / 0 failed — the broken cleanup is NOT counted there.
    expect(html).toMatch(/#1a7a4a">1<\/div><div class="stat-label">Passed/)
    expect(html).toMatch(/#cc2200">0<\/div><div class="stat-label">Failed/)
  })
})

// ─── f. Counters and semantics an adversarial review found wrong ──

describe('run lifecycle — counters stay honest', () => {
  it('teardown assertion failures stay OUT of the run’s test counts', async () => {
    // failedAssertions is persisted as runner_history.failed_tests and drives
    // every history list, so a failing cleanup assertion would show a green run
    // as having failed tests.
    const mainId = seedEndpoint({
      name: 'Main',
      url: `http://127.0.0.1:${port}/main`,
      assertions: [
        { id: 'a1', name: 'is 200', type: 'status_equals', enabled: true, expected: 200 },
      ],
    })
    const teardownId = seedEndpoint({
      name: 'Cleanup',
      url: `http://127.0.0.1:${port}/cleanup`,
      assertions: [
        { id: 'a2', name: 'is 418', type: 'status_equals', enabled: true, expected: 418 },
      ],
    })

    const res = await run({ endpointIds: [mainId], teardownEndpointIds: [teardownId] })

    expect(res.data?.passedAssertions).toBe(1)
    expect(res.data?.failedAssertions).toBe(0)
    expect(res.data?.failedEndpoints).toBe(0)
    // …and the cleanup failure is still REPORTED, just apart.
    expect(res.data?.teardownFailedEndpoints).toBe(1)
    const teardown = teardownRows(res)[0]
    expect(teardown.failed).toBe(1)
  })

  it('totalEndpoints counts exactly the rows passed+failed cover', async () => {
    const mainId = seedEndpoint({ name: 'Main', url: `http://127.0.0.1:${port}/main` })
    const setupId = seedEndpoint({ name: 'Setup', url: `http://127.0.0.1:${port}/setup` })
    const teardownId = seedEndpoint({ name: 'Cleanup', url: `http://127.0.0.1:${port}/cleanup` })

    const res = await run({
      endpointIds: [mainId],
      setupEndpointIds: [setupId],
      teardownEndpointIds: [teardownId],
    })

    const { totalEndpoints = 0, passedEndpoints = 0, failedEndpoints = 0 } = res.data ?? {}
    expect(passedEndpoints + failedEndpoints).toBe(totalEndpoints)
    expect(totalEndpoints).toBe(2) // setup + main; teardown is tallied apart
  })

  it('a row with no URL fails without aborting a stopOnError run', async () => {
    // Pre-#72 the loop `continue`d past a broken row, so one unconfigured
    // request did not kill an entire nightly run. (An id that does not exist at
    // all is refused earlier still, by the pre-existing ownership guard.)
    const brokenId = seedEndpoint({ name: 'Broken', url: '' })
    const mainId = seedEndpoint({ name: 'Main', url: `http://127.0.0.1:${port}/main` })
    const res = await run({
      endpointIds: [brokenId, mainId],
      stopOnError: true,
    })

    expect(res.success).toBe(true)
    expect(received).toEqual(['/main'])
    expect(res.data?.failedEndpoints).toBe(1)
    expect(res.data?.stopReason).toBeUndefined()
  })

  it('a run hook that THROWS is reported as a failure, not scored as a pass', async () => {
    const mainId = seedEndpoint({ name: 'Main', url: `http://127.0.0.1:${port}/main` })
    const res = await run({
      endpointIds: [mainId],
      runPreScript: 'throw new Error("token fetch failed")',
    })

    const hookRow = (res.data?.results ?? []).find((r) => r.statusText === 'SCRIPT')
    expect(hookRow?.error).toMatch(/token fetch failed/)
    expect(res.data?.failedEndpoints).toBe(1)
  })

  it('a healthy run hook does not fail the run', async () => {
    const mainId = seedEndpoint({ name: 'Main', url: `http://127.0.0.1:${port}/main` })
    const res = await run({
      endpointIds: [mainId],
      runPreScript: 'pm.environment.set("token", "abc")',
    })

    expect(res.data?.failedEndpoints).toBe(0)
  })
})
