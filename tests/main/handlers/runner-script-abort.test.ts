/**
 * A script that THROWS must stop the request (reported 5 Aug).
 *
 * The tester put a bare `throw new Error('boom')` in a pre-request script and
 * watched the run log "Script error: boom" and then send the request anyway,
 * getting a real 200 back. `runUserScript` caught the throw, recorded it on the
 * context and returned — and nothing read it before the send. So every step
 * whose precondition failed (a token that could not be minted, a signature that
 * could not be computed) was still scored on whatever the server happened to
 * answer, and "Stop run if an error occurs" had nothing to fire on.
 *
 * These tests assert the two halves that matter: the request DOES NOT REACH
 * THE SERVER, and the step is a failure the run can act on.
 *
 * Same idiom as `runner-lifecycle.test.ts`: a real local HTTP server, endpoints
 * seeded into the DB, and the REAL executeCollection loop.
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

let server: Server
let port = 0
/** Every path the server was actually asked for — the evidence of a send. */
let received: string[] = []

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      received.push(req.url ?? '/')
      req.resume()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
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

function seedEndpoint(opts: {
  name?: string
  url: string
  preScript?: string
  postScript?: string
  assertions?: Array<Record<string, unknown>>
}): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = JSON.stringify({
    method: 'GET',
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
       VALUES (?, ?, NULL, ?, 'http', 'GET', ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, opts.name ?? 'EP', opts.url, schema, now, now)
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

interface RunRow {
  endpointName: string
  status: number | null
  statusText?: string
  error?: string
  passed: number
  failed: number
  skipped?: number
  phase?: string
}

interface ExecResult {
  success: boolean
  data?: {
    passedEndpoints: number
    failedEndpoints: number
    stopReason?: string
    results: RunRow[]
  }
}

async function run(opts: Record<string, unknown>): Promise<ExecResult> {
  return (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    ...opts,
  })) as ExecResult
}

describe('a pre-request script that throws', () => {
  it('does not send the request', async () => {
    const id = seedEndpoint({
      name: 'Guarded',
      url: `http://127.0.0.1:${port}/should-not-happen`,
      preScript: `throw new Error('boom')`,
    })

    const res = await run({ endpointIds: [id] })

    expect(res.success).toBe(true)
    // The headline assertion: the server was never asked.
    expect(received).toEqual([])
  })

  it('reports the step as failed, naming the phase and the message', async () => {
    const id = seedEndpoint({
      name: 'Guarded',
      url: `http://127.0.0.1:${port}/should-not-happen`,
      preScript: `throw new Error('boom')`,
    })

    const res = await run({ endpointIds: [id] })

    const row = res.data?.results[0] as RunRow
    expect(row.error).toContain('Pre-request script error')
    expect(row.error).toContain('boom')
    expect(row.status).toBeNull()
    // NOT a skip: a skipped row is neither passed nor failed, and this one is a
    // genuine failure the run must be able to count.
    expect(row.skipped ?? 0).toBe(0)
    expect(res.data?.failedEndpoints).toBe(1)
    expect(res.data?.passedEndpoints).toBe(0)
  })

  it('halts the run when "stop on error" is on', async () => {
    // The behaviour the tester expected and did not get: with the checkbox on,
    // a script error must stop the following requests too.
    const bad = seedEndpoint({
      name: 'Bad',
      url: `http://127.0.0.1:${port}/first`,
      preScript: `throw new Error('boom')`,
    })
    const next = seedEndpoint({ name: 'Next', url: `http://127.0.0.1:${port}/second` })

    const res = await run({ endpointIds: [bad, next], stopOnError: true })

    expect(received).toEqual([])
    expect(res.data?.stopReason).toBe('stopOnError')
  })

  it('still runs the following requests when "stop on error" is off', async () => {
    // Aborting the request must not be confused with aborting the run.
    const bad = seedEndpoint({
      name: 'Bad',
      url: `http://127.0.0.1:${port}/first`,
      preScript: `throw new Error('boom')`,
    })
    const next = seedEndpoint({ name: 'Next', url: `http://127.0.0.1:${port}/second` })

    await run({ endpointIds: [bad, next], stopOnError: false })

    expect(received).toEqual(['/second'])
  })

  it('keeps the assertions the script registered before it threw', async () => {
    const id = seedEndpoint({
      name: 'Partial',
      url: `http://127.0.0.1:${port}/nope`,
      preScript: `pm.test('ran first', () => pm.expect(1).to.equal(1)); throw new Error('boom')`,
    })

    const res = await run({ endpointIds: [id] })

    const row = res.data?.results[0] as RunRow
    expect(row.passed).toBe(1)
    // …and the step is a failure regardless of that green assertion.
    expect(res.data?.failedEndpoints).toBe(1)
  })

  it('a script that merely FAILS an assertion still sends', async () => {
    // The guard keys on a THROW, not on a red test. A failing `pm.test` is a
    // reported result, not a broken precondition — over-reading it would stop
    // requests users expect to go out.
    const id = seedEndpoint({
      name: 'Red test',
      url: `http://127.0.0.1:${port}/sent`,
      preScript: `pm.test('nope', () => pm.expect(1).to.equal(2))`,
    })

    await run({ endpointIds: [id] })

    expect(received).toEqual(['/sent'])
  })
})

describe('a post-response script that throws', () => {
  it('fails the step instead of scoring it green', async () => {
    // The request DID go out — nothing can un-send it — but its checks never
    // ran, and with no assertions recorded the status-only fallback scored it
    // as a pass. A crashed test script is not a passing test.
    const id = seedEndpoint({
      name: 'Broken tests',
      url: `http://127.0.0.1:${port}/sent`,
      postScript: `throw new Error('post boom')`,
    })

    const res = await run({ endpointIds: [id] })

    expect(received).toEqual(['/sent'])
    const row = res.data?.results[0] as RunRow
    expect(row.error).toContain('Post-response script error')
    expect(row.error).toContain('post boom')
    expect(res.data?.failedEndpoints).toBe(1)
  })
})
