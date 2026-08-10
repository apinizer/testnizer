/**
 * Key Material Provider (#60) — Faz C EDIT 2 / R5: the Runner attaches client
 * certificates through THE SAME exported `loadCertificatesFor` the Send path
 * uses (design §2.5 EDIT 2, §4 Decisions "Runner R5").
 *
 * Why this file exists
 * ────────────────────
 * Before EDIT 2 the Runner main loop set only `resolvedOptions.projectId` and
 * called `executeHttpRequest` — it NEVER attached a client certificate. A
 * collection that Sent fine against an mTLS host failed on Run. That is the
 * Send≡Run parity class CLAUDE.md keeps flagging, so the fix is a CALL to the
 * shared export, never a Runner-local copy. These tests pin that:
 *
 *  1. file-backed rows attach on Run (the R5 BEHAVIOUR CHANGE — release-noted)
 *  2. keystore-backed rows attach on Run (provider branch, resolved in main)
 *  3. Send ≡ Run parity: the same row produces byte-identical material on both
 *  4. host scoping survives: a cert scoped to host A is NOT sent to host B
 *  5. FAIL LOUD, per-iteration: an unloadable cert fails THAT request only —
 *     the run continues and the request never goes out unauthenticated
 *  6. ADDITIVE INVARIANT: with no certificate rows configured the Runner sends
 *     byte-for-byte what it sent before (no `certificates` key at all)
 *  7. BLOCKER (§6): client-chain intermediates never land in `caCerts`
 *
 * `certificate.repo` is deliberately NOT mocked — the real host-matching /
 * row-selection path is part of what R5 turns on.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
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

// Stub the engine so we can read back EXACTLY what the runner/send path handed
// it. Both handlers import this same module ⇒ the same spy records both paths,
// which is what makes the parity assertion meaningful.
vi.mock('../../../src/main/protocols/http.engine', () => ({
  executeHttpRequest: vi.fn(async () => ({
    status: 200,
    statusText: 'OK',
    headers: {},
    body: '{}',
    bodySize: 2,
    timing: { total: 3 },
    actualRequest: { method: 'GET', url: 'http://cert-host.test/x', headers: {}, body: '' },
  })),
  stripUrlCredentials: (u: string) => u,
  fetchOAuth2Token: vi.fn(),
}))

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')
const { registerRequestHandlers } = await import('../../../src/main/ipc/request.handler')
const { executeHttpRequest } = await import('../../../src/main/protocols/http.engine')

const CERTS = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/certs')

let workspaceId: string
let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  vi.mocked(executeHttpRequest).mockClear()
  registerRunnerHandlers()
  registerRequestHandlers()
})

// ─── seeds ───────────────────────────────────────────────────────

function seedEndpoint(url: string, name = 'EP'): string {
  const id = randomUUID()
  const now = Date.now()
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

function seedFileCert(host: string): string {
  const id = randomUUID()
  testDb
    .prepare(
      `INSERT INTO certificates
        (id, project_id, kind, host, crt_path, key_path, pfx_path, passphrase,
         enabled, created_at, source, keystore_id, keystore_alias)
       VALUES (?, ?, 'client', ?, ?, ?, NULL, NULL, 1, ?, 'file', NULL, NULL)`,
    )
    .run(id, projectId, host, join(CERTS, 'client.crt'), join(CERTS, 'client.key'), Date.now())
  return id
}

function seedKeystore(): string {
  const jks = readFileSync(join(CERTS, 'client.jks'))
  const ksId = randomUUID()
  testDb
    .prepare(
      `INSERT INTO keystores (id, name, type, blob, store_password, alias_count, size_bytes, created_at, updated_at)
       VALUES (?, 'client.jks', 'JKS', ?, 'testpassword', 1, ?, 0, 0)`,
    )
    .run(ksId, jks.toString('base64'), jks.length)
  return ksId
}

function seedKeystoreCert(host: string, keystoreId: string, alias = 'test-client'): string {
  const id = randomUUID()
  testDb
    .prepare(
      `INSERT INTO certificates
        (id, project_id, kind, host, crt_path, key_path, pfx_path, passphrase,
         enabled, created_at, source, keystore_id, keystore_alias)
       VALUES (?, ?, 'client', ?, NULL, NULL, NULL, NULL, 1, ?, 'keystore', ?, ?)`,
    )
    .run(id, projectId, host, Date.now(), keystoreId, alias)
  return id
}

// ─── run helpers ─────────────────────────────────────────────────

interface RunResult {
  success: boolean
  error?: string
  data?: {
    results: Array<{ endpointName: string; error?: string; status: number | null }>
    summary: { failed: number; passed: number }
  }
}

async function run(endpointIds: string[]): Promise<RunResult> {
  return (await harness.invoke('runner:execute', { projectId, endpointIds })) as RunResult
}

type SentOptions = {
  url: string
  certificates?: {
    caCerts?: Buffer[]
    clientCert?: { cert?: Buffer; key?: Buffer; pfx?: Buffer; passphrase?: string }
  }
}

/** What the engine actually received on call `n`. */
function sent(n = 0): SentOptions {
  return vi.mocked(executeHttpRequest).mock.calls[n]?.[0] as unknown as SentOptions
}

