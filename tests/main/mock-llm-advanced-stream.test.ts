/**
 * Issue #222 (4) + (5) — the AI mock's advanced streaming settings and its
 * mid-stream error, on the wire:
 *
 *  - chunking `fixed` (N characters) and `whole` (one chunk), next to the
 *    existing word / char / sentence;
 *  - the stop reason in each provider's own words (OpenAI `finish_reason`:
 *    stop / length / tool_calls / content_filter; Anthropic `stop_reason`:
 *    end_turn / max_tokens / tool_use / stop_sequence / refusal), with
 *    Anthropic's `stop_sequence` field;
 *  - an error event after N chunks of partial output, then the end of the
 *    stream — the shapes the official SDKs raise on:
 *      OpenAI     unnamed `data: {"error": {…}}` (openai-python
 *                 `src/openai/_streaming.py`: `if is_mapping(data) and
 *                 data.get("error"): raise APIError`), no finish chunk, no
 *                 `[DONE]`;
 *      Anthropic  `event: error` + `{"type":"error","error":{"type":
 *                 "overloaded_error","message":"Overloaded"}}` (Claude
 *                 streaming docs, "Error events"; anthropic-sdk-typescript
 *                 `src/core/streaming.ts`: `if (sse.event === 'error') throw
 *                 new APIError`), no `message_delta` / `message_stop`.
 *
 * Then on a real loopback port, read raw AND by Testnizer's own AI Chat
 * engine (`streamChatRound`), which must now stop with the provider's error
 * instead of reading the cut stream as a successful partial answer.
 *
 * Fail-before: `fixed` / `whole`, `content_filter` / `stop_sequence` and
 * `streamError` were rejected by `validateLlmConfig`; the engine had no
 * error event; `streamChatRound` ended the cut stream with `end` (no error).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mockServerManager } from '../../src/main/mock/server'
import { sseWriterLiveTimers } from '../../src/main/mock/stream/sse-writer'
import { chunkText, countChunks } from '../../src/main/mock/stream/chunking'
import {
  buildLlmPlan,
  encodeLlmEvents,
  encodeLlmJson,
  encodeLlmStream,
  llmStreamFrameCount,
  type LlmIds,
  type LlmPlan,
} from '../../src/main/mock/stream/llm'
import {
  LLM_MAX_CHUNK_CHARS,
  normalizeLlmConfig,
  stopReasonFor,
  validateLlmConfig,
  type MockLlmProvider,
  type MockLlmStopReason,
} from '../../src/shared/mock-stream'
import {
  AiHttpError,
  streamChatRound,
  type AiStreamOptions,
} from '../../src/main/protocols/ai-chat.engine'
import { freePort, llmResponse, rawRead, serverDef, waitFor } from './mock-sse-fixtures'

const ID = 'llm-advanced'
const IDS: LlmIds = { newId: (p) => `${p}fixed`, nowSeconds: () => 1700000000 }
const PROVIDERS: readonly MockLlmProvider[] = ['openai', 'anthropic']

afterEach(async () => {
  await mockServerManager.stopAll()
  expect(await waitFor(() => sseWriterLiveTimers() === 0, 1000)).toBe(true)
})

function plan(cfg: Record<string, unknown>, text: string, includeUsage = false): LlmPlan {
  const r = buildLlmPlan(
    normalizeLlmConfig(cfg),
    { stream: true, model: 'm', includeUsage, promptChars: 3 },
    text,
    (s) => s,
    IDS,
  )
  if (!r.ok) throw new Error(r.reply.body)
  return r.value
}

const parsed = (data: string): Record<string, unknown> => JSON.parse(data)
const openAiDelta = (data: string): unknown =>
  (parsed(data).choices as { delta: { content?: string } }[])[0]?.delta?.content

// ─── Chunking ────────────────────────────────────────────────────

describe('chunking: fixed size and whole message', () => {
  const samples = ['', 'Hi', 'Hello there, world.', 'Ünïcödé 🙂 text 🙂🙂', 'x'.repeat(50)]

  it('fixed: N code points per chunk (emoji never split), joined back = the text', () => {
    for (const size of [1, 3, 8]) {
      for (const t of samples) {
        const chunks = chunkText(t, 'fixed', size)
        expect(chunks.join('')).toBe(t)
        for (const c of chunks.slice(0, -1)) expect(Array.from(c)).toHaveLength(size)
        expect(chunks.length).toBe(Math.ceil(Array.from(t).length / size))
      }
    }
    // Absent size = the default (8).
    expect(chunkText('abcdefghij', 'fixed')).toEqual(['abcdefgh', 'ij'])
  })

  it('whole: one chunk, still cut at the frame limit', () => {
    expect(chunkText('one two three.', 'whole')).toEqual(['one two three.'])
    const long = 'y'.repeat(LLM_MAX_CHUNK_CHARS + 10)
    expect(chunkText(long, 'whole').map((c) => c.length)).toEqual([LLM_MAX_CHUNK_CHARS, 10])
    expect(chunkText('', 'whole')).toEqual([])
  })

  it('countChunks equals chunkText(...).length, and stops past the limit', () => {
    for (const t of samples) {
      for (const size of [1, 3, 8]) {
        expect(countChunks(t, 'fixed', Infinity, size)).toBe(chunkText(t, 'fixed', size).length)
      }
      expect(countChunks(t, 'whole')).toBe(chunkText(t, 'whole').length)
    }
    expect(countChunks('x'.repeat(100), 'fixed', 10, 3)).toBeGreaterThan(10)
  })

  it('llmStreamFrameCount equals the encoded event count for fixed and whole', () => {
    for (const provider of PROVIDERS) {
      for (const [chunking, chunkSize] of [
        ['fixed', 3],
        ['fixed', undefined],
        ['whole', undefined],
      ] as const) {
        for (const text of ['', 'Hi there. Bye!', 'Ünïcödé 🙂 text']) {
          const p = plan({ provider, chunking, ...(chunkSize ? { chunkSize } : {}) }, text)
          expect(llmStreamFrameCount(p)).toBe(encodeLlmEvents(p).length)
        }
      }
    }
  })

  it('the OpenAI stream carries the fixed-size pieces; whole is one delta', () => {
    const fixed = encodeLlmEvents(plan({ chunking: 'fixed', chunkSize: 4 }, 'abcdefghij'))
    expect(fixed.map((e) => (e.data === '[DONE]' ? null : openAiDelta(e.data)))).toEqual([
      '',
      'abcd',
      'efgh',
      'ij',
      undefined,
      null,
    ])
    const whole = encodeLlmEvents(plan({ chunking: 'whole' }, 'one two three'))
    expect(whole.filter((e) => e.content).map((e) => openAiDelta(e.data))).toEqual([
      'one two three',
    ])
  })
})

// ─── Stop reasons ────────────────────────────────────────────────

/** The wire values, written out independently of the engine's table. */
const WIRE: Record<MockLlmProvider, Record<Exclude<MockLlmStopReason, 'tool_calls'>, string>> = {
  openai: {
    stop: 'stop',
    length: 'length',
    content_filter: 'content_filter',
    stop_sequence: 'stop',
  },
  anthropic: {
    stop: 'end_turn',
    length: 'max_tokens',
    content_filter: 'refusal',
    stop_sequence: 'stop_sequence',
  },
}

