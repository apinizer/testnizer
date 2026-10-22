/**
 * Issue #221 (Faz 2a, design §9.2) — the pure pieces of the AI mock reply:
 * chunking, request reading, the plan, and the OpenAI / Anthropic encoders,
 * fed back through Testnizer's own `StreamRoundParser` (the parser the AI
 * Chat tab runs) for parity. Fail-before: none of these modules existed.
 */
import { describe, it, expect } from 'vitest'
import { argumentPieces, chunkText, LLM_MAX_CHUNK_CHARS } from '../../src/main/mock/stream/chunking'
import {
  buildLlmPlan,
  encodeLlmEvents,
  encodeLlmJson,
  estimateTokens,
  readLlmRequest,
  type LlmIds,
  type LlmPlan,
  type LlmRequest,
} from '../../src/main/mock/stream/llm'
import { sseEventBlock, type SseEvent } from '../../src/main/mock/stream/sse-writer'
import { StreamRoundParser } from '../../src/main/protocols/ai-chat.engine'
import { normalizeLlmConfig, type MockLlmConfig } from '../../src/shared/mock-stream'

const IDS: LlmIds = {
  newId: (() => {
    let n = 0
    return (prefix: string) => `${prefix}${++n}`
  })(),
  nowSeconds: () => 1_700_000_000,
}

const REQ: LlmRequest = { stream: true, model: 'gpt-x', includeUsage: false, promptChars: 40 }

function plan(
  cfg: Partial<MockLlmConfig>,
  text: string,
  req: Partial<LlmRequest> = {},
  render: (s: string) => string = (s) => s,
): LlmPlan {
  const r = buildLlmPlan(normalizeLlmConfig(cfg), { ...REQ, ...req }, text, render, IDS)
  if (!r.ok) throw new Error(r.reply.body)
  return r.value
}

const json = (e: SseEvent): Record<string, unknown> => JSON.parse(e.data) as Record<string, unknown>

/** Feed encoded events through the AI Chat parser, the way streamChatRound does. */
function parse(provider: 'openai' | 'anthropic', events: SseEvent[]) {
  const parser = new StreamRoundParser(provider === 'openai' ? 'custom' : 'anthropic')
  let text = ''
  for (const e of events) {
    if (e.data === '[DONE]') break
    text += parser.feed(JSON.parse(e.data)).delta
  }
  return {
    text,
    toolCalls: parser.toolCalls(),
    usage: parser.usageOrNull(),
    stop: parser.stopReason(),
  }
}

const TEXT = 'Hello there, world! How are you?\nFine. Thanks… 😀 ok'

describe('chunkText', () => {
  it.each(['word', 'char', 'sentence', 'fixed', 'whole'] as const)(
    '%s chunks join back to the text',
    (mode) => {
      for (const t of [TEXT, '  leading', 'trailing  ', 'one', ' ', '3.14 is pi. Yes!']) {
        expect(chunkText(t, mode).join('')).toBe(t)
      }
      expect(chunkText('', mode)).toEqual([])
    },
  )

  it('word: a word plus its trailing whitespace; char: code points (emoji kept whole)', () => {
    expect(chunkText('Hi  there you', 'word')).toEqual(['Hi  ', 'there ', 'you'])
    expect(chunkText(' a b', 'word')).toEqual([' a ', 'b'])
    expect(chunkText('a😀b', 'char')).toEqual(['a', '😀', 'b'])
  })

  it('sentence: ends at . ! ? before whitespace, or a line break', () => {
    expect(chunkText('One. Two! 3.14 three?\nFour', 'sentence')).toEqual([
      'One. ',
      'Two! ',
      '3.14 three?\n',
      'Four',
    ])
  })

  it(`a chunk never exceeds ${LLM_MAX_CHUNK_CHARS} code points`, () => {
    const long = 'x'.repeat(LLM_MAX_CHUNK_CHARS * 2 + 5)
    const chunks = chunkText(long, 'word')
    expect(chunks.map((c) => c.length)).toEqual([LLM_MAX_CHUNK_CHARS, LLM_MAX_CHUNK_CHARS, 5])
    expect(chunks.join('')).toBe(long)
  })

  it('argumentPieces: 1 piece when short, at most 16, joins back', () => {
    expect(argumentPieces('{}')).toEqual(['{}'])
    expect(argumentPieces('')).toEqual([''])
    const args = JSON.stringify({ text: 'hello from the mock LLM' })
    const pieces = argumentPieces(args)
    expect(pieces.length).toBeGreaterThanOrEqual(8)
    expect(pieces.join('')).toBe(args)
    expect(argumentPieces('y'.repeat(5000)).length).toBe(16)
  })
})

