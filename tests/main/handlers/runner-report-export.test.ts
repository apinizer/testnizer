/**
 * Issue #266 — ONE main-side report generator.
 *
 * ── CONTRACT (the implementer must satisfy this file) ──────────────────────
 *
 *  `src/main/lib/run-report.ts` exports
 *
 *      buildRunReport(
 *        results: readonly EndpointRunResult[],
 *        format: 'html' | 'json',
 *        options?: { secrets?: readonly unknown[]; generatedAt?: Date | number },
 *      ): string
 *
 *  It does masking AND serialisation together, so no caller can serialise
 *  without masking:
 *   - masks every row with `maskRunResult(row, scrubberFor(db, options.secrets))`
 *     where `db` is `getDb()` (a secret env/global variable in the DB is masked
 *     by value) and `options.secrets` are extra live values (a value a script
 *     wrote to a secret variable that is not in the DB yet);
 *   - 'json'  → `JSON.stringify(maskedResults, null, 2)` (the SAME shape as the
 *     old `exportAsJson`: a plain array of masked rows — a shape change would
 *     break existing consumers);
 *   - 'html'  → the old `exportAsHtml` document, with the "Generated:" stamp
 *     taken from `options.generatedAt` when given (otherwise now), and with a
 *     `data-stat="<name>"` attribute on each headline `.stat-value` element:
 *     `passed`, `failed`, `skipped` (only when > 0, as today), `total`,
 *     `teardown` (only when teardown rows exist). The numbers come from
 *     `summarizeRun` (teardown excluded from passed/failed/total);
 *   - a row with no method/url (a run-level script: setup / teardown / fail
 *     script) prints its `endpointName` in the row header instead of a blank
 *     line, so "Run fail script" and its error are readable in the report.
 *
 *  Callers: the `runner:export` IPC handler (`{results, format}` → `buildRunReport`)
 *  and the run fail script's `pm.run.exportHtml()/exportJson()` (issue #267).
 *  There is no second serializer: `exportAsHtml`/`exportAsJson` stop being
 *  reachable from anywhere but `buildRunReport`.
 *
 * Masking is idempotent: feeding a masked report back through the generator
 * (a History row's `results_json`) yields the same text.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './helpers'
import { summarizeRun } from '../../../src/shared/runner-summary'
import { HISTORY_MASK } from '../../../src/shared/credential-headers'
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
const { buildRunReport } = await import('../../../src/main/lib/run-report')

const DB_SECRET = 'db-secret-S3CRET-4411'
const LIVE_SECRET = 'live-only-T0KEN-9020'
const LITERAL_KEY = 'literal-report-key-7788'

let workspaceId: string
let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
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
       VALUES ('v1', 'env1', 'tok', ?, 1, 1, NULL)`,
    )
    .run(DB_SECRET)
  registerRunnerHandlers()
})

afterEach(() => {
  testDb.close()
})

function row(over: Partial<EndpointRunResult> & { endpointId: string }): EndpointRunResult {
  return {
    endpointName: over.endpointId,
    method: 'GET',
    url: `http://h.test/${over.endpointId}`,
    status: 200,
    statusText: 'OK',
    duration: 10,
    passed: 0,
    failed: 0,
    skipped: 0,
    assertions: [],
    phase: 'main',
    ...over,
  }
}

/** A run that exercises every bucket the headline counters have to get right. */
function mixedRun(): EndpointRunResult[] {
  return [
    row({ endpointId: 'setup-ok', phase: 'setup' }),
    row({ endpointId: 'main-ok', assertions: [{ name: 'is 200', passed: true }], passed: 1 }),
    row({
      endpointId: 'main-bad',
      status: 500,
      statusText: 'Server Error',
      assertions: [{ name: 'is 200', passed: false, error: 'expected 500 to equal 200' }],
      failed: 1,
    }),
    row({ endpointId: 'main-never', status: null, statusText: 'NOT_RUN', skipped: 1 }),
    row({ endpointId: 'cleanup-bad', phase: 'teardown', status: 404, statusText: 'Not Found' }),
    row({
      endpointId: '__run_fail_script__',
      endpointName: 'Run fail script',
      phase: 'teardown',
      status: null,
      statusText: 'SCRIPT',
      error: 'mail api is down',
    }),
  ]
}

/** `data-stat` value as the report prints it. */
function stat(html: string, name: string): number | null {
  const m = html.match(new RegExp(`data-stat="${name}"[^>]*>\\s*(\\d+)\\s*<`))
  return m ? Number(m[1]) : null
}