describe('stop reason in each provider’s words', () => {
  for (const provider of PROVIDERS) {
    for (const [reason, wire] of Object.entries(WIRE[provider])) {
      it(`${provider}: ${reason} → ${wire} (stream and JSON)`, () => {
        const p = plan({ provider, stopReason: reason }, 'Hi')
        const events = encodeLlmEvents(p)
        const json = parsed(encodeLlmJson(p))
        if (provider === 'openai') {
          const finish = events.find((e) => e.finish && e.data !== '[DONE]')!
          expect(
            (parsed(finish.data).choices as { finish_reason: string }[])[0].finish_reason,
          ).toBe(wire)
          expect((json.choices as { finish_reason: string }[])[0].finish_reason).toBe(wire)
        } else {
          const delta = parsed(events.find((e) => e.event === 'message_delta')!.data)
          expect(delta.delta).toMatchObject({ stop_reason: wire })
          expect(json.stop_reason).toBe(wire)
        }
      })
    }
  }

  it('anthropic stop_sequence names the matched sequence (default END); null for other reasons', () => {
    const def = plan({ provider: 'anthropic', stopReason: 'stop_sequence' }, 'Hi')
    expect(parsed(encodeLlmJson(def)).stop_sequence).toBe('END')
    const custom = plan(
      { provider: 'anthropic', stopReason: 'stop_sequence', stopSequence: '\n\nUser:' },
      'Hi',
    )
    expect(parsed(encodeLlmJson(custom)).stop_sequence).toBe('\n\nUser:')
    const delta = parsed(encodeLlmEvents(custom).find((e) => e.event === 'message_delta')!.data)
    expect(delta.delta).toEqual({ stop_reason: 'stop_sequence', stop_sequence: '\n\nUser:' })
    const endTurn = plan({ provider: 'anthropic', stopReason: 'stop', stopSequence: 'X' }, 'Hi')
    expect(parsed(encodeLlmJson(endTurn)).stop_sequence).toBeNull()
  })

  it('tool calls always stop with tool_calls / tool_use, whatever is configured', () => {
    const calls = [{ name: 'echo', arguments: { text: 'x' } }]
    const o = plan({ provider: 'openai', stopReason: 'content_filter', toolCalls: calls }, '')
    expect((parsed(encodeLlmJson(o)).choices as { finish_reason: string }[])[0].finish_reason).toBe(
      'tool_calls',
    )
    const a = plan({ provider: 'anthropic', stopReason: 'stop_sequence', toolCalls: calls }, '')
    expect(parsed(encodeLlmJson(a))).toMatchObject({ stop_reason: 'tool_use', stop_sequence: null })
  })

  it('the provider switch mapping is total (stop_sequence → stop on OpenAI)', () => {
    expect(stopReasonFor('openai', 'stop_sequence')).toBe('stop')
    expect(stopReasonFor('anthropic', 'stop_sequence')).toBe('stop_sequence')
    for (const r of ['stop', 'length', 'tool_calls', 'content_filter'] as const) {
      expect(stopReasonFor('openai', r)).toBe(r)
      expect(stopReasonFor('anthropic', r)).toBe(r)
    }
  })
})

