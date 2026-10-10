/**
 * Runner / Test Suite execution of MCP requests (issues #160, #161).
 *
 * Until #161 an MCP row in a run came back `UNSUPPORTED` (skipped). These
 * tests drive the REAL `runner:execute` loop and the REAL MCP engine against
 * live in-process MCP servers — the e2e fixture server (echo / add /
 * ask_count / resources / prompts) and a v2 wire server with the tools the
 * fixture does not have (`isError`, `structuredContent`). Nothing on the MCP
 * path is mocked: the runner resolves `{{var}}`, connects, calls, disconnects,
 * runs the post-response script (`pm.response`, `pm.mcp`, `pm.environment`)
 * and scores the assertion rows exactly like an HTTP row.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest'
import crypto from 'node:crypto'
import { z } from 'zod'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './helpers'
import { startMcpServer, type McpServer } from '../../e2e/servers/mcp-server'
import {
  freePort,
  startV1Server,
  startV2Server,
  waitOrAbort,
  type RunningServer,
} from '../mcp-wire-fixtures'

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
const { mcpConnectionIds, setMcpElicitationTimeoutMs } =
  await import('../../../src/main/protocols/mcp.engine')

// ─── Servers ─────────────────────────────────────────────────────

let fixture: McpServer
let custom: RunningServer

beforeAll(async () => {
  fixture = await startMcpServer(await freePort())
  custom = await startV2Server((server) => {
    server.registerTool(
      'fail',
      { description: 'Always a tool error', inputSchema: z.object({}) },
      async () => ({ content: [{ type: 'text', text: 'tool blew up' }], isError: true }),
    )
    server.registerTool(
      'sum',
      {
        description: 'Structured sum',
        inputSchema: z.object({ a: z.number(), b: z.number() }),
        outputSchema: z.object({ sum: z.number() }),
      },
      async ({ a, b }) => ({
        content: [{ type: 'text', text: String(a + b) }],
        structuredContent: { sum: a + b },
      }),
    )
    server.registerTool(
      'slow',
      { description: 'Answers after 5 s unless cancelled', inputSchema: z.object({}) },
      async (_args, ctx) => {
        await waitOrAbort(5_000, ctx.mcpReq.signal)
        return { content: [{ type: 'text', text: 'late' }] }
      },
    )
  })
  // Safety net only: a run must fail an elicitation at once, never wait it out.
  setMcpElicitationTimeoutMs(15_000)
})

afterAll(async () => {
  setMcpElicitationTimeoutMs(null)
  await fixture?.close()
  await custom?.close()
})

// ─── Seeding ─────────────────────────────────────────────────────

let workspaceId: string
let projectId: string

interface McpCallSeed {
  capabilityTab?: 'tools' | 'resources' | 'prompts'
  selectedTool?: string | null
  toolArgs?: string
  selectedResourceUri?: string | null
  resourceUriDraft?: string
  selectedPrompt?: string | null
  promptArgs?: Record<string, string>
}

interface McpSeed {
  name?: string
  url: string
  transport?: 'http' | 'sse' | 'stdio'
  protocol?: string
  auth?: Record<string, unknown>
  customHeaders?: Array<{ id: string; key: string; value: string; enabled: boolean }>
  call: McpCallSeed
  preScript?: string
  postScript?: string
  assertions?: Array<Record<string, unknown>>
  /** Request timeout (ms) — the `timeout` HTTP rows read too. */
  timeout?: number
}

/** The `request_schema` an MCP endpoint row carries after Ctrl+S (save-active-request.ts). */
function mcpSchema(opts: McpSeed): Record<string, unknown> {
  return {
    url: opts.url,
    method: 'GET',
    params: [],
    headers: [],
    body: { type: 'none' },
    auth: { type: 'none' },
    preScript: opts.preScript,
    postScript: opts.postScript,
    assertions: opts.assertions ?? [],
    ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
    metadata: {
      mcp: {
        transport: opts.transport ?? 'http',
        url: opts.url,
        customHeaders: opts.customHeaders ?? [],
        envVars: [],
        auth: opts.auth ?? { type: 'none' },
        protocol: opts.protocol ?? 'auto',
        call: opts.call,
      },
    },
  }
}

