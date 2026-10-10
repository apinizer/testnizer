/**
 * Run-path half of the Send≡Run parity proof for scripts on MCP results
 * (issues #160, #161). Same idea as `script-parity.test.ts`: the shared
 * fixtures (`tests/fixtures/mcp-script-parity.ts`) go through the REAL
 * Collection Runner; only the transport — the engine's one-shot call — is
 * mocked to hand back each case's `McpCallOutcome`. The renderer half feeds
 * the same outcomes through its MCP post-call script path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './handlers/helpers'
import { mcpParityCases } from '../fixtures/mcp-script-parity'

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
vi.mock('../../src/main/db/database', () => ({ getDb: () => testDb }))

// Server URL → case: each case gets its own endpoint URL, which reaches the mock.
const byUrl = new Map(mcpParityCases.map((c, i) => [`http://mcp-parity.test/case-${i}`, c]))
vi.mock('../../src/main/protocols/mcp.engine', () => ({
  mcpCallOnce: vi.fn(async (opts: { connect: { url: string } }) => {
    const c = byUrl.get(opts.connect.url)
    return c ? c.outcome : { capability: 'tool', name: '?', error: 'no case' }
  }),
}))

const { registerRunnerHandlers } = await import('../../src/main/ipc/runner.handler')

let projectId: string
let envId: string

function seedEnvActive(db: Database.Database, project: string): string {
  const id = crypto.randomUUID()
  const ws = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(project) as {
    workspace_id: string
  }
  db.prepare(
    `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
     VALUES (?, ?, ?, 'Env', 1, ?, ?)`,
  ).run(id, ws.workspace_id, project, Date.now(), Date.now())
  return id
}

function seedMcpEndpoint(i: number): string {
  const c = mcpParityCases[i]
  const url = `http://mcp-parity.test/case-${i}`
  const call =
    c.outcome.capability === 'tool'
      ? { capabilityTab: 'tools', selectedTool: c.outcome.name, toolArgs: '{}' }
      : c.outcome.capability === 'resource'
        ? { capabilityTab: 'resources', resourceUriDraft: c.outcome.name }
        : { capabilityTab: 'prompts', selectedPrompt: c.outcome.name, promptArgs: {} }
  const schema = {
    url,
    method: 'GET',
    postScript: c.script,
    assertions: c.assertions ?? [],
    metadata: { mcp: { transport: 'http', url, customHeaders: [], envVars: [], call } },
  }
  const id = crypto.randomUUID()
  testDb
    .prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'MCP', 'mcp', 'GET', ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, url, JSON.stringify(schema), Date.now(), Date.now())
  return id
}

interface RunData {
  envUpdates: Record<string, string>
  passedEndpoints: number
  failedEndpoints: number
  results: Array<{
    endpointId: string
    error?: string
    assertions: Array<{ name: string; passed: boolean; error?: string }>
  }>
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  envId = seedEnvActive(testDb, projectId)
  registerRunnerHandlers()
})

describe('MCP script parity — Run path (Collection Runner)', () => {
  mcpParityCases.forEach((c, i) => {
    it(c.name, async () => {
      const ep = seedMcpEndpoint(i)
      const res = (await harness.invoke('runner:execute', {
        projectId,
        environmentId: envId,
        endpointIds: [ep],
      })) as { success: boolean; data?: RunData; error?: string }
      expect(res.success, res.error).toBe(true)
      const data = res.data!
      for (const [key, value] of Object.entries(c.expectEnv)) {
        expect(data.envUpdates[key], `env ${key}`).toBe(value)
      }
      const row = data.results.find((r) => r.endpointId === ep)!
      expect(row.error).toBeUndefined()
      expect(row.assertions.map((a) => ({ name: a.name, passed: a.passed }))).toEqual(c.expectTests)
      expect(data.passedEndpoints).toBe(c.expectPassed ? 1 : 0)
      expect(data.failedEndpoints).toBe(c.expectPassed ? 0 : 1)
    })
  })
})
