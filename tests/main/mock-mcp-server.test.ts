/**
 * Mock MCP server (issue #140) — REAL round trips, no SDK mocks.
 *
 * Every case starts a `MockMcpServerDef` on an ephemeral port and talks to it
 * with the app's own client engine (`mcp.engine.ts`) or, where the engine does
 * not expose the knob a case needs (per-request timeout, resources/prompts,
 * negotiated protocol version), with the SDK `Client` the engine wraps.
 */

import { afterEach, describe, expect, it } from 'vitest'
import net from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ErrorCode, LATEST_PROTOCOL_VERSION, McpError } from '@modelcontextprotocol/sdk/types.js'
import { mockMcpServerManager } from '../../src/main/mock-mcp/server'
import type { MockMcpServerDef, MockMcpServerState } from '../../src/main/mock-mcp/types'
import {
  mcpCallTool,
  mcpConnect,
  mcpDisconnect,
  mcpDisconnectAll,
  mcpListTools,
} from '../../src/main/protocols/mcp.engine'

const COMPLEX_SCHEMA = {
  type: 'object',
  properties: {
    city: { type: 'string', minLength: 2, description: 'City name' },
    units: { enum: ['metric', 'imperial'] },
    when: {
      oneOf: [{ type: 'string', format: 'date' }, { $ref: '#/$defs/range' }],
    },
  },
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

const started: string[] = []
const clients: Client[] = []

async function start(over: Partial<MockMcpServerDef> = {}): Promise<{
  def: MockMcpServerDef
  state: MockMcpServerState
}> {
  const def = baseDef(over)
  const r = await mockMcpServerManager.start(def)
  if (!r.ok) throw new Error(r.error)
  started.push(def.id)
  return { def, state: r.state }
}

async function sdkClient(
  url: string,
  headers?: Record<string, string>,
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const client = new Client({ name: 'mock-mcp-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    headers ? { requestInit: { headers } } : undefined,
  )
  await client.connect(transport)
  clients.push(client)
  return { client, transport }
}

function textOf(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? []
  return content.map((c) => c.text ?? '').join('')
}

async function rawInitialize(
  url: string,
  protocolVersion: string,
): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion, capabilities: {}, clientInfo: { name: 'raw', version: '0' } },
    }),
  })
  return { status: res.status, body: await res.text() }
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => {})
  mcpDisconnectAll()
  for (const id of started.splice(0)) await mockMcpServerManager.stop(id)
})

describe('Mock MCP server — tools over Streamable HTTP (client engine)', () => {
  it('advertises tools with the authored JSON Schema verbatim and answers text / json / template', async () => {
    const { def, state } = await start()
    expect(state.status).toBe('running')
    expect(state.port).toBeGreaterThan(0)
    expect(state.url).toBe(`http://127.0.0.1:${state.port}/mcp`)

    const info = await mcpConnect({ transport: 'http', url: state.url as string })
    expect(info.serverName).toBe(def.name)

    const tools = await mcpListTools(info.connectionId)
    expect(tools.map((t) => t.name)).toEqual(['echo', 'plain', 'weather', 'list', 'stamp'])
    // No zod round trip: $defs / $ref / oneOf / enum survive byte-for-byte.
    expect(tools.find((t) => t.name === 'weather')?.inputSchema).toEqual(COMPLEX_SCHEMA)

    expect(textOf(await mcpCallTool(info.connectionId, 'plain', {}))).toBe('plain text answer')
    expect(textOf(await mcpCallTool(info.connectionId, 'echo', { text: 'hi there' }))).toBe(
      'echo: hi there',
    )

    const weather = (await mcpCallTool(info.connectionId, 'weather', { city: 'Ankara' })) as {
      structuredContent?: unknown
      content: { text: string }[]
    }
    expect(weather.structuredContent).toEqual({ tempC: 21, sky: 'clear' })
    expect(weather.content[0].text).toBe('{"tempC":21,"sky":"clear"}')

    // A non-object JSON body is wrapped — the spec requires an object.
    const list = (await mcpCallTool(info.connectionId, 'list', {})) as {
      structuredContent?: unknown
    }
    expect(list.structuredContent).toEqual({ result: [1, 2, 3] })

    const [uuid, now, tool] = textOf(await mcpCallTool(info.connectionId, 'stamp', {})).split('|')
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(Number.isNaN(Date.parse(now))).toBe(false)
    expect(tool).toBe('stamp')

    await mcpDisconnect(info.connectionId)
  })

  it('validates arguments against the input schema (isError, like McpServer) and rejects unknown tools', async () => {
    const { state } = await start()
    const info = await mcpConnect({ transport: 'http', url: state.url as string })

    const bad = (await mcpCallTool(info.connectionId, 'weather', {
      city: 'X',
      extra: true,
    })) as { isError?: boolean; content: { text: string }[] }
    expect(bad.isError).toBe(true)
    expect(bad.content[0].text).toMatch(
      /^Input validation error: Invalid arguments for tool weather/,
    )

    await expect(mcpCallTool(info.connectionId, 'nope', {})).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    })
  })

  it('applies hot-reloaded definitions to a live session without reconnecting', async () => {
    const { def, state } = await start()
    const info = await mcpConnect({ transport: 'http', url: state.url as string })
    expect((await mcpListTools(info.connectionId)).length).toBe(5)

    const r = await mockMcpServerManager.update({
      ...def,
      tools: [
        ...def.tools,
        { name: 'added', inputSchema: { type: 'object' }, response: { kind: 'text', body: 'new' } },
      ],
    })
    expect(r.ok).toBe(true)
    expect((await mcpListTools(info.connectionId)).map((t) => t.name)).toContain('added')
    expect(textOf(await mcpCallTool(info.connectionId, 'added', {}))).toBe('new')
  })
})

