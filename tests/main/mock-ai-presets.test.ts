/**
 * AI presets of the "New mock server" dialog (issue #221, design Ek D
 * §D.3.1, Faz 2b) served by the REAL mock engine on a loopback port and
 * consumed by Testnizer's OWN AI Chat engine (`streamChatRound` — what the AI
 * Chat tab runs), like `mock-llm-client-parity.test.ts`.
 *
 * A preset's hint must be true to what it serves: each preset is turned into
 * a `MockServerDef` the way `createFromHttpPreset` stores it (every response,
 * in order, with its condition and headers) and talked to over HTTP. Only the
 * chunk interval is shortened for the test.
 *
 * Fail-before: `mock-ai-presets.ts` did not exist (the dialog had no AI type).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mockServerManager, type MockResponseDef } from '../../src/main/mock/server'
import { sseWriterLiveTimers } from '../../src/main/mock/stream/sse-writer'
import {
  AiHttpError,
  streamChatRound,
  type AiRoundEvent,
  type AiStreamOptions,
} from '../../src/main/protocols/ai-chat.engine'
import { normalizeLlmConfig, validateLlmConfig } from '../../src/shared/mock-stream'
import {
  buildAiPreset,
  chatResponse,
  MOCK_AI_PRESET_IDS,
  MOCK_AI_PRESET_NAMES,
  type MockAiPresetId,
} from '../../src/renderer/components/mock/mock-ai-presets'
import { buildToolNameTable } from '../../src/shared/ai-tool-names'
import { runAiTurn, type AiLoopDeps } from '../../src/main/protocols/ai-chat-loop'
import {
  mcpConnectionIds,
  mcpDisconnect,
  mcpOpenDetachedSession,
  mcpSessionCallTool,
} from '../../src/main/protocols/mcp.engine'
import { mockMcpServerManager } from '../../src/main/mock-mcp/server'
import type { MockMcpServerDef } from '../../src/main/mock-mcp/types'
import { buildPresetInput } from '../../src/renderer/components/mock-mcp/mock-mcp-presets'
import { freePort, serverDef, waitFor, type RouteSpec } from './mock-sse-fixtures'

const ID = 'ai-preset'

afterEach(async () => {
  await mockServerManager.stopAll()
  expect(await waitFor(() => sseWriterLiveTimers() === 0, 1000)).toBe(true)
})

/** Serve a preset (every response of every endpoint) and return its base URL. */
async function serve(
  id: MockAiPresetId,
  edit: (p: ReturnType<typeof buildAiPreset>) => void = () => {},
): Promise<string> {
  const preset = buildAiPreset(id)
  edit(preset)
  const routes: RouteSpec[] = preset.endpoints.map(({ endpoint }) => ({
    path: endpoint.path,
    method: endpoint.method,
    response: { body: '' },
  }))
  const port = await freePort()
  const def = serverDef(ID, port, routes)
  preset.endpoints.forEach(({ responses }, i) => {
    def.endpoints[i].responses = responses.map(
      (r, j) =>
        ({
          id: `resp-${i}-${j}`,
          name: r.name,
          statusCode: r.statusCode,
          headers: r.headers,
          bodyType: r.bodyType,
          body: r.body,
          delayMs: r.delayMs,
          condition: r.condition,
          script: '',
          order: j,
          enabled: true,
          ...(r.bodyType === 'llm'
            ? { llmConfig: normalizeLlmConfig({ ...r.streamConfig, chunkIntervalMs: 0 }) }
            : {}),
        }) as MockResponseDef,
    )
  })
  const r = await mockServerManager.start(def)
  expect(r.ok).toBe(true)
  return `http://127.0.0.1:${port}`
}

interface Round {
  text: string
  end: Extract<AiRoundEvent, { type: 'end' }>
}

async function round(opts: AiStreamOptions): Promise<Round> {
  let text = ''
  let end: Round['end'] | null = null
  for await (const ev of streamChatRound(opts)) {
    if (ev.type === 'text') text += ev.delta
    if (ev.type === 'end') end = ev
  }
  expect(end).not.toBeNull()
  return { text, end: end! }
}

/** What the AI Chat tab sends after "Open in AI Chat tab": provider Custom, the chat URL. */
const custom = (url: string, model: string, content: string): AiStreamOptions => ({
  provider: 'custom',
  url,
  model,
  messages: [{ role: 'user', content }],
})

