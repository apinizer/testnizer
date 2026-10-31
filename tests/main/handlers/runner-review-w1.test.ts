/**
 * Review findings on commit 870d28d (issue #287, issue #267), orchestrator
 * review round W1. Driven through the real `runner:execute` / `request:send`
 * handlers against real local servers.
 *
 *  P0-3  A project proxy with a LITERAL password (stored encrypted under the
 *        settings SENSITIVE_FIELDS, decrypted by `inheritedNetworkFor`) is not
 *        a known secret to any scrubber. A proxy that answers 407 and ECHOES
 *        the credential (status text, body, a header, base64 form) therefore
 *        lands in: the run result rows, runner_history, the History table,
 *        the Console and the run report. Same for Send (`request:send` with
 *        `proxy.auth.password`): History row and Console.
 *  P0-4  Run fail script: `pm.vault.set('tok', T)` / `pm.environment.set` of a
 *        secret-marked key INSIDE the hook is merged into `ctx.scopes` only
 *        after the script returns, so `pm.run.exportJson()` /
 *        `exportHtml()` called in the same script (`liveSecretValues(ctx.scopes)`)
 *        does not know T and a neutral-named response field holding T goes out
 *        through `pm.sendRequest` unmasked.
 *  P2-5  Run fail script: a direct Stop DURING the hook resolves the run, but
 *        `stopReason` was computed BEFORE the hook, so the final report says
 *        nothing was stopped. The hook runs after cleanup, so the expected
 *        reason is `teardownAborted` (cleanup abandoned), as for a direct Stop
 *        during teardown — not `stoppedImmediately` (cleanup never ran).
 *
 * Each describe states whether the finding reproduces; red tests are the
 * regression tests for the fix.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
} from './helpers'
import type { EndpointRunResult } from '../../../src/shared/runner-types'

const harness = setupHandlerHarness()
const sent: Array<{ channel: string; payload: unknown }> = []

vi.mock('electron', () => ({
  ...makeElectronMock(),
  // A keychain that really encrypts (the proxy password is stored `enc:v1:`).
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(`K${s}`, 'utf-8'),
    decryptString: (b: Buffer) => b.toString('utf-8').slice(1),
  },
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
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const storeState = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))
class FakeStore {
  get(key: string): unknown {
    return storeState.values[key]
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')
const { registerRequestHandlers } = await import('../../../src/main/ipc/request.handler')
const { registerConsoleHandlers } = await import('../../../src/main/ipc/console.handler')
const { registerHistoryHandlers } = await import('../../../src/main/ipc/history.handler')
const { buildRunReport } = await import('../../../src/main/lib/run-report')
const { encryptSecret } = await import('../../../src/main/lib/secure-storage')

const PROXY_USER = 'alice'
const PROXY_PW = 'PROXY-PW-s3cr3t-9137'
const PROXY_B64 = Buffer.from(`${PROXY_USER}:${PROXY_PW}`).toString('base64')
const TOKEN = 'NEUTRAL-FIELD-TOKEN-8842-qx'

// ─── Local servers ───────────────────────────────────────────────

let origin: Server
let proxy: Server
let originPort = 0
let proxyPort = 0
let received: string[] = []
let captured: Record<string, string[]> = {}
let hangs = 0
const sockets = new Set<Socket>()

function track(s: Server): void {
  s.on('connection', (c) => {
    sockets.add(c)
    c.on('close', () => sockets.delete(c))
  })
}
const listen = (s: Server): Promise<number> =>
  new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)))

beforeAll(async () => {
  origin = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/'
    let body = ''
    req.on('data', (c) => (body += String(c)))
    req.on('end', () => {
      received.push(url)
      ;(captured[url] ??= []).push(body)
      if (url.startsWith('/hang')) {
        hangs++
        return
      }
      if (url.startsWith('/fail-token')) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ note: TOKEN }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  track(origin)
  originPort = await listen(origin)

  // A forward proxy that REJECTS with 407 and echoes the credential it was
  // given everywhere a hostile / sloppy proxy might: status text, a header,
  // the body (decoded and base64).
  proxy = createServer((req, res) => {
    const auth = String(req.headers['proxy-authorization'] ?? '')
    const b64 = auth.replace(/^Basic\s+/i, '')
    const decoded = Buffer.from(b64, 'base64').toString('utf-8')
    res.writeHead(407, `Proxy rejected ${decoded}`, {
      'Content-Type': 'text/plain',
      'Proxy-Authenticate': 'Basic realm="corp"',
      'X-Echo-Proxy-Auth': b64,
    })
    res.end(`proxy saw credentials ${decoded} (basic ${b64})`)
  })
  track(proxy)
  proxyPort = await listen(proxy)
})

afterAll(async () => {
  for (const s of sockets) s.destroy()
  await Promise.all(
    [origin, proxy].map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  )
})

// ─── Fixtures ────────────────────────────────────────────────────

let workspaceId: string
let projectId: string

beforeEach(() => {
  harness.reset()
  sent.length = 0
  received = []
  captured = {}
  hangs = 0
  storeState.values = {}
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  registerRunnerHandlers()
  registerRequestHandlers()
  registerConsoleHandlers()
  registerHistoryHandlers()
})
afterEach(() => {
  testDb.close()
})

function seedEndpoint(path: string, host = `127.0.0.1:${originPort}`): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = JSON.stringify({
    method: 'GET',
    url: `http://${host}${path}`,
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
    .run(id, projectId, path, path, schema, now, now)
  return id
}

interface Report {
  success: boolean
  data?: {
    stopReason?: string
    results: EndpointRunResult[]
  }
}
const run = (options: Record<string, unknown>): Promise<Report> =>
  harness.invoke('runner:execute', { projectId, workspaceId, ...options }) as Promise<Report>

/** Every place the proxy credential must not be: plain and base64. */
function expectNoProxyCredential(label: string, text: string): void {
  expect.soft(text, `${label}: password`).not.toContain(PROXY_PW)
  expect.soft(text, `${label}: base64(user:password)`).not.toContain(PROXY_B64)
}

