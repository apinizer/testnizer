/**
 * Issue #195 — canary on the Run path. A step whose Authorization header is
 * `Bearer {{secret}}` (a secret-typed variable), with a literal X-API-Key,
 * `?api_key={{secret}}` and the secret in the body, against an echo server
 * (it returns the request headers in the body, like httpbin). Before: the
 * resolved secret and the literal key landed in `runner_history.results_json`,
 * in the History row, in the live results, the HTML export and the Console.
 *
 * Real local server + the real executeCollection loop (runner-console idiom).
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
import { HISTORY_MASK } from '../../../src/shared/credential-headers'

const SECRET = 'run-canary-S3CRET-77'
const LITERAL_KEY = 'literal-runner-key-5544'

const sent: Array<{ channel: string; payload: unknown }> = []

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
        },
      },
    ],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')
const { registerConsoleHandlers } = await import('../../../src/main/ipc/console.handler')

let server: Server
let port = 0
/** What the server last received — proves the secret really went out. */
let lastReceived: { auth?: string; url?: string; body?: string } = {}

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = ''
      req.on('data', (c) => (body += String(c)))
      req.on('end', () => {
        lastReceived = { auth: req.headers.authorization, url: req.url, body }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ headers: req.headers, url: req.url, body }))
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

function seedCanaryEndpoint(): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = JSON.stringify({
    method: 'POST',
    url: `http://127.0.0.1:${port}/anything?api_key={{secret}}&page=1`,
    params: [],
    headers: [
      { id: 'h1', key: 'Authorization', value: 'Bearer {{secret}}', enabled: true },
      { id: 'h2', key: 'X-API-Key', value: LITERAL_KEY, enabled: true },
      { id: 'h3', key: 'Content-Type', value: 'application/json', enabled: true },
    ],
    body: { type: 'json', content: '{"note":"{{secret}}"}' },
    auth: { type: 'none' },
    assertions: [],
    postScript: "console.log('token is ' + pm.environment.get('secret'))",
  })
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'Canary', 'http', 'POST', '/anything', 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, schema, now, now)
  return id
}

beforeEach(() => {
  harness.reset()
  sent.length = 0
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
       VALUES ('v1', 'env1', 'secret', ?, 1, 1, NULL)`,
    )
    .run(SECRET)
  registerRunnerHandlers()
  registerConsoleHandlers()
})

afterEach(() => {
  testDb.close()
})

interface RunResult {
  success: boolean
  data?: { results: Array<Record<string, unknown>> }
}

async function runCanary(): Promise<RunResult> {
  const id = seedCanaryEndpoint()
  return (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    endpointIds: [id],
  })) as RunResult
}

describe('Runner canary (issue #195)', () => {
  it('the request really carried the secret (the template resolved)', async () => {
    const res = await runCanary()
    expect(res.success).toBe(true)
    expect(res.data?.results[0].status).toBe(200)
    expect(lastReceived.auth).toBe(`Bearer ${SECRET}`)
    expect(lastReceived.url).toContain(`api_key=${SECRET}`)
    expect(lastReceived.body).toContain(SECRET)
  })

  it('runner_history.results_json holds no secret and no literal credential', async () => {
    await runCanary()
    const row = testDb.prepare('SELECT results_json FROM runner_history').get() as {
      results_json: string
    }
    expect(row.results_json).toContain(HISTORY_MASK)
    expect(row.results_json).not.toContain(SECRET)
    expect(row.results_json).not.toContain(LITERAL_KEY)
  })

  it('the run result and the live runner:progress results are masked', async () => {
    const res = await runCanary()
    expect(JSON.stringify(res.data?.results)).not.toContain(SECRET)
    const progress = sent.filter((s) => s.channel === 'runner:progress')
    expect(progress.length).toBeGreaterThan(0)
    expect(JSON.stringify(progress)).not.toContain(SECRET)
    expect(JSON.stringify(progress)).not.toContain(LITERAL_KEY)
  })

  it('the History row is masked and keeps the {{var}} template', async () => {
    await runCanary()
    const row = testDb
      .prepare('SELECT url, request_snapshot, response_snapshot FROM history')
      .get() as {
      url: string
      request_snapshot: string
      response_snapshot: string
    }
    const text = JSON.stringify(row)
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(LITERAL_KEY)
    const snap = JSON.parse(row.request_snapshot)
    expect(snap.configured.url).toContain('api_key={{secret}}')
    expect(snap.configured.headers[0].value).toBe('Bearer {{secret}}')
  })

  it('the Console entries are masked', async () => {
    await runCanary()
    const entries = sent.filter((s) => s.channel === 'console:log')
    expect(entries.length).toBeGreaterThan(0)
    expect(JSON.stringify(entries)).not.toContain(SECRET)
    expect(JSON.stringify(entries)).not.toContain(LITERAL_KEY)
  })

  it('the HTML and JSON exports are masked — even for results handed back unmasked', async () => {
    const raw = [
      {
        endpointId: 'e',
        endpointName: 'Canary',
        method: 'GET',
        url: `http://h/?api_key=${SECRET}`,
        status: 200,
        statusText: 'OK',
        duration: 1,
        passed: 0,
        failed: 0,
        skipped: 0,
        assertions: [],
        requestHeaders: { Authorization: `Bearer ${SECRET}`, 'X-API-Key': LITERAL_KEY },
        responseBody: `{"echo":"${SECRET}"}`,
      },
    ]
    for (const format of ['html', 'json'] as const) {
      const res = (await harness.invoke('runner:export', { results: raw, format })) as {
        success: boolean
        data: string
      }
      expect(res.success).toBe(true)
      expect(res.data).not.toContain(SECRET)
      expect(res.data).not.toContain(LITERAL_KEY)
    }
  })
})
