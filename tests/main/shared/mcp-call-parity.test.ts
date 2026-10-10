/**
 * Send ≡ Run for the MCP REQUEST (P-T parity, `src/shared/mcp-call.ts`).
 *
 * The same saved row (`endpoints.request_schema.metadata.mcp`) + the same
 * variables go through BOTH entries:
 *  - Send: what the tab does — restore the row the way `save-active-request`
 *    does (`readSavedMcpCall`, `normalizeMcpAuth`, `normalizeMcpProtocol`),
 *    then `mcp-send-request.ts` (`sendConnectParams`, `sendToolCall` with the
 *    tool's schema, `sendResourceUri`, `sendPromptCall`) over the renderer's
 *    `resolveVariables`;
 *  - Run: `runner.handler.ts` `readSavedMcpRequest` + `mcpRunRequest` over
 *    main's `resolveVariables`, then the engine's step — `applyToolSchema`
 *    with the listed tool's schema (what `mcpCallOnce` does on the wire).
 * Connect options and JSON-RPC params must come out identical — tool,
 * resource, prompt; http and stdio; a `{{n}}` in a number field included.
 */
import { describe, expect, it, vi } from 'vitest'
import { makeElectronMock } from '../handlers/helpers'

vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
}))
vi.mock('../../../src/main/db/database', () => ({ getDb: () => null }))

const { readSavedMcpRequest, mcpRunRequest } = await import('../../../src/main/ipc/runner.handler')
const { applyToolSchema, mcpJsonRpc } = await import('../../../src/shared/mcp-call')
const { readSavedMcpCall, savedCallDefaults } =
  await import('../../../src/renderer/stores/mcp-call.slice')
const { normalizeMcpAuth } = await import('../../../src/renderer/stores/mcp-auth.slice')
const { normalizeMcpProtocol } = await import('../../../src/renderer/lib/mcp-protocol')
const { sendConnectParams, sendPromptCall, sendResourceUri, sendToolCall } =
  await import('../../../src/renderer/lib/mcp-send-request')

type Row = Parameters<typeof readSavedMcpRequest>[0]

const VARS: Record<string, string> = {
  base: 'https://mcp.example.test',
  n: '5',
  yes: 'true',
  name: 'Ada',
  tok: 's3cret',
  id: '42',
  dir: '/My Docs',
}

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    a: { type: 'number' },
    b: { type: 'integer' },
    flag: { type: 'boolean' },
    text: { type: 'string' },
    nested: { type: 'object', properties: { count: { type: ['integer', 'null'] } } },
  },
  required: ['a'],
}

const HEADERS = [
  { id: 'h1', key: 'X-Trace', value: 'run-{{name}}', enabled: true },
  { id: 'h2', key: 'X-Off', value: 'nope', enabled: false },
  { id: 'h3', key: '  ', value: 'blank key', enabled: true },
  { id: 'h4', key: 'X-{{name}}', value: '{{tok}}', enabled: true },
]

function row(mcp: Record<string, unknown>): Row {
  return {
    id: 'ep-1',
    name: 'MCP',
    protocol: 'mcp',
    method: 'GET',
    path: String(mcp.url ?? ''),
    request_schema: JSON.stringify({ metadata: { mcp } }),
  } as unknown as Row
}

/** Send: restore the saved row into tab state, then the tab's Send entry. */
function sendSide(mcp: Record<string, unknown>) {
  const call = { ...savedCallDefaults(), ...readSavedMcpCall(mcp.call) }
  const kv = (v: unknown) => (Array.isArray(v) ? v : [])
  const connect = sendConnectParams(
    {
      transport: (mcp.transport as 'http' | 'sse' | 'stdio') ?? 'http',
      url: String(mcp.url ?? ''),
      customHeaders: kv(mcp.customHeaders),
      envVars: kv(mcp.envVars),
      auth: normalizeMcpAuth(mcp.auth),
      protocol: normalizeMcpProtocol(mcp.protocol),
    },
    VARS,
  )
  let rpc: ReturnType<typeof mcpJsonRpc>
  if (call.capabilityTab === 'resources') {
    const r = sendResourceUri(call.resourceUriDraft, VARS)
    if (r.error) throw new Error(r.error)
    rpc = mcpJsonRpc({ capability: 'resource', uri: r.uri })
  } else if (call.capabilityTab === 'prompts') {
    rpc = mcpJsonRpc(sendPromptCall(call.selectedPrompt ?? '', call.promptArgs, VARS))
  } else {
    const t = sendToolCall(call.selectedTool ?? '', call.toolArgs, VARS, TOOL_SCHEMA)
    if (t.error) throw new Error(t.error)
    rpc = mcpJsonRpc(t.call)
  }
  return { connect, rpc }
}

/** Run: the runner's reader + entry, then the engine's schema step. */
function runSide(mcp: Record<string, unknown>) {
  const { connect, call } = mcpRunRequest(readSavedMcpRequest(row(mcp)), VARS)
  if (call.problem) throw new Error(call.problem)
  const c = call.call
  const sent =
    c.capability === 'tool' ? { ...c, args: applyToolSchema(c.args, c.rawArgs, TOOL_SCHEMA) } : c
  return { connect, rpc: mcpJsonRpc(sent) }
}