function seedMcpEndpoint(opts: McpSeed): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints
        (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 'mcp', 'GET', ?, 'developing', ?, 0, ?, ?)`,
    )
    .run(id, projectId, opts.name ?? 'MCP', opts.url, JSON.stringify(mcpSchema(opts)), now, now)
  return id
}

function seedMcpSuiteItem(opts: McpSeed): string {
  const suiteId = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, 'Suite', 0, ?, ?)`,
    )
    .run(suiteId, projectId, now, now)
  const { assertions, ...schema } = mcpSchema(opts)
  const id = crypto.randomUUID()
  testDb
    .prepare(
      `INSERT INTO test_suite_items
         (id, suite_id, folder_id, protocol, name, method, url, request_schema, assertions,
          source_endpoint_id, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'mcp', ?, 'GET', ?, ?, ?, NULL, 0, ?, ?)`,
    )
    .run(
      id,
      suiteId,
      opts.name ?? 'Suite MCP',
      opts.url,
      JSON.stringify(schema),
      JSON.stringify(assertions ?? []),
      now,
      now,
    )
  return id
}

function seedActiveEnv(vars: Record<string, string>): void {
  const envId = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO environments (id, workspace_id, project_id, name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 'Vars', 1, ?, ?)`,
    )
    .run(envId, workspaceId, projectId, now, now)
  const ins = testDb.prepare(
    `INSERT INTO environment_variables (id, environment_id, key, value, enabled, initial_value)
     VALUES (?, ?, ?, ?, 1, ?)`,
  )
  // Initial value only — the importer shape `effectiveValue()` must fall back on.
  for (const [k, v] of Object.entries(vars)) ins.run(crypto.randomUUID(), envId, k, '', v)
}

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  registerRunnerHandlers()
})

afterEach(() => {
  testDb.close()
  // Every run connection is closed in `finally` — nothing may leak.
  expect(mcpConnectionIds()).toEqual([])
})

interface RunRow {
  endpointId: string
  endpointName: string
  method: string
  status: number | null
  statusText: string
  url: string
  duration: number
  passed: number
  failed: number
  skipped: number
  error?: string
  responseBody?: string
  responseSize?: number
  requestBody?: string
  assertions: Array<{ name: string; passed: boolean; error?: string }>
}

interface ExecResult {
  success: boolean
  error?: string
  data?: {
    passedEndpoints: number
    failedEndpoints: number
    results: RunRow[]
    envUpdates?: Record<string, string>
  }
}

async function run(options: Record<string, unknown>): Promise<ExecResult> {
  return (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    ...options,
  })) as ExecResult
}

const passedRow = (r: RunRow): boolean => r.status !== null && !r.error && r.failed === 0

// ─── (a) echo + pm.test + assertion rows ─────────────────────────

describe('Runner — MCP tool call (issue #161)', () => {
  it('calls the saved tool with {{var}}-resolved args; pm.test + assertion rows pass', async () => {
    seedActiveEnv({ mcpUrl: fixture.url, greeting: 'hello mcp' })
    const id = seedMcpEndpoint({
      name: 'Echo',
      url: '{{mcpUrl}}',
      call: { capabilityTab: 'tools', selectedTool: 'echo', toolArgs: '{"text":"{{greeting}}"}' },
      postScript: [
        "pm.test('text body', () => pm.expect(pm.response.text()).to.eql('hello mcp'))",
        "pm.test('status 200', () => pm.response.to.have.status(200))",
        "pm.test('pm.mcp', () => {",
        "  pm.expect(pm.mcp.capability).to.eql('tool')",
        "  pm.expect(pm.mcp.name).to.eql('echo')",
        '  pm.expect(pm.mcp.isError).to.eql(false)',
        "  pm.expect(pm.mcp.content[0].text).to.eql('hello mcp')",
        '})',
      ].join('\n'),
      assertions: [
        { id: 'a1', name: 'Status is 200', type: 'status_equals', enabled: true, expected: 200 },
        {
          id: 'a2',
          name: 'Body has greeting',
          type: 'body_contains',
          enabled: true,
          expected: '{{greeting}}',
        },
      ],
    })

    const res = await run({ endpointIds: [id] })
    expect(res.success).toBe(true)
    const row = res.data!.results[0]
    expect(row.statusText).not.toBe('UNSUPPORTED')
    expect(row.error).toBeUndefined()
    expect(row.status).toBe(200)
    expect(row.statusText).toBe('OK')
    expect(row.method).toBe('MCP')
    expect(row.url).toBe(fixture.url)
    expect(row.responseBody).toBe('hello mcp')
    expect(row.responseSize).toBeGreaterThan(0)
    expect(row.requestBody).toContain('echo')
    expect(row.assertions.map((a) => [a.name, a.passed])).toEqual([
      ['Status is 200', true],
      ['Body has greeting', true],
      ['text body', true],
      ['status 200', true],
      ['pm.mcp', true],
    ])
    expect(res.data!.passedEndpoints).toBe(1)
    expect(res.data!.failedEndpoints).toBe(0)
  })

  it('structuredContent → JSON body: pm.response.json() works', async () => {
    const id = seedMcpEndpoint({
      url: custom.url,
      call: { capabilityTab: 'tools', selectedTool: 'sum', toolArgs: '{"a": 2, "b": 3}' },
      postScript: [
        "pm.test('json', () => pm.expect(pm.response.json().sum).to.eql(5))",
        "pm.test('structured', () => pm.expect(pm.mcp.structuredContent).to.eql({ sum: 5 }))",
        "pm.test('ct', () => pm.expect(pm.response.headers.get('content-type')).to.eql('application/json'))",
      ].join('\n'),
      assertions: [
        {
          id: 'j1',
          name: 'jsonpath sum',
          type: 'body_jsonpath',
          enabled: true,
          jsonPath: '$.sum',
          expected: '5',
        },
      ],
    })
    const res = await run({ endpointIds: [id] })
    const row = res.data!.results[0]
    expect(row.error).toBeUndefined()
    expect(JSON.parse(row.responseBody ?? '')).toEqual({ sum: 5 })
    expect(row.assertions.every((a) => a.passed)).toBe(true)
    expect(row.assertions).toHaveLength(4)
  })

  it('a {{var}} in a number field is sent as a number (schema coercion, Send parity)', async () => {
    // Send's `prepareToolArgs` turns the resolved "5" back into 5 per the
    // tool's inputSchema; Run used to send the string and the server's
    // `z.number()` rejected it.
    seedActiveEnv({ n: '5' })
    const id = seedMcpEndpoint({
      url: custom.url,
      call: { capabilityTab: 'tools', selectedTool: 'sum', toolArgs: '{"a": "{{n}}", "b": 2}' },
      postScript: "pm.test('sum', () => pm.expect(pm.mcp.structuredContent).to.eql({ sum: 7 }))",
    })
    const row = (await run({ endpointIds: [id] })).data!.results[0]
    expect(row.error).toBeUndefined()
    expect(row.status).toBe(200)
    expect(JSON.parse(row.responseBody ?? '')).toEqual({ sum: 7 })
    expect(row.assertions).toEqual([{ name: 'sum', passed: true }])
    // The stored JSON-RPC view shows what went on the wire: a number.
    expect(JSON.parse(row.requestBody ?? '{}').params.arguments).toEqual({ a: 5, b: 2 })
  })

  it('a credential query value in the server URL is masked in the row (Send History rule)', async () => {
    seedActiveEnv({ key: 'k-77' })
    const id = seedMcpEndpoint({
      url: `${fixture.url}?api_key={{key}}`,
      call: { capabilityTab: 'tools', selectedTool: 'echo', toolArgs: '{"text":"q"}' },
    })
    const row = (await run({ endpointIds: [id] })).data!.results[0]
    expect(row.responseBody).toBe('q')
    expect(row.url).toBe(`${fixture.url}?api_key=***`)
    expect(row.url).not.toContain('k-77')
  })

  it('writes a restorable History row per MCP step (same scope ids as HTTP run rows)', async () => {
    seedActiveEnv({ key: 'k-9' })
    const tool = seedMcpEndpoint({
      name: 'Hist tool',
      url: fixture.url,
      call: {
        capabilityTab: 'tools',
        selectedTool: 'echo',
        toolArgs: '{"text":"hist","api_key":"{{key}}"}',
      },
    })
    const resource = seedMcpEndpoint({
      url: fixture.url,
      call: { capabilityTab: 'resources', resourceUriDraft: 'test://greeting' },
    })
    const prompt = seedMcpEndpoint({
      url: fixture.url,
      call: { capabilityTab: 'prompts', selectedPrompt: 'summarize', promptArgs: { text: 'x' } },
    })
    await run({ endpointIds: [tool, resource, prompt] })
    const rows = testDb
      .prepare(
        `SELECT workspace_id, project_id, endpoint_id, protocol, method, url, status_code,
                request_snapshot, response_snapshot
           FROM history ORDER BY executed_at, rowid`,
      )
      .all() as Array<Record<string, string | number | null>>
    expect(rows.map((r) => [r.endpoint_id, r.protocol, r.method, r.status_code])).toEqual([
      [tool, 'mcp', 'CALL_TOOL', 0],
      [resource, 'mcp', 'READ_RESOURCE', 0],
      [prompt, 'mcp', 'GET_PROMPT', 0],
    ])
    for (const r of rows) {
      expect(r.workspace_id).toBe(workspaceId)
      expect(r.project_id).toBe(projectId)
      expect(r.url).toBe(fixture.url)
    }
    const snap = (i: number) => JSON.parse(String(rows[i].request_snapshot)).mcp
    // Same `{ mcp }` shape Send's History stores (mcp.handler.ts), secrets masked.
    expect(snap(0)).toEqual({
      transport: 'http',
      url: fixture.url,
      protocol: 'auto',
      capability: 'tool',
      name: 'echo',
      args: { text: 'hist', api_key: '••••••' },
    })
    expect(snap(1)).toEqual({
      transport: 'http',
      url: fixture.url,
      protocol: 'auto',
      capability: 'resource',
      uri: 'test://greeting',
    })
    expect(snap(2)).toMatchObject({ capability: 'prompt', name: 'summarize', args: { text: 'x' } })
    expect(JSON.parse(String(rows[0].response_snapshot)).content[0].text).toBe('hist')
  })

  // ─── (b) chaining ──────────────────────────────────────────────

  it('pm.environment.set from tool 1 feeds {{var}} in tool 2 args (chaining)', async () => {
    const first = seedMcpEndpoint({
      name: 'Mint',
      url: fixture.url,
      call: { capabilityTab: 'tools', selectedTool: 'echo', toolArgs: '{"text":"token-123"}' },
      postScript: "pm.environment.set('tok', pm.response.text())",
    })
    const second = seedMcpEndpoint({
      name: 'Use',
      url: fixture.url,
      call: { capabilityTab: 'tools', selectedTool: 'echo', toolArgs: '{"text":"got {{tok}}"}' },
      postScript: "pm.test('chained', () => pm.expect(pm.response.text()).to.eql('got token-123'))",
    })
    const res = await run({ endpointIds: [first, second], keepVariableValues: false })
    const [r1, r2] = res.data!.results
    expect(passedRow(r1)).toBe(true)
    expect(r2.responseBody).toBe('got token-123')
    expect(r2.assertions).toEqual([{ name: 'chained', passed: true }])
    expect(res.data!.passedEndpoints).toBe(2)
  })

  it('a pre-request script variable resolves in the args of the same row', async () => {
    const id = seedMcpEndpoint({
      url: fixture.url,
      preScript: "pm.variables.set('n', '41')",
      call: { capabilityTab: 'tools', selectedTool: 'add', toolArgs: '{"a": {{n}}, "b": 1}' },
      postScript: "pm.test('sum', () => pm.expect(pm.response.text()).to.eql('42'))",
    })
    const row = (await run({ endpointIds: [id] })).data!.results[0]
    expect(row.error).toBeUndefined()
    expect(row.assertions).toEqual([{ name: 'sum', passed: true }])
  })

  // ─── (c) isError ───────────────────────────────────────────────

  it('a tool isError result FAILS without assertions (status 500)', async () => {
    const id = seedMcpEndpoint({
      url: custom.url,
      call: { capabilityTab: 'tools', selectedTool: 'fail', toolArgs: '{}' },
    })
    const res = await run({ endpointIds: [id] })
    const row = res.data!.results[0]
    expect(row.status).toBe(500)
    expect(row.statusText).toBe('Tool Error')
    expect(row.responseBody).toBe('tool blew up')
    expect(res.data!.failedEndpoints).toBe(1)
    expect(res.data!.passedEndpoints).toBe(0)
  })

  it('a tool isError result PASSES with an assertion that expects it (pm.mcp.isError)', async () => {
    const id = seedMcpEndpoint({
      url: custom.url,
      call: { capabilityTab: 'tools', selectedTool: 'fail', toolArgs: '{}' },
      postScript: "pm.test('expected tool error', () => pm.expect(pm.mcp.isError).to.eql(true))",
    })
    const res = await run({ endpointIds: [id] })
    expect(res.data!.results[0].assertions).toEqual([{ name: 'expected tool error', passed: true }])
    expect(res.data!.passedEndpoints).toBe(1)
    expect(res.data!.failedEndpoints).toBe(0)
  })

  // ─── (d) unreachable server ────────────────────────────────────

  it('an unreachable server fails its row with a message and the run continues', async () => {
    const dead = `http://127.0.0.1:${await freePort()}/mcp`
    const bad = seedMcpEndpoint({
      name: 'Dead',
      url: dead,
      call: { capabilityTab: 'tools', selectedTool: 'echo', toolArgs: '{}' },
    })
    const good = seedMcpEndpoint({
      name: 'Alive',
      url: fixture.url,
      call: { capabilityTab: 'tools', selectedTool: 'echo', toolArgs: '{"text":"ok"}' },
    })
    const res = await run({ endpointIds: [bad, good] })
    const [r1, r2] = res.data!.results
    expect(r1.status).toBeNull()
    expect(r1.error).toBeTruthy()
    expect(r1.method).toBe('MCP')
    expect(passedRow(r2)).toBe(true)
    expect(res.data!.failedEndpoints).toBe(1)
    expect(res.data!.passedEndpoints).toBe(1)
  })

  it('stopOnError halts after a failed MCP row', async () => {
    const dead = `http://127.0.0.1:${await freePort()}/mcp`
    const bad = seedMcpEndpoint({
      url: dead,
      call: { capabilityTab: 'tools', selectedTool: 'echo', toolArgs: '{}' },
    })
    const good = seedMcpEndpoint({
      url: fixture.url,
      call: { capabilityTab: 'tools', selectedTool: 'echo', toolArgs: '{}' },
    })
    const res = await run({ endpointIds: [bad, good], stopOnError: true })
    const ran = res.data!.results.filter((r) => r.statusText !== 'NOT_RUN')
    expect(ran).toHaveLength(1)
    expect(res.data!.passedEndpoints).toBe(0)
  })

  // ─── Interactive requests ──────────────────────────────────────

  it('input_required (2026-07-28) fails the row: runs cannot answer interactive requests', async () => {
    const id = seedMcpEndpoint({
      url: fixture.url,
      call: { capabilityTab: 'tools', selectedTool: 'ask_count', toolArgs: '{}' },
    })
    const row = (await run({ endpointIds: [id] })).data!.results[0]
    expect(row.error).toBe('The server asked for input; runs cannot answer interactive requests.')
  })

  it('a 2025-era elicitation/create fails the row at once (no 10-minute wait)', async () => {
    // Stateful 2025 server whose tool asks the client via `elicitation/create`.
    const v1 = await startV1Server((server) => {
      server.registerTool(
        'ask_name',
        { description: 'asks', inputSchema: {} },
        async (_a, extra) => {
          const r = await server.server.elicitInput(
            {
              message: 'What is your name?',
              requestedSchema: {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
            },
            { relatedRequestId: extra.requestId },
          )
          return { content: [{ type: 'text', text: `action:${r.action}` }] }
        },
      )
    })
    try {
      const id = seedMcpEndpoint({
        url: v1.url,
        protocol: 'legacy',
        call: { capabilityTab: 'tools', selectedTool: 'ask_name', toolArgs: '{}' },
      })
      const started = Date.now()
      const row = (await run({ endpointIds: [id] })).data!.results[0]
      expect(Date.now() - started).toBeLessThan(10_000)
      expect(row.error).toBe('The server asked for input; runs cannot answer interactive requests.')
      expect(row.status).toBeNull()
    } finally {
      await v1.close()
    }
  })

  it('"Stop now" aborts the MCP call on the wire: the row is CANCELLED, not failed', async () => {
    const id = seedMcpEndpoint({
      url: custom.url,
      call: { capabilityTab: 'tools', selectedTool: 'slow', toolArgs: '{}' },
    })
    const started = Date.now()
    const pending = run({ endpointIds: [id] })
    setTimeout(() => void harness.invoke('runner:stop', { mode: 'direct' }), 300)
    const res = await pending
    expect(Date.now() - started).toBeLessThan(4_000)
    const row = res.data!.results[0]
    expect(row.statusText).toBe('CANCELLED')
    expect(row.skipped).toBe(1)
    expect(res.data!.failedEndpoints).toBe(0)
  })

  it('review item 9: the row\'s request timeout bounds the MCP call (not a fixed 120 s)', async () => {
    const id = seedMcpEndpoint({
      url: custom.url,
      timeout: 300,
      call: { capabilityTab: 'tools', selectedTool: 'slow', toolArgs: '{}' },
    })
    const started = Date.now()
    const row = (await run({ endpointIds: [id] })).data!.results[0]
    expect(Date.now() - started).toBeLessThan(4_000)
    expect(row.error).toMatch(/timed out after 300 ms/)
  })

  it('credential-named args are masked in the persisted request body, not on the wire', async () => {
    seedActiveEnv({ key: 'k-123' })
    const id = seedMcpEndpoint({
      url: fixture.url,
      call: {
        capabilityTab: 'tools',
        selectedTool: 'echo',
        toolArgs: '{"text":"{{key}}","api_key":"{{key}}"}',
      },
    })
    const row = (await run({ endpointIds: [id] })).data!.results[0]
    // The server got the real value (echo returns `text`)…
    expect(row.responseBody).toBe('k-123')
    // …the stored JSON-RPC view masks the credential-named arg only.
    const body = JSON.parse(row.requestBody ?? '{}')
    expect(body).toEqual({
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'k-123', api_key: '***' } },
    })
  })

  it('args that break once variables resolve are a plain failure (trips stopOnError)', async () => {
    const bad = seedMcpEndpoint({
      url: fixture.url,
      call: { capabilityTab: 'tools', selectedTool: 'add', toolArgs: '{"a": {{missing}}}' },
    })
    const next = seedMcpEndpoint({
      url: fixture.url,
      call: { capabilityTab: 'tools', selectedTool: 'echo', toolArgs: '{}' },
    })
    const res = await run({ endpointIds: [bad, next], stopOnError: true })
    expect(res.data!.results[0].error).toMatch(/not valid JSON/)
    expect(res.data!.results.filter((r) => r.statusText !== 'NOT_RUN')).toHaveLength(1)
  })

  it('the HTML report lists the MCP row (method MCP + server URL)', async () => {
    const id = seedMcpEndpoint({
      name: 'Echo report',
      url: fixture.url,
      call: { capabilityTab: 'tools', selectedTool: 'echo', toolArgs: '{}' },
    })
    const res = await run({ endpointIds: [id] })
    const html = (await harness.invoke('runner:export', {
      results: res.data!.results,
      format: 'html',
    })) as { success: boolean; data: string }
    expect(html.success).toBe(true)
    expect(html.data).toContain('>MCP<')
    expect(html.data).toContain(fixture.url)
  })

  it('saved OAuth 2.1 auth fails the row with a clear message', async () => {
    const id = seedMcpEndpoint({
      url: fixture.url,
      auth: { type: 'oauth2' },
      call: { capabilityTab: 'tools', selectedTool: 'echo', toolArgs: '{}' },
    })
    const row = (await run({ endpointIds: [id] })).data!.results[0]
    expect(row.error).toBe(
      'OAuth 2.1 requires an interactive sign-in; use Bearer with a token variable in runs',
    )
    expect(row.status).toBeNull()
  })

  it('a row with no tool selected is a configuration failure, not a crash', async () => {
    const id = seedMcpEndpoint({ url: fixture.url, call: { capabilityTab: 'tools' } })
    const row = (await run({ endpointIds: [id] })).data!.results[0]
    expect(row.error).toMatch(/no tool selected/i)
  })

  it('bearer auth with a {{token}} variable reaches the server', async () => {
    seedActiveEnv({ tok: 's3cret' })
    const id = seedMcpEndpoint({
      url: fixture.url,
      auth: { type: 'bearer', bearer: { token: '{{tok}}' } },
      customHeaders: [{ id: 'h1', key: 'X-Trace', value: 'run-{{tok}}', enabled: true }],
      call: { capabilityTab: 'tools', selectedTool: 'echo_headers', toolArgs: '{}' },
      postScript: [
        'const h = JSON.parse(pm.response.text())',
        "pm.test('auth', () => pm.expect(h.authorization).to.eql('Bearer s3cret'))",
        "pm.test('custom', () => pm.expect(h['x-trace']).to.eql('run-s3cret'))",
      ].join('\n'),
    })
    const row = (await run({ endpointIds: [id] })).data!.results[0]
    expect(row.error).toBeUndefined()
    expect(row.assertions.every((a) => a.passed)).toBe(true)
  })
})

