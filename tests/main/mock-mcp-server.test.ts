/**
 * Mock MCP server (issue #140, v2 SDK / both protocol eras — issue #152) —
 * REAL round trips, no SDK mocks, and no dependency on the app's own client
 * engine (`mcp.engine.ts` migrates separately).
 *
 * Clients:
 *   - the v2 `Client` from `@modelcontextprotocol/client` in `auto` mode
 *     (probes `server/discover` → 2026-07-28 "modern" era) and in `legacy`
 *     mode (plain `initialize`);
 *   - the v1 `Client` from `@modelcontextprotocol/sdk` — a real 2025-era
 *     client — over Streamable HTTP and legacy HTTP+SSE.
 */

import { afterEach, describe, expect, it } from 'vitest'
import net from 'node:net'
import {
  Client as V2Client,
  StreamableHTTPClientTransport as V2HttpTransport,
  isInputRequiredResult,
  ProtocolError,
} from '@modelcontextprotocol/client'
import { Client as V1Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport as V1HttpTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport as V1SseTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import {
  ErrorCode,
  LATEST_PROTOCOL_VERSION,
  McpError,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { exampleElicitationTool } from '../../src/main/mock-mcp/config'
import { mockMcpServerManager } from '../../src/main/mock-mcp/server'
import type { MockMcpServerDef, MockMcpServerState } from '../../src/main/mock-mcp/types'

const MODERN = '2026-07-28'

const COMPLEX_SCHEMA = {
  properties: {
    city: { type: 'string', minLength: 2, description: 'City name' },
    units: { enum: ['metric', 'imperial'] },
    when: {
      oneOf: [{ type: 'string', format: 'date' }, { $ref: '#/$defs/range' }],
    },
  },
  type: 'object',
  required: ['city'],
  additionalProperties: false,
  $defs: {
    range: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
  },
}

function baseDef(over: Partial<MockMcpServerDef> = {}): MockMcpServerDef {
  return {
    id: `srv-${Math.random().toString(36).slice(2)}`,
    name: 'Mock MCP Under Test',
    description: '',
    host: '127.0.0.1',
    port: 0,
    path: '/mcp',
    legacySse: false,
    authMode: 'none',
    bearerToken: '',
    latencyMs: 0,
    errorMode: { kind: 'none' },
    protocolPin: null,
    legacyMode: 'stateless',
    cacheTtlMs: 0,
    tools: [
      {
        name: 'echo',
        description: 'Echo',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
        response: { kind: 'template', body: 'echo: {{args.text}}' },
      },
      {
        name: 'plain',
        inputSchema: { type: 'object' },
        response: { kind: 'text', body: 'plain text answer' },
      },
      {
        name: 'weather',
        title: 'Weather',
        inputSchema: COMPLEX_SCHEMA,
        response: { kind: 'json', body: '{"tempC":21,"sky":"clear"}' },
      },
      {
        name: 'list',
        inputSchema: { type: 'object' },
        response: { kind: 'json', body: '[1,2,3]' },
      },
      {
        name: 'stamp',
        inputSchema: { type: 'object' },
        response: { kind: 'template', body: '{{uuid}}|{{now}}|{{tool}}' },
      },
      exampleElicitationTool(),
    ],
    resources: [
      { uri: 'docs://readme', name: 'Readme', mimeType: 'text/markdown', text: '# Hello {{x}}' },
      {
        uriTemplate: 'users://{id}/profile',
        name: 'User profile',
        mimeType: 'application/json',
        text: '{"id":"{{params.id}}"}',
      },
      { uri: 'bin://logo', name: 'Logo', mimeType: 'image/png', blob: 'iVBORw0KGgo=' },
    ],
    prompts: [
      {
        name: 'greet',
        description: 'Greets someone',
        arguments: [{ name: 'who', required: true }],
        messages: [
          { role: 'user', text: 'Say hello to {{args.who}}' },
          { role: 'assistant', text: 'Hello, {{args.who}}!' },
        ],
      },
    ],
    ...over,
  }
}

const TOOL_NAMES = ['echo', 'plain', 'weather', 'list', 'stamp', 'ask_name']

const started: string[] = []
const closers: (() => Promise<unknown>)[] = []

async function start(over: Partial<MockMcpServerDef> = {}): Promise<{
  def: MockMcpServerDef
  state: MockMcpServerState
  url: string
}> {
  const def = baseDef(over)
  const r = await mockMcpServerManager.start(def)
  if (!r.ok) throw new Error(r.error)
  started.push(def.id)
  return { def, state: r.state, url: r.state.url as string }
}

type ElicitAnswer = { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }

/** v2 client; `auto` probes server/discover (modern era), `legacy` runs initialize. */
async function v2(
  url: string,
  opts: {
    mode?: 'auto' | 'legacy'
    headers?: Record<string, string>
    elicit?: () => ElicitAnswer
  } = {},
): Promise<{ client: V2Client; transport: V2HttpTransport }> {
  const client = new V2Client(
    { name: 'mock-mcp-test-v2', version: '1.0.0' },
    {
      versionNegotiation: { mode: opts.mode ?? 'auto' },
      ...(opts.elicit ? { capabilities: { elicitation: {} } } : {}),
    },
  )
  if (opts.elicit) {
    const answer = opts.elicit
    client.setRequestHandler('elicitation/create', () => answer())
  }
  const transport = new V2HttpTransport(
    new URL(url),
    opts.headers ? { requestInit: { headers: opts.headers } } : undefined,
  )
  await client.connect(transport)
  closers.push(() => client.close())
  return { client, transport }
}

/** The real 2025-era client: `@modelcontextprotocol/sdk` 1.x over Streamable HTTP. */
async function v1(
  url: string,
  headers?: Record<string, string>,
): Promise<{ client: V1Client; transport: V1HttpTransport }> {
  const client = new V1Client({ name: 'mock-mcp-test-v1', version: '1.0.0' })
  const transport = new V1HttpTransport(
    new URL(url),
    headers ? { requestInit: { headers } } : undefined,
  )
  await client.connect(transport)
  closers.push(() => client.close())
  return { client, transport }
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? []
  return content.map((c) => c.text ?? '').join('')
}

const JSON_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
}

async function rawInitialize(
  url: string,
  protocolVersion: string,
): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion, capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
    }),
  })
  return { status: res.status, body: await res.text() }
}

