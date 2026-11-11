/**
 * Tester report 2026-11-11 — three proxy findings on Run / Test Suite / Scheduler.
 *
 *  1. Run ignored the proxy's "Bypass for hosts" list: `inheritedNetworkFor`
 *     rebuilt the proxy field by field and dropped `bypass`, so a listed host
 *     went through the proxy on Run while Send went out directly.
 *  2. The same rebuild dropped `proxyType`: a saved SOCKS proxy was used as an
 *     HTTP proxy on Run, while Send refuses it (`SOCKS_PROXY_UNSUPPORTED`).
 *  3. A username + password typed into the proxy form and then cleared left
 *     `auth: {username:'', password:''}` behind. axios rejects that object
 *     ("Invalid proxy authorization"), so every request failed.
 *
 * Real target server + a real forward proxy that counts what it sees; Send is
 * the main half of the real Send path (`settings:get` → `networkPayload` →
 * `request:send`), Run the real `runner:execute` / Scheduler entry.
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
import type { ProxySetting } from '../../../src/shared/request-settings'
import { SOCKS_PROXY_UNSUPPORTED } from '../../../src/shared/proxy-bypass'

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
  delete(key: string): void {
    delete storeState.values[key]
  }
  clear(): void {
    storeState.values = {}
  }
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerSettingsHandlers } = await import('../../../src/main/ipc/settings.handler')
const { registerRequestHandlers } = await import('../../../src/main/ipc/request.handler')
const { registerRunnerHandlers, executeCollectionForScheduler, inheritedNetworkFor } =
  await import('../../../src/main/ipc/runner.handler')
const { encryptSecret } = await import('../../../src/main/lib/secure-storage')
const { networkPayload } = await import('../../../src/renderer/lib/network-settings')

let target: Server
let proxy: Server
let targetPort = 0
let proxyPort = 0
const direct: string[] = []
const proxied: Array<{ url: string; auth?: string }> = []

const listen = (s: Server): Promise<number> =>
  new Promise((resolve) =>
    s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)),
  )

beforeAll(async () => {
  target = createServer((req, res) => {
    direct.push(String(req.url))
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('direct')
  })
  proxy = createServer((req, res) => {
    proxied.push({ url: String(req.url), auth: req.headers['proxy-authorization'] })
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('via-proxy')
  })
  targetPort = await listen(target)
  proxyPort = await listen(proxy)
})
afterAll(async () => {
  await Promise.all(
    [target, proxy].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
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
  direct.length = 0
  proxied.length = 0
  registerSettingsHandlers()
  registerRequestHandlers()
  registerRunnerHandlers()
})
afterEach(() => testDb.close())

const targetUrl = (): string => `http://127.0.0.1:${targetPort}/get`

interface Outcome {
  status?: number | null
  error?: string
  direct: number
  proxied: number
  proxyAuth?: string
}

function outcome(row: { status?: number | null; error?: string }): Outcome {
  const out: Outcome = {
    status: row.status ?? null,
    ...(row.error ? { error: row.error } : {}),
    direct: direct.length,
    proxied: proxied.length,
    ...(proxied[0]?.auth ? { proxyAuth: proxied[0].auth } : {}),
  }
  direct.length = 0
  proxied.length = 0
  return out
}

/** The project Proxy pane's save — through the real settings handler (encrypts the password). */
async function saveProjectProxy(p: ProxySetting): Promise<void> {
  const res = (await harness.invoke('settings:set', projectKey, { proxy: p })) as {
    success: boolean
  }
  expect(res.success).toBe(true)
}

async function saveAppProxy(p: ProxySetting): Promise<void> {
  const res = (await harness.invoke('settings:setAll', { proxy: p })) as { success: boolean }
  expect(res.success).toBe(true)
}

function seedEndpoint(url: string): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'EP', 'http', 'GET', '/', 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, JSON.stringify({ method: 'GET', url, auth: { type: 'none' } }), now, now)
  return id
}

