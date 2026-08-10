/**
 * The two manual stops, and the pause between iterations (issues #91, #89).
 *
 * Manual Stop was reported as "not functionally trustworthy". Two things made
 * it so, and both are pinned here:
 *
 *  1. `shouldStop` is only read BETWEEN steps, so pressing Stop during a slow
 *     request changed nothing observable until that request answered. Users
 *     concluded the button was dead — and clicked again, which is how cleanup
 *     came to be abandoned at random in the first place.
 *  2. There was one control for two intentions. "Abort the flow but clean up
 *     after yourself" and "halt now, touch nothing else" are different asks,
 *     and the old Stop had to guess which one you meant.
 *
 * So: graceful Stop lets the request in flight finish (killing it is how you
 * get the half-written state teardown exists to undo) and guarantees cleanup.
 * Direct Stop aborts the socket and runs nothing afterwards, cleanup included.
 *
 * Same idiom as `runner-lifecycle.test.ts`: a real local HTTP server, endpoints
 * seeded into the `endpoints` table, and the REAL executeCollection loop.
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
/** Path + arrival time, so inter-request gaps can be measured directly. */
let hits: Array<{ url: string; at: number }> = []
const paths = (): string[] => hits.map((h) => h.url)

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/'
      req.resume()
      req.on('end', () => {
        hits.push({ url, at: Date.now() })
        const ok = (): void => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, path: url }))
        }
        // Both stop routes press the button WHILE this request is on the wire,
        // then answer late. That is the exact window the old code could not
        // act in — and the difference between the two modes is whether this
        // response is ever read.
        if (url.startsWith('/gracefulStop')) {
          void harness.invoke('runner:stop', { mode: 'graceful' })
          setTimeout(ok, 120)
          return
        }
        if (url.startsWith('/directStop')) {
          void harness.invoke('runner:stop', { mode: 'direct' })
          // Long enough that a run which waited for this response would be
          // obvious: the assertions below finish well before it fires.
          setTimeout(ok, 3000)
          return
        }
        ok()
      })
    })
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port
      resolve()
    })
  })
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

// ─── Seed helpers ────────────────────────────────────────────────

let workspaceId: string
let projectId: string

function seedEndpoint(name: string, path: string): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const url = `http://127.0.0.1:${port}${path}`
  const schema = JSON.stringify({
    method: 'GET',
    url,
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
    .run(id, projectId, name, url, schema, now, now)
  return id
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  hits = []
  registerRunnerHandlers()
})

afterEach(() => {
  testDb.close()
})

interface RunResultRow {
  endpointName: string
  status: number | null
  statusText?: string
  skipped?: number
  phase?: 'setup' | 'main' | 'teardown'
  iteration?: number
}

interface ExecResult {
  success: boolean
  error?: string
  data?: {
    startedAt: number
    completedAt: number
    stopReason?: string
    results: RunResultRow[]
  }
}

async function run(options: Record<string, unknown>): Promise<ExecResult> {
  return (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    ...options,
  })) as ExecResult
}

const rowsIn = (res: ExecResult, phase: string): RunResultRow[] =>
  (res.data?.results ?? []).filter((r) => (r.phase ?? 'main') === phase)

// ─── Graceful Stop ───────────────────────────────────────────────