/** A hand-built 2026-07-28 request (per-request `_meta` envelope + standard headers). */
async function rawModern(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'mcp-protocol-version': MODERN, 'mcp-method': method },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 42,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MODERN,
          'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  })
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

function logsOf(id: string) {
  return mockMcpServerManager.getLogs(id)
}

afterEach(async () => {
  for (const close of closers.splice(0)) await close().catch(() => {})
  for (const id of started.splice(0)) await mockMcpServerManager.stop(id)
})

// ─── 2026-07-28 (modern) — v2 client in auto mode ─────────────────

describe('Mock MCP server — 2026-07-28 era (v2 client, auto negotiation)', () => {
  it('negotiates 2026-07-28 via server/discover and serves tools with the authored schema byte-for-byte', async () => {
    const { def, state, url } = await start()
    expect(state).toMatchObject({
      status: 'running',
      url: `http://127.0.0.1:${state.port}/mcp`,
      eras: ['legacy', 'modern'],
      legacyNotifications: false,
    })

    const { client } = await v2(url)
    expect(client.getNegotiatedProtocolVersion()).toBe(MODERN)
    expect(client.getServerVersion()?.name).toBe(def.name)

    const tools = await client.listTools()
    expect(tools.tools.map((t) => t.name)).toEqual(TOOL_NAMES)
    // No zod round trip: $defs / $ref / oneOf / enum survive.
    expect(tools.tools.find((t) => t.name === 'weather')?.inputSchema).toEqual(COMPLEX_SCHEMA)
    // …and on the wire the authored key order is untouched (`properties` before `type`).
    const raw = await rawModern(url, 'tools/list')
    expect(JSON.stringify(raw.json)).toContain(JSON.stringify(COMPLEX_SCHEMA))

    const discover = logsOf(def.id).find((l) => l.method === 'server/discover')
    expect(discover).toMatchObject({
      ok: true,
      era: 'modern',
      transport: 'streamable-http',
      mcpMethod: 'server/discover',
    })
  })

  it('answers text / json (structuredContent) / template tools', async () => {
    const { url } = await start()
    const { client } = await v2(url)

    expect(textOf(await client.callTool({ name: 'plain', arguments: {} }))).toBe(
      'plain text answer',
    )
    expect(textOf(await client.callTool({ name: 'echo', arguments: { text: 'hi there' } }))).toBe(
      'echo: hi there',
    )
    const weather = await client.callTool({ name: 'weather', arguments: { city: 'Ankara' } })
    expect(weather.structuredContent).toEqual({ tempC: 21, sky: 'clear' })
    expect(textOf(weather)).toBe('{"tempC":21,"sky":"clear"}')
    // A non-object JSON body is wrapped — the spec requires an object.
    expect((await client.callTool({ name: 'list', arguments: {} })).structuredContent).toEqual({
      result: [1, 2, 3],
    })
    const [uuid, now, tool] = textOf(await client.callTool({ name: 'stamp', arguments: {} })).split(
      '|',
    )
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(Number.isNaN(Date.parse(now))).toBe(false)
    expect(tool).toBe('stamp')
  })

  it('validates arguments against the input schema (isError) and rejects unknown tools', async () => {
    const { url } = await start()
    const { client } = await v2(url)
    const bad = await client.callTool({ name: 'weather', arguments: { city: 'X', extra: true } })
    expect(bad.isError).toBe(true)
    expect(textOf(bad)).toMatch(/^Input validation error: Invalid arguments for tool weather/)

    const err = await client.callTool({ name: 'nope', arguments: {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProtocolError)
    expect((err as ProtocolError).code).toBe(-32602)
  })

  it('lists + reads resources, resource templates (rendered with params) and blobs', async () => {
    const { url } = await start()
    const { client } = await v2(url)

    expect((await client.listResources()).resources.map((r) => r.uri)).toEqual([
      'docs://readme',
      'bin://logo',
    ])
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual([
      { uriTemplate: 'users://{id}/profile', name: 'User profile', mimeType: 'application/json' },
    ])
    expect((await client.readResource({ uri: 'docs://readme' })).contents[0]).toMatchObject({
      uri: 'docs://readme',
      text: '# Hello {{x}}', // static text is served verbatim
    })
    expect((await client.readResource({ uri: 'users://42/profile' })).contents[0]).toMatchObject({
      mimeType: 'application/json',
      text: '{"id":"42"}',
    })
    expect((await client.readResource({ uri: 'bin://logo' })).contents[0]).toMatchObject({
      blob: 'iVBORw0KGgo=',
      mimeType: 'image/png',
    })
    // v2 answers a resources/read miss with Invalid Params (-32602) on every revision.
    const miss = await client.readResource({ uri: 'docs://missing' }).catch((e: unknown) => e)
    expect((miss as ProtocolError).code).toBe(-32602)
  })

  it('lists prompts and renders prompts/get messages with the arguments', async () => {
    const { url } = await start()
    const { client } = await v2(url)
    expect((await client.listPrompts()).prompts).toEqual([
      {
        name: 'greet',
        description: 'Greets someone',
        arguments: [{ name: 'who', required: true }],
      },
    ])
    const got = await client.getPrompt({ name: 'greet', arguments: { who: 'Ada' } })
    expect(got.messages).toEqual([
      { role: 'user', content: { type: 'text', text: 'Say hello to Ada' } },
      { role: 'assistant', content: { type: 'text', text: 'Hello, Ada!' } },
    ])
    const err = await client.getPrompt({ name: 'greet', arguments: {} }).catch((e: unknown) => e)
    expect((err as ProtocolError).code).toBe(-32602)
  })

  it('latencyMs delays every request (measurable at the client and in the log)', async () => {
    const { def, url } = await start({ latencyMs: 250 })
    const { client } = await v2(url)
    const t0 = Date.now()
    await client.callTool({ name: 'plain', arguments: {} })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(240)
    const call = logsOf(def.id).find((l) => l.method === 'tools/call')
    expect(call?.durationMs).toBeGreaterThanOrEqual(240)
    expect(call?.era).toBe('modern')
  })

  it('error mode jsonrpc → a JSON-RPC error with the configured code (other methods unaffected)', async () => {
    const { def, url } = await start({
      errorMode: { kind: 'jsonrpc', code: -32050, message: 'backend exploded' },
    })
    const { client } = await v2(url)
    const err = await client.callTool({ name: 'plain', arguments: {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProtocolError)
    expect((err as ProtocolError).code).toBe(-32050)
    expect((err as ProtocolError).message).toContain('backend exploded')
    expect((await client.listTools()).tools.length).toBe(TOOL_NAMES.length)
    expect(logsOf(def.id).find((l) => l.method === 'tools/call')).toMatchObject({
      ok: false,
      errorCode: -32050,
      toolName: 'plain',
      era: 'modern',
    })
  })

  it('error mode isError → CallToolResult with isError:true', async () => {
    const { url } = await start({ errorMode: { kind: 'isError', message: 'tool failed' } })
    const { client } = await v2(url)
    const res = await client.callTool({ name: 'plain', arguments: {} })
    expect(res.isError).toBe(true)
    expect(textOf(res)).toBe('tool failed')
  })

  it('error mode timeout → no response; the client times out and the log records the cancel', async () => {
    const { def, url } = await start({ errorMode: { kind: 'timeout' } })
    const { client } = await v2(url)
    const err = await client
      .callTool({ name: 'plain', arguments: {} }, { timeout: 300 })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(String((err as Error).message)).toMatch(/timed out/i)
    await expect
      .poll(() => logsOf(def.id).find((l) => l.method === 'tools/call'))
      .toMatchObject({ ok: false, toolName: 'plain', response: expect.stringMatching(/cancelled/) })
  })

  it('error mode http → the POST carrying tools/call gets the HTTP status (other methods unaffected)', async () => {
    const { def, url } = await start({
      errorMode: { kind: 'http', httpStatus: 503, message: 'down for maintenance' },
    })
    const { client } = await v2(url)
    expect((await client.listTools()).tools.length).toBe(TOOL_NAMES.length)
    await expect(client.callTool({ name: 'plain', arguments: {} })).rejects.toThrow()
    expect(logsOf(def.id).find((l) => l.httpStatus === 503)).toMatchObject({
      method: 'tools/call',
      toolName: 'plain',
      ok: false,
      era: 'modern',
    })
  })

  it('everyN applies the error to every Nth call only; a tool override beats the server mode', async () => {
    const { url } = await start({
      errorMode: { kind: 'isError', everyN: 2, message: 'flaky' },
      tools: [
        ...baseDef().tools,
        {
          name: 'safe',
          inputSchema: { type: 'object' },
          response: { kind: 'text', body: 'always fine' },
          error: { kind: 'none' },
        },
      ],
    })
    const { client } = await v2(url)
    const flags: boolean[] = []
    for (let i = 0; i < 4; i++) {
      flags.push(!!(await client.callTool({ name: 'plain', arguments: {} })).isError)
    }
    expect(flags).toEqual([false, true, false, true])
    for (let i = 0; i < 3; i++) {
      expect((await client.callTool({ name: 'safe', arguments: {} })).isError).toBeFalsy()
    }
  })

  it('cacheTtlMs → ttlMs / cacheScope on list results; the client serves the second listTools from cache', async () => {
    const zero = await start()
    expect((await rawModern(zero.url, 'tools/list')).json.result).toMatchObject({
      ttlMs: 0,
      cacheScope: 'private',
    })

    const { def, url } = await start({ cacheTtlMs: 60_000 })
    for (const method of [
      'tools/list',
      'prompts/list',
      'resources/list',
      'resources/templates/list',
    ]) {
      expect((await rawModern(url, method)).json.result).toMatchObject({
        ttlMs: 60_000,
        cacheScope: 'private',
      })
    }
    mockMcpServerManager.clearLogs(def.id)
    const { client } = await v2(url)
    await client.listTools()
    await client.listTools()
    expect(logsOf(def.id).filter((l) => l.method === 'tools/list').length).toBe(1)
  })

  it('elicitation round trip (auto-fulfilled): input_required → elicitation/create → retry → greeting', async () => {
    const { def, url } = await start()
    const asked: unknown[] = []
    const { client } = await v2(url, {
      elicit: () => {
        asked.push(true)
        return { action: 'accept', content: { name: 'Ada' } }
      },
    })
    const res = await client.callTool({ name: 'ask_name', arguments: {} })
    expect(textOf(res)).toBe('Hello, Ada!')
    expect(asked.length).toBe(1)

    const calls = logsOf(def.id).filter((l) => l.method === 'tools/call')
    expect(calls.map((l) => !!l.inputRequired)).toEqual([true, false])
    expect(calls.every((l) => l.ok && l.toolName === 'ask_name')).toBe(true)
  })

  it('elicitation round trip (manual): the input_required result, then a retry with inputResponses + requestState', async () => {
    const { url } = await start()
    const { client } = await v2(url, { elicit: () => ({ action: 'cancel' }) })

    const first = await client.callTool(
      { name: 'ask_name', arguments: {} },
      { allowInputRequired: true },
    )
    expect(isInputRequiredResult(first)).toBe(true)
    const pending = first as unknown as {
      inputRequests: Record<string, { method: string; params: Record<string, unknown> }>
      requestState: string
    }
    expect(pending.inputRequests.name).toMatchObject({
      method: 'elicitation/create',
      params: { mode: 'form', message: 'What is your name?' },
    })
    expect(pending.requestState).toMatch(/^v1\./)

    const done = await client.callTool({
      name: 'ask_name',
      arguments: {},
      inputResponses: { name: { action: 'accept', content: { name: 'Bob' } } },
      requestState: pending.requestState,
    })
    expect(textOf(done)).toBe('Hello, Bob!')

    const declined = await client.callTool({
      name: 'ask_name',
      arguments: {},
      inputResponses: { name: { action: 'decline' } },
      requestState: pending.requestState,
    })
    expect(textOf(declined)).toBe('The client declined the "name" request.')

    // A forged requestState fails the HMAC check before the handler runs.
    const forged = await client
      .callTool({
        name: 'ask_name',
        arguments: {},
        inputResponses: { name: { action: 'accept', content: { name: 'Eve' } } },
        requestState: `${pending.requestState}x`,
      })
      .catch((e: unknown) => e)
    expect((forged as ProtocolError).code).toBe(-32602)
  })

  it('hot reload reaches the next request and announces list_changed to subscriptions/listen streams', async () => {
    const { def, url } = await start()
    const { client } = await v2(url)
    const changed: string[] = []
    client.setNotificationHandler('notifications/tools/list_changed', () => {
      changed.push('tools')
    })
    const sub = await client.listen({ toolsListChanged: true })

    const r = await mockMcpServerManager.update({
      ...def,
      tools: [
        ...def.tools,
        { name: 'added', inputSchema: { type: 'object' }, response: { kind: 'text', body: 'new' } },
      ],
    })
    expect(r.ok).toBe(true)
    await expect.poll(() => changed.length).toBe(1)
    expect(textOf(await client.callTool({ name: 'added', arguments: {} }))).toBe('new')

    // An explicit notify (the `mockMcp:server:notify` IPC) publishes the same way.
    expect(mockMcpServerManager.notify(def.id, 'tools')).toBe(true)
    await expect.poll(() => changed.length).toBe(2)
    await sub.close()
  })
})

// ─── 2024/2025 (legacy) era ───────────────────────────────────────

describe('Mock MCP server — 2025 era (stateless legacy serving)', () => {
  it('a v2 client in legacy mode initializes and calls tools; logs say legacy / stateless', async () => {
    const { def, url } = await start()
    const { client } = await v2(url, { mode: 'legacy' })
    expect(client.getNegotiatedProtocolVersion()).toBe(LATEST_PROTOCOL_VERSION)
    expect(textOf(await client.callTool({ name: 'echo', arguments: { text: 'old' } }))).toBe(
      'echo: old',
    )
    const logs = logsOf(def.id)
    expect(logs.find((l) => l.method === 'initialize')).toMatchObject({
      ok: true,
      era: 'legacy',
      transport: 'stateless',
    })
    expect(logs.find((l) => l.method === 'tools/call')).toMatchObject({ ok: true, era: 'legacy' })
    expect(logs.some((l) => l.method.startsWith('notifications/'))).toBe(false)
  })

  it('the real v1 SDK client (2025): initialize + tools/call + resources/prompts; no session, GET → 405', async () => {
    const { url } = await start()
    const { client, transport } = await v1(url)
    expect(transport.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
    // Stateless legacy serving: no Mcp-Session-Id is ever assigned …
    expect(transport.sessionId).toBeUndefined()

    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(TOOL_NAMES)
    expect(textOf(await client.callTool({ name: 'echo', arguments: { text: 'v1' } }))).toBe(
      'echo: v1',
    )
    const weather = await client.callTool({ name: 'weather', arguments: { city: 'Izmir' } })
    expect(weather.structuredContent).toEqual({ tempC: 21, sky: 'clear' })
    expect((await client.readResource({ uri: 'users://7/profile' })).contents[0]).toMatchObject({
      text: '{"id":"7"}',
    })
    expect(
      (await client.getPrompt({ name: 'greet', arguments: { who: 'Lin' } })).messages[1],
    ).toEqual({ role: 'assistant', content: { type: 'text', text: 'Hello, Lin!' } })

    // … and the 2025 standalone notification stream (GET) is not served, so a
    // 2025 client gets no list_changed (state.legacyNotifications === false).
    const get = await fetch(url, { headers: { accept: 'text/event-stream' } })
    expect(get.status).toBe(405)
    const del = await fetch(url, { method: 'DELETE' })
    expect(del.status).toBe(405)
  })

  it('elicitation on a 2025-era call answers a note instead of pushing elicitation/create', async () => {
    const { url } = await start()
    const { client } = await v1(url)
    const res = await client.callTool({ name: 'ask_name', arguments: {} })
    expect(res.isError).toBeFalsy()
    expect(textOf(res)).toMatch(/only on MCP protocol revision 2026-07-28/)
  })

  it('error modes reach 2025 clients too (jsonrpc code, timeout + cancel in the log)', async () => {
    const jsonrpc = await start({ errorMode: { kind: 'jsonrpc', code: -32050, message: 'boom' } })
    const a = await v1(jsonrpc.url)
    const err = await a.client.callTool({ name: 'plain', arguments: {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(McpError)
    expect((err as McpError).code).toBe(-32050)

    const timeout = await start({ errorMode: { kind: 'timeout' } })
    const b = await v1(timeout.url)
    const t = await b.client
      .callTool({ name: 'plain', arguments: {} }, undefined, { timeout: 300 })
      .catch((e: unknown) => e)
    expect((t as McpError).code).toBe(ErrorCode.RequestTimeout)
    await expect
      .poll(() => logsOf(timeout.def.id).find((l) => l.method === 'tools/call'))
      .toMatchObject({ ok: false, era: 'legacy', response: expect.stringMatching(/cancelled/) })
  })

  it("legacyMode 'reject' → the v1 client fails with UnsupportedProtocolVersion (-32022); 2026 clients still work", async () => {
    const { def, state, url } = await start({ legacyMode: 'reject' })
    expect(state.eras).toEqual(['modern'])
    const err = await v1(url).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    expect(String((err as Error).message)).toMatch(/-32022/)
    expect(String((err as Error).message)).toContain('Unsupported protocol version')
    expect(logsOf(def.id).find((l) => l.method === 'initialize')).toMatchObject({
      ok: false,
      errorCode: -32022,
      httpStatus: 400,
      era: 'legacy',
    })

    const { client } = await v2(url)
    expect(client.getNegotiatedProtocolVersion()).toBe(MODERN)
    expect(textOf(await client.callTool({ name: 'plain', arguments: {} }))).toBe(
      'plain text answer',
    )
  })
})

// ─── Protocol pins ────────────────────────────────────────────────

describe('Mock MCP server — protocol pins', () => {
  it('pin 2026-07-28 → legacy clients rejected (-32022), modern clients accepted; ?rev= does the same per request', async () => {
    const pinned = await start({ protocolPin: MODERN })
    expect(pinned.state.eras).toEqual(['modern'])
    await expect(v1(pinned.url)).rejects.toThrow(/-32022/)
    expect((await v2(pinned.url)).client.getNegotiatedProtocolVersion()).toBe(MODERN)

    const open = await start()
    await expect(v1(`${open.url}?rev=${MODERN}`)).rejects.toThrow(/-32022/)
    // The strict handler is picked from the URL: a 2026 client on the same URL works.
    const viaRev = await v2(`${open.url}?rev=${MODERN}`)
    expect(viaRev.client.getNegotiatedProtocolVersion()).toBe(MODERN)
    expect(textOf(await viaRev.client.callTool({ name: 'plain', arguments: {} }))).toBe(
      'plain text answer',
    )
    expect((await v1(open.url)).transport.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
  })

  it('a 2025 pin rejects initialize with any other version (-32602) and 2026 requests (-32022); the pinned version is accepted', async () => {
    const { state, url } = await start({ protocolPin: '2025-03-26' })
    expect(state.eras).toEqual(['legacy'])

    // The v1 client asks for LATEST_PROTOCOL_VERSION.
    const err = await v1(url).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(McpError)
    expect((err as McpError).code).toBe(ErrorCode.InvalidParams)
    expect((err as McpError).message).toContain(
      `Unsupported protocol version: ${LATEST_PROTOCOL_VERSION} (supported versions: 2025-03-26)`,
    )

    const raw = await rawInitialize(url, '2025-03-26')
    expect(raw.status).toBe(200)
    expect(raw.body).toContain('"protocolVersion":"2025-03-26"')

    // A 2026-07-28 request names the pin in the spec's -32022 error …
    const modern = await rawModern(url, 'tools/list')
    expect(modern.status).toBe(400)
    expect(modern.json.error).toMatchObject({
      code: -32022,
      data: { supported: ['2025-03-26'], requested: MODERN },
    })
    // … so a negotiating client falls back to initialize, which the pin then refuses.
    await expect(v2(url)).rejects.toThrow(/Unsupported protocol version/)
  })

  it('?rev=<2025 version> pins a single request the same way', async () => {
    const { url } = await start()
    const err = await v1(`${url}?rev=2025-06-18`).catch((e: unknown) => e)
    expect((err as McpError).code).toBe(ErrorCode.InvalidParams)
    const raw = await rawInitialize(`${url}?rev=2025-06-18`, '2025-06-18')
    expect(raw.body).toContain('"protocolVersion":"2025-06-18"')
  })
})

// ─── Bearer auth / PRM (both eras) ───────────────────────────────

describe('Mock MCP server — bearer auth and protected-resource metadata', () => {
  it('401 + WWW-Authenticate for both eras, the RFC 9728 document, and access with the token', async () => {
    const token = 'tkn-123'
    const { def, state, url } = await start({ authMode: 'bearer', bearerToken: token })
    const origin = `http://127.0.0.1:${state.port}`

    // Both eras are refused before the SDK sees the request.
    await expect(v1(url)).rejects.toThrow()
    await expect(v2(url)).rejects.toThrow()
    const eras = new Set(
      logsOf(def.id)
        .filter((l) => l.httpStatus === 401)
        .map((l) => l.era),
    )
    expect(eras).toEqual(new Set(['legacy', 'modern']))

    const noAuth = await fetch(url, { method: 'POST', headers: JSON_HEADERS, body: '{}' })
    expect(noAuth.status).toBe(401)
    expect(noAuth.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    )
    const wrong = await fetch(url, {
      method: 'POST',
      headers: { ...JSON_HEADERS, authorization: 'Bearer nope' },
      body: '{}',
    })
    expect(wrong.status).toBe(401)
    expect(wrong.headers.get('www-authenticate')).toMatch(/error="invalid_token"/)

    for (const wk of [
      `${origin}/.well-known/oauth-protected-resource`,
      `${origin}/.well-known/oauth-protected-resource/mcp`,
    ]) {
      const prm = await fetch(wk)
      expect(prm.status).toBe(200)
      expect(await prm.json()).toEqual({
        resource: `${origin}/mcp`,
        resource_name: def.name,
        authorization_servers: [],
        bearer_methods_supported: ['header'],
      })
    }

    const headers = { Authorization: `Bearer ${token}` }
    expect((await (await v1(url, headers)).client.listTools()).tools.length).toBe(TOOL_NAMES.length)
    const modern = await v2(url, { headers })
    expect(modern.client.getNegotiatedProtocolVersion()).toBe(MODERN)
    expect((await modern.client.listTools()).tools.length).toBe(TOOL_NAMES.length)
  })

  it('without bearer mode there is no protected-resource document', async () => {
    const { state } = await start()
    const res = await fetch(`http://127.0.0.1:${state.port}/.well-known/oauth-protected-resource`)
    expect(res.status).toBe(404)
  })

  it('a loopback-bound server refuses a foreign Host header (DNS-rebinding guard)', async () => {
    const { state } = await start()
    const res = await new Promise<number>((resolve, reject) => {
      const sock = net.connect(state.port as number, '127.0.0.1', () => {
        sock.write(
          'POST /mcp HTTP/1.1\r\nHost: evil.example:80\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}',
        )
      })
      let buf = ''
      sock.on('data', (d) => (buf += d.toString()))
      sock.on('end', () => resolve(Number(buf.split(' ')[1])))
      sock.on('error', reject)
    })
    expect(res).toBe(403)
  })
})

// ─── Legacy HTTP+SSE ─────────────────────────────────────────────

describe('Mock MCP server — legacy HTTP+SSE', () => {
  it('serves <path>/sse with the v1 SSEClientTransport; sessions get list_changed on hot reload', async () => {
    const { def, state } = await start({ legacySse: true })
    expect(state.sseUrl).toBe(`http://127.0.0.1:${state.port}/mcp/sse`)
    const client = new V1Client({ name: 'sse-test', version: '1.0.0' })
    const changed: string[] = []
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      changed.push('tools')
    })
    await client.connect(new V1SseTransport(new URL(state.sseUrl as string)))
    closers.push(() => client.close())

    expect((await client.listTools()).tools.length).toBe(TOOL_NAMES.length)
    expect(textOf(await client.callTool({ name: 'echo', arguments: { text: 'via sse' } }))).toBe(
      'echo: via sse',
    )
    const call = logsOf(def.id).find((l) => l.method === 'tools/call')
    expect(call).toMatchObject({ transport: 'sse', era: 'legacy', ok: true })
    expect(call?.sessionId).toBeTruthy()

    await mockMcpServerManager.update({
      ...def,
      tools: [
        ...def.tools,
        { name: 'x', inputSchema: { type: 'object' }, response: { kind: 'text', body: 'x' } },
      ],
    })
    await expect.poll(() => changed.length).toBe(1)
  })

  it('an unknown SSE session id is 404', async () => {
    const { state } = await start({ legacySse: true })
    const res = await fetch(`http://127.0.0.1:${state.port}/mcp/messages?sessionId=nope`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.status).toBe(404)
  })
})

// ─── Logs and lifecycle ──────────────────────────────────────────

describe('Mock MCP server — logs and lifecycle', () => {
  it('records one entry per JSON-RPC request with method, tool, era and outcome; clear empties it', async () => {
    const { def, url } = await start({ errorMode: { kind: 'jsonrpc', code: -32099 } })
    const { client } = await v2(url)
    await client.listTools()
    await client.callTool({ name: 'plain', arguments: {} }).catch(() => {})

    const logs = logsOf(def.id)
    expect(logs.find((l) => l.method === 'tools/list')).toMatchObject({
      ok: true,
      serverId: def.id,
      mcpMethod: 'tools/list',
    })
    const call = logs.find((l) => l.method === 'tools/call')
    expect(call).toMatchObject({ ok: false, errorCode: -32099, toolName: 'plain', era: 'modern' })
    expect(call?.request).toContain('"name":"plain"')
    expect(call?.response).toContain('-32099')

    mockMcpServerManager.clearLogs(def.id)
    expect(logsOf(def.id)).toEqual([])
  })

  it('refuses a port already held by another mock MCP server or another process', async () => {
    const { state } = await start()
    const clash = await mockMcpServerManager.start(baseDef({ port: state.port as number }))
    expect(clash.ok).toBe(false)
    expect(!clash.ok && clash.error).toMatch(
      /already in use by mock MCP server "Mock MCP Under Test"/,
    )

    const blocker = net.createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()))
    const port = (blocker.address() as net.AddressInfo).port
    try {
      const def = baseDef({ port })
      const r = await mockMcpServerManager.start(def)
      expect(r.ok).toBe(false)
      expect(!r.ok && r.error).toMatch(new RegExp(`Port ${port} is already in use`))
      expect(mockMcpServerManager.status(def.id)).toBe('stopped')
    } finally {
      await new Promise<void>((r) => blocker.close(() => r()))
    }
  })

  it('refuses bearer mode without a token', async () => {
    const r = await mockMcpServerManager.start(baseDef({ authMode: 'bearer', bearerToken: ' ' }))
    expect(r).toEqual({ ok: false, error: 'Bearer auth is enabled but no token is set' })
  })

  it('stop closes live sessions and frees the port; notify on a stopped server is false', async () => {
    const { def, state, url } = await start({ legacySse: true })
    const client = new V1Client({ name: 'sse-stop', version: '1.0.0' })
    await client.connect(new V1SseTransport(new URL(state.sseUrl as string)))
    closers.push(() => client.close())
    await mockMcpServerManager.stop(def.id)
    started.splice(started.indexOf(def.id), 1)
    expect(mockMcpServerManager.state(def.id)).toMatchObject({
      status: 'stopped',
      url: null,
      eras: [],
    })
    expect(mockMcpServerManager.notify(def.id, 'tools')).toBe(false)
    await expect(fetch(url, { method: 'POST', body: '{}' })).rejects.toThrow()
  })
})