// ─── Resources + prompts ─────────────────────────────────────────

describe('Runner — MCP resources and prompts', () => {
  it('reads the saved resource URI; body = the text contents', async () => {
    const id = seedMcpEndpoint({
      url: fixture.url,
      call: {
        capabilityTab: 'resources',
        selectedResourceUri: 'test://greeting',
        resourceUriDraft: 'test://greeting',
      },
      postScript: [
        "pm.test('text', () => pm.expect(pm.response.text()).to.eql('Hello from Testnizer'))",
        "pm.test('mcp', () => pm.expect(pm.mcp.capability).to.eql('resource'))",
      ].join('\n'),
    })
    const row = (await run({ endpointIds: [id] })).data!.results[0]
    expect(row.error).toBeUndefined()
    expect(row.status).toBe(200)
    expect(row.assertions.every((a) => a.passed)).toBe(true)
  })

  it('templated resource with a {{var}} id', async () => {
    seedActiveEnv({ itemId: '7' })
    const id = seedMcpEndpoint({
      url: fixture.url,
      call: { capabilityTab: 'resources', resourceUriDraft: 'test://item/{{itemId}}' },
      postScript: "pm.test('id', () => pm.expect(JSON.parse(pm.response.text()).id).to.eql('7'))",
    })
    const row = (await run({ endpointIds: [id] })).data!.results[0]
    expect(row.error).toBeUndefined()
    expect(row.assertions).toEqual([{ name: 'id', passed: true }])
  })

  it('gets the saved prompt; body = JSON of messages', async () => {
    const id = seedMcpEndpoint({
      url: fixture.url,
      call: { capabilityTab: 'prompts', selectedPrompt: 'summarize', promptArgs: { text: 'abc' } },
      postScript: [
        "pm.test('messages', () => pm.expect(pm.response.json()[0].content.text).to.contain('abc'))",
        "pm.test('mcp', () => pm.expect(pm.mcp.name).to.eql('summarize'))",
      ].join('\n'),
    })
    const row = (await run({ endpointIds: [id] })).data!.results[0]
    expect(row.error).toBeUndefined()
    expect(row.assertions.every((a) => a.passed)).toBe(true)
  })
})

