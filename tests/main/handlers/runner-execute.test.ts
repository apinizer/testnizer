/**
 * Integration tests for the Collection Runner's EXECUTE LOOP.
 *
 * The validation / no-op branches of `runner:execute` are covered in
 * `runner.test.ts` with a stubbed http engine. This file instead drives the
 * REAL `executeCollection` loop against a live local HTTP server so the
 * end-to-end behaviour — request building, `{{var}}` resolution via
 * `loadEnvVars`, iterations, data-driven rows, `stopOnError`, and declarative
 * assertions — is exercised for real.
 *
 * Server is a tiny echo/counter listening on 127.0.0.1:0; endpoints are seeded
 * by direct INSERT into the `endpoints` table with a `request_schema` whose
 * shape mirrors what `buildRequestFromEndpoint` parses (method, url, params,
 * headers, body, auth, assertions, preScript/postScript).
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

// NOTE: http.engine is intentionally NOT mocked here — we want the real
// network path so the {{var}}-resolved URL truly hits our local server.
const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')

// ─── Local echo / counter server ─────────────────────────────────

interface RecordedRequest {
  method: string
  url: string
  headers: NodeJS.Dict<string | string[]>
  body: string
}

let server: Server
let port = 0
let received: RecordedRequest[] = []

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          received.push({
            method: req.method ?? 'GET',
            url: req.url ?? '/',
            headers: req.headers,
            body,
          })

          const url = req.url ?? '/'
          // /fail → deterministic 500 so stopOnError has a failing endpoint.
          if (url.startsWith('/fail')) {
            res.writeHead(500, { 'Content-Type': 'text/plain' })
            res.end('boom')
            return
          }
          // Echo back the path + any received body so data-driven row plumbing
          // can be asserted on the wire.
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, path: url, echo: body }))
        })
      })
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port
        resolve()
      })
    }),
)

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

// ─── Seed helpers ────────────────────────────────────────────────

let workspaceId: string
let projectId: string

interface SeedEndpointOpts {
  name?: string
  method?: string
  url: string
  params?: Array<{ id: string; key: string; value: string; enabled: boolean }>
  headers?: Array<{ id: string; key: string; value: string; enabled: boolean }>
  body?: {
    type: string
    content?: string
    formData?: Array<{ id: string; key: string; value: string; enabled: boolean; filePath?: string }>
    urlEncoded?: Array<{ id: string; key: string; value: string; enabled: boolean }>
  }
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
    params: opts.params ?? [],
    headers: opts.headers ?? [],
    body: opts.body,
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

/** Seed an active environment with a `base` var pointing at the local server. */
function seedActiveBaseEnv(): void {
  const envId = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'Local', 1, ?, ?)`,
    )
    .run(envId, workspaceId, projectId, now, now)
  testDb
    .prepare(
      `INSERT INTO environment_variables (id, environment_id, key, value, enabled, initial_value)
       VALUES (?, ?, 'base', ?, 1, ?)`,
    )
    .run(crypto.randomUUID(), envId, `http://127.0.0.1:${port}`, `http://127.0.0.1:${port}`)
}

/** Seed an active environment carrying the given key→value variables. */
function seedActiveEnv(vars: Record<string, string>): void {
  const envId = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'Vars', 1, ?, ?)`,
    )
    .run(envId, workspaceId, projectId, now, now)
  const ins = testDb.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, enabled, initial_value)
     VALUES (?, ?, ?, ?, 1, ?)`,
  )
  for (const [k, v] of Object.entries(vars)) ins.run(crypto.randomUUID(), envId, k, v, v)
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
    results: Array<{
      endpointId: string
      status: number | null
      url: string
      passed: number
      failed: number
      iteration?: number
      error?: string
    }>
  }
}

function run(options: Record<string, unknown>): Promise<ExecResult> {
  return harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    ...options,
  }) as Promise<ExecResult>
}

// ─── a. Single run + {{base}} resolution ─────────────────────────

describe('executeCollection — single run', () => {
  it('runs one 200 endpoint and resolves {{base}} from the active environment', async () => {
    seedActiveBaseEnv()
    const epId = seedEndpoint({ name: 'Ping', url: '{{base}}/ping' })

    const res = await run({ endpointIds: [epId] })

    expect(res.success).toBe(true)
    expect(res.data?.results.length).toBe(1)
    expect(res.data?.passedEndpoints).toBe(1)
    expect(res.data?.failedEndpoints).toBe(0)
    expect(res.data?.results[0].status).toBe(200)

    // {{base}} was resolved — the server actually received the request, and
    // the recorded URL is the resolved path (no literal `{{base}}`).
    expect(received.length).toBe(1)
    expect(received[0].url).toBe('/ping')
    expect(res.data?.results[0].url).not.toMatch(/\{\{base\}\}/)
    expect(res.data?.results[0].url).toContain(`127.0.0.1:${port}`)
  })
})

// ─── b. Iterations ───────────────────────────────────────────────