// ─── P0-3 ────────────────────────────────────────────────────────

describe('P0-3: project proxy password echoed by a 407 proxy (Run)', () => {
  function configureProxy(): void {
    const stored = encryptSecret(PROXY_PW)
    expect(stored).toMatch(/^enc:v1:/)
    storeState.values[`project.${projectId}.settings`] = {
      proxy: {
        mode: 'custom',
        host: '127.0.0.1',
        port: proxyPort,
        auth: { username: PROXY_USER, password: stored },
      },
    }
  }

  it('control: the proxy really received the credential and answered 407', async () => {
    configureProxy()
    const res = await run({ endpointIds: [seedEndpoint('/x', 'upstream.invalid')] })
    expect(res.success).toBe(true)
    // The echo is observable in the unmasked canary field the fixture controls:
    // the status is the proxy's 407, so the request really went through it.
    expect(res.data!.results[0].status).toBe(407)
  })

  it('result rows, runner_history, History table, Console and the run report carry no proxy credential', async () => {
    configureProxy()
    const res = await run({ endpointIds: [seedEndpoint('/x', 'upstream.invalid')] })
    expect(res.data!.results[0].status).toBe(407)

    expectNoProxyCredential('result rows', JSON.stringify(res.data!.results))
    expectNoProxyCredential(
      'runner:progress',
      JSON.stringify(sent.filter((s) => s.channel === 'runner:progress')),
    )
    expectNoProxyCredential(
      'runner_history',
      JSON.stringify(testDb.prepare('SELECT * FROM runner_history').all()),
    )
    expectNoProxyCredential('history', JSON.stringify(testDb.prepare('SELECT * FROM history').all()))
    expectNoProxyCredential(
      'console',
      JSON.stringify(sent.filter((s) => s.channel === 'console:log')),
    )
    expectNoProxyCredential('report json', buildRunReport(res.data!.results, 'json'))
    expectNoProxyCredential('report html', buildRunReport(res.data!.results, 'html'))
  })
})

