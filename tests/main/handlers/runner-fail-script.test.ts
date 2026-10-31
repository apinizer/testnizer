/**
 * Issue #267 — the run-level FAIL SCRIPT (`runFailScript`).
 *
 * ── CONTRACT (the implementer must satisfy this file) ──────────────────────
 *
 *  Option / persistence
 *   - `RunnerExecuteOptions.runFailScript?: string` (src/shared/runner-types.ts),
 *     next to `runPreScript` / `runPostScript`.
 *
 *  When it runs — ONCE per run, in `executeCollection`'s teardown `finally`,
 *  AFTER the teardown requests and AFTER the run teardown script (`runPostScript`),
 *  and ONLY when the run's verdict is failed. Verdict = the same rule as the UI
 *  (`summarizeRun` / `endpointDidPass`): setup + main rows only, teardown rows
 *  never count. A row stopped by `criticalFailed` is a counted failure.
 *
 *    | situation                                         | fail script            |
 *    | green run                                         | never                  |
 *    | red, stopOnError off                              | all main, teardown, 1x |
 *    | red, stopOnError on                               | stop, teardown, 1x     |
 *    | setup request / run setup script failed           | main skipped, teardown, 1x |
 *    | teardown-only failure (requests or script)        | NOT run                |
 *    | hard stop (stopReason 'stoppedImmediately')       | NOT run               |
 *    | explicit "Skip teardown" (stopReason 'teardownAborted') | NOT run          |
 *    | graceful Stop, no counted failure                 | NOT run                |
 *    | graceful Stop, counted failure (inferred)         | 1x                     |
 *
 *  Its result row uses the EXISTING 'teardown' phase, so it can never change the
 *  verdict: synthetic `endpointId: '__run_fail_script__'`,
 *  `endpointName: 'Run fail script'`, `statusText: 'SCRIPT'`, `phase: 'teardown'`,
 *  `error` set when the script throws, `assertions` from its `pm.test`s. It is
 *  appended AFTER the 'Run teardown script' row, so it is the last result.
 *
 *  `pm.run` exists ONLY in this hook (setup/teardown scripts and request scripts
 *  have `pm.run === undefined`):
 *    pm.run.summary   frozen { passed, failed, skipped, errors, duration, stopReason }
 *                     (= summarizeRun of the finished run BEFORE the hook, teardown
 *                     excluded; `duration` ms since the run began; `stopReason` the
 *                     run's RunStopReason or `null`)
 *    pm.run.exportHtml() / exportJson()  string — `buildRunReport(snapshot, fmt,
 *                     { secrets: liveSecretValues(ctx.scopes) })` where `snapshot`
 *                     is the results array as it was BEFORE the hook started (so it
 *                     does not contain the fail script's own row).
 *
 *  Stop semantics inside the hook:
 *   - a direct Stop (`runner:stop {mode:'direct'}`) aborts the hook: an in-flight
 *     `pm.sendRequest` (awaited or fire-and-forget) is cancelled and the run
 *     resolves — it must never hang until the HTTP timeout;
 *   - a graceful Stop does NOT abort it (same promise as cleanup);
 *   - fire-and-forget `pm.sendRequest` calls are awaited before the run resolves.
 *
 * The negative rows (green, teardown-only, hard stop, …) pass even before the
 * feature exists; each therefore ALSO asserts an adjacent request that must have
 * run (`/teardown-hook`, `/cleanup`, …), so they cannot pass by the run being broken.
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
import type { EndpointRunResult } from '../../../src/shared/runner-types'

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

const FAIL_ROW_ID = '__run_fail_script__'
const LATE_SECRET = 'LATE-SECRET-4242-zq'

// ─── Local server ────────────────────────────────────────────────

let server: Server
let port = 0
let deadPort = 0
/** Paths in arrival order. */
let received: string[] = []
/** Bodies per path (POST hooks). */
let bodies: Record<string, string[]> = {}
let hangs = 0
let slowDone = false
const sockets = new Set<import('node:net').Socket>()

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/'
      let body = ''
      req.on('data', (c) => (body += String(c)))
      req.on('end', () => {
        received.push(url)
        ;(bodies[url] ??= []).push(body)
        const ok = (payload = '{"ok":true}'): void => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(payload)
        }
        if (url.startsWith('/stopDirect')) {
          void harness.invoke('runner:stop', { mode: 'direct' })
          return ok()
        }
        if (url.startsWith('/stopTeardown')) {
          void harness.invoke('runner:stop', { skipTeardown: true })
          return ok()
        }
        if (url.startsWith('/plainStopHook')) {
          void harness.invoke('runner:stop')
          return ok()
        }
        if (url.startsWith('/stop')) {
          void harness.invoke('runner:stop')
          return ok()
        }
        if (url.startsWith('/hang')) {
          hangs++
          return // never answers; the test (or the abort) ends it
        }
        if (url.startsWith('/slowhook')) {
          setTimeout(() => {
            slowDone = true
            ok()
          }, 150)
          return
        }
        if (url.startsWith('/echoToken')) return ok(`{"note":"${LATE_SECRET}"}`)
        if (url === '/fail' || url.startsWith('/fail?')) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('boom')
          return
        }
        ok()
      })
    })
    server.on('connection', (s) => {
      sockets.add(s)
      s.on('close', () => sockets.delete(s))
    })
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port
      resolve()
    })
  })
  await new Promise<void>((resolve) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      deadPort = (probe.address() as AddressInfo).port
      probe.close(() => resolve())
    })
  })
})