describe('graceful Stop', () => {
  it('lets the request already on the wire finish', async () => {
    const mainId = seedEndpoint('Main', '/gracefulStop')

    const res = await run({ endpointIds: [mainId] })

    // Not CANCELLED: a graceful stop must not sever a request mid-write, or it
    // creates exactly the partial state cleanup is there to undo.
    const main = rowsIn(res, 'main')[0]
    expect(main.status).toBe(200)
    expect(main.statusText).not.toBe('CANCELLED')
  })

  it('still runs every teardown step and reports "cancelled"', async () => {
    const mainId = seedEndpoint('Main', '/gracefulStop')
    // A second flow request, so the stop actually cuts something short. (With
    // one request the flow finishes before the flag is next read, and a report
    // that claimed the run was stopped would be describing a run that wasn't.)
    const laterId = seedEndpoint('Later', '/never')
    const cleanup1 = seedEndpoint('Cleanup 1', '/cleanup-a')
    const cleanup2 = seedEndpoint('Cleanup 2', '/cleanup-b')

    const res = await run({
      endpointIds: [mainId, laterId],
      teardownEndpointIds: [cleanup1, cleanup2],
    })

    // The flow stopped where it was told to, and cleanup still got its turn —
    // in order, in full.
    expect(paths()).toEqual(['/gracefulStop', '/cleanup-a', '/cleanup-b'])
    expect(res.data?.stopReason).toBe('cancelled')
    expect(rowsIn(res, 'teardown').every((r) => r.status === 200)).toBe(true)
  })

  it('is not turned destructive by pressing it repeatedly', async () => {
    // The reported reflex: the first click cannot interrupt the request in
    // flight, so the user clicks again. Under the old inference that second
    // click abandoned cleanup. Now only the DIRECT button can.
    const mainId = seedEndpoint('Main', '/gracefulStop')
    const cleanup = seedEndpoint('Cleanup', '/cleanup')

    const started = run({ endpointIds: [mainId], teardownEndpointIds: [cleanup] })
    for (let i = 0; i < 5; i++) await harness.invoke('runner:stop', { mode: 'graceful' })
    const res = await started

    expect(paths()).toContain('/cleanup')
    expect(res.data?.stopReason).toBe('cancelled')
  })
})

// ─── Direct Stop ─────────────────────────────────────────────────

describe('direct Stop', () => {
  it('aborts the request on the wire instead of waiting it out', async () => {
    const mainId = seedEndpoint('Main', '/directStop')

    const startedAt = Date.now()
    const res = await run({ endpointIds: [mainId] })
    const elapsed = Date.now() - startedAt

    // The route answers after 3s. Returning well before that is the whole
    // claim: the halt happened at the click, not at the response.
    expect(elapsed).toBeLessThan(2000)
    const main = rowsIn(res, 'main')[0]
    expect(main.statusText).toBe('CANCELLED')
    // Cancelled is SKIPPED, not failed — the user pulled the plug, which says
    // nothing about the endpoint.
    expect(main.skipped).toBe(1)
    expect(main.status).toBeNull()
  })

  it('runs nothing afterwards — teardown requests and the teardown script included', async () => {
    const mainId = seedEndpoint('Main', '/directStop')
    const cleanup = seedEndpoint('Cleanup', '/cleanup')

    const res = await run({
      endpointIds: [mainId],
      teardownEndpointIds: [cleanup],
      runPostScript: 'pm.test("teardown script ran", () => pm.expect(true).to.be.true)',
    })

    expect(paths()).toEqual(['/directStop'])
    const teardown = rowsIn(res, 'teardown')
    expect(teardown.every((r) => r.skipped === 1)).toBe(true)
    // The run-teardown script is cleanup too — it silently not running while
    // teardown REQUESTS did is what made the old behaviour look random.
    expect((res.data?.results ?? []).some((r) => r.statusText === 'SCRIPT')).toBe(false)
  })

  it('reports the hard halt as its own reason, not as abandoned cleanup', async () => {
    const mainId = seedEndpoint('Main', '/directStop')
    const cleanup = seedEndpoint('Cleanup', '/cleanup')

    const res = await run({ endpointIds: [mainId], teardownEndpointIds: [cleanup] })

    expect(res.data?.stopReason).toBe('stoppedImmediately')
  })

  it('does not send a request whose pre-request script was still running', async () => {
    // The click can land before the HTTP call exists — a pre-request script
    // that fetches a token takes real time. There is nothing on the wire to
    // abort then, so a naive implementation lets the request go out anyway and
    // "nothing after the click" holds only by luck of timing.
    const first = seedEndpoint('First', '/directStop')
    const second = seedEndpoint('Second', '/second')
    // A script slow enough that the halt from the previous step arrives while
    // it is still running.
    testDb
      .prepare(`UPDATE endpoints SET request_schema = ? WHERE id = ?`)
      .run(
        JSON.stringify({
          method: 'GET',
          url: `http://127.0.0.1:${port}/second`,
          params: [],
          headers: [],
          auth: { type: 'none' },
          assertions: [],
          preScript: 'await new Promise((r) => setTimeout(r, 250))',
        }),
        second,
      )

    const res = await run({ endpointIds: [first, second] })

    expect(paths()).toEqual(['/directStop'])
    expect(res.data?.stopReason).toBe('stoppedImmediately')
  })

  it('skips the steps that never started, rather than dropping them', async () => {
    const first = seedEndpoint('First', '/directStop')
    const second = seedEndpoint('Second', '/second')
    const third = seedEndpoint('Third', '/third')

    const res = await run({ endpointIds: [first, second, third] })

    // A three-request run must not report as a one-request run.
    const main = rowsIn(res, 'main')
    expect(main.length).toBe(3)
    expect(main[1].statusText).toBe('NOT_RUN')
    expect(main[2].statusText).toBe('NOT_RUN')
    expect(paths()).toEqual(['/directStop'])
  })
})

