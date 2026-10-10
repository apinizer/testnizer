/**
 * Review item 2 — a Run must not spawn a stdio MCP server the user never
 * connected on this computer. A project pulled from git can carry any command
 * line; until the user clicks Connect on that request's MCP tab (`mcp:connect`
 * records a LOCAL trust entry), the run row fails as a configuration error and
 * NO process is started. HTTP rows are unaffected. Real runner, real engine,
 * real child processes (the e2e stdio stub).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setupHandlerHarness, makeElectronMock, createTestDb, seedProject, seedWorkspace } from './helpers'

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

const { registerRunnerHandlers, executeCollectionForScheduler } =
  await import('../../../src/main/ipc/runner.handler')
const { registerMcpHandlers } = await import('../../../src/main/ipc/mcp.handler')
const { mcpConnectionIds } = await import('../../../src/main/protocols/mcp.engine')
const trust = await import('../../../src/main/lib/mcp-stdio-trust')

const STUB = path.resolve(__dirname, '../../fixtures/mcp-stdio-stub.cjs')
const NODE = process.execPath

let workspaceId: string
let projectId: string
let store: Map<string, unknown>
let tmp: string

function seedStdioEndpoint(commandLine: string, tool = 'ping'): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  const schema = {
    url: commandLine,
    method: 'GET',
    assertions: [],
    metadata: {
      mcp: {
        transport: 'stdio',
        url: commandLine,
        customHeaders: [],
        envVars: [],
        auth: { type: 'none' },
        protocol: 'legacy',
        call: { capabilityTab: 'tools', selectedTool: tool, toolArgs: '{}' },
      },
    },
  }
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'mcp', 'GET', ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, `stdio ${id.slice(0, 4)}`, commandLine, JSON.stringify(schema), now, now)
  return id
}

function seedHttpEndpoint(url: string): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'http', 'http', 'GET', ?, 'developing', ?, 1, ?, ?)`,
    )
    .run(id, projectId, url, JSON.stringify({ url, method: 'GET' }), now, now)
  return id
}

interface RunRow {
  endpointId: string
  status: number | null
  error?: string
  responseBody?: string
}

async function run(options: Record<string, unknown>) {
  return (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    ...options,
  })) as { success: boolean; data?: { results: RunRow[] } }
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  store = new Map()
  trust.setStdioTrustStoreForTests({
    get: (k) => store.get(k),
    set: (k, v) => void store.set(k, v),
  })
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tnz-trust-'))
  registerRunnerHandlers()
  registerMcpHandlers()
})

afterEach(() => {
  testDb.close()
  fs.rmSync(tmp, { recursive: true, force: true })
  expect(mcpConnectionIds()).toEqual([])
})

afterAll(() => trust.setStdioTrustStoreForTests(undefined))

describe('Run — stdio MCP trust (review item 2)', () => {
  it('an untrusted stdio row is a configuration error and spawns NOTHING', async () => {
    const marker = path.join(tmp, 'spawned.txt')
    const script = `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`
    const evil = seedStdioEndpoint(`"${NODE}" -e "${script.replace(/"/g, "'")}"`)
    // An HTTP row after it: a config error does not trip stopOnError.
    const http = seedHttpEndpoint('http://127.0.0.1:9/unreachable')
    const res = await run({ endpointIds: [evil, http], stopOnError: true })
    const rows = res.data!.results
    // Give a would-be child process time to have written its marker.
    await new Promise((r) => setTimeout(r, 300))
    expect(fs.existsSync(marker)).toBe(false)
    expect(rows[0].error).toBe(
      'This stdio MCP server has not been trusted on this computer. Connect to it once from its MCP tab to allow it in runs.',
    )
    expect(rows[0].status).toBeNull()
    expect(rows).toHaveLength(2)
  })

  it('after the user connects it once from the MCP tab, the same row runs', async () => {
    const line = `"${NODE}" "${STUB}"`
    const id = seedStdioEndpoint(line)
    const before = (await run({ endpointIds: [id] })).data!.results[0]
    expect(before.error).toMatch(/not been trusted/)

    // The tab's Connect: same resolved command line (shared `buildMcpConnect`).
    const conn = (await harness.invoke('mcp:connect', {
      transport: 'stdio',
      url: line,
      command: NODE,
      args: [STUB],
      protocol: 'legacy',
      projectId,
    })) as { success: boolean; data?: { connectionId: string } }
    expect(conn.success).toBe(true)
    await harness.invoke('mcp:disconnect', conn.data!.connectionId)
    // Local settings only: a hash, never the command line.
    const saved = JSON.stringify(store.get(trust.STDIO_TRUST_STORE_KEY))
    expect(saved).not.toContain('mcp-stdio-stub')

    const after = (await run({ endpointIds: [id] })).data!.results[0]
    expect(after.error).toBeUndefined()
    expect(after.status).toBe(200)
  })

  it('the Scheduler path refuses an untrusted stdio row the same way, spawning nothing', async () => {
    const marker = path.join(tmp, 'cron.txt')
    const script = `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`
    const id = seedStdioEndpoint(`"${NODE}" -e "${script.replace(/"/g, "'")}"`)
    const report = await executeCollectionForScheduler({ projectId, workspaceId, endpointIds: [id] })
    await new Promise((r) => setTimeout(r, 300))
    expect(fs.existsSync(marker)).toBe(false)
    expect(report.results[0].error).toMatch(/not been trusted on this computer/)
  })

  it('trust is per project and per exact command line', async () => {
    await trust.trustStdioServer({ projectId: 'other', command: NODE, args: [STUB] })
    await trust.trustStdioServer({ projectId, command: NODE, args: [STUB, '--extra'] })
    const id = seedStdioEndpoint(`"${NODE}" "${STUB}"`)
    const row = (await run({ endpointIds: [id] })).data!.results[0]
    expect(row.error).toMatch(/not been trusted/)
  })
})