describe('AI presets — shape', () => {
  it.each(MOCK_AI_PRESET_IDS)('preset "%s" is a valid AI server', (id) => {
    const preset = buildAiPreset(id)
    expect(preset.server.kind).toBe('ai')
    expect(preset.endpoints.length).toBeGreaterThan(0)
    for (const { endpoint, responses } of preset.endpoints) {
      expect(endpoint.pathMode).toBe('exact')
      for (const r of responses) {
        expect(r.body).not.toContain('}}}')
        if (r.bodyType === 'llm') expect(validateLlmConfig(r.streamConfig)).toBeNull()
        else expect(r.streamConfig).toBeUndefined()
      }
    }
  })

  it('names and endpoints match the dialog table (Ek D §D.3.1)', () => {
    expect(MOCK_AI_PRESET_NAMES).toEqual({
      chat: 'Chat API',
      anthropic: 'Messages API',
      tools: 'Tool-call API',
      errors: 'Error API',
    })
    const routes = (id: MockAiPresetId): string[] =>
      buildAiPreset(id).endpoints.map((e) => `${e.endpoint.method} ${e.endpoint.path}`)
    expect(routes('chat')).toEqual(['POST /v1/chat/completions', 'GET /v1/models'])
    expect(routes('anthropic')).toEqual(['POST /v1/messages'])
    expect(routes('tools')).toEqual(['POST /v1/chat/completions'])
    expect(routes('errors')).toEqual(['POST /v1/chat/completions'])
    const chat = buildAiPreset('chat').endpoints[0].responses[0]
    expect(chat.streamConfig).toEqual({
      provider: 'openai',
      chunking: 'word',
      chunkIntervalMs: 30,
      stopReason: 'stop',
      toolCalls: [],
      usage: 'auto',
    })
    // The editor's "Add" uses the very same reply.
    expect(chatResponse('openai')).toEqual(chat)
    expect(chatResponse('anthropic')).toEqual(buildAiPreset('anthropic').endpoints[0].responses[0])
    // The tool-call reply says it stops for tools (the editor's select shows it).
    const tool = buildAiPreset('tools').endpoints[0].responses[1]
    expect(tool.streamConfig).toMatchObject({ stopReason: 'tool_calls' })
  })
})