describe('executeCollection — iterations', () => {
  it('hits the server N times when iterations = 3', async () => {
    const epId = seedEndpoint({ name: 'Loop', url: `http://127.0.0.1:${port}/loop` })

    const res = await run({ endpointIds: [epId], iterations: 3 })

    expect(res.success).toBe(true)
    expect(res.data?.results.length).toBe(3)
    expect(received.length).toBe(3)
    // Iteration index is 1-based and increments across the run.
    expect(res.data?.results.map((r) => r.iteration)).toEqual([1, 2, 3])
    expect(res.data?.results.every((r) => r.status === 200)).toBe(true)
  })
})

// ─── c. Data-driven (iterationData) ──────────────────────────────

describe('executeCollection — data-driven', () => {
  it('runs one iteration per data row and the row value flows into the request', async () => {
    // The pre-script reads `pm.iterationData.get('user')` and stows it in an
    // env var; the URL references that env var so the resolved query string
    // carries the row value onto the wire.
    const epId = seedEndpoint({
      name: 'DataDriven',
      url: `http://127.0.0.1:${port}/u?name={{rowUser}}`,
      preScript: `pm.environment.set('rowUser', pm.iterationData.get('user'))`,
    })

    const res = await run({
      endpointIds: [epId],
      iterationData: [{ user: 'alice' }, { user: 'bob' }],
    })

    expect(res.success).toBe(true)
    // iterationData.length (2) overrides the default single iteration.
    expect(res.data?.results.length).toBe(2)
    expect(received.length).toBe(2)

    // Each row value reached the server in the resolved query string.
    const wireUrls = received.map((r) => r.url).sort()
    expect(wireUrls).toEqual(['/u?name=alice', '/u?name=bob'])
  })
})

// ─── d. stopOnError ──────────────────────────────────────────────

describe('executeCollection — stopOnError', () => {
  it('halts before the second endpoint when the first fails and stopOnError is true', async () => {
    const failingId = seedEndpoint({ name: 'Fails', url: `http://127.0.0.1:${port}/fail` })
    const secondId = seedEndpoint({ name: 'Never', url: `http://127.0.0.1:${port}/never` })

    const res = await run({
      endpointIds: [failingId, secondId],
      stopOnError: true,
    })

    expect(res.success).toBe(true)
    // Only the first (failing) endpoint executed; the run halted.
    expect(res.data?.results.length).toBe(1)
    expect(res.data?.results[0].endpointId).toBe(failingId)
    expect(res.data?.results[0].status).toBe(500)
    expect(res.data?.failedEndpoints).toBe(1)

    // The second endpoint's path was never requested.
    expect(received.some((r) => r.url.startsWith('/never'))).toBe(false)
    expect(received.length).toBe(1)
  })

  it('runs both endpoints when stopOnError is false', async () => {
    const failingId = seedEndpoint({ name: 'Fails', url: `http://127.0.0.1:${port}/fail` })
    const secondId = seedEndpoint({ name: 'Runs', url: `http://127.0.0.1:${port}/second` })

    const res = await run({
      endpointIds: [failingId, secondId],
      stopOnError: false,
    })

    expect(res.success).toBe(true)
    expect(res.data?.results.length).toBe(2)
    expect(received.some((r) => r.url.startsWith('/second'))).toBe(true)
  })
})

// ─── f. Body variable resolution (issue #10) ─────────────────────

describe('executeCollection — body variable resolution', () => {
  it('resolves {{var}} inside a JSON request body', async () => {
    seedActiveEnv({ AccessURL: 'https://access.example', ApiKey: 'k-123' })
    const epId = seedEndpoint({
      name: 'JsonBody',
      method: 'POST',
      url: `http://127.0.0.1:${port}/json`,
      body: { type: 'json', content: '{"endpoint":"{{AccessURL}}","apiKey":"{{ApiKey}}"}' },
    })

    const res = await run({ endpointIds: [epId] })

    expect(res.success).toBe(true)
    expect(received[0].body).toContain('"endpoint":"https://access.example"')
    expect(received[0].body).toContain('"apiKey":"k-123"')
    expect(received[0].body).not.toContain('{{')
  })

  it('resolves {{var}} in urlencoded body values (array, not content)', async () => {
    seedActiveEnv({ AccessURL: 'https://access.example' })
    const epId = seedEndpoint({
      name: 'UrlEncoded',
      method: 'POST',
      url: `http://127.0.0.1:${port}/form`,
      body: {
        type: 'urlencoded',
        urlEncoded: [{ id: '1', key: 'endpoint', value: '{{AccessURL}}', enabled: true }],
      },
    })

    const res = await run({ endpointIds: [epId] })

    expect(res.success).toBe(true)
    expect(received[0].body).toContain('endpoint=')
    // value is url-encoded on the wire; decode then check, and ensure no
    // literal/encoded {{ }} placeholder survived.
    expect(decodeURIComponent(received[0].body)).toContain('https://access.example')
    expect(received[0].body).not.toContain('%7B%7B')
    expect(received[0].body).not.toContain('{{')
  })

  it('resolves {{var}} in form-data field values', async () => {
    seedActiveEnv({ ApiKey: 'k-xyz' })
    const epId = seedEndpoint({
      name: 'FormData',
      method: 'POST',
      url: `http://127.0.0.1:${port}/multipart`,
      body: {
        type: 'form-data',
        formData: [{ id: '1', key: 'token', value: '{{ApiKey}}', enabled: true }],
      },
    })

    const res = await run({ endpointIds: [epId] })

    expect(res.success).toBe(true)
    // multipart body carries the resolved value, not the placeholder.
    expect(received[0].body).toContain('k-xyz')
    expect(received[0].body).not.toContain('{{ApiKey}}')
  })
})