describe('readLlmRequest', () => {
  it('reads stream / model / include_usage / prompt size from any content type', () => {
    const r = readLlmRequest(
      'openai',
      JSON.stringify({
        model: 'gpt-x',
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: [{ type: 'text', text: 'abcd' }] },
        ],
      }),
    )
    expect(r).toEqual({
      ok: true,
      value: { stream: true, model: 'gpt-x', includeUsage: true, promptChars: 7 },
    })
  })

  it('stream must be literally true; model defaults to mock-model; Anthropic never includeUsage', () => {
    const r = readLlmRequest(
      'anthropic',
      JSON.stringify({
        stream: 'yes',
        system: 'be brief',
        stream_options: { include_usage: true },
        messages: [
          {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 't', content: 'result' }],
          },
        ],
      }),
    )
    expect(r).toEqual({
      ok: true,
      value: { stream: false, model: 'mock-model', includeUsage: false, promptChars: 14 },
    })
  })

  it('not JSON / not an object / no messages → the provider-shaped 400', () => {
    const o = readLlmRequest('openai', 'nope')
    expect(o.ok).toBe(false)
    if (o.ok) return
    expect(o.reply.status).toBe(400)
    expect(JSON.parse(o.reply.body)).toEqual({
      error: {
        message:
          'We could not parse the JSON body of your request. The request body must be a JSON object.',
        type: 'invalid_request_error',
        param: null,
        code: null,
      },
    })
    const a = readLlmRequest('anthropic', '{"model":"m"}')
    expect(a.ok).toBe(false)
    if (a.ok) return
    expect(JSON.parse(a.reply.body)).toEqual({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'messages: Field required' },
    })
    const arr = readLlmRequest('openai', '[]')
    expect(!arr.ok && JSON.parse(arr.reply.body).error.message).toBe(
      'The request body must be a JSON object',
    )
    const noMsg = readLlmRequest('openai', '{}')
    expect(!noMsg.ok && JSON.parse(noMsg.reply.body).error.message).toBe(
      "'messages' is a required property",
    )
  })
})

describe('buildLlmPlan', () => {
  it("usage 'auto' ≈ chars / 4 (at least 1), deterministic; fixed numbers kept", () => {
    const p = plan({}, 'x'.repeat(10), { promptChars: 40 })
    expect(p.usage).toEqual({ inputTokens: 10, outputTokens: 3 })
    expect(plan({}, '', { promptChars: 0 }).usage).toEqual({ inputTokens: 1, outputTokens: 1 })
    expect(estimateTokens(9)).toBe(3)
    expect(plan({ usage: { inputTokens: 5, outputTokens: 6 } }, 'abc').usage).toEqual({
      inputTokens: 5,
      outputTokens: 6,
    })
  })

  it('reflects the model; a tool call forces tool_calls; tool_calls without calls is stop', () => {
    expect(plan({}, 'a').model).toBe('gpt-x')
    expect(plan({ stopReason: 'length' }, 'a').stopReason).toBe('length')
    expect(plan({ toolCalls: [{ name: 'e', arguments: {} }] }, '').stopReason).toBe('tool_calls')
  })

  it('object arguments: string values rendered, serialised exactly once', () => {
    const render = (s: string): string => s.replace('{{lastUserMessage}}', 'say "hi"')
    const p = plan(
      {
        toolCalls: [
          {
            name: 'echo',
            arguments: { text: '{{lastUserMessage}}', n: 2, list: ['{{lastUserMessage}}'] },
          },
        ],
      },
      '',
      {},
      render,
    )
    const call = p.toolCalls[0]
    expect(call.arguments).toBe('{"text":"say \\"hi\\"","n":2,"list":["say \\"hi\\""]}')
    expect(JSON.parse(call.arguments)).toEqual(call.input)
    expect(call.id).toMatch(/^call_\d+$/)
  })

  it('string arguments: rendered and sent as is; a configured id is kept (and rendered)', () => {
    const p = plan(
      { toolCalls: [{ id: 'call_{{model}}', name: '{{model}}_tool', arguments: '{ "a" : 1 }' }] },
      '',
      {},
      (s) => s.replace(/\{\{model\}\}/g, 'm'),
    )
    expect(p.toolCalls[0]).toEqual({
      id: 'call_m',
      name: 'm_tool',
      arguments: '{ "a" : 1 }',
      input: { a: 1 },
    })
    // OpenAI arguments are text on the wire: malformed text is served (a client's error path).
    expect(
      plan({ toolCalls: [{ name: 't', arguments: '{"a":' }] }, '').toolCalls[0].arguments,
    ).toBe('{"a":')
  })

  it('Anthropic: arguments that do not render to an object → a provider-shaped 500', () => {
    const r = buildLlmPlan(
      normalizeLlmConfig({ provider: 'anthropic', toolCalls: [{ name: 't', arguments: '{"a":' }] }),
      REQ,
      '',
      (s) => s,
      IDS,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reply.status).toBe(500)
    expect(JSON.parse(r.reply.body)).toEqual({
      type: 'error',
      error: {
        type: 'api_error',
        message: 'Mock tool call "t": the arguments did not render to a JSON object',
      },
    })
  })
})