describe('AI presets served ↔ the AI Chat engine', () => {
  it('chat: the templated text streams, with usage; GET /v1/models lists mock-model', async () => {
    const base = await serve('chat')
    const r = await round(custom(`${base}/v1/chat/completions`, 'mock-model', 'hi there'))
    expect(r.text).toBe('Hello from the mock LLM. You said: hi there')
    expect(r.end.stopReason).toBe('stop')
    expect(r.end.usage?.inputTokens).toBeGreaterThan(0)
    expect(r.end.usage?.outputTokens).toBeGreaterThan(0)

    const models = await fetch(`${base}/v1/models`)
    expect(models.status).toBe(200)
    expect(await models.json()).toEqual({
      object: 'list',
      data: [{ id: 'mock-model', object: 'model' }],
    })
  })

  it('a reply switched to llm from an "Add response" JSON one (Content-Type: application/json kept) still streams', async () => {
    const base = await serve('chat', (p) => {
      p.endpoints[0].responses[0].headers = [{ name: 'Content-Type', value: 'application/json' }]
    })
    const r = await round(custom(`${base}/v1/chat/completions`, 'mock-model', 'switched'))
    expect(r.text).toBe('Hello from the mock LLM. You said: switched')
    expect(r.end.usage?.outputTokens).toBeGreaterThan(0)
  })

  it('anthropic: the Anthropic provider (URL override) gets the text and usage', async () => {
    const base = await serve('anthropic')
    const r = await round({
      provider: 'anthropic',
      url: `${base}/v1/messages`,
      model: 'claude-mock',
      messages: [{ role: 'user', content: 'hello anthropic' }],
    })
    expect(r.text).toBe('Hello from the mock LLM. You said: hello anthropic')
    expect(r.end.stopReason).toBe('end_turn')
    expect(r.end.usage?.outputTokens).toBeGreaterThan(0)
  })

  it('anthropic via the Custom provider reads as an empty answer — why there is no one-click target', async () => {
    const base = await serve('anthropic')
    const r = await round(custom(`${base}/v1/messages`, 'mock-model', 'hi'))
    expect(r.text).toBe('')
  })

  it('tools: the first round calls echo, the round with the tool result answers', async () => {
    const base = await serve('tools')
    const url = `${base}/v1/chat/completions`
    const tools = [{ name: 'echo', inputSchema: { type: 'object' } }]
    const first = await round({ ...custom(url, 'mock-model', 'use the tool'), tools })
    expect(first.text).toBe('')
    expect(first.end.stopReason).toBe('tool_calls')
    expect(first.end.toolCalls).toHaveLength(1)
    const call = first.end.toolCalls[0]
    expect(call.name).toBe('echo')
    expect(JSON.parse(call.argsJson)).toEqual({ text: 'hello from the mock LLM' })

    const second = await round({
      provider: 'custom',
      url,
      model: 'mock-model',
      messages: [
        { role: 'user', content: 'use the tool' },
        { role: 'assistant', content: '', toolCalls: [call] },
        { role: 'tool', results: [{ id: call.id, content: 'echo: hello', isError: false }] },
      ],
      tools,
    })
    expect(second.text).toBe('Tool said: echo: hello')
    expect(second.end.stopReason).toBe('stop')

    // No tools offered → the plain answer.
    const plain = await round(custom(url, 'mock-model', 'hi'))
    expect(plain.text.length).toBeGreaterThan(0)
    expect(plain.end.toolCalls).toEqual([])
  })

  // Issue #226 P1: AI Chat never offers a bare `echo` — every MCP tool goes out
  // under its namespaced wire name (`wireToolName`: `<server>__<tool>`). The
  // preset matched `function.name == 'echo'` and called `echo`, so it never
  // fired from AI Chat. Fail-before: the first round was the plain answer.
  it('tools: AI Chat’s namespaced wire name (buildToolNameTable) gets a call to that exact name', async () => {
    const base = await serve('tools')
    const url = `${base}/v1/chat/completions`
    const table = buildToolNameTable([
      { serverId: 'srv-weather', server: 'Weather', tool: 'forecast' },
      { serverId: 'srv-echo', server: 'Echo tools', tool: 'echo' },
    ])
    const wire = [...table.keys()]
    expect(wire).toEqual(['Weather__forecast', 'Echo_tools__echo'])
    // A name that merely contains "echo" is not the echo tool.
    const tools = [
      ...wire.map((name) => ({ name, inputSchema: { type: 'object' } })),
      { name: 'Other__echoes', inputSchema: { type: 'object' } },
    ]
    const first = await round({ ...custom(url, 'mock-model', 'use the tool'), tools })
    expect(first.end.stopReason).toBe('tool_calls')
    expect(first.end.toolCalls).toHaveLength(1)
    const call = first.end.toolCalls[0]
    expect(call.name).toBe('Echo_tools__echo')
    expect(table.get(call.name)).toEqual({
      serverId: 'srv-echo',
      server: 'Echo tools',
      tool: 'echo',
    })
    expect(JSON.parse(call.argsJson)).toEqual({ text: 'hello from the mock LLM' })

    const second = await round({
      provider: 'custom',
      url,
      model: 'mock-model',
      messages: [
        { role: 'user', content: 'use the tool' },
        { role: 'assistant', content: '', toolCalls: [call] },
        {
          role: 'tool',
          results: [{ id: call.id, content: 'hello from the mock LLM', isError: false }],
        },
      ],
      tools,
    })
    expect(second.text).toBe('Tool said: hello from the mock LLM')
    expect(second.end.stopReason).toBe('stop')

    // Offered tools without any echo → the plain answer, not a call to a tool nobody offered.
    const none = await round({
      ...custom(url, 'mock-model', 'hi'),
      tools: [{ name: 'Weather__forecast', inputSchema: { type: 'object' } }],
    })
    expect(none.end.toolCalls).toEqual([])
    expect(none.text.length).toBeGreaterThan(0)
  })

  it('errors: the model name picks 429 (+ retry-after), 500 or 401; any other model gets a reply', async () => {
    const base = await serve('errors')
    const url = `${base}/v1/chat/completions`
    for (const [model, status, text] of [
      ['error-429', 429, 'Rate limit reached'],
      ['error-500', 500, 'The server had an error'],
      ['error-401', 401, 'Incorrect API key provided'],
    ] as const) {
      const err = await round(custom(url, model, 'x')).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(AiHttpError)
      expect((err as AiHttpError).status).toBe(status)
      expect((err as AiHttpError).message).toContain(text)
    }
    const raw = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'error-429', messages: [{ role: 'user', content: 'x' }] }),
    })
    expect(raw.status).toBe(429)
    expect(raw.headers.get('retry-after')).toBe('2')
    expect(await raw.json()).toEqual({
      error: { message: 'Rate limit reached', type: 'rate_limit_error' },
    })
    const unauthorized = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'error-401', messages: [] }),
    })
    expect(await unauthorized.json()).toMatchObject({ error: { code: 'invalid_api_key' } })

    const ok = await round(custom(url, 'mock-model', 'hello'))
    expect(ok.text).toBe('Hello from the mock LLM. You said: hello')
    expect(ok.end.status).toBe(200)
  })
})