// ─── e. Declarative assertions ───────────────────────────────────

describe('executeCollection — assertions', () => {
  it('passes a status_equals 200 assertion', async () => {
    const epId = seedEndpoint({
      name: 'AssertPass',
      url: `http://127.0.0.1:${port}/ok`,
      assertions: [
        {
          id: 'a1',
          name: 'is 200',
          type: 'status_equals',
          enabled: true,
          expected: 200,
        },
      ],
    })

    const res = await run({ endpointIds: [epId] })

    expect(res.success).toBe(true)
    expect(res.data?.totalAssertions).toBe(1)
    expect(res.data?.passedAssertions).toBe(1)
    expect(res.data?.failedAssertions).toBe(0)
    expect(res.data?.passedEndpoints).toBe(1)
    expect(res.data?.results[0].passed).toBe(1)
    expect(res.data?.results[0].failed).toBe(0)
  })

  it('fails a status_equals 201 assertion against a 200 response', async () => {
    const epId = seedEndpoint({
      name: 'AssertFail',
      url: `http://127.0.0.1:${port}/ok`,
      assertions: [
        {
          id: 'a1',
          name: 'is 201',
          type: 'status_equals',
          enabled: true,
          expected: 201,
        },
      ],
    })

    const res = await run({ endpointIds: [epId] })

    expect(res.success).toBe(true)
    expect(res.data?.totalAssertions).toBe(1)
    expect(res.data?.failedAssertions).toBe(1)
    expect(res.data?.passedAssertions).toBe(0)
    // A failed assertion makes the endpoint fail even though the HTTP call 200'd.
    expect(res.data?.failedEndpoints).toBe(1)
    expect(res.data?.results[0].failed).toBe(1)
  })

  // body_jsonpath / body_equals_json must evaluate in the Runner exactly as they
  // do for the Send button (src/renderer/lib/test-runner.ts). They used to be
  // rejected as "Unknown type", so a JSONPath assertion that passed on Send
  // silently failed in the Runner (see CLAUDE.md "Header assertion paralelliği").
  it('passes a body_jsonpath assertion against the echoed response', async () => {
    const epId = seedEndpoint({
      name: 'JsonPath',
      url: `http://127.0.0.1:${port}/ok`,
      assertions: [
        {
          id: 'a1',
          name: 'path is /ok',
          type: 'body_jsonpath',
          enabled: true,
          jsonPath: '$.path',
          expected: '/ok',
        },
      ],
    })

    const res = await run({ endpointIds: [epId] })

    expect(res.success).toBe(true)
    expect(res.data?.passedAssertions).toBe(1)
    expect(res.data?.failedAssertions).toBe(0)
    expect(res.data?.results[0].passed).toBe(1)
  })

  it('resolves {{var}} inside a body_jsonpath expected value', async () => {
    seedActiveEnv({ wantPath: '/wp' })
    const epId = seedEndpoint({
      name: 'JsonPathVar',
      url: `http://127.0.0.1:${port}/wp`,
      assertions: [
        {
          id: 'a1',
          name: 'path matches {{wantPath}}',
          type: 'body_jsonpath',
          enabled: true,
          jsonPath: '$.path',
          expected: '{{wantPath}}',
        },
      ],
    })

    const res = await run({ endpointIds: [epId] })

    expect(res.success).toBe(true)
    expect(res.data?.passedAssertions).toBe(1)
    expect(res.data?.failedAssertions).toBe(0)
  })

  it('passes a body_equals_json assertion (whitespace insensitive)', async () => {
    const epId = seedEndpoint({
      name: 'EqualsJson',
      url: `http://127.0.0.1:${port}/eq`,
      assertions: [
        {
          id: 'a1',
          name: 'body matches',
          type: 'body_equals_json',
          enabled: true,
          // Whitespace differs from the wire payload but the parse→stringify
          // round-trip normalises it. Key order mirrors the server's shape
          // ({ ok, path, echo }) — assertBodyEqualsJson is order-sensitive.
          expected: '{ "ok": true, "path": "/eq", "echo": "" }',
        },
      ],
    })

    const res = await run({ endpointIds: [epId] })

    expect(res.success).toBe(true)
    expect(res.data?.passedAssertions).toBe(1)
    expect(res.data?.failedAssertions).toBe(0)
  })
})