describe('OpenAI encoder', () => {
  it('non-stream chat.completion JSON with usage', () => {
    const body = JSON.parse(encodeLlmJson(plan({}, 'Hi there', { stream: false })))
    expect(body).toMatchObject({
      object: 'chat.completion',
      created: 1_700_000_000,
      model: 'gpt-x',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hi there' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    })
    expect(body.id).toMatch(/^chatcmpl-/)
    expect(body.choices[0].message.tool_calls).toBeUndefined()
  })

  it('non-stream tool calls: content null, tool_calls with string arguments', () => {
    const body = JSON.parse(
      encodeLlmJson(plan({ toolCalls: [{ id: 'c1', name: 'echo', arguments: { a: 1 } }] }, '')),
    )
    expect(body.choices[0]).toMatchObject({
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'echo', arguments: '{"a":1}' } },
        ],
      },
      finish_reason: 'tool_calls',
    })
  })

  it('stream: role chunk first, text chunks, finish chunk WITH usage, [DONE] last', () => {
    const events = encodeLlmEvents(plan({ chunking: 'word' }, 'Hello mock world'))
    expect(events.every((e) => e.event === undefined)).toBe(true)
    expect(events.at(-1)!.data).toBe('[DONE]')
    const chunks = events.slice(0, -1).map(json)
    for (const c of chunks) {
      expect(c).toMatchObject({
        object: 'chat.completion.chunk',
        model: 'gpt-x',
        created: 1_700_000_000,
      })
    }
    expect(chunks.map((c) => c.id).every((id) => id === chunks[0].id)).toBe(true)
    const choice = (c: Record<string, unknown>) => (c.choices as Record<string, unknown>[])[0]
    expect(choice(chunks[0]).delta).toEqual({ role: 'assistant', content: '' })
    expect(
      chunks.slice(1, -1).map((c) => (choice(c).delta as { content: string }).content),
    ).toEqual(['Hello ', 'mock ', 'world'])
    const finish = chunks.at(-1)!
    expect(choice(finish)).toMatchObject({ delta: {}, finish_reason: 'stop' })
    expect(finish.usage).toEqual({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 })
    // Only the finish chunk has a finish reason.
    expect(chunks.filter((c) => choice(c).finish_reason !== null)).toHaveLength(1)
  })

  it('include_usage: an extra {choices: [], usage} chunk right before [DONE]', () => {
    const events = encodeLlmEvents(plan({}, 'Hi', { includeUsage: true }))
    expect(events.at(-1)!.data).toBe('[DONE]')
    const usageChunk = json(events.at(-2)!)
    expect(usageChunk.choices).toEqual([])
    expect(usageChunk.usage).toEqual(json(events.at(-3)!).usage)
    const without = encodeLlmEvents(plan({}, 'Hi'))
    expect(without).toHaveLength(events.length - 1)
  })

  it('tool calls: opening fragment (index/id/type/name), then arguments-only fragments', () => {
    const args = { text: 'hello from the mock LLM' }
    const events = encodeLlmEvents(
      plan(
        {
          toolCalls: [
            { id: 'call_a', name: 'echo', arguments: args },
            { name: 'second', arguments: '{}' },
          ],
        },
        'Calling',
      ),
    )
    const deltas = events
      .slice(0, -1)
      .map(json)
      .map((c) => ((c.choices as { delta: Record<string, unknown> }[])[0] ?? { delta: {} }).delta)
    const frags = deltas.flatMap((d) => (d.tool_calls as Record<string, unknown>[]) ?? [])
    expect(frags[0]).toEqual({
      index: 0,
      id: 'call_a',
      type: 'function',
      function: { name: 'echo', arguments: '' },
    })
    const rest0 = frags.filter((f) => f.index === 0).slice(1)
    for (const f of rest0) expect(Object.keys(f).sort()).toEqual(['function', 'index'])
    expect(rest0.map((f) => (f.function as { arguments: string }).arguments).join('')).toBe(
      JSON.stringify(args),
    )
    expect(frags.find((f) => f.index === 1)).toMatchObject({
      type: 'function',
      function: { name: 'second' },
    })
  })

  it('parity: the AI Chat parser reassembles text, tool calls, usage and stop reason', () => {
    const args = { text: 'hi', nested: { n: [1, 2] } }
    const p = plan(
      { chunking: 'char', toolCalls: [{ id: 'call_z', name: 'echo', arguments: args }] },
      TEXT,
      { includeUsage: true },
    )
    const r = parse('openai', encodeLlmEvents(p))
    expect(r.text).toBe(TEXT)
    expect(r.toolCalls).toEqual([{ id: 'call_z', name: 'echo', argsJson: JSON.stringify(args) }])
    expect(r.usage).toEqual({
      inputTokens: p.usage.inputTokens,
      outputTokens: p.usage.outputTokens,
    })
    expect(r.stop).toBe('tool_calls')
  })
})

