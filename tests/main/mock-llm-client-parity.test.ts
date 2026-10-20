/**
 * Issue #221 (Faz 2a, design §9.4 + Ek D §D.3.5) — an AI (`bodyType: 'llm'`)
 * mock on a real loopback listener, consumed by Testnizer's OWN AI Chat
 * engine (`streamChatRound`, the code the AI Chat tab runs). No SDK, no
 * fixture LLM: the claim "the AI Chat tab works against the mock" is proven
 * over the network.
 *
 * Fail-before: the engine had no `llm` branch — the body went out once as
 * `text/plain`, so no delta arrived, `end.usage` was null and no tool call
 * was parsed.
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
import { freePort, llmResponse, serverDef, waitFor, type RouteSpec } from './mock-sse-fixtures'

const ID = 'llm-mock'

afterEach(async () => {
  await mockServerManager.stopAll()
  expect(await waitFor(() => sseWriterLiveTimers() === 0, 1000)).toBe(true)
})

/** Start a mock whose routes may carry several responses (first matching condition wins). */
async function start(routes: (RouteSpec & { more?: RouteSpec['response'][] })[]): Promise<string> {
  const port = await freePort()
  const def = serverDef(
    ID,
    port,
    routes.map(({ more: _more, ...r }) => ({ method: 'POST' as const, ...r })),
  )
  routes.forEach((r, i) => {
    for (const [j, extra] of (r.more ?? []).entries()) {
      def.endpoints[i].responses.push({
        ...def.endpoints[i].responses[0],
        id: `resp-${i}-${j + 1}`,
        order: j + 1,
        condition: { type: 'always' },
        ...extra,
      } as MockResponseDef)
    }
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

/** Raw `data:` payloads of an SSE response (strings; `[DONE]` kept). */
async function rawFrames(url: string, body: unknown): Promise<{ ct: string; data: string[] }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const data = text
    .split('\n\n')
    .map((block) =>
      block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n'),
    )
    .filter((d) => d !== '')
  return { ct: res.headers.get('content-type') ?? '', data }
}

const HELLO = 'Hello from the mock LLM. You said: {{lastUserMessage}}'
const ECHO_ARGS = { text: 'hello from the mock LLM' }

/** The design's "Tool call round-trip" preset (Ek D §D.3.1), for one provider. */
function toolRoundTrip(provider: 'openai' | 'anthropic'): RouteSpec & {
  more: RouteSpec['response'][]
} {
  const hasToolResult =
    provider === 'openai'
      ? "$.messages[?(@.role=='tool')]"
      : "$.messages[*].content[?(@.type=='tool_result')]"
  const offersEcho =
    provider === 'openai' ? "$.tools[?(@.function.name=='echo')]" : "$.tools[?(@.name=='echo')]"
  return {
    path: provider === 'openai' ? '/v1/chat/completions' : '/v1/messages',
    response: llmResponse(
      'Tool said: {{lastToolResult}}',
      { provider },
      { condition: { type: 'jsonPath', path: hasToolResult, op: 'exists' } },
    ),
    more: [
      llmResponse(
        '',
        { provider, toolCalls: [{ name: 'echo', arguments: ECHO_ARGS }] },
        { condition: { type: 'jsonPath', path: offersEcho, op: 'exists' } },
      ),
      llmResponse('Plain answer', { provider }),
    ],
  }
}

describe('OpenAI-compatible llm mock ↔ the AI Chat engine (provider custom)', () => {
  it('streams the templated text; end.usage comes from the finish chunk (no include_usage)', async () => {
    const base = await start([{ path: '/v1/chat/completions', response: llmResponse(HELLO) }])
    const r = await round({
      provider: 'custom',
      url: `${base}/v1/chat/completions`,
      model: 'mock-model',
      messages: [{ role: 'user', content: 'hi there' }],
    })
    expect(r.text).toBe('Hello from the mock LLM. You said: hi there')
    expect(r.end.status).toBe(200)
    expect(r.end.stopReason).toBe('stop')
    expect(r.end.toolCalls).toEqual([])
    expect(r.end.usage).not.toBeNull()
    expect(r.end.usage!.inputTokens).toBeGreaterThan(0)
    expect(r.end.usage!.outputTokens).toBeGreaterThan(0)
    expect(r.end.firstContentAt).not.toBeNull()
  })

  it('fixed usage numbers reach end.usage as configured', async () => {
    const base = await start([
      {
        path: '/v1/chat/completions',
        response: llmResponse('ok', { usage: { inputTokens: 11, outputTokens: 7 } }),
      },
    ])
    const r = await round({
      provider: 'custom',
      url: `${base}/v1/chat/completions`,
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
    })
    expect(r.end.usage).toEqual({ inputTokens: 11, outputTokens: 7 })
  })

  it('tool call round trip: echo is called with the configured arguments, the result turn answers', async () => {
    const base = await start([toolRoundTrip('openai')])
    const url = `${base}/v1/chat/completions`
    const first = await round({
      provider: 'custom',
      url,
      model: 'mock-model',
      messages: [{ role: 'user', content: 'use the tool' }],
      tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
    })
    expect(first.text).toBe('')
    expect(first.end.stopReason).toBe('tool_calls')
    expect(first.end.toolCalls).toHaveLength(1)
    const call = first.end.toolCalls[0]
    expect(call.name).toBe('echo')
    expect(call.id).toMatch(/^call_/)
    expect(JSON.parse(call.argsJson)).toEqual(ECHO_ARGS)

    const second = await round({
      provider: 'custom',
      url,
      model: 'mock-model',
      messages: [
        { role: 'user', content: 'use the tool' },
        { role: 'assistant', content: '', toolCalls: [call] },
        { role: 'tool', results: [{ id: call.id, content: 'echo: hello', isError: false }] },
      ],
      tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
    })
    expect(second.text).toBe('Tool said: echo: hello')
    expect(second.end.stopReason).toBe('stop')
    expect(second.end.toolCalls).toEqual([])
  })

  it('no tools offered → the plain answer (tools absent and empty behave the same)', async () => {
    const base = await start([toolRoundTrip('openai')])
    const r = await round({
      provider: 'custom',
      url: `${base}/v1/chat/completions`,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    })
    expect(r.text).toBe('Plain answer')
    expect(r.end.toolCalls).toEqual([])
  })

  it('include_usage: true (provider openai) adds the {choices: [], usage} chunk before [DONE]', async () => {
    const base = await start([{ path: '/v1/chat/completions', response: llmResponse(HELLO) }])
    const url = `${base}/v1/chat/completions`
    // The engine's openai provider sends stream_options.include_usage.
    const r = await round({
      provider: 'openai',
      url,
      model: 'gpt-x',
      messages: [{ role: 'user', content: 'yo' }],
    })
    expect(r.text).toBe('Hello from the mock LLM. You said: yo')
    expect(r.end.usage).not.toBeNull()

    const asked = await rawFrames(url, {
      model: 'gpt-x',
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: 'user', content: 'yo' }],
    })
    expect(asked.ct).toBe('text/event-stream; charset=utf-8')
    expect(asked.data.at(-1)).toBe('[DONE]')
    const chunks = asked.data.slice(0, -1).map((d) => JSON.parse(d) as Record<string, unknown>)
    const usageOnly = chunks.at(-1)!
    expect(usageOnly.choices).toEqual([])
    expect(usageOnly.usage).toMatchObject({ prompt_tokens: expect.any(Number) })
    // The finish chunk carries usage too, and every chunk reflects the request's model.
    const finish = chunks.at(-2)! as { choices: { finish_reason: string }[]; usage: unknown }
    expect(finish.choices[0].finish_reason).toBe('stop')
    expect(finish.usage).toEqual(usageOnly.usage)
    for (const c of chunks) expect(c.model).toBe('gpt-x')

    // Not asked (what `custom` sends): no choices-less chunk at all.
    const plain = await rawFrames(url, {
      model: 'gpt-x',
      stream: true,
      messages: [{ role: 'user', content: 'yo' }],
    })
    const plainChunks = plain.data.slice(0, -1).map((d) => JSON.parse(d) as { choices: unknown[] })
    expect(plainChunks.every((c) => c.choices.length === 1)).toBe(true)
  })

  it('stream absent → one chat.completion JSON with usage', async () => {
    const base = await start([{ path: '/v1/chat/completions', response: llmResponse(HELLO) }])
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      body: JSON.stringify({ model: 'gpt-x', messages: [{ role: 'user', content: 'yo' }] }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8')
    const json = (await res.json()) as Record<string, unknown> & {
      choices: { message: { content: string } }[]
      usage: Record<string, number>
    }
    expect(json.object).toBe('chat.completion')
    expect(json.model).toBe('gpt-x')
    expect(json.choices[0].message.content).toBe('Hello from the mock LLM. You said: yo')
    expect(json.usage.total_tokens).toBe(json.usage.prompt_tokens + json.usage.completion_tokens)
  })

  it('a configured error status reaches the engine as an AiHttpError with the JSON body', async () => {
    const body = '{"error":{"message":"Rate limit reached","type":"rate_limit_error"}}'
    const base = await start([
      {
        path: '/v1/chat/completions',
        response: llmResponse(body, {}, { statusCode: 429 }),
      },
    ])
    const err = await round({
      provider: 'custom',
      url: `${base}/v1/chat/completions`,
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiHttpError)
    expect((err as AiHttpError).status).toBe(429)
    expect((err as AiHttpError).message).toContain('Rate limit reached')
  })
})

describe('Anthropic llm mock ↔ the AI Chat engine (provider anthropic, URL override)', () => {
  it('streams the text; usage from message_start + message_delta; stop reason end_turn', async () => {
    const base = await start([
      {
        path: '/v1/messages',
        response: llmResponse(HELLO, {
          provider: 'anthropic',
          usage: { inputTokens: 21, outputTokens: 9 },
        }),
      },
    ])
    const r = await round({
      provider: 'anthropic',
      url: `${base}/v1/messages`,
      model: 'claude-mock',
      messages: [{ role: 'user', content: 'hello anthropic' }],
    })
    expect(r.text).toBe('Hello from the mock LLM. You said: hello anthropic')
    expect(r.end.stopReason).toBe('end_turn')
    expect(r.end.usage).toEqual({ inputTokens: 21, outputTokens: 9 })
  })

  it('tool call round trip: tool_use with the configured input, then the tool_result turn', async () => {
    const base = await start([toolRoundTrip('anthropic')])
    const url = `${base}/v1/messages`
    const tools = [{ name: 'echo', inputSchema: { type: 'object' } }]
    const first = await round({
      provider: 'anthropic',
      url,
      model: 'claude-mock',
      messages: [{ role: 'user', content: 'use the tool' }],
      tools,
    })
    expect(first.end.stopReason).toBe('tool_use')
    expect(first.end.toolCalls).toHaveLength(1)
    const call = first.end.toolCalls[0]
    expect(call.name).toBe('echo')
    expect(call.id).toMatch(/^toolu_/)
    expect(JSON.parse(call.argsJson)).toEqual(ECHO_ARGS)

    const second = await round({
      provider: 'anthropic',
      url,
      model: 'claude-mock',
      messages: [
        { role: 'user', content: 'use the tool' },
        { role: 'assistant', content: '', toolCalls: [call] },
        { role: 'tool', results: [{ id: call.id, content: 'echo: hi', isError: false }] },
      ],
      tools,
    })
    expect(second.text).toBe('Tool said: echo: hi')
    expect(second.end.stopReason).toBe('end_turn')
  })

  it('stream absent → one message JSON', async () => {
    const base = await start([
      { path: '/v1/messages', response: llmResponse(HELLO, { provider: 'anthropic' }) },
    ])
    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-mock',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'q' }],
      }),
    })
    const json = (await res.json()) as Record<string, unknown> & {
      content: { type: string; text: string }[]
      usage: Record<string, number>
    }
    expect(json.type).toBe('message')
    expect(json.model).toBe('claude-mock')
    expect(json.stop_reason).toBe('end_turn')
    expect(json.content).toEqual([{ type: 'text', text: 'Hello from the mock LLM. You said: q' }])
    expect(json.usage.input_tokens).toBeGreaterThan(0)
  })

  it('a request body that is not JSON gets the provider-shaped 400', async () => {
    const base = await start([
      { path: '/v1/messages', response: llmResponse(HELLO, { provider: 'anthropic' }) },
    ])
    const res = await fetch(`${base}/v1/messages`, { method: 'POST', body: 'not json' })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { type: string; error: { type: string; message: string } }
    expect(json.type).toBe('error')
    expect(json.error.type).toBe('invalid_request_error')
  })
})