// ─── Save-time validation / tolerant read ───────────────────────

describe('validateLlmConfig / normalizeLlmConfig: the new keys', () => {
  it('accepts the new values and keys', () => {
    expect(
      validateLlmConfig({
        chunking: 'fixed',
        chunkSize: 12,
        stopReason: 'stop_sequence',
        stopSequence: 'END',
        streamError: { afterChunks: 3, type: 'overloaded_error', message: 'Overloaded' },
      }),
    ).toBeNull()
    expect(validateLlmConfig({ chunking: 'whole', stopReason: 'content_filter' })).toBeNull()
    expect(validateLlmConfig({ streamError: { afterChunks: 0 } })).toBeNull()
  })

  it('rejects bad values with the sentences the editor translates', () => {
    expect(validateLlmConfig({ chunking: 'token' })).toBe(
      'Chunking must be "word", "char", "sentence", "fixed" or "whole"',
    )
    expect(validateLlmConfig({ chunkSize: 0 })).toBe(
      'Chunk size must be a whole number of characters between 1 and 4096',
    )
    expect(validateLlmConfig({ stopReason: 'pause_turn' })).toBe(
      'Stop reason must be "stop", "length", "tool_calls", "content_filter" or "stop_sequence"',
    )
    expect(validateLlmConfig({ stopSequence: '' })).toBe(
      'Stop sequence must be text of 1 to 256 characters',
    )
    expect(validateLlmConfig({ streamError: 3 })).toBe(
      'Mid-stream error must be an object with afterChunks, type and message',
    )
    expect(validateLlmConfig({ streamError: { afterChunks: 1, status: 529 } })).toBe(
      'Mid-stream error: unknown field status',
    )
    expect(validateLlmConfig({ streamError: { afterChunks: -1 } })).toBe(
      'Mid-stream error: afterChunks must be a whole number between 0 and 10000',
    )
    expect(validateLlmConfig({ streamError: { afterChunks: 1, type: 'x'.repeat(101) } })).toBe(
      'Mid-stream error: type must be text of at most 100 characters',
    )
    expect(validateLlmConfig({ streamError: { afterChunks: 1, message: 7 } })).toBe(
      'Mid-stream error: message must be text of at most 2000 characters',
    )
  })

  it('a config without the new keys reads back without them (stored JSON stays byte-identical)', () => {
    const old = {
      provider: 'openai',
      chunking: 'word',
      chunkIntervalMs: 30,
      stopReason: 'stop',
      toolCalls: [],
      usage: 'auto',
    }
    expect(JSON.stringify(normalizeLlmConfig(old))).toBe(JSON.stringify(old))
    expect(
      normalizeLlmConfig({ chunkSize: 99999, streamError: { afterChunks: 2.6 } }),
    ).toMatchObject({ chunkSize: LLM_MAX_CHUNK_CHARS, streamError: { afterChunks: 3 } })
  })
})

// ─── Mid-stream error: the encoded events ────────────────────────