describe('P0-3: project proxy password echoed by a 407 proxy (Send, request:send)', () => {
  it('History row and Console entries carry no proxy credential', async () => {
    const res = (await harness.invoke('request:send', {
      method: 'GET',
      url: 'http://upstream.invalid/x',
      params: [],
      headers: [],
      auth: { type: 'none' },
      // What the renderer sends: the project proxy as `settings:get` returned
      // it (password decrypted).
      proxy: {
        mode: 'custom',
        host: '127.0.0.1',
        port: proxyPort,
        auth: { username: PROXY_USER, password: PROXY_PW },
      },
      _projectId: projectId,
      _workspaceId: workspaceId,
    })) as { success: boolean; data?: { status: number } }
    expect(res.success).toBe(true)
    expect(res.data?.status).toBe(407)

    expectNoProxyCredential('history', JSON.stringify(testDb.prepare('SELECT * FROM history').all()))
    expectNoProxyCredential(
      'console',
      JSON.stringify(sent.filter((s) => s.channel === 'console:log')),
    )
  })
})

// ─── P0-4 ────────────────────────────────────────────────────────

describe('P0-4: pm.run.export* inside the fail script knows secrets the hook itself just wrote', () => {
  /** Hook: write the token to a secret, THEN export both formats and send them out. */
  const exfil = (setter: string): string =>
    `${setter}\n` +
    `await pm.sendRequest({ url: 'http://127.0.0.1:${originPort}/capture-json', method: 'POST', ` +
    `body: { mode: 'raw', raw: pm.run.exportJson() } })\n` +
    `await pm.sendRequest({ url: 'http://127.0.0.1:${originPort}/capture-html', method: 'POST', ` +
    `body: { mode: 'raw', raw: pm.run.exportHtml() } })`

  function seedSecretEnvKey(): void {
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
         VALUES ('v1', 'env1', 'tok', 'placeholder-tok-1', 1, 1, NULL)`,
      )
      .run()
  }

  async function redRunWith(script: string): Promise<void> {
    const bad = seedEndpoint('/fail-token')
    await run({ endpointIds: [bad], stopOnError: false, runFailScript: script })
    expect(captured['/capture-json'], 'the hook must have exported JSON').toHaveLength(1)
    expect(captured['/capture-html'], 'the hook must have exported HTML').toHaveLength(1)
    // Not vacuous: the export is the real run (it names the failing request).
    expect(captured['/capture-json'][0]).toContain('/fail-token')
  }

  it('pm.vault.set(NEW key) in the hook, then pm.run.exportJson/exportHtml: token masked', async () => {
    await redRunWith(exfil(`await pm.vault.set('hooktok', '${TOKEN}')`))
    expect(captured['/capture-json'][0]).not.toContain(TOKEN)
    expect(captured['/capture-html'][0]).not.toContain(TOKEN)
  })

  it('pm.environment.set on a secret-marked key in the hook, then export: token masked', async () => {
    seedSecretEnvKey()
    await redRunWith(exfil(`pm.environment.set('tok', '${TOKEN}')`))
    expect(captured['/capture-json'][0]).not.toContain(TOKEN)
    expect(captured['/capture-html'][0]).not.toContain(TOKEN)
  })

  it('control: a token that is NOT a secret anywhere is (rightly) left in the export', async () => {
    // Guards the premise: the neutral-named field is only maskable via the
    // secret value, so without a secret write the export carries it.
    await redRunWith(exfil('// no secret written'))
    expect(captured['/capture-json'][0]).toContain(TOKEN)
  })
})

// ─── P2-5 ────────────────────────────────────────────────────────

describe('P2-5: direct Stop during the fail script is reflected in stopReason', () => {
  it('stopOnError off, red run, hook awaits a hanging pm.sendRequest, direct Stop: the run resolves with teardownAborted', async () => {
    const bad = seedEndpoint('/fail-token')
    const started = run({
      endpointIds: [bad],
      stopOnError: false,
      runFailScript: `await pm.sendRequest('http://127.0.0.1:${originPort}/hang')`,
    })
    await vi.waitFor(() => expect(hangs).toBe(1), { timeout: 5000 })
    void harness.invoke('runner:stop', { mode: 'direct' })

    const res = await Promise.race([
      started,
      new Promise<'hung'>((r) => setTimeout(() => r('hung'), 5000)),
    ])
    expect(res, 'run did not resolve within 5 s of the direct Stop').not.toBe('hung')
    const report = res as Report
    expect(report.success).toBe(true)
    expect(report.data?.stopReason).toBe('teardownAborted')
  }, 12_000)
})