/** The only line two builds of the same results may differ on. */
const stripStamp = (html: string): string => html.replace(/Generated: [^<]+/, 'Generated: <t>')

describe('buildRunReport — headline counts are the in-app summary (issue #266)', () => {
  it('html: passed / failed / skipped / total come from summarizeRun, teardown excluded', () => {
    const results = mixedRun()
    const summary = summarizeRun(results)
    const html = buildRunReport(results, 'html')

    expect(stat(html, 'passed')).toBe(summary.passed)
    expect(stat(html, 'failed')).toBe(summary.failed)
    expect(stat(html, 'skipped')).toBe(summary.skipped)
    expect(stat(html, 'total')).toBe(summary.total)
    // Concrete numbers, so the test is not a tautology of the helper:
    // setup-ok + main-ok pass, main-bad fails, main-never is neutral,
    // the two teardown rows never touch the verdict.
    expect([summary.passed, summary.failed, summary.skipped, summary.total]).toEqual([2, 1, 1, 4])
    expect(stat(html, 'teardown')).toBe(2)
  })

  it('html: a green run with a failing teardown stays green in the headline', () => {
    const results = [
      row({ endpointId: 'a', assertions: [{ name: 'ok', passed: true }], passed: 1 }),
      row({ endpointId: 'cleanup', phase: 'teardown', status: 500, statusText: 'Server Error' }),
    ]
    const html = buildRunReport(results, 'html')
    expect(stat(html, 'passed')).toBe(1)
    expect(stat(html, 'failed')).toBe(0)
  })

  it('html: a fail-script error row is visible in the report but not counted as a failure', () => {
    const html = buildRunReport(mixedRun(), 'html')
    expect(html).toContain('Run fail script')
    expect(html).toContain('mail api is down')
    expect(stat(html, 'failed')).toBe(1)
  })

  it('json: a plain array of the rows, 2-space indented (shape unchanged)', () => {
    const results = mixedRun()
    const out = buildRunReport(results, 'json')
    expect(out).toBe(JSON.stringify(results, null, 2))
    const parsed = JSON.parse(out) as EndpointRunResult[]
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.map((r) => r.endpointId)).toEqual(results.map((r) => r.endpointId))
  })

  it('generatedAt makes the document reproducible; without it the stamp is "now"', () => {
    const at = new Date('2026-10-30T08:00:00.000Z')
    const a = buildRunReport(mixedRun(), 'html', { generatedAt: at })
    const b = buildRunReport(mixedRun(), 'html', { generatedAt: at })
    expect(a).toBe(b)
    expect(a).toContain('Generated: 2026-10-30T08:00:00.000Z')
    expect(buildRunReport(mixedRun(), 'html')).toMatch(/Generated: \d{4}-\d{2}-\d{2}T/)
  })
})

describe('buildRunReport — masking and serialisation are one step (issue #266)', () => {
  function leaky(): EndpointRunResult[] {
    return [
      row({
        endpointId: 'leak',
        url: `http://h.test/x?api_key=${DB_SECRET}`,
        requestHeaders: { Authorization: `Bearer ${DB_SECRET}`, 'X-API-Key': LITERAL_KEY },
        responseBody: `{"echo":"${DB_SECRET}","late":"${LIVE_SECRET}"}`,
        assertions: [
          { name: 'echoes', passed: false, actual: `got ${LIVE_SECRET}`, error: `${LIVE_SECRET}!` },
        ],
        failed: 1,
        consoleLogs: [{ level: 'log', message: `token ${LIVE_SECRET}`, timestamp: 1 }],
      }),
    ]
  }

  it.each(['html', 'json'] as const)(
    '%s: a secret variable of the DB and a literal credential never appear',
    (format) => {
      const out = buildRunReport(leaky(), format, { secrets: [LIVE_SECRET] })
      expect(out).not.toContain(DB_SECRET)
      expect(out).not.toContain(LITERAL_KEY)
    },
  )

  it.each(['html', 'json'] as const)(
    '%s: a live-only secret passed in the mask context is masked too',
    (format) => {
      const out = buildRunReport(leaky(), format, { secrets: [LIVE_SECRET] })
      expect(out).not.toContain(LIVE_SECRET)
    },
  )

  it('without the live value the generator cannot know it (documents why the context exists)', () => {
    expect(buildRunReport(leaky(), 'json')).toContain(LIVE_SECRET)
  })

  it('json shows the mask token, so a reader sees something was withheld', () => {
    expect(buildRunReport(leaky(), 'json', { secrets: [LIVE_SECRET] })).toContain(HISTORY_MASK)
  })

  it('is idempotent: a stored (already masked) run exports to the same text', () => {
    const once = buildRunReport(leaky(), 'json', { secrets: [LIVE_SECRET] })
    const twice = buildRunReport(JSON.parse(once) as EndpointRunResult[], 'json')
    expect(twice).toBe(once)
    const at = new Date('2026-10-30T08:00:00.000Z')
    const h1 = buildRunReport(leaky(), 'html', { secrets: [LIVE_SECRET], generatedAt: at })
    // Re-rendering the masked rows renders the same document.
    const masked = JSON.parse(once) as EndpointRunResult[]
    expect(buildRunReport(masked, 'html', { generatedAt: at })).toBe(h1)
  })
})

