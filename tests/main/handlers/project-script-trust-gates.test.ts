/**
 * The main-process gates: real `executeCollection` against a real local server,
 * and a real mock server. While blocked, no script body evaluates and the row's
 * request is not sent; after Allow the same row runs. The scripts only write a
 * console line and an environment value: enough to prove they ran.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock } from './helpers'

interface ConsoleEntry {
  category: string
  message: string
}
const captured = vi.hoisted(() => ({
  console: [] as ConsoleEntry[],
  prompts: 0,
}))
const harness = setupHandlerHarness()

vi.mock('electron', () => ({
  ...makeElectronMock(),
  dialog: {
    showMessageBox: async () => {
      captured.prompts++
      return { response: 1 }
    },
  },
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, entry: unknown) => {
            if (channel === 'console:log') captured.console.push(entry as ConsoleEntry)
          },
        },
      },
    ],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let db: Database.Database
const realDb = await vi.importActual<typeof import('../../../src/main/db/database')>(
  '../../../src/main/db/database',
)
vi.mock('../../../src/main/db/database', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/db/database')>()),
  getDb: () => db,
}))

class FakeStore {
  get(): unknown {
    return undefined
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const trust = await import('../../../src/main/lib/project-script-trust')
const { registerRunnerHandlers, executeCollectionForScheduler } =
  await import('../../../src/main/ipc/runner.handler')
const { registerSchedulerHandlers } = await import('../../../src/main/ipc/scheduler.handler')
const { registerMockHandlers } = await import('../../../src/main/ipc/mock.handler')
const { mockServerManager } = await import('../../../src/main/mock/server')

const MESSAGE = trust.PROJECT_SCRIPTS_BLOCKED_MESSAGE
const CANARY = 'script-trust-canary'
const SCRIPT = `console.log('${CANARY}')`
const ENV_SCRIPT = `pm.environment.set('script_trust_canary', 'ran')`

let server: Server
let port = 0
let hits: string[] = []
let onHit: ((url: string) => void) | null = null

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '/')
    onHit?.(req.url ?? '/')
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  port = (server.address() as AddressInfo).port
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

let workspaceId = ''
let projectId = ''

function schema(path: string, scripts: { preScript?: string; postScript?: string } = {}): string {
  return JSON.stringify({
    method: 'GET',
    url: `http://127.0.0.1:${port}${path}`,
    params: [],
    headers: [],
    auth: { type: 'none' },
    assertions: [],
    ...scripts,
  })
}
function endpoint(
  path: string,
  scripts: { preScript?: string; postScript?: string } = {},
  folderId: string | null = null,
): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'http', 'GET', ?, 'developing', ?, 0, 1, 1)`,
  ).run(id, projectId, folderId, path, path, schema(path, scripts))
  return id
}
function folder(
  script: string | null,
  parentId: string | null = null,
  column = 'pre_script',
): string {
  const id = randomUUID()
  db.prepare(
    `INSERT INTO folders (id, project_id, parent_id, name, sort_order, ${column}) VALUES (?, ?, ?, 'F', 0, ?)`,
  ).run(id, projectId, parentId, script)
  return id
}

interface Row {
  endpointId: string
  endpointName: string
  status: number | null
  error?: string
  phase?: string
}
interface Report {
  results: Row[]
  failedRequests?: number
}
async function run(options: Record<string, unknown>): Promise<Report> {
  const r = (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    ...options,
  })) as { success: boolean; error?: string; data?: Report }
  expect(r.success, r.error).toBe(true)
  return r.data!
}
const canaryLines = (): ConsoleEntry[] => captured.console.filter((e) => e.message.includes(CANARY))
const allow = (): Promise<void> => trust.allowProjectScripts(projectId)

beforeEach(async () => {
  harness.reset()
  hits = []
  onHit = null
  captured.console = []
  captured.prompts = 0
  trust.setProjectScriptTrustStoreForTests(null)
  await trust.allowProjectScripts('unused') // forces the load on the null store
  db = realDb.openAndMigrate(':memory:')
  workspaceId = randomUUID()
  projectId = randomUUID()
  db.prepare(`INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, 'W', 1, 1)`).run(
    workspaceId,
  )
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, type, sort_order, created_at, updated_at) VALUES (?, ?, 'P', 'http', 0, 1, 1)`,
  ).run(projectId, workspaceId)
  registerRunnerHandlers()
  registerSchedulerHandlers()
  registerMockHandlers()
  await trust.blockProjectScripts(projectId)
})
afterEach(async () => {
  await trust.allowProjectScripts(projectId)
  trust.setProjectScriptTrustStoreForTests(undefined)
})

describe('a row that would run a script', () => {
  const blockedThenAllowed = async (ids: string[]): Promise<void> => {
    const before = await run({ endpointIds: ids })
    expect(before.results[0].error).toBe(MESSAGE)
    expect(before.results[0].status).toBeNull()
    expect(hits).toEqual([])
    expect(canaryLines()).toEqual([])

    await allow()
    const after = await run({ endpointIds: ids })
    expect(after.results[0].error).toBeFalsy()
    expect(after.results[0].status).toBe(200)
    expect(hits.length).toBe(1)
    expect(canaryLines().length).toBeGreaterThan(0)
  }

  it('its own pre-request script', async () => {
    await blockedThenAllowed([endpoint('/pre', { preScript: SCRIPT })])
  })

  it('its own post-response script: the request is not sent either', async () => {
    await blockedThenAllowed([endpoint('/post', { postScript: SCRIPT })])
  })

  it('a pre-request script on its folder', async () => {
    await blockedThenAllowed([endpoint('/folder', {}, folder(SCRIPT))])
  })

  it('a post-response script two folders up', async () => {
    const top = folder(SCRIPT, null, 'post_script')
    await blockedThenAllowed([endpoint('/nested', {}, folder(null, top))])
  })

  it('the project shared settings pre-request script', async () => {
    db.prepare('UPDATE projects SET shared_settings = ? WHERE id = ?').run(
      JSON.stringify({ preScript: SCRIPT }),
      projectId,
    )
    await blockedThenAllowed([endpoint('/project')])
  })

  it('the project shared settings test script', async () => {
    db.prepare('UPDATE projects SET shared_settings = ? WHERE id = ?').run(
      JSON.stringify({ testScript: SCRIPT }),
      projectId,
    )
    await blockedThenAllowed([endpoint('/project-test')])
  })

  it('a suite item, with a script on its suite folder', async () => {
    const suite = randomUUID()
    const suiteFolder = randomUUID()
    const item = randomUUID()
    db.prepare(
      `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at) VALUES (?, ?, 'S', 0, 1, 1)`,
    ).run(suite, projectId)
    db.prepare(
      `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, pre_script, created_at) VALUES (?, ?, NULL, 'SF', 0, ?, 1)`,
    ).run(suiteFolder, suite, SCRIPT)
    db.prepare(
      `INSERT INTO test_suite_items (id, suite_id, folder_id, protocol, name, method, url, request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'http', 'Item', 'GET', ?, ?, 0, 1, 1)`,
    ).run(item, suite, suiteFolder, `http://127.0.0.1:${port}/item`, schema('/item'))
    await blockedThenAllowed([item])
  })

  it('whitespace is no script: the row runs while blocked', async () => {
    const id = endpoint('/blank', { preScript: '  \n ', postScript: '\t' })
    const r = await run({ endpointIds: [id] })
    expect(r.results[0].status).toBe(200)
    expect(hits).toEqual(['/blank'])
  })

  it('the default comments the project dialog saves are no script: the row runs while blocked', async () => {
    db.prepare('UPDATE projects SET shared_settings = ? WHERE id = ?').run(
      JSON.stringify({
        preScript: '// Runs before every request in this project\n// pm.environment.set("a", 1)\n',
        testScript: '// Runs after every response in this project\n',
      }),
      projectId,
    )
    const id = endpoint('/comments', { preScript: '/* nothing */' })
    const r = await run({ endpointIds: [id] })
    expect(r.results[0].error).toBeFalsy()
    expect(r.results[0].status).toBe(200)
    expect(hits).toEqual(['/comments'])
  })

  it('a row with no script in a blocked project still runs, next to one that fails', async () => {
    const plain = endpoint('/plain')
    const scripted = endpoint('/scripted', { preScript: SCRIPT })
    const r = await run({ endpointIds: [plain, scripted, plain] })
    expect(r.results.map((row) => row.error ?? null)).toEqual([null, MESSAGE, null])
    expect(hits).toEqual(['/plain', '/plain'])
  })

  it('a pm.environment.set never happens while blocked, and does after Allow', async () => {
    const env = randomUUID()
    db.prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, 'E', 1, 1, 1)`,
    ).run(env, workspaceId, projectId)
    const id = endpoint('/env', { preScript: ENV_SCRIPT })
    const written = (): unknown =>
      db
        .prepare(
          `SELECT value FROM environment_variables WHERE environment_id = ? AND key = 'script_trust_canary'`,
        )
        .get(env)
    await run({ endpointIds: [id], environmentId: env })
    expect(written()).toBeUndefined()
    await allow()
    await run({ endpointIds: [id], environmentId: env })
    expect(written()).toEqual({ value: 'ran' })
  })

  it('an MCP row fails the same way, before connecting', async () => {
    const id = randomUUID()
    const url = `http://127.0.0.1:${port}/mcp`
    db.prepare(
      `INSERT INTO endpoints (id, project_id, name, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, 'M', 'mcp', 'GET', ?, 'developing', ?, 0, 1, 1)`,
    ).run(
      id,
      projectId,
      url,
      JSON.stringify({
        url,
        method: 'GET',
        assertions: [],
        preScript: SCRIPT,
        metadata: {
          mcp: {
            transport: 'http',
            url,
            customHeaders: [],
            envVars: [],
            auth: { type: 'none' },
            protocol: 'legacy',
            call: { capabilityTab: 'tools', selectedTool: 'ping', toolArgs: '{}' },
          },
        },
      }),
    )
    const before = await run({ endpointIds: [id] })
    expect(before.results[0].error).toBe(MESSAGE)
    expect(hits).toEqual([])
    expect(canaryLines()).toEqual([])

    await allow()
    const after = await run({ endpointIds: [id] })
    expect(after.results[0].error).not.toBe(MESSAGE)
    expect(canaryLines().length).toBeGreaterThan(0)
  })
})

