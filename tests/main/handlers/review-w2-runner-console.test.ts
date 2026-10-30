/**
 * Review findings on commit 606f580 (issue #254 + review fixes), orchestrator
 * review round W2.
 *
 *  P0-1  Run: the proxy credential joined every Send/Run sink's secret list in
 *        606f580 (`proxySecretValues` -> `authSecrets`), but the script
 *        context's own console mirror (`pushConsoleLog` in runner.handler.ts)
 *        only passes `liveSecretValues(ctx)`. A 407 proxy that echoes the
 *        literal proxy password (status text, header, body) plus a
 *        post-response script `console.log(pm.response.text())` /
 *        `pm.response.headers.get(...)` / `pm.response.status` therefore
 *        puts the password (and its base64 `user:password`) into the app
 *        Console (`console:log`). The script-log copy in the result rows is
 *        scrubbed by `recordStep`; the live Console mirror is not.
 *
 * Send equivalent: Send-path script `console.*` output is built in the
 * renderer and masked through `console:maskEntry` (`maskRendererConsoleEntry`),
 * which only knows the DB's secret variables - by design it is never handed a
 * request's auth / proxy secrets. But the only Console entries the renderer
 * builds from script logs are PRE-request ones (request.store.ts), and a
 * pre-request script cannot read `pm.response`, so the 407 echo cannot reach
 * them; post-response script logs on Send stay in the response pane and are
 * not a Console sink. The Send-side guard below therefore asserts only the
 * main sink that does carry the response (the `request:send` Console entry);
 * there is no Send equivalent of the Run script-console leak to test.
 *
 * Red tests are the regression tests for the fix.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
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
const { encryptSecret } = await import('../../../src/main/lib/secure-storage')

const PROXY_USER = 'alice'
const PROXY_PW = 'PROXY-PW-w2-s3cr3t-5521'
const PROXY_B64 = Buffer.from(`${PROXY_USER}:${PROXY_PW}`).toString('base64')

let proxy: Server
let proxyPort = 0
const sockets = new Set<Socket>()

beforeAll(async () => {
  // Same fixture as runner-review-w1: a 407 proxy that echoes the credential
  // in the reason phrase, a header and the body (decoded + base64).
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
  proxy.on('connection', (c) => {
    sockets.add(c)
    c.on('close', () => sockets.delete(c))
  })
  proxyPort = await new Promise<number>((resolve) =>
    proxy.listen(0, '127.0.0.1', () => resolve((proxy.address() as AddressInfo).port)),
  )
})

afterAll(async () => {
  for (const s of sockets) s.destroy()
  await new Promise<void>((resolve) => proxy.close(() => resolve()))
})

let workspaceId: string
let projectId: string

beforeEach(() => {
  harness.reset()
  sent.length = 0
  storeState.values = {}
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  registerRunnerHandlers()
  registerRequestHandlers()
  registerConsoleHandlers()
})
afterEach(() => {
  testDb.close()
})

function seedEndpoint(path: string, postScript?: string): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = JSON.stringify({
    method: 'GET',
    url: `http://upstream.invalid${path}`,
    params: [],
    headers: [],
    auth: { type: 'none' },
    assertions: [],
    ...(postScript ? { postScript } : {}),
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

function configureProjectProxy(): void {
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

interface Report {
  success: boolean
  data?: { results: EndpointRunResult[] }
}
const run = (options: Record<string, unknown>): Promise<Report> =>
  harness.invoke('runner:execute', { projectId, workspaceId, ...options }) as Promise<Report>

const consoleEntries = (): string => JSON.stringify(sent.filter((s) => s.channel === 'console:log'))

function expectNoProxyCredential(label: string, text: string): void {
  expect.soft(text, `${label}: password`).not.toContain(PROXY_PW)
  expect.soft(text, `${label}: base64(user:password)`).not.toContain(PROXY_B64)
}

describe('P0-1: post-response script console.log of a 407 proxy echo (Run)', () => {
  const SCRIPT = [
    'console.log("body:", pm.response.text())',
    'console.log("headers:", JSON.stringify(pm.response.headers))',
    'console.log("echo header:", pm.response.headers.get("X-Echo-Proxy-Auth"))',
    'console.log("status:", pm.response.status)',
    'console.log("reason:", pm.response.reason())',
  ].join('\n')

  it('control: the script really ran against the 407 and its lines reached the Console', async () => {
    configureProjectProxy()
    const res = await run({ endpointIds: [seedEndpoint('/x', SCRIPT)] })
    expect(res.success).toBe(true)
    expect(res.data!.results[0].status).toBe(407)
    const consoleText = consoleEntries()
    // The script's own lines are in the Console (not vacuous)...
    expect(consoleText).toContain('proxy saw credentials')
    expect(consoleText).toContain('echo header:')
  })

  it('app Console entries emitted by the run carry neither the proxy password nor its base64', async () => {
    configureProjectProxy()
    const res = await run({ endpointIds: [seedEndpoint('/x', SCRIPT)] })
    expect(res.data!.results[0].status).toBe(407)
    expectNoProxyCredential('console:log', consoleEntries())
  })

  it('the per-step script log copy in the result rows is masked too (already true; guard)', async () => {
    configureProjectProxy()
    const res = await run({ endpointIds: [seedEndpoint('/x', SCRIPT)] })
    expectNoProxyCredential('result rows', JSON.stringify(res.data!.results))
    expectNoProxyCredential(
      'runner:progress',
      JSON.stringify(sent.filter((s) => s.channel === 'runner:progress')),
    )
  })
})

describe('P0-1 Send side: what the Send path can and cannot leak', () => {
  it('request:send Console entry for the same 407 echo carries no proxy credential', async () => {
    const res = (await harness.invoke('request:send', {
      method: 'GET',
      url: 'http://upstream.invalid/x',
      params: [],
      headers: [],
      auth: { type: 'none' },
      proxy: {
        mode: 'custom',
        host: '127.0.0.1',
        port: proxyPort,
        auth: { username: PROXY_USER, password: PROXY_PW },
      },
      _projectId: projectId,
      _workspaceId: workspaceId,
    })) as { success: boolean; data?: { status: number } }
    expect(res.data?.status).toBe(407)
    expectNoProxyCredential('console:log (Send)', consoleEntries())
  })
})