function seedSuiteItem(url: string): string {
  const now = Date.now()
  const suiteId = crypto.randomUUID()
  testDb
    .prepare(
      'INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    )
    .run(suiteId, projectId, 'S', now, now)
  const itemId = crypto.randomUUID()
  testDb
    .prepare(
      `INSERT INTO test_suite_items (id, suite_id, folder_id, protocol, name, method, url, request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'http', 'it', 'GET', ?, ?, 0, ?, ?)`,
    )
    .run(
      itemId,
      suiteId,
      url,
      JSON.stringify({ url, method: 'GET', auth: { type: 'none' } }),
      now,
      now,
    )
  return itemId
}

type Row = { status: number | null; error?: string }

async function runIds(ids: string[]): Promise<Row> {
  const res = (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    endpointIds: ids,
  })) as { success: boolean; data?: { results: Row[] } }
  expect(res.success).toBe(true)
  return res.data!.results[0]
}

const PATHS = {
  Run: async (): Promise<Outcome> => outcome(await runIds([seedEndpoint(targetUrl())])),
  'Test Suite': async (): Promise<Outcome> => outcome(await runIds([seedSuiteItem(targetUrl())])),
  Scheduler: async (): Promise<Outcome> => {
    const report = await executeCollectionForScheduler({
      projectId,
      workspaceId,
      endpointIds: [seedEndpoint(targetUrl())],
    } as never)
    return outcome(report.results[0] as Row)
  },
}

/**
 * Send as the renderer does it: `settings:get` (password decrypted) feeds
 * `networkPayload` (`resolveProxy`, project → app), whose proxy rides
 * `request:send` to the engine.
 */
async function send(): Promise<Outcome> {
  const get = async (key: string): Promise<unknown> =>
    ((await harness.invoke('settings:get', key)) as { data?: unknown }).data
  const project = ((await get(projectKey)) ?? {}) as { proxy?: ProxySetting }
  const appProxy = (await get('proxy')) as ProxySetting | undefined
  const payload = networkPayload({}, { project, appProxy })
  const res = (await harness.invoke('request:send', {
    method: 'GET',
    url: targetUrl(),
    headers: [],
    auth: { type: 'none' },
    ...(payload.proxy ? { proxy: payload.proxy } : {}),
    _projectId: projectId,
  })) as { success: boolean; data?: { status?: number; error?: string }; error?: string }
  return outcome(res.data ?? { error: res.error })
}

const viaProxy = (): ProxySetting => ({ mode: 'custom', host: '127.0.0.1', port: proxyPort })

describe('finding 1 — the bypass list applies on Run, Test Suite and Scheduler', () => {
  for (const [name, run] of Object.entries(PATHS)) {
    it(`${name}: a bypassed project-proxy target goes out directly`, async () => {
      await saveProjectProxy({ ...viaProxy(), bypass: '127.0.0.1' })
      expect(await run()).toEqual({ status: 200, direct: 1, proxied: 0 })
    })
  }

  it('Run: a bypassed app-proxy target goes out directly', async () => {
    await saveAppProxy({ ...viaProxy(), bypass: 'localhost, 127.0.0.1' })
    expect(await PATHS.Run()).toEqual({ status: 200, direct: 1, proxied: 0 })
  })

  it('control: without the bypass entry Run does go through the proxy', async () => {
    await saveProjectProxy({ ...viaProxy(), bypass: '*.internal' })
    expect(await PATHS.Run()).toEqual({ status: 200, direct: 0, proxied: 1 })
  })
})

describe('finding 2 — a saved SOCKS proxy is refused on Run, as on Send', () => {
  for (const [name, run] of Object.entries(PATHS)) {
    it(`${name}: SOCKS_PROXY_UNSUPPORTED, neither the proxy nor the server sees it`, async () => {
      await saveProjectProxy({ ...viaProxy(), proxyType: 'socks' })
      const got = await run()
      expect(got.error).toBe(SOCKS_PROXY_UNSUPPORTED)
      expect(got.direct).toBe(0)
      expect(got.proxied).toBe(0)
    })
  }
})

