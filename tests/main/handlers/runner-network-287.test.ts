/**
 * Issue #287 follow-ups on the Run path (orchestrator decisions 1, 2, 3):
 *
 *  1. Follow redirects: Run built `settings.followRedirects ?? true` — the
 *     project (`shared_settings.followRedirects`) and app values were never
 *     read, and every pre-fix Ctrl+S stored a bare `followRedirects: true` on
 *     the row anyway. Now `resolveFollowRedirects(requestFollowRedirects(row),
 *     project, app)`; a bare stored `true` is inherit, a marked one explicit.
 *  2. SOAP and GraphQL rows go through `buildRequestFromEndpoint` too, so they
 *     get the resolved SSL verification (Send now sends the same value).
 *  3. The project's TLS protocol / cipher choice (Certificates pane) and its
 *     machine-local proxy were applied by Send only. Run now applies both —
 *     the proxy password decrypted (it is stored encrypted), never as
 *     ciphertext.
 *
 * Driven through `runner:execute` against real local servers.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http'
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
  // A keychain that really encrypts, so the proxy password is stored as
  // `enc:v1:` ciphertext the way the settings handler writes it.
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`K${s}`, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8').slice(1),
  },
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const storeState = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))
class FakeStore {
  get(key: string): unknown {
    return storeState.values[key]
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerRunnerHandlers, inheritedNetworkFor } =
  await import('../../../src/main/ipc/runner.handler')
const { encryptSecret } = await import('../../../src/main/lib/secure-storage')

const CERTS = join(__dirname, '..', '..', 'fixtures', 'certs')
let tlsServer: HttpsServer
let httpServer: HttpServer
let proxyServer: HttpServer
let tlsBase = ''
let httpBase = ''
let proxyPort = 0
const proxySeen: Array<{ url: string; auth?: string }> = []

const listen = (s: HttpServer | HttpsServer): Promise<number> =>
  new Promise((resolve) =>
    s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)),
  )

beforeAll(async () => {
  // TLS 1.2 at most: a project minimum of TLS 1.3 cannot handshake with it.
  tlsServer = createHttpsServer(
    {
      key: readFileSync(join(CERTS, 'selfsigned.key')),
      cert: readFileSync(join(CERTS, 'selfsigned.crt')),
      maxVersion: 'TLSv1.2',
    },
    (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    },
  )
  tlsBase = `https://127.0.0.1:${await listen(tlsServer)}`

  httpServer = createHttpServer((req, res) => {
    if (req.url === '/hop') {
      res.writeHead(302, { Location: '/dest' })
      res.end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('dest')
  })
  httpBase = `http://127.0.0.1:${await listen(httpServer)}`

  // A forward proxy for plain http: answers every request itself.
  proxyServer = createHttpServer((req, res) => {
    proxySeen.push({ url: String(req.url), auth: req.headers['proxy-authorization'] })
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('via-proxy')
  })
  proxyPort = await listen(proxyServer)
})
afterAll(async () => {
  await Promise.all(
    [tlsServer, httpServer, proxyServer].map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  )
})

let workspaceId: string
let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  storeState.values = {}
  proxySeen.length = 0
  registerRunnerHandlers()
})
afterEach(() => {
  testDb.close()
})

function setShared(value: Record<string, unknown>): void {
  testDb
    .prepare('UPDATE projects SET shared_settings = ? WHERE id = ?')
    .run(JSON.stringify(value), projectId)
}

function seedEndpoint(
  protocol: string,
  schema: Record<string, unknown>,
  method = String(schema.method ?? 'GET'),
): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'EP', ?, ?, '/', 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, protocol, method, JSON.stringify(schema), now, now)
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

describe('issue #287 — Run: Follow redirects inherits the project / app value', () => {
  const hop = (extra: Record<string, unknown> = {}) =>
    seedEndpoint('http', { method: 'GET', url: `${httpBase}/hop`, ...extra })

  it('project false, no key on the row -> the 302 is kept', async () => {
    setShared({ followRedirects: false })
    expect((await runOne(hop())).status).toBe(302)
  })

  it('project false + LEGACY bare row true (old Ctrl+S) -> follows the project: 302', async () => {
    setShared({ followRedirects: false })
    expect((await runOne(hop({ followRedirects: true, maxRedirects: 5 }))).status).toBe(302)
  })

  it('project false + explicit (marked) row true -> followed: 200', async () => {
    setShared({ followRedirects: false })
    expect(
      (await runOne(hop({ followRedirects: true, followRedirectsExplicit: true }))).status,
    ).toBe(200)
  })

  it('app false, no project key -> 302; nothing configured -> followed', async () => {
    storeState.values.followRedirects = false
    expect((await runOne(hop())).status).toBe(302)
    storeState.values = {}
    expect((await runOne(hop())).status).toBe(200)
  })
})

describe('issue #287 — Run: SOAP and GraphQL rows honour the project SSL setting', () => {
  const soap = () =>
    seedEndpoint('soap', {
      method: 'POST',
      url: `${tlsBase}/svc`,
      body: { type: 'xml', content: '<Envelope><Body><Ping/></Body></Envelope>' },
    })
  const graphql = () =>
    seedEndpoint('graphql', {
      method: 'POST',
      url: `${tlsBase}/graphql`,
      body: { type: 'json', content: '{"query":"{ ping }"}' },
    })

  it('SOAP: project false -> 200; nothing configured -> certificate error', async () => {
    setShared({ sslVerification: false })
    expect((await runOne(soap())).status).toBe(200)
    setShared({})
    const verified = await runOne(soap())
    expect(verified.status).toBeNull()
    expect(verified.error).toMatch(CERT_ERROR)
  })

  it('GraphQL: project false -> 200; app false -> 200; nothing -> certificate error', async () => {
    setShared({ sslVerification: false })
    expect((await runOne(graphql())).status).toBe(200)
    setShared({})
    storeState.values.sslVerification = false
    expect((await runOne(graphql())).status).toBe(200)
    storeState.values = {}
    expect((await runOne(graphql())).error).toMatch(CERT_ERROR)
  })
})

describe('issue #287 — Run applies the project TLS settings (Certificates pane)', () => {
  const ep = () => seedEndpoint('http', { method: 'GET', url: `${tlsBase}/` })

  it('minimum TLS 1.3 against a TLS 1.2 server -> handshake error (it used to be ignored)', async () => {
    setShared({ sslVerification: false, tls: { minVersion: 'TLSv1.3' } })
    const row = await runOne(ep())
    expect(row.status).toBeNull()
    // A protocol failure, not the certificate error a Run that ignored the
    // project settings (SSL off included) used to produce.
    expect(row.error).toMatch(/protocol|version|handshake|TLS/i)
    expect(row.error).not.toMatch(CERT_ERROR)
  })

  it('control: the same server without the TLS override answers 200', async () => {
    setShared({ sslVerification: false })
    expect((await runOne(ep())).status).toBe(200)
  })
})

describe('issue #287 — Run applies the project proxy (machine-local), password decrypted', () => {
  it('routes through the custom proxy with the decrypted credential', async () => {
    const stored = encryptSecret('s3cret')
    expect(stored).toMatch(/^enc:v1:/)
    storeState.values[`project.${projectId}.settings`] = {
      proxy: {
        mode: 'custom',
        host: '127.0.0.1',
        port: proxyPort,
        auth: { username: 'alice', password: stored },
      },
    }
    const row = await runOne(
      seedEndpoint('http', { method: 'GET', url: 'http://upstream.invalid/x' }),
    )
    expect(row.error).toBeUndefined()
    expect(row.status).toBe(200)
    expect(proxySeen).toHaveLength(1)
    expect(proxySeen[0].url).toBe('http://upstream.invalid/x')
    expect(proxySeen[0].auth).toBe(`Basic ${Buffer.from('alice:s3cret').toString('base64')}`)

    // The decrypted password reaches the proxy only — never a persisted or
    // displayed Run artefact (the result rows, Runner / request History).
    const b64 = Buffer.from('alice:s3cret').toString('base64')
    const runs = testDb.prepare('SELECT * FROM runner_history').all()
    expect(runs.length).toBeGreaterThan(0)
    const artefacts = [
      JSON.stringify(row),
      JSON.stringify(runs),
      JSON.stringify(testDb.prepare('SELECT * FROM history').all()),
    ].join('\n')
    expect(artefacts).not.toContain('s3cret')
    expect(artefacts).not.toContain(b64)
  })

  it('mode none / system leave the request direct', async () => {
    storeState.values[`project.${projectId}.settings`] = { proxy: { mode: 'system' } }
    expect(
      (await runOne(seedEndpoint('http', { method: 'GET', url: `${httpBase}/dest` }))).status,
    ).toBe(200)
    expect(proxySeen).toHaveLength(0)
  })
})

describe('inheritedNetworkFor — the run-level network settings', () => {
  it('maps project + app tiers, resolves the TLS preset, decrypts the proxy password', () => {
    const net = inheritedNetworkFor(
      {
        sslVerification: false,
        tls: { minVersion: 'TLSv1.2', cipherPreset: 'intermediate' },
        proxy: {
          mode: 'custom',
          host: 'p',
          port: 1,
          auth: { username: 'u', password: encryptSecret('pw') ?? '' },
        },
      },
      { sslVerification: true, followRedirects: false },
    )
    expect(net.sslVerification).toEqual({ project: false, app: true })
    expect(net.followRedirects).toEqual({ project: undefined, app: false })
    expect(net.tls?.minVersion).toBe('TLSv1.2')
    expect(net.tls?.ciphers).toBeTruthy()
    expect(net.proxy?.auth).toEqual({ username: 'u', password: 'pw' })
  })

  it('no project settings -> no tls, no proxy', () => {
    const net = inheritedNetworkFor(undefined, {})
    expect(net.tls).toBeUndefined()
    expect(net.proxy).toBeUndefined()
  })
})