describe('run hooks', () => {
  const hookRow = (r: Report, phase: string): Row | undefined =>
    r.results.find((row) => row.phase === phase)

  it('setup and teardown hooks do not evaluate while blocked, and do after Allow', async () => {
    const id = endpoint('/main')
    const options = { endpointIds: [id], runPreScript: SCRIPT, runPostScript: SCRIPT }
    const before = await run(options)
    expect(canaryLines()).toEqual([])
    expect(hookRow(before, 'setup')?.error).toBe(MESSAGE)
    expect(hookRow(before, 'teardown')?.error).toBe(MESSAGE)

    await allow()
    await run(options)
    expect(canaryLines().length).toBeGreaterThanOrEqual(2)
  })

  it('a fail hook does not evaluate while blocked, and does after Allow', async () => {
    const scripted = endpoint('/fails', { preScript: "throw new Error('no')" })
    await run({ endpointIds: [scripted], runFailScript: SCRIPT })
    expect(canaryLines()).toEqual([])

    await allow()
    await run({ endpointIds: [scripted], runFailScript: SCRIPT, stopOnError: true })
    expect(canaryLines().length).toBeGreaterThan(0)
  })
})

describe('the state is read for each row, after the row', () => {
  // A project file imported while a run waits on a slow request: it blocks the
  // project, and the next row already holds what it brought.
  it('a block that arrives during a run stops the next row and its script', async () => {
    await allow()
    const first = endpoint('/first')
    const second = endpoint('/second', { preScript: SCRIPT })
    onHit = () => {
      void trust.blockProjectScripts(projectId)
    }
    const r = await run({ endpointIds: [first, second] })
    expect(r.results.map((row) => row.status)).toEqual([200, null])
    expect(r.results[1].error).toBe(MESSAGE)
    expect(hits).toEqual(['/first'])
    expect(canaryLines()).toEqual([])
  })

  it('a block that arrives during a run stops a later run hook', async () => {
    await allow()
    onHit = () => {
      void trust.blockProjectScripts(projectId)
    }
    await run({ endpointIds: [endpoint('/first')], runPostScript: SCRIPT })
    expect(canaryLines()).toEqual([])
  })

  it('an Allow that arrives during a run applies to the next row', async () => {
    await trust.blockProjectScripts(projectId)
    const first = endpoint('/first')
    const second = endpoint('/second', { preScript: SCRIPT })
    onHit = () => {
      void allow()
    }
    const r = await run({ endpointIds: [first, second] })
    expect(r.results.map((row) => row.status)).toEqual([200, 200])
    expect(canaryLines().length).toBeGreaterThan(0)
  })
})