afterAll(
  () =>
    new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy()
      server.close(() => resolve())
    }),
)

// ─── Seed helpers ────────────────────────────────────────────────

let workspaceId: string
let projectId: string

function seedEndpoint(opts: {
  name?: string
  path: string
  host?: number
  preScript?: string
}): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = JSON.stringify({
    method: 'GET',
    url: `http://127.0.0.1:${opts.host ?? port}${opts.path}`,
    params: [],
    headers: [],
    auth: { type: 'none' },
    assertions: [],
    preScript: opts.preScript,
  })
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'http', 'GET', ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, opts.name ?? opts.path, opts.path, schema, now, now)
  return id
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  received = []
  bodies = {}
  hangs = 0
  slowDone = false
  registerRunnerHandlers()
})

afterEach(() => {
  testDb.close()
})

interface Report {
  success: boolean
  error?: string
  data?: {
    totalEndpoints: number
    passedEndpoints: number
    failedEndpoints: number
    teardownPassedEndpoints?: number
    teardownFailedEndpoints?: number
    stopReason?: string
    environmentName?: string
    results: EndpointRunResult[]
  }
}

function run(options: Record<string, unknown>): Promise<Report> {
  return harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    ...options,
  }) as Promise<Report>
}

/** `pm.sendRequest` POST of `expr` (a JS expression) to a hook path. */
const post = (path: string, expr = "''"): string =>
  `await pm.sendRequest({ url: 'http://127.0.0.1:${port}${path}', method: 'POST', ` +
  `header: { 'Content-Type': 'text/plain' }, body: { mode: 'raw', raw: ${expr} } })`

/*
 * The fail script that proves it ran: one POST to /fail-hook; and the run
 * teardown script — the adjacent anchor for negative rows. Getters, because the
 * server port only exists after `beforeAll`.
 */
const hooks = {
  get FAIL_HOOK(): string {
    return post('/fail-hook')
  },
  get TEARDOWN_HOOK(): string {
    return post('/teardown-hook')
  },
}

const count = (path: string): number => received.filter((p) => p === path).length
const failRow = (res: Report): EndpointRunResult | undefined =>
  res.data?.results.find((r) => r.endpointId === FAIL_ROW_ID)

// ─── The semantics table ─────────────────────────────────────────

