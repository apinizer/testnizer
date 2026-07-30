/**
 * Runner traffic must reach the app-wide Console panel (issue #79).
 *
 * The Console is fed from the HANDLER layer — `request.handler` logs for Send,
 * every protocol handler logs for its own tab. The runner called the HTTP
 * engine directly and logged nowhere, so a folder or suite run was invisible:
 * no request rows, and `console.log` inside step scripts produced nothing,
 * even though the requests demonstrably went out. Script logging is the
 * primary debugging tool in Postman-style workflows, which made runs the one
 * place you could not debug.
 *
 * Same idiom as `runner-lifecycle.test.ts` — a real local server and the REAL
 * executeCollection loop — plus a fake BrowserWindow that captures whatever
 * `console-logger` sends on the `console:log` channel.
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

/** Everything sent on the `console:log` IPC channel during a run. */
interface ConsoleEntry {
  protocol: string
  level: string
  category: string
  tabId?: string
  method?: string
  url?: string
  status?: number
  message: string
  details?: {
    requestHeaders?: Record<string, string>
    responseBody?: string
    error?: { message: string }
    meta?: Record<string, string | number | boolean>
  }
}

let consoleEntries: ConsoleEntry[] = []

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    // One live window, so `emitConsoleEntry` has somewhere to send.
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, entry: unknown) => {
            if (channel === 'console:log') consoleEntries.push(entry as ConsoleEntry)
          },
        },
      },
    ],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')

// ─── Local server ────────────────────────────────────────────────

let server: Server
let port = 0
/** A port nothing listens on — forces a genuine transport failure. */
let deadPort = 0

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/'
      req.resume()
      req.on('end', () => {
        if (url.startsWith('/fail')) {
          res.writeHead(500, { 'Content-Type': 'text/plain' })
          res.end('boom')
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, path: url }))
      })
    })
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port
      resolve()
    })
  })
  await new Promise<void>((resolve) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      deadPort = (probe.address() as AddressInfo).port
      probe.close(() => resolve())
    })
  })
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

// ─── Seed helpers ────────────────────────────────────────────────

let workspaceId: string
let projectId: string

function seedEndpoint(opts: {
  name?: string
  method?: string
  url: string
  preScript?: string
  postScript?: string
}): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = JSON.stringify({
    method: opts.method ?? 'GET',
    url: opts.url,
    params: [],
    headers: [],
    auth: { type: 'none' },
    assertions: [],
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

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  consoleEntries = []
  registerRunnerHandlers()
})

afterEach(() => {
  testDb.close()
})

function run(options: Record<string, unknown>): Promise<{ success: boolean }> {
  return harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    ...options,
  }) as Promise<{ success: boolean }>
}

/** Request/response rows — the traffic, not the script output. */
const traffic = (): ConsoleEntry[] => consoleEntries.filter((e) => e.category === 'response')
/** Script `console.*` rows. */
const scriptLines = (): ConsoleEntry[] => consoleEntries.filter((e) => e.category === 'system')

// ─── The reported bug ────────────────────────────────────────────

describe('runner → Console: request traffic', () => {
  it('logs every executed step, which it used to log none of', async () => {
    const a = seedEndpoint({ name: 'First', url: `http://127.0.0.1:${port}/one` })
    const b = seedEndpoint({ name: 'Second', url: `http://127.0.0.1:${port}/two` })

    await run({ endpointIds: [a, b] })

    const rows = traffic()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.url)).toEqual([
      `http://127.0.0.1:${port}/one`,
      `http://127.0.0.1:${port}/two`,
    ])
    expect(rows.every((r) => r.status === 200)).toBe(true)
  })

  it('carries the request AND response side, like the Send path', async () => {
    const id = seedEndpoint({ name: 'Echo', method: 'GET', url: `http://127.0.0.1:${port}/echo` })
    await run({ endpointIds: [id] })

    const row = traffic()[0]
    expect(row.method).toBe('GET')
    // A row with no body is the "requests are invisible" complaint in a
    // different costume: you can see that something happened, not what.
    expect(row.details?.responseBody).toContain('"ok":true')
    expect(row.details?.requestHeaders).toBeTruthy()
  })

  it('says which run, step, phase and iteration each row came from', async () => {
    const setup = seedEndpoint({ name: 'Setup', url: `http://127.0.0.1:${port}/setup` })
    const main = seedEndpoint({ name: 'Main', url: `http://127.0.0.1:${port}/main` })

    await run({
      endpointIds: [main],
      setupEndpointIds: [setup],
      sourceLabel: 'APIs: Checkout',
      runTabId: 'runner-folder-7',
    })

    const rows = traffic()
    expect(rows.map((r) => r.details?.meta?.phase)).toEqual(['setup', 'main'])
    expect(rows.map((r) => r.details?.meta?.step)).toEqual(['Setup', 'Main'])
    expect(rows.every((r) => r.details?.meta?.run === 'APIs: Checkout')).toBe(true)
    // Attribution to the runner tab is what makes the per-tab Console view
    // work; without it the entries exist but belong to no tab.
    expect(rows.every((r) => r.tabId === 'runner-folder-7')).toBe(true)
    expect(rows[1].details?.meta?.iteration).toBe(1)
  })

  it('logs a step that never reached a response', async () => {
    // The case you most want in the Console: DNS failure, refused TLS, an
    // unloadable client certificate. Nothing is logged after the request
    // because there is no response to log — so it must be logged on the way out.
    const id = seedEndpoint({ name: 'Dead', url: `http://127.0.0.1:${deadPort}/nope` })
    await run({ endpointIds: [id] })

    const rows = traffic()
    expect(rows).toHaveLength(1)
    expect(rows[0].level).toBe('error')
    expect(rows[0].details?.error?.message).toBeTruthy()
  })

  it('logs a failing status as an error row, not a success', async () => {
    const id = seedEndpoint({ name: 'Boom', url: `http://127.0.0.1:${port}/fail` })
    await run({ endpointIds: [id] })

    expect(traffic()[0].status).toBe(500)
    expect(traffic()[0].level).toBe('error')
  })
})