// ─── (e) Test Suite item ─────────────────────────────────────────

describe('Test Suite — MCP item runs through the same step', () => {
  it('a suite item with an MCP request runs and scores its assertions', async () => {
    const id = seedMcpSuiteItem({
      url: fixture.url,
      call: { capabilityTab: 'tools', selectedTool: 'add', toolArgs: '{"a": 1, "b": 2}' },
      assertions: [
        { id: 's1', name: 'Body is 3', type: 'body_contains', enabled: true, expected: '3' },
      ],
    })
    const res = await run({ endpointIds: [id] })
    const row = res.data!.results[0]
    expect(row.statusText).toBe('OK')
    expect(row.assertions).toEqual([expect.objectContaining({ name: 'Body is 3', passed: true })])
    expect(res.data!.passedEndpoints).toBe(1)
  })
})

describe('Scheduler — MCP endpoint runs through the same step', () => {
  it('a scheduled run executes the MCP call and scores it', async () => {
    const id = seedMcpEndpoint({
      url: fixture.url,
      call: { capabilityTab: 'tools', selectedTool: 'echo', toolArgs: '{"text":"cron"}' },
      postScript: "pm.test('cron', () => pm.expect(pm.response.text()).to.eql('cron'))",
    })
    const report = await executeCollectionForScheduler({
      projectId,
      workspaceId,
      endpointIds: [id],
    })
    expect(report.results[0].method).toBe('MCP')
    expect(report.results[0].assertions).toEqual([{ name: 'cron', passed: true }])
    expect(report.passedEndpoints).toBe(1)
  })
})

describe('other non-HTTP protocols stay UNSUPPORTED', () => {
  it('websocket rows are still skipped as UNSUPPORTED', async () => {
    const id = crypto.randomUUID()
    const now = Date.now()
    testDb
      .prepare(
        `INSERT INTO endpoints
          (id, project_id, folder_id, name, protocol, method, path, status,
           request_schema, sort_order, created_at, updated_at)
         VALUES (?, ?, NULL, 'WS', 'websocket', 'GET', 'ws://x', 'developing', '{}', 0, ?, ?)`,
      )
      .run(id, projectId, now, now)
    const row = (await run({ endpointIds: [id] })).data!.results[0]
    expect(row.statusText).toBe('UNSUPPORTED')
  })
})