describe('run fail script — when it runs (issue #267)', () => {
  it('green run: never runs (adjacent teardown script DID run)', async () => {
    const ok = seedEndpoint({ path: '/ok' })
    const cleanup = seedEndpoint({ path: '/cleanup' })
    const res = await run({
      endpointIds: [ok],
      teardownEndpointIds: [cleanup],
      runPostScript: hooks.TEARDOWN_HOOK,
      runFailScript: hooks.FAIL_HOOK,
    })
    expect(res.success).toBe(true)
    expect(received).toEqual(['/ok', '/cleanup', '/teardown-hook'])
    expect(failRow(res)).toBeUndefined()
  })

  it('red, stopOnError off: every main step, then teardown, then teardown script, then ONCE', async () => {
    const bad = seedEndpoint({ path: '/fail' })
    const ok2 = seedEndpoint({ path: '/ok2' })
    const cleanup = seedEndpoint({ path: '/cleanup' })
    const res = await run({
      endpointIds: [bad, ok2],
      teardownEndpointIds: [cleanup],
      stopOnError: false,
      runPostScript: hooks.TEARDOWN_HOOK,
      runFailScript: hooks.FAIL_HOOK,
    })
    expect(res.success).toBe(true)
    expect(received).toEqual(['/fail', '/ok2', '/cleanup', '/teardown-hook', '/fail-hook'])

    const rows = res.data!.results
    const last = rows[rows.length - 1]
    expect(last.endpointId).toBe(FAIL_ROW_ID)
    expect(last.endpointName).toBe('Run fail script')
    expect(last.phase).toBe('teardown')
    expect(last.statusText).toBe('SCRIPT')
    expect(last.error).toBeUndefined()
    // …directly after the run teardown script's own row.
    expect(rows[rows.length - 2].endpointId).toBe('__run_post_script__')
    expect(rows.filter((r) => r.endpointId === FAIL_ROW_ID)).toHaveLength(1)
  })

  it('red, stopOnError on: the flow stops, teardown runs, the hook fires once', async () => {
    const bad = seedEndpoint({ path: '/fail' })
    const never = seedEndpoint({ path: '/never' })
    const cleanup = seedEndpoint({ path: '/cleanup' })
    const res = await run({
      endpointIds: [bad, never],
      teardownEndpointIds: [cleanup],
      stopOnError: true,
      runFailScript: hooks.FAIL_HOOK,
    })
    expect(received).toEqual(['/fail', '/cleanup', '/fail-hook'])
    expect(res.data?.stopReason).toBe('stopOnError')
    expect(failRow(res)).toBeDefined()
  })

  it('setup request failure: main skipped, teardown runs, the hook fires once', async () => {
    const setup = seedEndpoint({ path: '/fail' })
    const never = seedEndpoint({ path: '/never' })
    const cleanup = seedEndpoint({ path: '/cleanup' })
    const res = await run({
      setupEndpointIds: [setup],
      endpointIds: [never],
      teardownEndpointIds: [cleanup],
      runFailScript: hooks.FAIL_HOOK,
    })
    expect(received).toEqual(['/fail', '/cleanup', '/fail-hook'])
    expect(res.data?.stopReason).toBe('setupFailed')
  })

  it('run setup SCRIPT failure counts the same: main skipped, teardown, once', async () => {
    const never = seedEndpoint({ path: '/never' })
    const cleanup = seedEndpoint({ path: '/cleanup' })
    const res = await run({
      endpointIds: [never],
      teardownEndpointIds: [cleanup],
      runPreScript: "throw new Error('no token')",
      runFailScript: hooks.FAIL_HOOK,
    })
    expect(received).toEqual(['/cleanup', '/fail-hook'])
    expect(res.data?.stopReason).toBe('setupFailed')
  })

  it('teardown-only failure on an otherwise green run: NOT run (teardown script anchors)', async () => {
    const ok = seedEndpoint({ path: '/ok' })
    const badCleanup = seedEndpoint({ path: '/fail' })
    const res = await run({
      endpointIds: [ok],
      teardownEndpointIds: [badCleanup],
      runPostScript: hooks.TEARDOWN_HOOK,
      runFailScript: hooks.FAIL_HOOK,
    })
    expect(received).toEqual(['/ok', '/fail', '/teardown-hook'])
    expect(res.data?.teardownFailedEndpoints).toBe(1)
    expect(res.data?.failedEndpoints).toBe(0)
    expect(failRow(res)).toBeUndefined()
  })

  it('a throwing run teardown script on a green run: NOT run', async () => {
    const ok = seedEndpoint({ path: '/ok' })
    const cleanup = seedEndpoint({ path: '/cleanup' })
    const res = await run({
      endpointIds: [ok],
      teardownEndpointIds: [cleanup],
      runPostScript: "throw new Error('cleanup script broke')",
      runFailScript: hooks.FAIL_HOOK,
    })
    expect(received).toEqual(['/ok', '/cleanup'])
    const teardownScript = res.data!.results.find((r) => r.endpointId === '__run_post_script__')
    expect(teardownScript?.error).toContain('cleanup script broke')
    expect(failRow(res)).toBeUndefined()
  })

  it('hard stop during the flow (stoppedImmediately): NOT run, even though the verdict is red', async () => {
    const bad = seedEndpoint({ path: '/fail' })
    const stopper = seedEndpoint({ path: '/stopDirect' })
    const never = seedEndpoint({ path: '/never' })
    const cleanup = seedEndpoint({ path: '/cleanup' })
    const res = await run({
      endpointIds: [bad, stopper, never],
      teardownEndpointIds: [cleanup],
      stopOnError: false,
      runFailScript: hooks.FAIL_HOOK,
    })
    expect(received).toContain('/fail')
    expect(received).toContain('/stopDirect')
    expect(received).not.toContain('/never')
    expect(res.data?.stopReason).toBe('stoppedImmediately')
    expect(count('/fail-hook')).toBe(0)
    expect(failRow(res)).toBeUndefined()
  })

  it('explicit Skip teardown (teardownAborted): NOT run', async () => {
    const bad = seedEndpoint({ path: '/fail' })
    const skipper = seedEndpoint({ path: '/stopTeardown' })
    const cleanup2 = seedEndpoint({ path: '/cleanup2' })
    const res = await run({
      endpointIds: [bad],
      teardownEndpointIds: [skipper, cleanup2],
      runFailScript: hooks.FAIL_HOOK,
    })
    expect(received).toEqual(['/fail', '/stopTeardown'])
    expect(res.data?.stopReason).toBe('teardownAborted')
    expect(failRow(res)).toBeUndefined()
  })

  it('graceful Stop with no counted failure (cancelled): NOT run (teardown ran)', async () => {
    const stopper = seedEndpoint({ path: '/stop' })
    const never = seedEndpoint({ path: '/never' })
    const cleanup = seedEndpoint({ path: '/cleanup' })
    const res = await run({
      endpointIds: [stopper, never],
      teardownEndpointIds: [cleanup],
      runFailScript: hooks.FAIL_HOOK,
    })
    expect(received).toEqual(['/stop', '/cleanup'])
    expect(res.data?.stopReason).toBe('cancelled')
    expect(failRow(res)).toBeUndefined()
  })

  it('graceful Stop AFTER a counted failure: the verdict is red, so it fires once (inferred row)', async () => {
    const bad = seedEndpoint({ path: '/fail' })
    const stopper = seedEndpoint({ path: '/stop' })
    const never = seedEndpoint({ path: '/never' })
    const cleanup = seedEndpoint({ path: '/cleanup' })
    const res = await run({
      endpointIds: [bad, stopper, never],
      teardownEndpointIds: [cleanup],
      stopOnError: false,
      runFailScript: hooks.FAIL_HOOK,
    })
    expect(received).toEqual(['/fail', '/stop', '/cleanup', '/fail-hook'])
    expect(res.data?.stopReason).toBe('cancelled')
  })

  it('a transport error is a counted failure too', async () => {
    const dead = seedEndpoint({ path: '/x', host: deadPort })
    const res = await run({ endpointIds: [dead], runFailScript: hooks.FAIL_HOOK })
    expect(received).toEqual(['/fail-hook'])
    expect(res.data?.failedEndpoints).toBe(1)
  })

  it('once per RUN, not per iteration or per failure (3 iterations, 2 failures each)', async () => {
    const bad = seedEndpoint({ path: '/fail' })
    const bad2 = seedEndpoint({ path: '/fail?b' })
    const res = await run({
      endpointIds: [bad, bad2],
      iterations: 3,
      stopOnError: false,
      runFailScript: hooks.FAIL_HOOK,
    })
    expect(res.data?.failedEndpoints).toBe(6)
    expect(count('/fail-hook')).toBe(1)
    expect(res.data!.results.filter((r) => r.endpointId === FAIL_ROW_ID)).toHaveLength(1)
    // …and it is last, after every iteration.
    expect(received[received.length - 1]).toBe('/fail-hook')
  })

  it('an empty or whitespace fail script adds no row', async () => {
    const bad = seedEndpoint({ path: '/fail' })
    const res = await run({ endpointIds: [bad], runFailScript: '   ' })
    expect(failRow(res)).toBeUndefined()
  })
})