describe('runner:export is the same generator (issue #266)', () => {
  async function exportVia(results: EndpointRunResult[], format: 'html' | 'json'): Promise<string> {
    const res = (await harness.invoke('runner:export', { results, format })) as {
      success: boolean
      data?: string
      error?: string
    }
    expect(res.success, res.error).toBe(true)
    return res.data as string
  }

  it('html equals buildRunReport for the same results (only the stamp may differ)', async () => {
    const via = await exportVia(mixedRun(), 'html')
    const direct = buildRunReport(mixedRun(), 'html')
    expect(stripStamp(via)).toBe(stripStamp(direct))
  })

  it('json equals buildRunReport byte for byte', async () => {
    expect(await exportVia(mixedRun(), 'json')).toBe(buildRunReport(mixedRun(), 'json'))
  })

  it.each(['html', 'json'] as const)('%s: still masked on the way out', async (format) => {
    const leaky = [
      row({
        endpointId: 'leak',
        requestHeaders: { Authorization: `Bearer ${DB_SECRET}`, 'X-API-Key': LITERAL_KEY },
        responseBody: `{"echo":"${DB_SECRET}"}`,
      }),
    ]
    const out = await exportVia(leaky, format)
    expect(out).not.toContain(DB_SECRET)
    expect(out).not.toContain(LITERAL_KEY)
  })
})

describe('a stored run re-exports without re-running (issue #266)', () => {
  const YESTERDAY = Date.now() - 24 * 60 * 60 * 1000

  function storeRun(results: EndpointRunResult[]): string {
    const id = crypto.randomUUID()
    const s = summarizeRun(results)
    testDb
      .prepare(
        `INSERT INTO runner_history (id, project_id, source, iterations, duration_ms,
           total_endpoints, passed_endpoints, failed_endpoints, total_tests, passed_tests,
           failed_tests, skipped_tests, avg_resp_time, results_json, started_at)
         VALUES (?, ?, 'Runner', 1, 100, ?, ?, ?, 0, 0, 0, 0, 5, ?, ?)`,
      )
      .run(id, projectId, s.total, s.passed, s.failed, JSON.stringify(results), YESTERDAY)
    return id
  }

  it('yesterday\'s results_json exports to HTML/JSON whose headline equals the history row', async () => {
    const id = storeRun(mixedRun())
    const stored = testDb.prepare('SELECT * FROM runner_history WHERE id = ?').get(id) as {
      results_json: string
      passed_endpoints: number
      failed_endpoints: number
      total_endpoints: number
    }
    const results = JSON.parse(stored.results_json) as EndpointRunResult[]

    const html = (
      (await harness.invoke('runner:export', { results, format: 'html' })) as { data: string }
    ).data
    expect(stat(html, 'passed')).toBe(stored.passed_endpoints)
    expect(stat(html, 'failed')).toBe(stored.failed_endpoints)
    expect(stat(html, 'total')).toBe(stored.total_endpoints)

    const json = (
      (await harness.invoke('runner:export', { results, format: 'json' })) as { data: string }
    ).data
    expect((JSON.parse(json) as unknown[]).length).toBe(results.length)
  })

  it('exporting a stored run performs no new run (history unchanged)', async () => {
    storeRun(mixedRun())
    const before = (testDb.prepare('SELECT COUNT(*) AS n FROM runner_history').get() as { n: number })
      .n
    await harness.invoke('runner:export', { results: mixedRun(), format: 'html' })
    const after = (testDb.prepare('SELECT COUNT(*) AS n FROM runner_history').get() as { n: number })
      .n
    expect(after).toBe(before)
  })
})