describe('runner → Console: script output', () => {
  it('forwards console.log from a step script', async () => {
    const id = seedEndpoint({
      name: 'Logs',
      url: `http://127.0.0.1:${port}/x`,
      preScript: 'console.log("hello from pre")',
    })
    await run({ endpointIds: [id] })

    expect(scriptLines().map((e) => e.message)).toContain('hello from pre')
  })

  it('keeps warn and error apart instead of flattening them', async () => {
    const id = seedEndpoint({
      name: 'Levels',
      url: `http://127.0.0.1:${port}/x`,
      preScript: 'console.warn("careful"); console.error("broken")',
    })
    await run({ endpointIds: [id] })

    const byMessage = new Map(scriptLines().map((e) => [e.message, e.level]))
    expect(byMessage.get('careful')).toBe('warning')
    expect(byMessage.get('broken')).toBe('error')
  })

  it('forwards output from run-level hook scripts too', async () => {
    const id = seedEndpoint({ name: 'Step', url: `http://127.0.0.1:${port}/x` })
    await run({
      endpointIds: [id],
      runPreScript: 'console.log("run setup script ran")',
    })

    expect(scriptLines().map((e) => e.message)).toContain('run setup script ran')
  })

  it('tags script lines with the step they came from', async () => {
    const id = seedEndpoint({
      name: 'Tagged',
      url: `http://127.0.0.1:${port}/x`,
      postScript: 'console.log("after")',
    })
    await run({ endpointIds: [id], sourceLabel: 'Suite: Smoke' })

    const line = scriptLines().find((e) => e.message === 'after')
    expect(line?.details?.meta?.step).toBe('Tagged')
    expect(line?.details?.meta?.run).toBe('Suite: Smoke')
  })

  it('still records the same output in the run report', async () => {
    // Two destinations, on purpose: the report copy is persisted with the run,
    // the Console copy is live and sits beside the traffic. Fixing #79 must
    // not move the logs out of the report.
    const id = seedEndpoint({
      name: 'Both',
      url: `http://127.0.0.1:${port}/x`,
      preScript: 'console.log("in both places")',
    })
    const res = (await run({ endpointIds: [id] })) as {
      data?: { results: Array<{ consoleLogs?: Array<{ message: string }> }> }
    }

    expect(res.data?.results[0].consoleLogs?.map((l) => l.message)).toContain('in both places')
    expect(scriptLines().map((e) => e.message)).toContain('in both places')
  })
})

describe('runner → Console: scripted sends', () => {
  it('logs pm.sendRequest, which the Send path logs via request:send', async () => {
    const id = seedEndpoint({
      name: 'Scripted',
      url: `http://127.0.0.1:${port}/main`,
      preScript: `pm.sendRequest("http://127.0.0.1:${port}/from-script", function () {})`,
    })
    await run({ endpointIds: [id] })

    const scripted = traffic().find((r) => r.url?.includes('/from-script'))
    expect(scripted, 'pm.sendRequest must appear in the Console').toBeTruthy()
    expect(scripted?.details?.meta?.via).toBe('pm.sendRequest')
  })
})

describe('runner → Console: scheduled runs', () => {
  it('logs them too, identified by task instead of tab', async () => {
    // Asked explicitly in the issue. A scheduled run has no tab, and it is the
    // run you are least able to watch — so it is the one that most needs to
    // leave a trace.
    const id = seedEndpoint({ name: 'Nightly', url: `http://127.0.0.1:${port}/cron` })
    await run({ endpointIds: [id], scheduledTaskId: 'task-42', sourceLabel: 'Nightly smoke' })

    const row = traffic()[0]
    expect(row.details?.meta?.task).toBe('task-42')
    expect(row.tabId).toBeUndefined()
  })
})
