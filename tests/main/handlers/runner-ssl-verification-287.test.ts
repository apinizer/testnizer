/**
 * Issue #287 — Run honours "SSL certificate verification" off (Send ≡ Run).
 *
 * Root cause (Run): `runner.handler.ts` `buildRequestFromEndpoint` built
 * `sslVerification: settings.sslVerification ?? true` — the project setting
 * (`project.<id>.settings.sslVerification`, shared key => lives in the
 * `projects.shared_settings` DB column) and the app-wide Settings value were
 * never consulted, so every Run against a self-signed host failed with a
 * certificate error however the toggle was set.
 *
 * Contract: `resolveSslVerification(request, project, app)` (see
 * tests/main/shared/ssl-verification-resolver.test.ts for the precedence and
 * the legacy-`true` migration rule). Run reads the project value from the
 * shared_settings column (the real place after `writeSetting`) and the app
 * value from the electron-store top-level `sslVerification` key.
 *
 * Driven through `runner:execute` against a real HTTPS server that presents
 * `tests/fixtures/certs/selfsigned.*` (not trusted by anything). Rows exercised:
 * an endpoint (`request_schema` top-level keys) and a saved_request (keys at
 * the top of `metadata`).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:https'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
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
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

/** The fake electron-store: app-wide values + any (local) project settings. */
const storeState = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))
class FakeStore {
  get(key: string): unknown {
    return storeState.values[key]
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')

const CERTS = join(__dirname, '..', '..', 'fixtures', 'certs')
let server: Server
let base = ''

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer(
        {
          key: readFileSync(join(CERTS, 'selfsigned.key')),
          cert: readFileSync(join(CERTS, 'selfsigned.crt')),
        },
        (_req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/plain' })
          res.end('ok')
        },
      )
      server.listen(0, '127.0.0.1', () => {
        base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`
        resolve()
      })
    }),
)
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

let workspaceId: string
let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  storeState.values = {}
  registerRunnerHandlers()
})
afterEach(() => {
  testDb.close()
})

/** Where `writeSetting` puts the shared project settings (SHARED_PROJECT_SETTING_KEYS). */
function setProjectSsl(value: boolean, extra: Record<string, unknown> = {}): void {
  testDb
    .prepare('UPDATE projects SET shared_settings = ? WHERE id = ?')
    .run(JSON.stringify({ sslVerification: value, ...extra }), projectId)
}

function seedEndpoint(settings: Record<string, unknown> = {}): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = JSON.stringify({ method: 'GET', url: `${base}/`, ...settings })
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'EP', 'http', 'GET', '/', 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, schema, now, now)
  return id
}

function seedSavedRequest(metadata: Record<string, unknown> = {}): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO saved_requests
         (id, project_id, folder_id, name, protocol, method, url, params, headers, body, auth,
          pre_script, post_script, assertions, metadata, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'SR', 'http', 'GET', ?, '[]', '[]', NULL, NULL, NULL, NULL, '[]', ?, 0, ?, ?)`,
    )
    .run(id, projectId, `${base}/`, JSON.stringify(metadata), now, now)
  return id
}

interface Row {
  status: number | null
  error?: string
}

async function runOne(id: string): Promise<Row> {
  const res = (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    endpointIds: [id],
  })) as { success: boolean; data?: { results: Row[] } }
  expect(res.success).toBe(true)
  return res.data!.results[0]
}

const CERT_ERROR = /self[- ]signed|certificate|unable to verify/i

function expectVerified(row: Row): void {
  expect(row.status).toBeNull()
  expect(row.error).toMatch(CERT_ERROR)
}
function expectUnverified(row: Row): void {
  expect(row.error).toBeUndefined()
  expect(row.status).toBe(200)
}

describe('issue #287 — Run: project "SSL certificate verification" (shared_settings column)', () => {
  it('project false, request has no ssl key -> the self-signed host answers 200', async () => {
    setProjectSsl(false)
    expectUnverified(await runOne(seedEndpoint()))
  })

  it('project true -> the self-signed host fails with a certificate error', async () => {
    setProjectSsl(true)
    expectVerified(await runOne(seedEndpoint()))
  })

  it('no project value, no app value -> verification stays ON (the default)', async () => {
    expectVerified(await runOne(seedEndpoint()))
  })

  it('project false + tls options in the same shared object still resolves ssl false', async () => {
    setProjectSsl(false, { tls: { minVersion: 'TLSv1.2', cipherPreset: 'intermediate' } })
    expectUnverified(await runOne(seedEndpoint()))
  })

  it('project false is also read when only the electron-store copy exists (pre-migration installs)', async () => {
    storeState.values[`project.${projectId}.settings`] = { sslVerification: false }
    expectUnverified(await runOne(seedEndpoint()))
  })
})

describe('issue #287 — Run: app-wide Settings value is the last tier', () => {
  it('no project key, app sslVerification false -> 200', async () => {
    storeState.values.sslVerification = false
    expectUnverified(await runOne(seedEndpoint()))
  })

  it('project true beats app false -> certificate error', async () => {
    setProjectSsl(true)
    storeState.values.sslVerification = false
    expectVerified(await runOne(seedEndpoint()))
  })

  it('project false beats app true -> 200', async () => {
    setProjectSsl(false)
    storeState.values.sslVerification = true
    expectUnverified(await runOne(seedEndpoint()))
  })
})

describe('issue #287 — Run: request-level override and the legacy-true migration rule', () => {
  it('request false over project true -> 200 (explicit OFF wins)', async () => {
    setProjectSsl(true)
    expectUnverified(await runOne(seedEndpoint({ sslVerification: false })))
  })

  it('LEGACY bare request true (what old Ctrl+S wrote) under project false -> follows the project: 200', async () => {
    setProjectSsl(false)
    expectUnverified(await runOne(seedEndpoint({ sslVerification: true })))
  })

  it('explicit request true (marked) under project false -> verification ON: certificate error', async () => {
    setProjectSsl(false)
    expectVerified(
      await runOne(seedEndpoint({ sslVerification: true, sslVerificationExplicit: true })),
    )
  })

  it('legacy request true under app false (no project key) -> follows the app: 200', async () => {
    storeState.values.sslVerification = false
    expectUnverified(await runOne(seedEndpoint({ sslVerification: true })))
  })
})

describe('issue #287 — Run: saved_request rows (settings in metadata)', () => {
  it('project false, no ssl key in metadata -> 200', async () => {
    setProjectSsl(false)
    expectUnverified(await runOne(seedSavedRequest({})))
  })

  it('project false, LEGACY metadata sslVerification:true -> 200', async () => {
    setProjectSsl(false)
    expectUnverified(
      await runOne(
        seedSavedRequest({ followRedirects: true, maxRedirects: 5, sslVerification: true }),
      ),
    )
  })

  it('metadata sslVerification:false over project true -> 200', async () => {
    setProjectSsl(true)
    expectUnverified(await runOne(seedSavedRequest({ sslVerification: false })))
  })

  it('explicit marked true in metadata under project false -> certificate error', async () => {
    setProjectSsl(false)
    expectVerified(
      await runOne(seedSavedRequest({ sslVerification: true, sslVerificationExplicit: true })),
    )
  })
})