/**
 * The whole offline round trip the preset promises (issue #226 P1): AI Chat's
 * real tool loop (`runAiTurn`) with the real model client (`streamChatRound`)
 * against the "Tool-call API" mock, and the real MCP client against a running
 * Mock MCP "Echo MCP" server built from its preset. Only the approval is
 * automatic ("Run tools without asking").
 * Fail-before: the model never asked for the tool — no MCP call, "Plain answer".
 */
describe('Tool-call API preset ↔ AI Chat tool loop ↔ Mock MCP Echo', () => {
  const mcpIds: string[] = []
  afterEach(async () => {
    for (const id of mcpIds.splice(0)) await mockMcpServerManager.stop(id)
  })

  it('the model calls Echo MCP__echo, the MCP server answers, the model says "Tool said: …"', async () => {
    const base = await serve('tools')
    const preset = buildPresetInput('echo', { projectId: 'p', takenNames: [], takenPorts: [] })
    const mcpDef: MockMcpServerDef = {
      id: 'mcp-echo-roundtrip',
      name: preset.name,
      description: preset.description ?? '',
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
      tools: preset.tools ?? [],
      resources: [],
      prompts: [],
    }
    const started = await mockMcpServerManager.start(mcpDef)
    if (!started.ok) throw new Error(started.error)
    mcpIds.push(mcpDef.id)

    const calls: Array<{ name: string; args: Record<string, unknown> }> = []
    const deps: AiLoopDeps = {
      streamRound: streamChatRound,
      openSession: (connect, signal, timeoutMs) =>
        mcpOpenDetachedSession({
          connect,
          signal,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        }),
      callTool: (id, name, args, opts) => {
        calls.push({ name, args })
        return mcpSessionCallTool(id, name, args, opts)
      },
      closeSession: (id) => mcpDisconnect(id),
      isTrusted: async () => false,
    }
    let text = ''
    const parts: Array<Record<string, unknown>> = []
    const res = await runAiTurn(
      {
        stream: { provider: 'custom', url: `${base}/v1/chat/completions`, model: 'mock-model' },
        messages: [{ role: 'user', content: 'use the tool' }],
        tools: {
          projectId: 'p',
          servers: [
            {
              id: mcpDef.id,
              name: mcpDef.name,
              connect: {
                transport: 'http',
                url: started.state.url as string,
                protocol: 'auto',
              },
              disabledTools: [],
            },
          ],
          autoApprove: true,
          allowedTools: [],
        },
      },
      deps,
      {
        signal: new AbortController().signal,
        onText: (d) => {
          text += d
        },
        onTruncated: () => {},
        onPart: (p) => parts.push(p as unknown as Record<string, unknown>),
        onCall: () => {},
        askApproval: async () => 'once',
        askStdioTrust: async () => 'skip',
      },
    )
    expect(res.outcome).toBe('done')
    expect(res.rounds).toBe(2)
    // The MCP client got the bare MCP name back from the wire name the model used.
    expect(calls).toEqual([{ name: 'echo', args: { text: 'hello from the mock LLM' } }])
    expect(parts.find((p) => p.type === 'tool_call')).toMatchObject({
      server: 'Echo MCP',
      tool: 'echo',
    })
    expect(text).toBe('Tool said: hello from the mock LLM')
    expect(mcpConnectionIds()).toEqual([])
  })
})
