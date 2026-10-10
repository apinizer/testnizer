/**
 * Issues #180 / #198 — tool calls and usage from the providers' SSE streams.
 *
 * Fixtures are byte-for-byte what OpenAI-compatible and Anthropic endpoints
 * stream: indexed `tool_calls` fragments (parallel calls, arguments split
 * across chunks), Anthropic `tool_use` blocks + `input_json_delta`, malformed
 * argument JSON, and the usage frames (`include_usage` chunk with
 * `choices: []`, Groq's `x_groq.usage`, Anthropic `message_start` /
 * `message_delta`). Missing usage must come back as null — "not reported",
 * never 0.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  acceptsStreamUsageOption,
  buildBody,
  streamChatCompletion,
  streamChatRound,
  type AiProvider,
  type AiRoundEvent,
} from '../../src/main/protocols/ai-chat.engine'

function sse(events: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(e))
      c.close()
    },
  })
}

const data = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

async function round(
  provider: AiProvider,
  events: string[],
  status = 200,
): Promise<{ events: AiRoundEvent[]; body: Record<string, unknown> }> {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(sse(events), { status, headers: { 'content-type': 'text/event-stream' } }),
    )
  globalThis.fetch = fetchMock as unknown as typeof fetch
  const out: AiRoundEvent[] = []
  for await (const ev of streamChatRound({
    provider,
    apiKey: 'k',
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
  })) {
    out.push(ev)
  }
  const init = fetchMock.mock.calls[0][1] as { body: string }
  return { events: out, body: JSON.parse(init.body) as Record<string, unknown> }
}

const endOf = (events: AiRoundEvent[]): Extract<AiRoundEvent, { type: 'end' }> => {
  const e = events.find((x) => x.type === 'end')
  if (!e || e.type !== 'end') throw new Error('no end event')
  return e
}

describe('OpenAI-compatible tool_calls stream', () => {
  it('assembles PARALLEL calls from indexed fragments and joins split arguments', async () => {
    const { events } = await round('openai', [
      data({ choices: [{ delta: { role: 'assistant', content: null } }] }),
      data({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_a',
                  type: 'function',
                  function: { name: 'weather__get', arguments: '' },
                },
              ],
            },
          },
        ],
      }),
      data({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"ci' } }] } }],
      }),
      data({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: 'call_b',
                  type: 'function',
                  function: { name: 'clock__now', arguments: '' },
                },
              ],
            },
          },
        ],
      }),
      data({
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"Ankara"}' } }] } },
        ],
      }),
      data({ choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{}' } }] } }] }),
      data({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]\n\n',
    ])
    const end = endOf(events)
    expect(end.toolCalls).toEqual([
      { id: 'call_a', name: 'weather__get', argsJson: '{"city":"Ankara"}' },
      { id: 'call_b', name: 'clock__now', argsJson: '{}' },
    ])
    expect(end.stopReason).toBe('tool_calls')
    expect(end.firstContentAt).not.toBeNull()
    expect(events.filter((e) => e.type === 'text')).toEqual([])
  })

  it('keeps malformed argument JSON as text (the loop turns it into an error result)', async () => {
    const { events } = await round('openai', [
      data({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_x', function: { name: 'a__b', arguments: '{"city": ' } },
              ],
            },
          },
        ],
      }),
      data({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
      'data: [DONE]\n\n',
    ])
    expect(endOf(events).toolCalls).toEqual([{ id: 'call_x', name: 'a__b', argsJson: '{"city": ' }])
  })

  it('handles fragments without `index` (some compatible gateways) by id', async () => {
    const { events } = await round('google', [
      data({
        choices: [
          {
            delta: {
              tool_calls: [{ id: 'g1', function: { name: 'a__one', arguments: '{"x":1}' } }],
            },
          },
        ],
      }),
      data({
        choices: [
          {
            delta: {
              tool_calls: [{ id: 'g2', function: { name: 'a__two', arguments: { y: 2 } } }],
            },
          },
        ],
      }),
      data({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      'data: [DONE]\n\n',
    ])
    expect(endOf(events).toolCalls).toEqual([
      { id: 'g1', name: 'a__one', argsJson: '{"x":1}' },
      { id: 'g2', name: 'a__two', argsJson: '{"y":2}' },
    ])
  })

  it('reads the include_usage chunk (choices: []) with cached + reasoning tokens', async () => {
    const { events } = await round('openai', [
      data({ choices: [{ delta: { content: 'Hi' } }] }),
      data({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
      data({
        choices: [],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          total_tokens: 150,
          prompt_tokens_details: { cached_tokens: 100 },
          completion_tokens_details: { reasoning_tokens: 12 },
        },
      }),
      'data: [DONE]\n\n',
    ])
    expect(endOf(events).usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cachedTokens: 100,
      reasoningTokens: 12,
    })
  })

  it("reads Groq's x_groq.usage, last value wins (never summed)", async () => {
    const { events } = await round('groq', [
      data({
        choices: [{ delta: { content: 'a' } }],
        x_groq: { usage: { prompt_tokens: 5, completion_tokens: 1 } },
      }),
      data({
        choices: [{ delta: {}, finish_reason: 'stop' }],
        x_groq: { usage: { prompt_tokens: 5, completion_tokens: 9 } },
      }),
      'data: [DONE]\n\n',
    ])
    expect(endOf(events).usage).toEqual({ inputTokens: 5, outputTokens: 9 })
  })

  it('usage is null when the provider sends none — "not reported", not 0', async () => {
    const { events } = await round('mistral', [
      data({ choices: [{ delta: { content: 'x' } }] }),
      'data: [DONE]\n\n',
    ])
    expect(endOf(events).usage).toBeNull()
  })

  it('a non-2xx response throws AiHttpError carrying the status', async () => {
    await expect(round('openai', ['{"error":{"message":"slow down"}}'], 429)).rejects.toMatchObject(
      {
        status: 429,
      },
    )
  })
})

describe('Anthropic tool_use stream', () => {
  it('assembles tool_use blocks from input_json_delta, text kept separate, usage from message_start/delta', async () => {
    const { events } = await round('anthropic', [
      'event: message_start\n' +
        data({
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 40,
              cache_read_input_tokens: 200,
              cache_creation_input_tokens: 10,
              output_tokens: 1,
            },
          },
        }),
      data({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      data({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Checking.' },
      }),
      data({ type: 'content_block_stop', index: 0 }),
      data({
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'weather__get', input: {} },
      }),
      data({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"city":' },
      }),
      data({
        type: 'content_block_start',
        index: 2,
        content_block: { type: 'tool_use', id: 'toolu_2', name: 'clock__now', input: {} },
      }),
      data({
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '"Izmir"}' },
      }),
      data({ type: 'content_block_stop', index: 1 }),
      data({ type: 'content_block_stop', index: 2 }),
      data({
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 57 },
      }),
      data({ type: 'message_stop' }),
    ])
    expect(events.filter((e) => e.type === 'text')).toEqual([{ type: 'text', delta: 'Checking.' }])
    const end = endOf(events)
    expect(end.toolCalls).toEqual([
      { id: 'toolu_1', name: 'weather__get', argsJson: '{"city":"Izmir"}' },
      // No input_json_delta → the block's own (empty) input.
      { id: 'toolu_2', name: 'clock__now', argsJson: '{}' },
    ])
    expect(end.stopReason).toBe('tool_use')
    // input = 40 + 200 cache read + 10 cache creation; output = cumulative 57 (not 58).
    expect(end.usage).toEqual({ inputTokens: 250, outputTokens: 57, cachedTokens: 200 })
  })

  it('malformed partial_json is kept as text for the loop', async () => {
    const { events } = await round('anthropic', [
      data({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 't', name: 'a__b', input: {} },
      }),
      data({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"a":' },
      }),
      data({ type: 'message_stop' }),
    ])
    expect(endOf(events).toolCalls).toEqual([{ id: 't', name: 'a__b', argsJson: '{"a":' }])
  })
})

describe('request body — tools, replay and stream_options', () => {
  const tools = [
    {
      name: 'weather__get',
      description: '[Weather] get',
      inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
    },
  ]
  const transcript = [
    { role: 'system' as const, content: 'sys' },
    { role: 'user' as const, content: 'weather?' },
    {
      role: 'assistant' as const,
      content: 'Checking.',
      toolCalls: [
        { id: 'c1', name: 'weather__get', argsJson: '{"city":"Ankara"}' },
        { id: 'c2', name: 'weather__get', argsJson: '{bad' },
      ],
    },
    {
      role: 'tool' as const,
      results: [
        { id: 'c1', content: 'sunny', isError: false },
        { id: 'c2', content: 'bad args', isError: true },
      ],
    },
  ]

  it('OpenAI: function tools, assistant tool_calls, one tool message per result', () => {
    const body = buildBody({ provider: 'openai', model: 'm', messages: transcript, tools })
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'weather__get',
          description: '[Weather] get',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      },
    ])
    const msgs = body.messages as Array<Record<string, unknown>>
    expect(msgs[2]).toEqual({
      role: 'assistant',
      content: 'Checking.',
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'weather__get', arguments: '{"city":"Ankara"}' },
        },
        // Malformed arguments are replayed as {}.
        { id: 'c2', type: 'function', function: { name: 'weather__get', arguments: '{}' } },
      ],
    })
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'sunny' })
    expect(msgs[4]).toEqual({ role: 'tool', tool_call_id: 'c2', content: 'bad args' })
  })

  it('Anthropic: input_schema tools, tool_use blocks with object input, ONE user message of tool_results', () => {
    const body = buildBody({ provider: 'anthropic', model: 'm', messages: transcript, tools })
    expect(body.system).toBe('sys')
    expect(body.tools).toEqual([
      {
        name: 'weather__get',
        description: '[Weather] get',
        input_schema: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ])
    const msgs = body.messages as Array<Record<string, unknown>>
    expect(msgs[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: 'c1', name: 'weather__get', input: { city: 'Ankara' } },
        { type: 'tool_use', id: 'c2', name: 'weather__get', input: {} },
      ],
    })
    expect(msgs[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'c1', content: 'sunny' },
        { type: 'tool_result', tool_use_id: 'c2', content: 'bad args', is_error: true },
      ],
    })
  })

  it('no `tools` key at all when no tool is offered (MST-153)', () => {
    for (const provider of ['openai', 'anthropic', 'custom'] as const) {
      const body = buildBody({
        provider,
        model: 'm',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [],
      })
      expect('tools' in body).toBe(false)
    }
  })

  it('stream_options.include_usage only for the documented allowlist', () => {
    const on: AiProvider[] = [
      'openai',
      'openrouter',
      'groq',
      'deepseek',
      'xai',
      'fireworks',
      'deepinfra',
      'google',
    ]
    const off: AiProvider[] = [
      'mistral',
      'cohere',
      'perplexity',
      'together',
      'cerebras',
      'custom',
      'anthropic',
    ]
    for (const p of on) {
      expect(acceptsStreamUsageOption(p)).toBe(true)
      expect(buildBody({ provider: p, model: 'm', messages: [] }).stream_options).toEqual({
        include_usage: true,
      })
    }
    for (const p of off) {
      expect(acceptsStreamUsageOption(p)).toBe(false)
      expect('stream_options' in buildBody({ provider: p, model: 'm', messages: [] })).toBe(false)
    }
  })

  it('streamChatCompletion stays text-only over the richer round stream', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        sse([
          data({ choices: [{ delta: { content: 'A' } }] }),
          data({
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, id: 'c', function: { name: 'x__y', arguments: '{}' } }],
                },
              },
            ],
          }),
          data({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
          'data: [DONE]\n\n',
        ]),
        { status: 200 },
      ),
    ) as unknown as typeof fetch
    const out: unknown[] = []
    for await (const c of streamChatCompletion({ provider: 'openai', model: 'm', messages: [] }))
      out.push(c)
    expect(out).toEqual([{ delta: 'A' }])
  })
})

describe('Gemini (google) tool schemas — documented OpenAPI subset only', () => {
  const mcpSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    additionalProperties: false,
    $defs: { X: { type: 'string' } },
    properties: {
      city: { type: 'string', description: 'City', minLength: 1 },
      unit: { const: 'C' },
      days: { type: ['integer', 'null'], exclusiveMinimum: 0 },
      tags: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { k: { $ref: '#/$defs/X' } },
        },
      },
      either: { anyOf: [{ type: 'string', additionalProperties: true }, { type: 'number' }] },
    },
    required: ['city'],
  }
  const tools = [{ name: 'w__get', inputSchema: mcpSchema }]

  it('google: $schema / additionalProperties / $defs / $ref / exclusiveMinimum dropped at every level', () => {
    const body = buildBody({ provider: 'google', model: 'gemini-2.5-flash', messages: [], tools })
    const params = (body.tools as Array<{ function: { parameters: unknown } }>)[0].function
      .parameters
    expect(params).toEqual({
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City', minLength: 1 },
        unit: { enum: ['C'] },
        days: { type: 'integer', nullable: true },
        tags: { type: 'array', items: { type: 'object', properties: { k: {} } } },
        either: { anyOf: [{ type: 'string' }, { type: 'number' }] },
      },
      required: ['city'],
    })
    expect(JSON.stringify(params)).not.toMatch(/\$schema|additionalProperties|\$ref|\$defs/)
  })

  it('other providers get the schema untouched', () => {
    for (const provider of ['openai', 'groq', 'custom'] as const) {
      const body = buildBody({ provider, model: 'm', messages: [], tools })
      const params = (body.tools as Array<{ function: { parameters: Record<string, unknown> } }>)[0]
        .function.parameters
      expect(params.$schema).toBe(mcpSchema.$schema)
      expect(params.additionalProperties).toBe(false)
    }
    const anthropic = buildBody({ provider: 'anthropic', model: 'm', messages: [], tools })
    expect(
      (anthropic.tools as Array<{ input_schema: Record<string, unknown> }>)[0].input_schema
        .additionalProperties,
    ).toBe(false)
  })
})