describe('run fail script — never changes the verdict (issue #267)', () => {
  async function redRun(runFailScript: string | undefined): Promise<Report> {
    const bad = seedEndpoint({ path: '/fail' })
    const ok = seedEndpoint({ path: '/ok' })
    return run({ endpointIds: [bad, ok], stopOnError: false, runFailScript })
  }

  it('a throwing fail script is a visible row; counters and stopReason equal the run without it', async () => {
    const baseline = await redRun(undefined)
    const withHook = await redRun("throw new Error('mail api is down')")

    const row = failRow(withHook)
    expect(row, 'the failure must be visible as its own row').toBeDefined()
    expect(row!.phase).toBe('teardown')
    expect(row!.error).toContain('mail api is down')

    expect(withHook.data!.failedEndpoints).toBe(baseline.data!.failedEndpoints)
    expect(withHook.data!.passedEndpoints).toBe(baseline.data!.passedEndpoints)
    expect(withHook.data!.totalEndpoints).toBe(baseline.data!.totalEndpoints)
    expect(withHook.data!.stopReason).toBe(baseline.data!.stopReason)
  })

  it('a failed pm.test in the fail script shows in the row and still leaves the verdict alone', async () => {
    const res = await redRun("pm.test('mail delivered', function () { pm.expect(1).to.equal(2) })")
    const row = failRow(res)
    expect(row?.assertions.some((a) => a.name === 'mail delivered' && !a.passed)).toBe(true)
    expect(row?.failed).toBe(1)
    expect(res.data!.failedEndpoints).toBe(1)
    expect(res.data!.passedEndpoints).toBe(1)
  })

  it('the stored History row carries the hook row but counts only the run proper', async () => {
    await redRun("throw new Error('mail api is down')")
    const h = testDb.prepare('SELECT * FROM runner_history').get() as {
      total_endpoints: number
      passed_endpoints: number
      failed_endpoints: number
      results_json: string
    }
    expect(h.total_endpoints).toBe(2)
    expect(h.passed_endpoints).toBe(1)
    expect(h.failed_endpoints).toBe(1)
    const stored = JSON.parse(h.results_json) as EndpointRunResult[]
    expect(stored.some((r) => r.endpointId === FAIL_ROW_ID)).toBe(true)
  })
})