describe('finding 3 — cleared proxy credentials mean no proxy authentication', () => {
  const basic = (s: string): string => `Basic ${Buffer.from(s, 'utf-8').toString('base64')}`

  it('Run: {username:"", password:""} goes through the proxy without Proxy-Authorization', async () => {
    await saveProjectProxy({ ...viaProxy(), auth: { username: '', password: '' } })
    expect(await PATHS.Run()).toEqual({ status: 200, direct: 0, proxied: 1 })
  })

  it('Send: {username:"", password:""} goes through the proxy without Proxy-Authorization', async () => {
    await saveProjectProxy({ ...viaProxy(), auth: { username: '', password: '' } })
    expect(await send()).toEqual({ status: 200, direct: 0, proxied: 1 })
  })

  it('Send: the app proxy with cleared credentials too', async () => {
    await saveAppProxy({ ...viaProxy(), auth: { username: '', password: '' } })
    expect(await send()).toEqual({ status: 200, direct: 0, proxied: 1 })
  })

  it('username only: "user:" — never the text "null" for the cleared password', async () => {
    // The settings handler stores an empty password as null (`encryptSecret('')`).
    await saveProjectProxy({ ...viaProxy(), auth: { username: 'alice', password: '' } })
    expect((await send()).proxyAuth).toBe(basic('alice:'))
    expect((await PATHS.Run()).proxyAuth).toBe(basic('alice:'))
  })

  it('password only stays a credential (":secret"), as the app Settings form already allows', async () => {
    await saveProjectProxy({ ...viaProxy(), auth: { username: '', password: 'pw-only-7' } })
    expect((await send()).proxyAuth).toBe(basic(':pw-only-7'))
    expect((await PATHS.Run()).proxyAuth).toBe(basic(':pw-only-7'))
  })
})

describe('Send ≡ Run — the same project setting, the same decision', () => {
  const CASES: Array<[string, () => ProxySetting]> = [
    ['bypassed target', () => ({ ...viaProxy(), bypass: '127.0.0.1' })],
    ['proxied target', () => ({ ...viaProxy(), bypass: 'other.host' })],
    ['SOCKS', () => ({ ...viaProxy(), proxyType: 'socks' })],
    ['HTTPS type (read as HTTP on both)', () => ({ ...viaProxy(), proxyType: 'https' })],
    ['cleared credentials', () => ({ ...viaProxy(), auth: { username: '', password: '' } })],
    ['full credentials', () => ({ ...viaProxy(), auth: { username: 'u', password: 'p4ss-w0rd' } })],
    ['No proxy', () => ({ mode: 'none' })],
  ]
  for (const [name, setting] of CASES) {
    it(name, async () => {
      await saveProjectProxy(setting())
      const sent = await send()
      const ran = await PATHS.Run()
      expect(ran).toEqual(sent)
    })
  }
})

describe('inheritedNetworkFor carries every ProxySetting key', () => {
  it('nothing is dropped; only the password is decrypted', () => {
    // `Required<>`: a key added to ProxySetting fails typecheck here until listed.
    const stored: Required<ProxySetting> = {
      mode: 'custom',
      host: 'proxy.corp',
      port: 3128,
      bypass: 'localhost, *.corp',
      proxyType: 'https',
      auth: { username: 'u', password: encryptSecret('pw') as string },
    }
    const net = inheritedNetworkFor({ proxy: stored }, {})
    expect(Object.keys(net.proxy ?? {}).sort()).toEqual(Object.keys(stored).sort())
    expect(net.proxy).toEqual({ ...stored, auth: { username: 'u', password: 'pw' } })
  })

  it('a key ProxySetting does not know yet passes through too (no field-by-field rebuild)', () => {
    const stored = { mode: 'custom', host: 'p', port: 1, futureKey: 'kept' } as ProxySetting
    expect(inheritedNetworkFor({ proxy: stored }, {}).proxy).toEqual(stored)
  })
})
