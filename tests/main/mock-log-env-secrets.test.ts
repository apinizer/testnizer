/**
 * Canary scan follow-up (release 1.6.0) — the mock request log and project
 * environment variables, on a real loopback listener with a real (test) DB.
 *
 *  - The log masks the values of variables marked SECRET, like History and
 *    the Console do (`secret-inventory-cache.ts`). Before: `pushLog` built its
 *    scrubber from the request's credential-named headers + query only, so a
 *    secret env value sent in a NEUTRAL header (`x-trace: {{token}}`) or
 *    rendered by the mock itself (`{"v":"{{mockOnlySecret}}"}`) sat in the
 *    Logs tab in clear text.
 *  - The log value-scrubs credential-named BODY fields too (`client_secret`
 *    echoed back under a neutral name).
 *  - An SSE frame template renders a project environment variable, including
 *    the `initial_value` fallback (audit gap).
 *
 * Only the LOG is masked — the live reply still carries every value.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, seedProject, seedWorkspace } from './handlers/helpers'

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { mockServerManager } = await import('../../src/main/mock/server')
const { invalidateSecretInventory } = await import('../../src/main/lib/secret-inventory-cache')
const { HISTORY_MASK } = await import('../../src/shared/credential-headers')
const { freePort, rawRead, serverDef, sseResponse, waitFor } = await import('./mock-sse-fixtures')
type RouteSpec = import('./mock-sse-fixtures').RouteSpec

const ID = 'env-secret-mock'
const TRACE = 'CANARY-D-trace-588a9c43-732c'
const MOCK_ONLY = 'CANARY-A2-mockonly-40d0-b50e'
const BODY_SECRET = 'CANARY-BODY-client-1f2e3d4c'
const BASE = 'base-value-from-initial'

let projectId: string
let workspaceId: string

beforeEach(() => {
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
  const addVar = testDb.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, enabled, secret, initial_value)
     VALUES (?, 'env1', ?, ?, 1, ?, ?)`,
  )
  addVar.run('v1', 'traceSecret', TRACE, 1, TRACE)
  addVar.run('v2', 'mockOnlySecret', MOCK_ONLY, 1, MOCK_ONLY)
  // Current value empty → the effective value is the initial value.
  addVar.run('v3', 'baseValue', '', 0, BASE)
  invalidateSecretInventory()
})

afterEach(async () => {
  await mockServerManager.stopAll()
  invalidateSecretInventory()
})

async function start(routes: RouteSpec[]): Promise<number> {
  const port = await freePort()
  const r = await mockServerManager.start(serverDef(ID, port, routes, { projectId, workspaceId }))
  expect(r.ok).toBe(true)
  return port
}

describe('mock log masks the secret-variable inventory', () => {
  it('a secret env value in a NEUTRAL request header is masked in the log', async () => {
    const port = await start([
      { path: '/echo', response: { bodyType: 'text', body: 'trace={{request.headers.x-trace}}' } },
    ])
    const r = await rawRead(port, '/echo', { headers: { 'x-trace': TRACE } })
    expect(r.status).toBe(200)
    expect(r.text).toBe(`trace=${TRACE}`) // the live reply carries the value
    const [entry] = mockServerManager.getLogs(ID)
    expect(entry.request.headers['x-trace']).toBe(HISTORY_MASK)
    expect(entry.response.body).toBe(`trace=${HISTORY_MASK}`)
    expect(JSON.stringify(entry)).not.toContain(TRACE)
  })

  it('a mock body rendering {{secretVar}} is masked in the log response body', async () => {
    const port = await start([
      { path: '/json', response: { bodyType: 'json', body: '{"v":"{{mockOnlySecret}}"}' } },
    ])
    const r = await rawRead(port, '/json')
    expect(JSON.parse(r.text)).toEqual({ v: MOCK_ONLY })
    const [entry] = mockServerManager.getLogs(ID)
    expect(entry.response.body).toBe(`{"v":"${HISTORY_MASK}"}`)
    expect(JSON.stringify(entry)).not.toContain(MOCK_ONLY)
  })

  it('an SSE stream rendering {{secretVar}}: the closed entry preview is masked', async () => {
    const port = await start([
      {
        path: '/sse',
        response: sseResponse('data: {{mockOnlySecret}}\n\ndata: done', { intervalMs: 0 }),
      },
    ])
    const r = await rawRead(port, '/sse')
    expect(r.text).toBe(`data: ${MOCK_ONLY}\n\ndata: done\n\n`)
    expect(await waitFor(() => mockServerManager.getLogs(ID).length === 2)).toBe(true)
    const logs = mockServerManager.getLogs(ID)
    expect(logs[1].response.body).toContain(`data: ${HISTORY_MASK}`)
    expect(JSON.stringify(logs)).not.toContain(MOCK_ONLY)
  })
})

describe('mock log value-scrubs credential-named request body fields', () => {
  const routes: RouteSpec[] = [
    {
      path: '/token',
      method: 'POST',
      response: { bodyType: 'text', body: 'Body:[{{request.body.client_secret}}]' },
    },
    {
      // A form body is not parsed — the raw text is echoed after a prefix, so
      // no urlencoded name rule applies to the reply.
      path: '/form',
      method: 'POST',
      response: { bodyType: 'text', body: 'Echo: {{request.bodyText}}' },
    },
  ]

  it('JSON body: client_secret echoed under a neutral name is masked', async () => {
    const port = await start(routes)
    const r = await rawRead(port, '/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', client_secret: BODY_SECRET }),
    })
    expect(r.text).toBe(`Body:[${BODY_SECRET}]`)
    const [entry] = mockServerManager.getLogs(ID)
    expect(entry.response.body).toBe(`Body:[${HISTORY_MASK}]`)
    expect(JSON.stringify(entry)).not.toContain(BODY_SECRET)
  })

  it('form body: client_secret echoed under a neutral name is masked', async () => {
    const port = await start(routes)
    const form = `grant_type=client_credentials&client_secret=${encodeURIComponent(BODY_SECRET)}`
    const r = await rawRead(port, '/form', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    })
    expect(r.text).toBe(`Echo: ${form}`)
    const [entry] = mockServerManager.getLogs(ID)
    expect(JSON.stringify(entry)).not.toContain(BODY_SECRET)
  })
})

describe('mock log value-scrubs credential elements of a SOAP envelope', () => {
  it('<wsse:Password> echoed back in the reply is masked in the log', async () => {
    const PW = 'CANARY-WSSE-mock-pw-77aa88bb'
    const port = await start([
      {
        path: '/soap',
        method: 'POST',
        response: { bodyType: 'xml', body: '<EchoResponse>{{request.bodyText}}</EchoResponse>' },
      },
    ])
    const envelope =
      '<soapenv:Envelope><soapenv:Header><wsse:Security><wsse:UsernameToken>' +
      `<wsse:Username>bob</wsse:Username><wsse:Password>${PW}</wsse:Password>` +
      '</wsse:UsernameToken></wsse:Security></soapenv:Header><soapenv:Body/></soapenv:Envelope>'
    const r = await rawRead(port, '/soap', {
      method: 'POST',
      headers: { 'content-type': 'text/xml' },
      body: envelope,
    })
    expect(r.text).toContain(PW) // the live reply carries the value
    const [entry] = mockServerManager.getLogs(ID)
    expect(entry.request.body).toContain(`<wsse:Password>${HISTORY_MASK}</wsse:Password>`)
    expect(JSON.stringify(entry)).not.toContain(PW)
  })
})

describe('an SSE frame template renders project env variables (audit gap)', () => {
  it('{{baseValue}} resolves from the active env, falling back to initial_value', async () => {
    const port = await start([
      {
        path: '/events',
        response: sseResponse('data: base={{baseValue}}\n\ndata: n={{stream.seq}}', {
          intervalMs: 0,
        }),
      },
    ])
    const r = await rawRead(port, '/events')
    expect(r.headers['content-type']).toContain('text/event-stream')
    expect(r.text).toBe(`data: base=${BASE}\n\ndata: n=2\n\n`)
  })
})