describe('run fail script — pm.run (issue #267)', () => {
  it('pm.run exists only in the fail script (setup, teardown and request scripts have none)', async () => {
    const check = (label: string, want: 'undefined' | 'object'): string =>
      `pm.test('${label}', function () { pm.expect(typeof pm.run).to.equal('${want}') })`
    const bad = seedEndpoint({
      path: '/fail',
      preScript: check('request script has no pm.run', 'undefined'),
    })
    // The passing pre-request pm.test above makes `/fail` assertion-driven and
    // therefore PASSED (issue #16) — a second, assertion-less 500 keeps the run red.
    const red = seedEndpoint({ path: '/fail?red' })
    const res = await run({
      endpointIds: [bad, red],
      runPreScript: check('setup script has no pm.run', 'undefined'),
      runPostScript: check('teardown script has no pm.run', 'undefined'),
      runFailScript: check('fail script has pm.run', 'object'),
    })
    const names = res.data!.results.flatMap((r) => r.assertions)
    for (const label of [
      'setup script has no pm.run',
      'teardown script has no pm.run',
      'fail script has pm.run',
    ]) {
      const a = names.find((x) => x.name === label)
      expect(a, label).toBeDefined()
      expect(a!.passed, label).toBe(true)
    }
    const reqRow = res.data!.results.find((r) => r.endpointId === bad)
    expect(reqRow?.assertions.every((a) => a.passed)).toBe(true)
  })

  it('pm.run.summary: passed / failed / skipped / errors / duration / stopReason of the finished run', async () => {
    const bad = seedEndpoint({ path: '/fail' })
    const skippedAfter = seedEndpoint({ path: '/never' })
    const cleanup = seedEndpoint({ path: '/cleanup' })
    const res = await run({
      endpointIds: [bad, skippedAfter],
      teardownEndpointIds: [cleanup],
      stopOnError: true,
      runFailScript: post('/summary', 'JSON.stringify(pm.run.summary)'),
    })
    expect(res.data?.stopReason).toBe('stopOnError')
    const summary = JSON.parse(bodies['/summary'][0]) as Record<string, unknown>
    expect(Object.keys(summary).sort()).toEqual(
      ['duration', 'errors', 'failed', 'passed', 'skipped', 'stopReason'].sort(),
    )
    expect(summary.passed).toBe(0)
    expect(summary.failed).toBe(1)
    expect(summary.skipped).toBe(1)
    expect(summary.errors).toBe(0)
    expect(summary.stopReason).toBe('stopOnError')
    expect(typeof summary.duration).toBe('number')
    expect(summary.duration as number).toBeGreaterThanOrEqual(0)
  })

  it('pm.run.summary counts a transport error as an error, and stopReason is null when nothing stopped the run', async () => {
    const dead = seedEndpoint({ path: '/x', host: deadPort })
    await run({
      endpointIds: [dead],
      stopOnError: false,
      runFailScript: post('/summary', 'JSON.stringify(pm.run.summary)'),
    })
    const summary = JSON.parse(bodies['/summary'][0]) as Record<string, unknown>
    expect(summary.failed).toBe(1)
    expect(summary.errors).toBe(1)
    expect(summary.stopReason).toBeNull()
  })

  it('pm.run.summary is read-only for the script', async () => {
    const bad = seedEndpoint({ path: '/fail' })
    await run({
      endpointIds: [bad],
      runFailScript:
        'try { pm.run.summary.failed = 99 } catch (e) {}\n' +
        post('/summary', 'JSON.stringify(pm.run.summary)'),
    })
    expect((JSON.parse(bodies['/summary'][0]) as { failed: number }).failed).toBe(1)
  })

  it('pm.run.exportHtml()/exportJson() equal the Export output for the same results (masking included)', async () => {
    const bad = seedEndpoint({ path: '/fail' })
    const ok = seedEndpoint({ path: '/ok' })
    const cleanup = seedEndpoint({ path: '/cleanup' })
    const res = await run({
      endpointIds: [bad, ok],
      teardownEndpointIds: [cleanup],
      stopOnError: false,
      runPostScript: hooks.TEARDOWN_HOOK,
      runFailScript: `${post('/export-html', 'pm.run.exportHtml()')}\n${post('/export-json', 'pm.run.exportJson()')}`,
    })

    // The snapshot is the run as it stood BEFORE the hook began: no fail row.
    const snapshot = res.data!.results.filter((r) => r.endpointId !== FAIL_ROW_ID)
    expect(snapshot.length).toBe(res.data!.results.length - 1)

    // The live results header's Export passes the report's environment (issue
    // #307), so the parity check does too.
    const viaExport = async (format: 'html' | 'json'): Promise<string> =>
      (
        (await harness.invoke('runner:export', {
          results: snapshot,
          format,
          environmentName: res.data!.environmentName,
        })) as { data: string }
      ).data
    const stamp = (s: string): string => s.replace(/Generated: [^<]+/, 'Generated: <t>')

    expect(stamp(bodies['/export-html'][0])).toBe(stamp(await viaExport('html')))
    expect(bodies['/export-json'][0]).toBe(await viaExport('json'))
    // The run teardown script ran before the hook, so its row IS in the snapshot.
    expect(bodies['/export-json'][0]).toContain('__run_post_script__')
    expect(bodies['/export-json'][0]).not.toContain(FAIL_ROW_ID)
  })

  it('a value that became secret LATER in the run is masked in pm.run exports (live secrets reach the mask)', async () => {
    // The echoed token is not a known secret when step 1 is recorded; step 2's
    // pre-request script then writes it to a SECRET variable. Only the live
    // value can mask step 1's row at export time — the DB still holds the old one.
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
         VALUES ('env1', ?, ?, 'Dev', 1, ?, ?)`,
      )
      .run(workspaceId, projectId, now, now)
    testDb
      .prepare(
        `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
         VALUES ('v1', 'env1', 'tok', 'placeholder-tok-1', 1, 1, NULL)`,
      )
      .run()
    const echo = seedEndpoint({ path: '/echoToken' })
    const bad = seedEndpoint({
      path: '/fail',
      preScript: `pm.environment.set('tok', '${LATE_SECRET}')`,
    })
    await run({
      endpointIds: [echo, bad],
      stopOnError: false,
      runFailScript: `${post('/export-html', 'pm.run.exportHtml()')}\n${post('/export-json', 'pm.run.exportJson()')}`,
    })
    expect(bodies['/export-json'], 'the hook must have exported').toBeDefined()
    expect(bodies['/export-json'][0]).not.toContain(LATE_SECRET)
    expect(bodies['/export-html'][0]).not.toContain(LATE_SECRET)
  })
})

describe('run fail script — Stop and pending requests (issue #267)', () => {
  it('a direct Stop during the hook aborts a pending pm.sendRequest: the run resolves, it does not hang', async () => {
    const bad = seedEndpoint({ path: '/fail' })
    const started = run({
      endpointIds: [bad],
      // Fire-and-forget: only the pending-send drain keeps this script alive.
      runFailScript: `pm.sendRequest('http://127.0.0.1:${port}/hang', function () {})`,
    })
    await vi.waitFor(() => expect(hangs).toBe(1), { timeout: 5000 })
    void harness.invoke('runner:stop', { mode: 'direct' })

    const res = await Promise.race([
      started,
      new Promise<'hung'>((r) => setTimeout(() => r('hung'), 5000)),
    ])
    expect(res, 'run did not resolve within 5 s of the direct Stop').not.toBe('hung')
    expect((res as Report).success).toBe(true)
    expect(hangs).toBe(1)
  }, 12_000)

  it('the same for an AWAITED pm.sendRequest', async () => {
    const bad = seedEndpoint({ path: '/fail' })
    const started = run({
      endpointIds: [bad],
      runFailScript: `await pm.sendRequest('http://127.0.0.1:${port}/hang')`,
    })
    await vi.waitFor(() => expect(hangs).toBe(1), { timeout: 5000 })
    void harness.invoke('runner:stop', { mode: 'direct' })
    const res = await Promise.race([
      started,
      new Promise<'hung'>((r) => setTimeout(() => r('hung'), 5000)),
    ])
    expect(res).not.toBe('hung')
    expect((res as Report).success).toBe(true)
  }, 12_000)

  it('a graceful Stop during the hook does not cut it short (cleanup promise)', async () => {
    const bad = seedEndpoint({ path: '/fail' })
    const res = await run({
      endpointIds: [bad],
      runFailScript: `${post('/plainStopHook')}\n${post('/after-stop-hook')}`,
    })
    expect(received).toEqual(['/fail', '/plainStopHook', '/after-stop-hook'])
    expect(failRow(res)?.error).toBeUndefined()
  })

  it('fire-and-forget pm.sendRequest calls finish before the run resolves', async () => {
    const bad = seedEndpoint({ path: '/fail' })
    await run({
      endpointIds: [bad],
      runFailScript: `pm.sendRequest('http://127.0.0.1:${port}/slowhook', function () {})`,
    })
    expect(slowDone).toBe(true)
  })
})
