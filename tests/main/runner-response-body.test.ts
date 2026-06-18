/**
 * Run-path regressions for two reported issues:
 *
 *  - #18 — pm.response.json() / .body (and insomnia.response.*) must be
 *    populated for AFTER-response scripts on the Collection Runner, not just on
 *    Send. The shared runtime feeds both paths the same NormalizedResponse;
 *    this guards against a Run-path regression where the body fails to reach
 *    test scripts.
 *  - #16 — a request that returns a non-2xx status (e.g. an idempotent DELETE →
 *    400) but whose assertion explicitly allows it must count as PASSED in the
 *    run summary, matching Postman/Insomnia. Status alone must not fail it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './handlers/helpers'
import crypto from 'node:crypto'
import type Database from 'better-sqlite3'

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
vi.mock('../../src/main/db/database', () => ({ getDb: () => testDb }))

// Mutable response the engine mock replays — each test sets it before running.
const mockResponse = { status: 200, statusText: 'OK', body: '{}' }

vi.mock('../../src/main/protocols/http.engine', () => ({
  stripUrlCredentials: (u: string) => u,
  executeHttpRequest: vi.fn(async (opts: { url: string }) => ({
    status: mockResponse.status,
    statusText: mockResponse.statusText,
    headers: { 'content-type': 'application/json' },
    cookies: [],
    body: mockResponse.body,
    bodySize: mockResponse.body.length,
    timing: { total: 1 },
    actualRequest: { method: 'GET', url: opts.url, headers: {}, body: '' },
  })),
}))

const { registerRunnerHandlers } = await import('../../src/main/ipc/runner.handler')

let projectId: string
let envId: string

function seedEnvActive(db: Database.Database, project: string): string {
  const id = crypto.randomUUID()
  const ws = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(project) as {
    workspace_id: string
  }
  db.prepare(
    `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'Env', 1, ?, ?)`,
  ).run(id, ws.workspace_id, project, Date.now(), Date.now())
  return id
}

function seedEndpoint(
  db: Database.Database,
  project: string,
  schema: Record<string, unknown>,
): string {
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
     VALUES (?, ?, NULL, 'EP', 'http', 'GET', '/x', 'developing', ?, 0, ?, ?)`,
  ).run(id, project, JSON.stringify(schema), Date.now(), Date.now())
  return id
}

interface RunData {
  passedEndpoints: number
  failedEndpoints: number
  results: Array<{
    endpointId: string
    passed: number
    failed: number
    assertions: Array<{ name: string; passed: boolean; error?: string }>
  }>
}

async function run(ep: string): Promise<RunData> {
  const res = (await harness.invoke('runner:execute', {
    projectId,
    environmentId: envId,
    endpointIds: [ep],
  })) as { success: boolean; data?: RunData; error?: string }
  expect(res.success, res.error).toBe(true)
  return res.data!
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  envId = seedEnvActive(testDb, projectId)
  registerRunnerHandlers()
  mockResponse.status = 200
  mockResponse.statusText = 'OK'
  mockResponse.body = '{}'
})

const SECRET_BODY = JSON.stringify({
  status: 'SUCCESS',
  resultList: [
    {
      name: 'col-mqi28296-secret-key',
      keyType: 'SECRET_KEY',
      cryptoKeyInfoEnvironmentList: [{ environmentName: 'tester-new', alias: 'pilot-secret' }],
    },
  ],
  resultCount: 1,
})

const PM_SCRIPT = `
function parseJsonResponse() {
  try { return pm.response.json(); } catch (e) { return {}; }
}
pm.test("Status code is 200", function () { pm.response.to.have.status(200); });
var json = parseJsonResponse();
var first = (json.resultList || [])[0] || {};
pm.test("Key name and keyType", function () {
  pm.expect(first.name).to.eql("col-mqi28296-secret-key");
  pm.expect(first.keyType).to.eql("SECRET_KEY");
});
pm.test("cryptoKeyInfoEnvironmentList present", function () {
  pm.expect(first.cryptoKeyInfoEnvironmentList).to.be.an("array");
  pm.expect(first.cryptoKeyInfoEnvironmentList.length).to.be.above(0);
});
pm.test("body string present", function () {
  pm.expect(pm.response.body.length).to.be.above(0);
});
`

const INSOMNIA_SCRIPT = `
var json = insomnia.response.json();
var first = (json.resultList || [])[0] || {};
pm.test("insomnia json key", function () {
  pm.expect(first.name).to.eql("col-mqi28296-secret-key");
});
`

const IDEMPOTENT_DELETE_SCRIPT = `
pm.test("Idempotent delete (200, 204, 404 or 400)", function () {
  pm.expect(pm.response.code).to.be.oneOf([200, 204, 404, 400]);
});
`

describe('runner response body — issue #18', () => {
  it('pm.response.json() / .body reach after-response scripts in Run', async () => {
    mockResponse.body = SECRET_BODY
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://x/',
      method: 'GET',
      postScript: PM_SCRIPT,
    })
    const epr = (await run(ep)).results.find((r) => r.endpointId === ep)!
    for (const a of epr.assertions) expect(a.passed, `${a.name}: ${a.error ?? ''}`).toBe(true)
  })

  it('insomnia.response.json() reaches after-response scripts in Run', async () => {
    mockResponse.body = SECRET_BODY
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://x/',
      method: 'GET',
      postScript: INSOMNIA_SCRIPT,
    })
    const epr = (await run(ep)).results.find((r) => r.endpointId === ep)!
    for (const a of epr.assertions) expect(a.passed, `${a.name}: ${a.error ?? ''}`).toBe(true)
  })
})

describe('runner pass/fail — issue #16', () => {
  it('HTTP 400 with a passing oneOf assertion counts as PASSED', async () => {
    mockResponse.status = 400
    mockResponse.statusText = 'Bad Request'
    mockResponse.body = JSON.stringify({ resultMessage: 'Connection was not found!' })
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://x/',
      method: 'DELETE',
      postScript: IDEMPOTENT_DELETE_SCRIPT,
    })
    const data = await run(ep)
    const epr = data.results.find((r) => r.endpointId === ep)!
    expect(epr.failed, 'no failed assertions').toBe(0)
    expect(epr.passed, 'one passing assertion').toBe(1)
    expect(data.failedEndpoints, 'endpoint not bucketed as failed').toBe(0)
    expect(data.passedEndpoints, 'endpoint counted as passed').toBe(1)
  })

  it('HTTP 400 with a FAILING assertion still counts as failed', async () => {
    mockResponse.status = 400
    mockResponse.statusText = 'Bad Request'
    mockResponse.body = '{}'
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://x/',
      method: 'GET',
      postScript: `pm.test("expects 200", function () { pm.response.to.have.status(200); });`,
    })
    const data = await run(ep)
    expect(data.failedEndpoints).toBe(1)
    expect(data.passedEndpoints).toBe(0)
  })
})
