/**
 * Issue #254 (orchestrator decision) — Run: the App settings proxy is a REAL
 * fallback. Before, `inheritedNetworkFor` only looked at the project's proxy;
 * the app dialog's proxy was saved and read by nothing.
 *
 * Rule (`resolveProxy`, src/shared/request-settings.ts — Send uses the same):
 *   project proxy when it configures one ("No proxy", or custom with a host)
 *   → app Settings proxy → none (the engine default).
 * A stored project `{mode:'system'}` — the old project dialog default, frozen
 * into every project on its first Save — is NOT an override.
 *
 * The app proxy is written through the real `settings:setAll` (which encrypts
 * `auth.password`, `SENSITIVE_FIELDS`) into the same store the runner reads,
 * so the Proxy-Authorization the proxy sees proves Run decrypts it.
 *
 * Fail-before: on the unfixed tree Run never routes through the app proxy, so
 * every "via the app proxy" case sees zero proxy hits.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
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
  // A keychain that really encrypts, so the stored proxy password is ciphertext.
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
  get store(): Record<string, unknown> {
    return storeState.values
  }
  get(key: string): unknown {
    return storeState.values[key]
  }
  set(key: string, value: unknown): void {
    storeState.values[key] = value
  }
  clear(): void {
    storeState.values = {}
  }
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerSettingsHandlers } = await import('../../../src/main/ipc/settings.handler')
const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')

let upstream: Server
let appProxy: Server
let projectProxy: Server
let upstreamBase = ''
let appProxyPort = 0
let projectProxyPort = 0
let deadPort = 0
const appSeen: Array<{ url: string; auth?: string }> = []
const projectSeen: Array<{ url: string; auth?: string }> = []

const listen = (s: Server): Promise<number> =>
  new Promise((resolve) =>
    s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)),
  )

/** A forward proxy for plain http that answers every request itself. */
function fakeProxy(seen: typeof appSeen, body: string): Server {
  return createServer((req, res) => {
    seen.push({ url: String(req.url), auth: req.headers['proxy-authorization'] })
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end(body)
  })
}

beforeAll(async () => {
  upstream = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('direct')
  })
  upstreamBase = `http://127.0.0.1:${await listen(upstream)}`
  appProxy = fakeProxy(appSeen, 'via-app-proxy')
  appProxyPort = await listen(appProxy)
  projectProxy = fakeProxy(projectSeen, 'via-project-proxy')
  projectProxyPort = await listen(projectProxy)
  const probe = createServer()
  deadPort = await listen(probe)
  await new Promise<void>((resolve) => probe.close(() => resolve()))
})
afterAll(async () => {
  await Promise.all(
    [upstream, appProxy, projectProxy].map(
      (s) => new Promise<void>((resolve) => s.close(() => resolve())),
    ),
  )
})

let workspaceId: string
let projectId: string
let projectKey: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  projectKey = `project.${projectId}.settings`
  storeState.values = {}
  appSeen.length = 0
  projectSeen.length = 0
  registerSettingsHandlers()
  registerRunnerHandlers()
})
afterEach(() => testDb.close())

interface Row {
  status: number | null
  error?: string
}

async function run(url: string): Promise<Row> {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'EP', 'http', 'GET', '/', 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, JSON.stringify({ method: 'GET', url }), now, now)
  const res = (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    endpointIds: [id],
  })) as { success: boolean; data?: { results: Row[] } }
  expect(res.success).toBe(true)
  return res.data!.results[0]
}

async function setAppProxy(proxy: Record<string, unknown>): Promise<void> {
  const res = (await harness.invoke('settings:setAll', { proxy })) as { success: boolean }
  expect(res.success).toBe(true)
}

const APP_AUTH = { username: 'alice', password: 's3cret' }

describe('issue #254 — Run falls back to the App settings proxy', () => {
  it('a project without a proxy goes through the app proxy, password decrypted', async () => {
    await setAppProxy({ mode: 'custom', host: '127.0.0.1', port: appProxyPort, auth: APP_AUTH })
    // Stored encrypted — the plaintext never sits in the store.
    expect(JSON.stringify(storeState.values.proxy)).not.toContain('s3cret')

    const row = await run('http://upstream.invalid/x')
    expect(row.error).toBeUndefined()
    expect(row.status).toBe(200)
    expect(appSeen).toHaveLength(1)
    expect(appSeen[0].url).toBe('http://upstream.invalid/x')
    expect(appSeen[0].auth).toBe(`Basic ${Buffer.from('alice:s3cret').toString('base64')}`)
  })

  it('a project holding the frozen legacy {mode:"system"} still follows the app proxy', async () => {
    await setAppProxy({ mode: 'custom', host: '127.0.0.1', port: appProxyPort })
    await harness.invoke('settings:set', projectKey, { proxy: { mode: 'system' } })
    expect((await run('http://upstream.invalid/legacy')).status).toBe(200)
    expect(appSeen).toHaveLength(1)
  })

  it('the project’s own custom proxy wins over the app proxy', async () => {
    // The app proxy points at a dead port: using it would fail the request.
    await setAppProxy({ mode: 'custom', host: '127.0.0.1', port: deadPort })
    await harness.invoke('settings:set', projectKey, {
      proxy: { mode: 'custom', host: '127.0.0.1', port: projectProxyPort },
    })
    const row = await run('http://upstream.invalid/own')
    expect(row.status).toBe(200)
    expect(projectSeen).toHaveLength(1)
    expect(appSeen).toHaveLength(0)
  })

  it('project "No proxy" overrides an app custom proxy (direct)', async () => {
    await setAppProxy({ mode: 'custom', host: '127.0.0.1', port: appProxyPort })
    await harness.invoke('settings:set', projectKey, { proxy: { mode: 'none' } })
    expect((await run(`${upstreamBase}/d`)).status).toBe(200)
    expect(appSeen).toHaveLength(0)
  })

  it('"Use app setting" (proxy: null) hands a project back to the app proxy and stores no null', async () => {
    await setAppProxy({ mode: 'custom', host: '127.0.0.1', port: appProxyPort })
    await harness.invoke('settings:set', projectKey, { proxy: { mode: 'none' } })
    await harness.invoke('settings:set', projectKey, { proxy: null, workingDirectory: '/w' })
    expect(storeState.values[projectKey]).toEqual({ workingDirectory: '/w' })
    expect((await run('http://upstream.invalid/back')).status).toBe(200)
    expect(appSeen).toHaveLength(1)
  })

  it('neither sets a proxy -> direct', async () => {
    await setAppProxy({ mode: 'system' })
    expect((await run(`${upstreamBase}/plain`)).status).toBe(200)
    expect(appSeen).toHaveLength(0)
    expect(projectSeen).toHaveLength(0)
  })
})