describe('Mock MCP server — resources and prompts', () => {
  it('lists + reads static resources, resource templates (rendered with params) and blobs', async () => {
    const { state } = await start()
    const { client } = await sdkClient(state.url as string)

    const listed = await client.listResources()
    expect(listed.resources.map((r) => r.uri)).toEqual(['docs://readme', 'bin://logo'])
    const templates = await client.listResourceTemplates()
    expect(templates.resourceTemplates).toEqual([
      { uriTemplate: 'users://{id}/profile', name: 'User profile', mimeType: 'application/json' },
    ])

    // Static text is served verbatim (no template pass).
    const readme = await client.readResource({ uri: 'docs://readme' })
    expect(readme.contents[0]).toMatchObject({ uri: 'docs://readme', text: '# Hello {{x}}' })

    const profile = await client.readResource({ uri: 'users://42/profile' })
    expect(profile.contents[0]).toMatchObject({
      uri: 'users://42/profile',
      mimeType: 'application/json',
      text: '{"id":"42"}',
    })

    const logo = await client.readResource({ uri: 'bin://logo' })
    expect(logo.contents[0]).toMatchObject({ blob: 'iVBORw0KGgo=', mimeType: 'image/png' })

    await expect(client.readResource({ uri: 'docs://missing' })).rejects.toMatchObject({
      code: -32002,
    })
  })

  it('lists prompts and renders prompts/get messages with the arguments', async () => {
    const { state } = await start()
    const { client } = await sdkClient(state.url as string)

    const listed = await client.listPrompts()
    expect(listed.prompts).toEqual([
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

    await expect(client.getPrompt({ name: 'greet', arguments: {} })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    })
  })
})

describe('Mock MCP server — scenarios', () => {
  it('latencyMs delays every JSON-RPC request (measurable at the client and in the log)', async () => {
    const { def, state } = await start({ latencyMs: 250 })
    const info = await mcpConnect({ transport: 'http', url: state.url as string })
    const t0 = Date.now()
    await mcpCallTool(info.connectionId, 'plain', {})
    expect(Date.now() - t0).toBeGreaterThanOrEqual(240)

    const call = mockMcpServerManager.getLogs(def.id).find((l) => l.method === 'tools/call')
    expect(call?.durationMs).toBeGreaterThanOrEqual(240)
  })

  it('error mode jsonrpc → JSON-RPC error with the configured code and message', async () => {
    const { state } = await start({
      errorMode: { kind: 'jsonrpc', code: -32050, message: 'backend exploded' },
    })
    const info = await mcpConnect({ transport: 'http', url: state.url as string })
    const err = await mcpCallTool(info.connectionId, 'plain', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(McpError)
    expect((err as McpError).code).toBe(-32050)
    expect((err as McpError).message).toContain('backend exploded')
    // Only tools/call is affected — listing still works.
    expect((await mcpListTools(info.connectionId)).length).toBe(5)
  })

  it('error mode isError → CallToolResult with isError:true', async () => {
    const { state } = await start({ errorMode: { kind: 'isError', message: 'tool failed' } })
    const info = await mcpConnect({ transport: 'http', url: state.url as string })
    const res = (await mcpCallTool(info.connectionId, 'plain', {})) as { isError?: boolean }
    expect(res.isError).toBe(true)
    expect(textOf(res)).toBe('tool failed')
  })

  it('error mode timeout → no response; the client times out and the log records the cancel', async () => {
    const { def, state } = await start({ errorMode: { kind: 'timeout' } })
    const { client } = await sdkClient(state.url as string)
    const err = await client
      .callTool({ name: 'plain', arguments: {} }, undefined, { timeout: 300 })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(McpError)
    expect((err as McpError).code).toBe(ErrorCode.RequestTimeout)

    await expect
      .poll(() => mockMcpServerManager.getLogs(def.id).find((l) => l.method === 'tools/call'))
      .toMatchObject({ ok: false, toolName: 'plain', response: expect.stringMatching(/cancelled/) })
  })

  it('error mode http → the POST carrying tools/call gets the HTTP status (other methods unaffected)', async () => {
    const { def, state } = await start({
      errorMode: { kind: 'http', httpStatus: 503, message: 'down for maintenance' },
    })
    const info = await mcpConnect({ transport: 'http', url: state.url as string })
    expect((await mcpListTools(info.connectionId)).length).toBe(5)
    await expect(mcpCallTool(info.connectionId, 'plain', {})).rejects.toThrow(/503|maintenance/)
    const entry = mockMcpServerManager.getLogs(def.id).find((l) => l.httpStatus === 503)
    expect(entry).toMatchObject({ method: 'tools/call', toolName: 'plain', ok: false })
  })

  it('everyN applies the error to every Nth call only; a tool override beats the server mode', async () => {
    const { state } = await start({
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
    const info = await mcpConnect({ transport: 'http', url: state.url as string })
    const flags: boolean[] = []
    for (let i = 0; i < 4; i++) {
      const r = (await mcpCallTool(info.connectionId, 'plain', {})) as { isError?: boolean }
      flags.push(!!r.isError)
    }
    expect(flags).toEqual([false, true, false, true])
    for (let i = 0; i < 3; i++) {
      const r = (await mcpCallTool(info.connectionId, 'safe', {})) as { isError?: boolean }
      expect(r.isError).toBeFalsy()
    }
  })

  it('bearer auth → 401 + WWW-Authenticate resource_metadata, serves the RFC 9728 document, accepts the header', async () => {
    const token = 'tkn-123'
    const { def, state } = await start({ authMode: 'bearer', bearerToken: token })
    const url = state.url as string
    const origin = `http://127.0.0.1:${state.port}`

    await expect(mcpConnect({ transport: 'http', url })).rejects.toThrow()

    const noAuth = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: '{}',
    })
    expect(noAuth.status).toBe(401)
    expect(noAuth.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    )

    const wrong = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer nope' },
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

    const info = await mcpConnect({
      transport: 'http',
      url,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect((await mcpListTools(info.connectionId)).length).toBe(5)
    expect(mockMcpServerManager.getLogs(def.id).some((l) => l.httpStatus === 401)).toBe(true)
  })

  it('without bearer mode there is no protected-resource document', async () => {
    const { state } = await start()
    const res = await fetch(`http://127.0.0.1:${state.port}/.well-known/oauth-protected-resource`)
    expect(res.status).toBe(404)
  })

  it('protocol pin rejects initialize with any other version; the pinned version is accepted', async () => {
    const pinned = await start({ protocolPin: '2025-03-26' })
    // The SDK client always asks for LATEST_PROTOCOL_VERSION.
    const err = await sdkClient(pinned.state.url as string).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(McpError)
    expect((err as McpError).code).toBe(ErrorCode.InvalidParams)
    expect((err as McpError).message).toContain(
      `Unsupported protocol version: ${LATEST_PROTOCOL_VERSION} (supported versions: 2025-03-26)`,
    )

    const raw = await rawInitialize(pinned.state.url as string, '2025-03-26')
    expect(raw.status).toBe(200)
    expect(raw.body).toContain('"protocolVersion":"2025-03-26"')

    const latest = await start({ protocolPin: LATEST_PROTOCOL_VERSION })
    const { transport } = await sdkClient(latest.state.url as string)
    expect(transport.protocolVersion).toBe(LATEST_PROTOCOL_VERSION)
  })

  it('?rev=<version> on the URL pins the session the same way', async () => {
    const { state } = await start()
    const err = await sdkClient(`${state.url}?rev=2025-06-18`).catch((e: unknown) => e)
    expect((err as McpError).code).toBe(ErrorCode.InvalidParams)
    const raw = await rawInitialize(`${state.url}?rev=2025-06-18`, '2025-06-18')
    expect(raw.body).toContain('"protocolVersion":"2025-06-18"')
  })
})

describe('Mock MCP server — transports', () => {
  it('serves legacy HTTP+SSE at <path>/sse when enabled', async () => {
    const { def, state } = await start({ legacySse: true })
    expect(state.sseUrl).toBe(`http://127.0.0.1:${state.port}/mcp/sse`)
    const info = await mcpConnect({ transport: 'sse', url: state.sseUrl as string })
    expect((await mcpListTools(info.connectionId)).length).toBe(5)
    expect(textOf(await mcpCallTool(info.connectionId, 'echo', { text: 'via sse' }))).toBe(
      'echo: via sse',
    )
    const logs = mockMcpServerManager.getLogs(def.id)
    expect(logs.find((l) => l.method === 'tools/call')).toMatchObject({
      transport: 'sse',
      ok: true,
    })
  })

  it('answers a stateless POST (no session, no initialize)', async () => {
    const { def, state } = await start()
    const res = await fetch(state.url as string, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'stateless' } },
      }),
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('echo: stateless')
    await expect
      .poll(() => mockMcpServerManager.getLogs(def.id).find((l) => l.method === 'tools/call'))
      .toMatchObject({ transport: 'stateless', ok: true, toolName: 'echo' })
  })

  it('rejects an unknown session id with 404', async () => {
    const { state } = await start()
    const res = await fetch(state.url as string, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': 'not-a-session',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(res.status).toBe(404)
  })
})

describe('Mock MCP server — logs and lifecycle', () => {
  it('records one entry per JSON-RPC request with method, tool, session and outcome; clear empties it', async () => {
    const { def, state } = await start({ errorMode: { kind: 'jsonrpc', code: -32099 } })
    const info = await mcpConnect({ transport: 'http', url: state.url as string })
    await mcpListTools(info.connectionId)
    await mcpCallTool(info.connectionId, 'plain', {}).catch(() => {})

    const logs = mockMcpServerManager.getLogs(def.id)
    const init = logs.find((l) => l.method === 'initialize')
    expect(init).toMatchObject({ ok: true, transport: 'streamable-http', serverId: def.id })
    expect(init?.sessionId).toBeTruthy()
    expect(logs.find((l) => l.method === 'tools/list')).toMatchObject({ ok: true })
    const call = logs.find((l) => l.method === 'tools/call')
    expect(call).toMatchObject({ ok: false, errorCode: -32099, toolName: 'plain' })
    expect(call?.request).toContain('"name":"plain"')
    expect(call?.response).toContain('-32099')
    // Notifications (notifications/initialized) are not requests.
    expect(logs.some((l) => l.method.startsWith('notifications/'))).toBe(false)

    mockMcpServerManager.clearLogs(def.id)
    expect(mockMcpServerManager.getLogs(def.id)).toEqual([])
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

  it('stop closes live sessions and frees the port', async () => {
    const { def, state } = await start({ legacySse: true })
    await mcpConnect({ transport: 'sse', url: state.sseUrl as string })
    await mockMcpServerManager.stop(def.id)
    started.splice(started.indexOf(def.id), 1)
    expect(mockMcpServerManager.state(def.id)).toMatchObject({ status: 'stopped', url: null })
    await expect(fetch(state.url as string, { method: 'POST', body: '{}' })).rejects.toThrow()
  })
})