describe('Anthropic encoder', () => {
  const anth = (cfg: Partial<MockLlmConfig>, text: string, req: Partial<LlmRequest> = {}) =>
    plan({ provider: 'anthropic', ...cfg }, text, req)

  it('non-stream message JSON', () => {
    const body = JSON.parse(
      encodeLlmJson(
        anth({ toolCalls: [{ id: 'toolu_1', name: 'echo', arguments: { a: 1 } }] }, 'Sure'),
      ),
    )
    expect(body).toEqual({
      id: expect.stringMatching(/^msg_/),
      type: 'message',
      role: 'assistant',
      model: 'gpt-x',
      content: [
        { type: 'text', text: 'Sure' },
        { type: 'tool_use', id: 'toolu_1', name: 'echo', input: { a: 1 } },
      ],
      stop_reason: 'tool_use',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: expect.any(Number) },
    })
    expect(JSON.parse(encodeLlmJson(anth({ stopReason: 'length' }, 'x'))).stop_reason).toBe(
      'max_tokens',
    )
    // Tools only: no empty text block.
    expect(
      JSON.parse(encodeLlmJson(anth({ toolCalls: [{ name: 'e', arguments: {} }] }, ''))).content,
    ).toEqual([{ type: 'tool_use', id: expect.stringMatching(/^toolu_/), name: 'e', input: {} }])
  })

  it('stream: event order, event: names match data.type, cumulative output usage', () => {
    const events = encodeLlmEvents(
      anth(
        {
          usage: { inputTokens: 21, outputTokens: 9 },
          toolCalls: [{ id: 'toolu_x', name: 'echo', arguments: { text: 'hello' } }],
        },
        'One two',
      ),
    )
    for (const e of events) expect(json(e).type).toBe(e.event)
    expect(events.map((e) => e.event)).toEqual([
      'message_start',
      'content_block_start',
      'ping',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'content_block_start',
      ...argumentPieces('{"text":"hello"}').map(() => 'content_block_delta'),
      'content_block_stop',
      'message_delta',
      'message_stop',
    ])
    const start = json(events[0]) as { message: { usage: unknown; model: string } }
    expect(start.message.usage).toEqual({ input_tokens: 21, output_tokens: 1 })
    expect(start.message.model).toBe('gpt-x')
    const delta = json(events.at(-2)!)
    expect(delta).toEqual({
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 9 },
    })
    // Block indices are contiguous from 0.
    const starts = events.filter((e) => e.event === 'content_block_start').map((e) => json(e).index)
    expect(starts).toEqual([0, 1])
    const toolStart = json(events[6]) as { content_block: unknown }
    expect(toolStart.content_block).toEqual({
      type: 'tool_use',
      id: 'toolu_x',
      name: 'echo',
      input: {},
    })
    const partial = events
      .map(json)
      .filter((d) => (d.delta as { type?: string })?.type === 'input_json_delta')
      .map((d) => (d.delta as { partial_json: string }).partial_json)
      .join('')
    expect(JSON.parse(partial)).toEqual({ text: 'hello' })
  })

  it('parity: the AI Chat parser reassembles text, tool call, usage and stop reason', () => {
    const p = anth(
      { chunking: 'sentence', toolCalls: [{ id: 'toolu_q', name: 'echo', arguments: { t: 'x' } }] },
      TEXT,
    )
    const r = parse('anthropic', encodeLlmEvents(p))
    expect(r.text).toBe(TEXT)
    expect(r.toolCalls).toEqual([{ id: 'toolu_q', name: 'echo', argsJson: '{"t":"x"}' }])
    expect(r.usage).toEqual({
      inputTokens: p.usage.inputTokens,
      outputTokens: p.usage.outputTokens,
    })
    expect(r.stop).toBe('tool_use')
  })
})

describe('sseEventBlock — framing has one owner', () => {
  it('event: line then one data: line per data line', () => {
    expect(sseEventBlock({ event: 'ping', data: '{"type":"ping"}' })).toEqual({
      raw: 'event: ping\ndata: {"type":"ping"}',
      separator: '\n\n',
      id: null,
      dynamicId: false,
    })
    expect(sseEventBlock({ data: 'a\nb' }).raw).toBe('data: a\ndata: b')
  })
})
