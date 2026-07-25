/**
 * #73 Run half: a pre-request script signs a JWT with `pm.jose`, stores it in an
 * environment variable, and the endpoint's `Authorization: Bearer {{mkkJwt}}`
 * header carries it out through the REAL Collection Runner pipeline (script →
 * mergeScriptUpdates → resolveRequestOptions → http.engine).
 *
 * The Send half (tests/renderer/jose-header-flow.test.ts) asserts the SAME
 * literal header from tests/fixtures/jose-header-flow.ts, so the two together
 * prove byte-identical signing across paths — not merely "a token was produced".
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
import {
  JOSE_FLOW_EXPECTED_HEADER,
  JOSE_FLOW_HEADER_TEMPLATE,
  JOSE_FLOW_PRE_SCRIPT,
  JOSE_FLOW_SECRET,
} from '../fixtures/jose-header-flow'

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

interface SentRequest {
  url: string
  headers?: Array<{ key: string; value: string; enabled?: boolean }>
}
const sent: SentRequest[] = []

vi.mock('../../src/main/protocols/http.engine', () => ({
  stripUrlCredentials: (u: string) => u,
  executeHttpRequest: vi.fn(async (opts: SentRequest) => {
    sent.push(opts)
    return {
      status: 200,
      statusText: 'OK',
      headers: {},
      cookies: [],
      body: '{}',
      bodySize: 2,
      timing: { total: 1 },
      actualRequest: { method: 'GET', url: opts.url, headers: {}, body: '' },
    }
  }),
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

function seedEndpoint(db: Database.Database, project: string, schema: object): string {
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
     VALUES (?, ?, NULL, 'EP', 'http', 'GET', '/x', 'developing', ?, 0, ?, ?)`,
  ).run(id, project, JSON.stringify(schema), Date.now(), Date.now())
  return id
}

beforeEach(() => {
  harness.reset()
  sent.length = 0
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  envId = seedEnvActive(testDb, projectId)
  registerRunnerHandlers()
})

describe('#73 — signed token flows into a variable and out via a header (Run path)', () => {
  it('pm.jose.sign in a pre-request script reaches the wire as Authorization', async () => {
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://jose.test/protected',
      method: 'GET',
      preScript: JOSE_FLOW_PRE_SCRIPT,
      headers: [{ key: 'Authorization', value: JOSE_FLOW_HEADER_TEMPLATE, enabled: true }],
    })

    const res = (await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: [ep],
    })) as { success: boolean; data?: { envUpdates: Record<string, string> }; error?: string }

    expect(res.success, res.error).toBe(true)
    expect(sent).toHaveLength(1)

    const auth = sent[0].headers?.find((h) => h.key === 'Authorization')
    expect(auth, 'Authorization header present on the outgoing request').toBeDefined()
    // Exact bytes — the same literal the Send-path test asserts.
    expect(auth!.value).toBe(JOSE_FLOW_EXPECTED_HEADER)

    // …and the variable itself is persisted for later requests in the run.
    expect(res.data!.envUpdates.mkkJwt).toBe(JOSE_FLOW_EXPECTED_HEADER.replace('Bearer ', ''))
  })

  it('the token verifies against the same secret (it is a real signature)', async () => {
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://jose.test/protected',
      method: 'GET',
      preScript: JOSE_FLOW_PRE_SCRIPT,
      headers: [{ key: 'Authorization', value: JOSE_FLOW_HEADER_TEMPLATE, enabled: true }],
    })
    const res = (await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: [ep],
    })) as { success: boolean; data?: { envUpdates: Record<string, string> } }

    const { jwtVerify } = await import('jose')
    const { payload, protectedHeader } = await jwtVerify(
      res.data!.envUpdates.mkkJwt,
      new TextEncoder().encode(JOSE_FLOW_SECRET),
    )
    expect(protectedHeader.alg).toBe('HS256')
    expect(protectedHeader.typ).toBe('JWT')
    expect(payload.iss).toBe('testnizer')
  })

  it('an UNCAUGHT verify failure is a normal script error — the run continues', async () => {
    // Send-path twin: tests/renderer/jose-header-flow.test.ts (same script).
    const ep = seedEndpoint(testDb, projectId, {
      url: 'http://jose.test/protected',
      method: 'GET',
      preScript: `
        pm.environment.set('before', 'written');
        const token = await pm.jose.sign({ a: 1 }, 'right-secret', { alg: 'HS256' });
        await pm.jose.verify(token, 'wrong-secret');
        pm.environment.set('after', 'never');
      `,
    })

    const res = (await harness.invoke('runner:execute', {
      projectId,
      environmentId: envId,
      endpointIds: [ep],
    })) as { success: boolean; data?: { envUpdates: Record<string, string> }; error?: string }

    expect(res.success, res.error).toBe(true)
    expect(res.data!.envUpdates.before).toBe('written')
    expect(res.data!.envUpdates.after).toBeUndefined()
    // The request still went out — a failed script is not a transport abort.
    expect(sent).toHaveLength(1)
  })
})