// ═══════════════════════════════════════════════════════════════════
// 1 + 2 — the Runner attaches BOTH row kinds
// ═══════════════════════════════════════════════════════════════════

describe('Runner R5 — client certificates attach on Run', () => {
  it('attaches a FILE-backed client cert (the documented behaviour change)', async () => {
    seedFileCert('cert-host.test')
    const ep = seedEndpoint('http://cert-host.test/x')

    const res = await run([ep])
    expect(res.success).toBe(true)

    const clientCert = sent().certificates?.clientCert
    expect(clientCert?.cert?.toString('utf8')).toBe(readFileSync(join(CERTS, 'client.crt'), 'utf8'))
    expect(clientCert?.key?.toString('utf8')).toContain('PRIVATE KEY')
  })

  it('attaches a KEYSTORE-backed client cert (provider branch, resolved in main)', async () => {
    seedKeystoreCert('cert-host.test', seedKeystore())
    const ep = seedEndpoint('http://cert-host.test/x')

    const res = await run([ep])
    expect(res.success).toBe(true)

    const clientCert = sent().certificates?.clientCert
    expect(clientCert?.cert?.toString('utf8')).toContain('BEGIN CERTIFICATE')
    expect(clientCert?.key?.toString('utf8')).toContain('PRIVATE KEY')
  })

  it('BLOCKER §6: client-chain intermediates never leak into caCerts', async () => {
    // The JKS fixture carries a leaf + its issuer. The chain must ride in
    // `clientCert.cert` as ONE bundle; Node's `ca` (which REPLACES the root
    // store used to validate the SERVER cert) must stay untouched.
    seedKeystoreCert('cert-host.test', seedKeystore())
    const ep = seedEndpoint('http://cert-host.test/x')
    await run([ep])

    const certs = sent().certificates
    expect(certs?.caCerts).toBeUndefined()
    const bundle = certs?.clientCert?.cert?.toString('utf8') ?? ''
    // EXACT count, not ">= 1": the fixture is a leaf + its issuer, so a
    // regression that drops the chain from the bundle (and, worse, re-routes it
    // to `ca`) must fail here rather than pass with the leaf alone.
    expect(bundle.match(/BEGIN CERTIFICATE/g)?.length ?? 0).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 3 — Send ≡ Run parity (the whole point of sharing the export)
// ═══════════════════════════════════════════════════════════════════

describe('Send ≡ Run parity — same row, same attached material', () => {
  it('file-backed row resolves identically on both paths', async () => {
    seedFileCert('cert-host.test')
    const ep = seedEndpoint('http://cert-host.test/x')

    await run([ep])
    const viaRun = sent(0).certificates?.clientCert

    await harness.invoke('request:send', {
      method: 'GET',
      url: 'http://cert-host.test/x',
      _projectId: projectId,
      _workspaceId: workspaceId,
    })
    const viaSend = sent(1).certificates?.clientCert

    expect(viaRun?.cert).toBeInstanceOf(Buffer)
    expect(viaSend?.cert?.equals(viaRun!.cert!)).toBe(true)
    expect(viaSend?.key?.equals(viaRun!.key!)).toBe(true)
  })

  it('keystore-backed row resolves identically on both paths', async () => {
    seedKeystoreCert('cert-host.test', seedKeystore())
    const ep = seedEndpoint('http://cert-host.test/x')

    await run([ep])
    const viaRun = sent(0).certificates?.clientCert

    await harness.invoke('request:send', {
      method: 'GET',
      url: 'http://cert-host.test/x',
      _projectId: projectId,
      _workspaceId: workspaceId,
    })
    const viaSend = sent(1).certificates?.clientCert

    expect(viaRun?.key?.toString('utf8')).toContain('PRIVATE KEY')
    expect(viaSend?.cert?.equals(viaRun!.cert!)).toBe(true)
    expect(viaSend?.key?.equals(viaRun!.key!)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 4 — host scoping (the R5 HIGH risk: don't ship a client identity
//     to hosts the cert was never scoped to)
// ═══════════════════════════════════════════════════════════════════

describe('Runner R5 — host scoping', () => {
  it('a cert scoped to host A is NOT presented to host B in the same run', async () => {
    seedFileCert('scoped.test')
    const a = seedEndpoint('http://scoped.test/x', 'A')
    const b = seedEndpoint('http://other.test/y', 'B')

    await run([a, b])

    expect(sent(0).url).toContain('scoped.test')
    expect(sent(0).certificates?.clientCert?.cert).toBeInstanceOf(Buffer)

    expect(sent(1).url).toContain('other.test')
    expect(sent(1).certificates?.clientCert).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════
// 5 — FAIL LOUD, but per-iteration (design §4 "Runner fail-loud semantics")
// ═══════════════════════════════════════════════════════════════════

describe('Runner R5 — fail loud without aborting the run', () => {
  it('an unloadable cert fails THAT request only; the run continues', async () => {
    // Alias that does not exist in the keystore ⇒ the resolver throws.
    seedKeystoreCert('broken.test', seedKeystore(), 'ghost-alias')
    const bad = seedEndpoint('http://broken.test/x', 'BAD')
    const good = seedEndpoint('http://fine.test/y', 'GOOD')

    const res = await run([bad, good])
    expect(res.success).toBe(true)

    const results = res.data!.results
    expect(results).toHaveLength(2)
    const badResult = results.find((r) => r.endpointName === 'BAD')!
    expect(badResult.status).toBeNull()
    expect(badResult.error).toMatch(/could not be loaded/i)

    // The failing request NEVER hit the wire unauthenticated…
    expect(vi.mocked(executeHttpRequest)).toHaveBeenCalledTimes(1)
    // …and the run carried on to the next endpoint.
    expect(sent(0).url).toContain('fine.test')
    expect(results.find((r) => r.endpointName === 'GOOD')!.status).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════
// 6 — ADDITIVE INVARIANT
//     "hiç keystore yüklemeden de var olan ayarların çalışması lazım"
// ═══════════════════════════════════════════════════════════════════

describe('ADDITIVE INVARIANT — a project with no certificates runs unchanged', () => {
  it('sends no `certificates` at all when no rows are configured', async () => {
    const ep = seedEndpoint('http://plain.test/x')
    const res = await run([ep])

    expect(res.success).toBe(true)
    expect(res.data!.results[0].status).toBe(200)
    // Byte-for-byte the pre-EDIT-2 payload: the key is absent, not an empty object.
    expect(sent().certificates).toBeUndefined()
  })

  it('a CA-only project still attaches no client cert', async () => {
    testDb
      .prepare(
        `INSERT INTO certificates
          (id, project_id, kind, host, crt_path, key_path, pfx_path, passphrase,
           enabled, created_at, source, keystore_id, keystore_alias)
         VALUES (?, ?, 'ca', '*', ?, NULL, NULL, NULL, 1, ?, 'file', NULL, NULL)`,
      )
      .run(randomUUID(), projectId, join(CERTS, 'ca.crt'), Date.now())
    const ep = seedEndpoint('http://plain.test/x')

    await run([ep])

    expect(sent().certificates?.clientCert).toBeUndefined()
    expect(sent().certificates?.caCerts).toHaveLength(1)
  })

  it('a DISABLED client-cert row is ignored on Run, exactly as on Send', async () => {
    const id = seedFileCert('cert-host.test')
    testDb.prepare('UPDATE certificates SET enabled = 0 WHERE id = ?').run(id)
    const ep = seedEndpoint('http://cert-host.test/x')

    await run([ep])
    expect(sent().certificates?.clientCert).toBeUndefined()
  })
})