describe('mid-stream error: encoded events', () => {
  it('openai: role chunk + N text chunks, then an unnamed {"error":{…}} — no finish, no [DONE]', () => {
    for (const [chunking, expected] of [
      ['word', ['one ', 'two ']],
      ['char', ['o', 'n']],
    ] as const) {
      const s = encodeLlmStream(
        plan({ chunking, streamError: { afterChunks: 2 } }, 'one two three four'),
      )
      expect(s.events.map((e) => openAiDelta(e.data))).toEqual(['', ...expected])
      expect(s.events.some((e) => e.data === '[DONE]' || e.data.includes('finish_reason":"'))).toBe(
        false,
      )
      expect(s.chunksSent).toBe(2)
      expect(s.textSent).toBe(expected.join(''))
      expect(s.error?.event).toBeUndefined()
      expect(parsed(s.error!.data)).toEqual({
        error: {
          message: 'The server had an error while processing your request. Sorry about that!',
          type: 'server_error',
          param: null,
          code: null,
        },
      })
    }
  })

  it('anthropic: message_start … N text deltas, then event: error overloaded_error — no message_delta / message_stop', () => {
    for (const chunking of ['word', 'char'] as const) {
      const s = encodeLlmStream(
        plan({ provider: 'anthropic', chunking, streamError: { afterChunks: 2 } }, 'one two three'),
      )
      expect(s.events.map((e) => e.event)).toEqual([
        'message_start',
        'content_block_start',
        'ping',
        'content_block_delta',
        'content_block_delta',
      ])
      expect(s.error).toEqual({
        event: 'error',
        data: JSON.stringify({
          type: 'error',
          error: { type: 'overloaded_error', message: 'Overloaded' },
        }),
      })
    }
  })

  it('afterChunks 0: only the preamble before the error; more than the reply has: the error replaces the finish', () => {
    const zero = encodeLlmStream(
      plan({ provider: 'anthropic', streamError: { afterChunks: 0 } }, 'one two'),
    )
    expect(zero.events.map((e) => e.event)).toEqual([
      'message_start',
      'content_block_start',
      'ping',
    ])
    expect(zero.textSent).toBe('')

    const many = encodeLlmStream(
      plan({ provider: 'anthropic', streamError: { afterChunks: 99 } }, 'one two'),
    )
    expect(many.events.map((e) => e.event).slice(-2)).toEqual([
      'content_block_delta',
      'content_block_stop',
    ])
    expect(many.textSent).toBe('one two')
    const openai = encodeLlmStream(plan({ streamError: { afterChunks: 99 } }, 'one two'))
    expect(openai.events.map((e) => openAiDelta(e.data))).toEqual(['', 'one ', 'two'])
  })

  it('a custom type / message is sent as written; tool-call argument pieces count as chunks', () => {
    const s = encodeLlmStream(
      plan(
        {
          toolCalls: [{ name: 'echo', arguments: { text: 'hello from the mock LLM' } }],
          streamError: { afterChunks: 1, type: 'rate_limit_error', message: 'Slow down' },
        },
        '',
      ),
    )
    // role chunk, the call opening, one argument piece — then the error.
    expect(s.events).toHaveLength(3)
    expect(parsed(s.events[1].data)).toMatchObject({
      choices: [
        { delta: { tool_calls: [{ index: 0, function: { name: 'echo', arguments: '' } }] } },
      ],
    })
    expect(parsed(s.error!.data)).toMatchObject({
      error: { type: 'rate_limit_error', message: 'Slow down' },
    })
  })

  it('without a stream error the stream is the whole reply', () => {
    const p = plan({}, 'one two')
    const s = encodeLlmStream(p)
    expect(s.error).toBeNull()
    expect(s.events).toEqual(encodeLlmEvents(p))
  })
})

// ─── Mid-stream error on a real port ─────────────────────────────

async function serve(
  cfg: Record<string, unknown>,
  text = 'one two three four five',
): Promise<number> {
  const port = await freePort()
  const r = await mockServerManager.start(
    serverDef(ID, port, [
      {
        path: '/v1/chat',
        method: 'POST',
        response: llmResponse(text, { chunkIntervalMs: 5, ...cfg }),
      },
    ]),
  )
  expect(r.ok).toBe(true)
  return port
}

const chatBody = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({ model: 'm', stream: true, messages: [{ role: 'user', content: 'hi' }], ...over })