// ─── Delay between iterations (issue #89) ────────────────────────

describe('delay between iterations', () => {
  it('waits between iterations without pausing between requests', async () => {
    const a = seedEndpoint('A', '/a')
    const b = seedEndpoint('B', '/b')
    const ITER_DELAY = 300

    const res = await run({
      endpointIds: [a, b],
      iterations: 2,
      delay: 0,
      iterationDelay: ITER_DELAY,
    })

    expect(res.success).toBe(true)
    expect(paths()).toEqual(['/a', '/b', '/a', '/b'])

    const [t0, t1, t2, t3] = hits.map((h) => h.at)
    // Inside an iteration: no pause, because "delay between requests" is 0.
    // This is the distinction the single field could not express — the reason
    // the issue was filed.
    expect(t1 - t0).toBeLessThan(ITER_DELAY / 2)
    expect(t3 - t2).toBeLessThan(ITER_DELAY / 2)
    // At the boundary: the configured pause (minus a little timer slack).
    expect(t2 - t1).toBeGreaterThanOrEqual(ITER_DELAY - 50)
  })

  it('does not pause after the LAST iteration', async () => {
    const a = seedEndpoint('A', '/a')
    const ITER_DELAY = 300

    const res = await run({
      endpointIds: [a],
      iterations: 2,
      delay: 0,
      iterationDelay: ITER_DELAY,
    })

    const lastHit = hits[hits.length - 1].at
    // Nothing follows the final iteration, so a trailing wait would be dead
    // time the user is charged for and cannot see.
    expect((res.data?.completedAt ?? 0) - lastHit).toBeLessThan(ITER_DELAY)
  })

  it('composes with the per-request delay rather than replacing it', async () => {
    const a = seedEndpoint('A', '/a')

    const res = await run({
      endpointIds: [a],
      iterations: 2,
      delay: 200,
      iterationDelay: 200,
    })

    expect(res.success).toBe(true)
    const [t0, t1] = hits.map((h) => h.at)
    // Both apply at the boundary: 200 (after the request) + 200 (between
    // iterations). The config screen states this sum for the same reason.
    expect(t1 - t0).toBeGreaterThanOrEqual(350)
  })

  it('does not make Stop wait out the pause', async () => {
    // A minute-long iteration pause with an uninterruptible timer would make
    // Stop look ignored for a minute — the very complaint behind issue #91.
    const a = seedEndpoint('A', '/a')

    const started = run({
      endpointIds: [a],
      iterations: 3,
      delay: 0,
      iterationDelay: 5000,
    })
    // Let the first iteration land, then stop mid-pause.
    await new Promise((r) => setTimeout(r, 150))
    const stopAt = Date.now()
    await harness.invoke('runner:stop', { mode: 'graceful' })
    const res = await started

    expect(Date.now() - stopAt).toBeLessThan(2000)
    expect(res.data?.stopReason).toBe('cancelled')
  })
})