describe('a row of another project', () => {
  // `runner:execute` refuses this; a scheduled task stores whatever ids it was given.
  it('never runs under the permission of the project that asked', async () => {
    await allow()
    const blockedProject = randomUUID()
    db.prepare(
      `INSERT INTO projects (id, workspace_id, name, type, sort_order, created_at, updated_at) VALUES (?, ?, 'B', 'http', 0, 1, 1)`,
    ).run(blockedProject, workspaceId)
    await trust.blockProjectScripts(blockedProject)
    const foreign = randomUUID()
    db.prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'foreign', 'http', 'GET', '/foreign', 'developing', ?, 0, 1, 1)`,
    ).run(foreign, blockedProject, schema('/foreign', { preScript: SCRIPT }))

    const report = await executeCollectionForScheduler({
      projectId,
      workspaceId,
      endpointIds: [foreign],
    } as Parameters<typeof executeCollectionForScheduler>[0])

    expect(report.results[0].error).toMatch(/another project/)
    expect(hits).toEqual([])
    expect(canaryLines()).toEqual([])
  })
})

describe('Scheduler', () => {
  it('a tick fails the row and never asks', async () => {
    const id = endpoint('/tick', { preScript: SCRIPT })
    const report = await executeCollectionForScheduler({
      projectId,
      workspaceId,
      endpointIds: [id],
    } as Parameters<typeof executeCollectionForScheduler>[0])
    expect(report.results[0].error).toBe(MESSAGE)
    expect(hits).toEqual([])
    expect(canaryLines()).toEqual([])
    expect(captured.prompts).toBe(0)

    await allow()
    const after = await executeCollectionForScheduler({
      projectId,
      workspaceId,
      endpointIds: [id],
    } as Parameters<typeof executeCollectionForScheduler>[0])
    expect(after.results[0].status).toBe(200)
    expect(canaryLines().length).toBeGreaterThan(0)
  })

  it('a stored task, run through the real task path, with hooks on the task', async () => {
    const id = endpoint('/task')
    const created = (await harness.invoke('scheduler:create', {
      projectId,
      name: 'Nightly',
      endpointIds: [id],
      runPreScript: SCRIPT,
      runFailScript: SCRIPT,
      intervalValue: 1,
      intervalUnit: 'hours',
      enabled: false,
    })) as { success: boolean; error?: string; data?: { id: string } }
    expect(created.success, created.error).toBe(true)

    const r = (await harness.invoke('scheduler:runNow', created.data!.id)) as {
      success: boolean
      error?: string
    }
    expect(r.success, r.error).toBe(true)
    await vi.waitFor(() =>
      expect(
        (db.prepare('SELECT COUNT(*) AS c FROM runner_history').get() as { c: number }).c,
      ).toBe(1),
    )
    expect(canaryLines()).toEqual([])
    expect(captured.prompts).toBe(0)
  })
})

describe('Mock server', () => {
  const invoke = async <T>(channel: string, ...args: unknown[]): Promise<T> => {
    const r = (await harness.invoke(channel, ...args)) as {
      success: boolean
      error?: string
      data?: T
    }
    expect(r.success, r.error).toBe(true)
    return r.data as T
  }
  async function startMock(script: string): Promise<{ id: string; port: number }> {
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
    const free = (probe.address() as AddressInfo).port
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    const created = await invoke<{ id: string }>('mock:server:create', {
      projectId,
      name: 'M',
      port: free,
    })
    const ep = await invoke<{ id: string }>('mock:endpoint:create', {
      serverId: created.id,
      method: 'GET',
      path: '/rule',
    })
    await invoke('mock:response:create', {
      endpointId: ep.id,
      statusCode: 200,
      body: 'from the rule',
      script,
    })
    await invoke('mock:server:start', created.id)
    return { id: created.id, port: free }
  }
  afterEach(() => mockServerManager.stopAll())

  const SETS_STATUS = `console.log('${CANARY}'); setStatus(201)`

  it('a blocked rule answers with the reason, logs it, and evaluates nothing', async () => {
    const { id, port: p } = await startMock(SETS_STATUS)
    const res = await fetch(`http://127.0.0.1:${p}/rule`)
    expect(res.status).toBe(500)
    expect((await res.json()) as { message: string }).toMatchObject({
      message: trust.MOCK_SCRIPT_BLOCKED_MESSAGE,
    })
    const log = mockServerManager.getLogs(id).at(-1)!
    expect(log.error).toBe(trust.MOCK_SCRIPT_BLOCKED_MESSAGE)
    expect(log.response.headers['x-mock-script-log']).toBeUndefined() // its console stayed silent
    expect(captured.prompts).toBe(0)
  })

  it('Allow takes effect without a restart', async () => {
    const { id, port: p } = await startMock(SETS_STATUS)
    expect((await fetch(`http://127.0.0.1:${p}/rule`)).status).toBe(500)
    await allow()
    const res = await fetch(`http://127.0.0.1:${p}/rule`)
    expect(res.status).toBe(201)
    expect(await res.text()).toBe('from the rule')
    expect(mockServerManager.getLogs(id).at(-1)!.response.headers['x-mock-script-log']).toContain(
      CANARY,
    )
  })

  it('a block takes effect on a running server too', async () => {
    await allow()
    const { port: p } = await startMock(SETS_STATUS)
    expect((await fetch(`http://127.0.0.1:${p}/rule`)).status).toBe(201)
    await trust.blockProjectScripts(projectId)
    expect((await fetch(`http://127.0.0.1:${p}/rule`)).status).toBe(500)
  })

  it('a rule with no script answers normally while blocked', async () => {
    const { port: p } = await startMock('   ')
    const res = await fetch(`http://127.0.0.1:${p}/rule`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('from the rule')
  })
})