const HTTP = {
  transport: 'http',
  url: '{{base}}/mcp',
  customHeaders: HEADERS,
  envVars: [{ id: 'e1', key: 'IGNORED', value: 'x', enabled: true }],
  auth: { type: 'bearer', bearer: { token: '{{tok}}', prefix: '' } },
  protocol: ' 2025-06-18 ',
}

const STDIO = {
  transport: 'stdio',
  url: ' npx -y "@scope/server" --dir "{{dir}}/{{name}}" C:\\srv\\{{id}}.js ',
  customHeaders: HEADERS,
  envVars: [
    { id: 'e1', key: 'API_TOKEN', value: '{{tok}}', enabled: true },
    { id: 'e2', key: 'OFF', value: 'x', enabled: false },
  ],
  auth: { type: 'basic', basic: { username: 'u', password: '{{tok}}' } },
  protocol: 'bogus',
}

const TOOL_CALL = {
  capabilityTab: 'tools',
  selectedTool: 'calc',
  toolArgs:
    '{"a": "{{n}}", "b": "{{n}}", "flag": "{{yes}}", "text": "hi {{name}}", "nested": {"count": "{{id}}"}, "extra": "{{n}}"}',
}
/** Unquoted placeholders: the raw text is not JSON, so nothing is coerced — on both paths. */
const UNQUOTED_TOOL_CALL = {
  capabilityTab: 'tools',
  selectedTool: 'calc',
  toolArgs: '{"a": {{n}}, "text": "{{n}}"}',
}
const RESOURCE_CALL = {
  capabilityTab: 'resources',
  selectedResourceUri: 'test://item/{id}',
  resourceUriDraft: '  test://item/{{id}}?who={{name}} ',
}
const PROMPT_CALL = {
  capabilityTab: 'prompts',
  selectedPrompt: 'summarize',
  promptArgs: { text: 'by {{name}}', empty: '', count: '{{n}}' },
}

describe('MCP request parity — Send ≡ Run (src/shared/mcp-call.ts)', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['http · tool', { ...HTTP, call: TOOL_CALL }],
    ['http · resource', { ...HTTP, call: RESOURCE_CALL }],
    ['http · prompt', { ...HTTP, call: PROMPT_CALL }],
    ['http · tool, unquoted {{var}}', { ...HTTP, call: UNQUOTED_TOOL_CALL }],
    ['stdio · tool', { ...STDIO, call: TOOL_CALL }],
    ['stdio · resource', { ...STDIO, call: RESOURCE_CALL }],
    ['stdio · prompt', { ...STDIO, call: PROMPT_CALL }],
    [
      'http · api-key in query, legacy protocol',
      {
        ...HTTP,
        protocol: 'legacy',
        auth: { type: 'api-key', apiKey: { key: 'api_key', value: '{{tok}}', in: 'query' } },
        call: TOOL_CALL,
      },
    ],
  ]
  for (const [name, mcp] of cases) {
    it(name, () => {
      const send = sendSide(mcp)
      const run = runSide(mcp)
      expect(run.connect).toEqual(send.connect)
      expect(run.rpc).toEqual(send.rpc)
    })
  }

  it('pins the resolved values (not just "both equally wrong")', () => {
    const tool = runSide({ ...HTTP, call: TOOL_CALL })
    // `{{n}}` in a number / integer field → 5 (number), `{{yes}}` in a boolean → true, nested nullable integer → 42, a key the
    // schema does not know stays text.
    expect(tool.rpc).toEqual({
      method: 'tools/call',
      params: {
        name: 'calc',
        arguments: { a: 5, b: 5, flag: true, text: 'hi Ada', nested: { count: 42 }, extra: '5' },
      },
    })
    expect(runSide({ ...HTTP, call: UNQUOTED_TOOL_CALL }).rpc.params.arguments).toEqual({
      a: 5,
      text: '5',
    })
    expect(tool.connect).toEqual({
      transport: 'http',
      url: 'https://mcp.example.test/mcp',
      protocol: '2025-06-18',
      headers: { 'X-Trace': 'run-Ada', 'X-Ada': 's3cret' },
      auth: { type: 'bearer', bearer: { token: 's3cret' } },
    })
    const stdio = runSide({ ...STDIO, call: RESOURCE_CALL })
    expect(stdio.connect).toEqual({
      transport: 'stdio',
      url: 'npx -y "@scope/server" --dir "/My Docs/Ada" C:\\srv\\42.js',
      protocol: 'auto',
      command: 'npx',
      args: ['-y', '@scope/server', '--dir', '/My Docs/Ada', 'C:\\srv\\42.js'],
      env: { API_TOKEN: 's3cret' },
    })
    expect(stdio.rpc).toEqual({
      method: 'resources/read',
      params: { uri: 'test://item/42?who=Ada' },
    })
    expect(runSide({ ...HTTP, call: PROMPT_CALL }).rpc).toEqual({
      method: 'prompts/get',
      params: { name: 'summarize', arguments: { text: 'by Ada', count: '5' } },
    })
  })
})