describe('mid-stream error on a real port', () => {
  for (const provider of PROVIDERS) {
    for (const chunking of ['word', 'char'] as const) {
      it(`${provider} / ${chunking}: partial output, the provider's error frame, then the end of the response`, async () => {
        const port = await serve({ provider, chunking, streamError: { afterChunks: 2 } })
        const r = await rawRead(port, '/v1/chat', { method: 'POST', body: chatBody() })
        expect(r.status).toBe(200)
        expect(r.headers['content-type']).toContain('text/event-stream')
        expect(r.ended).toBe(true)
        if (provider === 'openai') {
          expect(
            r.text.endsWith(
              'data: {"error":{"message":"The server had an error while processing your request. Sorry about that!","type":"server_error","param":null,"code":null}}\n\n',
            ),
          ).toBe(true)
          expect(r.text).not.toContain('[DONE]')
          expect(r.text).not.toContain('"finish_reason":"stop"')
        } else {
          expect(
            r.text.endsWith(
              'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
            ),
          ).toBe(true)
          expect(r.text).not.toContain('message_delta')
          expect(r.text).not.toContain('message_stop')
        }
        expect(r.text).toContain(chunking === 'word' ? 'two ' : '"n"')
        expect(r.text).not.toContain('three')
        expect(mockServerManager.openStreamCount(ID)).toBe(0)
      })
    }
  }

  it('the closed log entry shows what the client got (partial text + the error), reason error-event', async () => {
    const port = await serve({ provider: 'anthropic', streamError: { afterChunks: 2 } })
    await rawRead(port, '/v1/chat', { method: 'POST', body: chatBody() })
    expect(await waitFor(() => mockServerManager.getLogs(ID).length >= 2)).toBe(true)
    const closed = mockServerManager.getLogs(ID).at(-1)!
    expect(closed.response.headers['x-mock-stream']).toMatch(/reason=error-event$/)
    expect(closed.response.body).toContain('one two ')
    expect(closed.response.body).toContain('overloaded_error')
    expect(closed.response.body).not.toContain('five')
    expect(closed.response.body).toContain('ended with the mid-stream error event')
  })

  it('a request without stream: true gets the whole reply as JSON (the error is stream-only)', async () => {
    const port = await serve({ streamError: { afterChunks: 1 } }, 'all of it')
    const r = await rawRead(port, '/v1/chat', { method: 'POST', body: chatBody({ stream: false }) })
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text)).toMatchObject({
      choices: [{ message: { content: 'all of it' }, finish_reason: 'stop' }],
    })
  })
})

// ─── Testnizer's AI Chat engine against it ───────────────────────

async function readRound(opts: AiStreamOptions): Promise<{ text: string; error: unknown }> {
  let text = ''
  try {
    for await (const ev of streamChatRound(opts)) if (ev.type === 'text') text += ev.delta
  } catch (e) {
    return { text, error: e }
  }
  return { text, error: null }
}

describe('AI Chat engine stops with the provider’s mid-stream error (the SDK rule)', () => {
  it('openai-compatible: the partial text arrives, then AiHttpError(server_error, midStream)', async () => {
    const port = await serve({ streamError: { afterChunks: 2 } })
    const r = await readRound({
      provider: 'custom',
      url: `http://127.0.0.1:${port}/v1/chat`,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(r.text).toBe('one two ')
    expect(r.error).toBeInstanceOf(AiHttpError)
    const err = r.error as AiHttpError
    expect(err.midStream).toBe(true)
    expect(err.status).toBe(200)
    expect(err.errorType).toBe('server_error')
    expect(err.message).toBe(
      'Mid-stream error (server_error): The server had an error while processing your request. Sorry about that!',
    )
  })

  it('anthropic: the partial text arrives, then AiHttpError(overloaded_error, midStream)', async () => {
    const port = await serve({
      provider: 'anthropic',
      chunking: 'char',
      streamError: { afterChunks: 3 },
    })
    const r = await readRound({
      provider: 'anthropic',
      url: `http://127.0.0.1:${port}/v1/chat`,
      model: 'claude-mock',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(r.text).toBe('one')
    const err = r.error as AiHttpError
    expect(err).toBeInstanceOf(AiHttpError)
    expect(err.midStream).toBe(true)
    expect(err.errorType).toBe('overloaded_error')
    expect(err.message).toBe('Mid-stream error (overloaded_error): Overloaded')
  })

  it('a stream without an error still ends normally', async () => {
    const port = await serve({ provider: 'anthropic', stopReason: 'content_filter' }, 'no')
    const r = await readRound({
      provider: 'anthropic',
      url: `http://127.0.0.1:${port}/v1/chat`,
      model: 'claude-mock',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(r).toEqual({ text: 'no', error: null })
  })
})
