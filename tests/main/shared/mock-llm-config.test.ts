/**
 * Issue #221 (Faz 2a) — the AI (`body_type: 'llm'`) reply settings in
 * `src/shared/mock-stream.ts`: the tolerant reader every serve path uses and
 * the strict save-time check (the messages are the editor's error texts).
 * Fail-before: neither `normalizeLlmConfig` nor `validateLlmConfig` existed.
 */
import { describe, it, expect } from 'vitest'
import {
  LLM_CONFIG_DEFAULTS,
  LLM_MAX_CHUNK_INTERVAL_MS,
  LLM_MAX_TOOL_ARGUMENT_CHARS,
  LLM_MAX_TOOL_CALLS,
  normalizeLlmConfig,
  normalizeStreamConfig,
  validateLlmConfig,
} from '../../../src/shared/mock-stream'

describe('normalizeLlmConfig — tolerant', () => {
  it('NULL / corrupt JSON / non-object → the defaults', () => {
    for (const raw of [null, undefined, 'not json', '[1]', 42, [], 'null']) {
      expect(normalizeLlmConfig(raw)).toEqual(LLM_CONFIG_DEFAULTS)
    }
    expect(LLM_CONFIG_DEFAULTS).toEqual({
      provider: 'openai',
      chunking: 'word',
      chunkIntervalMs: 30,
      stopReason: 'stop',
      toolCalls: [],
      usage: 'auto',
    })
  })

  it('reads the stored JSON text, keeps valid values, drops unknown keys', () => {
    const cfg = normalizeLlmConfig(
      JSON.stringify({
        provider: 'anthropic',
        chunking: 'sentence',
        chunkIntervalMs: 5,
        stopReason: 'length',
        usage: { inputTokens: 3, outputTokens: 4 },
        future: true,
      }),
    )
    expect(cfg).toEqual({
      provider: 'anthropic',
      chunking: 'sentence',
      chunkIntervalMs: 5,
      stopReason: 'length',
      toolCalls: [],
      usage: { inputTokens: 3, outputTokens: 4 },
    })
  })

  it('unknown provider / chunking / stop reason → defaults; interval clamped and rounded', () => {
    const cfg = normalizeLlmConfig({
      provider: 'gemini',
      chunking: 'line',
      stopReason: 'end_turn',
      chunkIntervalMs: 99_999,
    })
    expect(cfg.provider).toBe('openai')
    expect(cfg.chunking).toBe('word')
    expect(cfg.stopReason).toBe('stop')
    expect(cfg.chunkIntervalMs).toBe(LLM_MAX_CHUNK_INTERVAL_MS)
    expect(normalizeLlmConfig({ chunkIntervalMs: -5 }).chunkIntervalMs).toBe(0)
    expect(normalizeLlmConfig({ chunkIntervalMs: 12.6 }).chunkIntervalMs).toBe(13)
  })

  it('tool calls: unusable entries dropped, at most 16, ids kept, other args → {}', () => {
    const cfg = normalizeLlmConfig({
      toolCalls: [
        { name: 'echo', arguments: { text: 'hi' }, id: 'call_1' },
        { name: '', arguments: {} },
        { arguments: {} },
        'x',
        { name: 'raw', arguments: '{"a":1}' },
        { name: 'odd', arguments: 5 },
        { name: 'big', arguments: 'x'.repeat(LLM_MAX_TOOL_ARGUMENT_CHARS + 1) },
      ],
    })
    expect(cfg.toolCalls).toEqual([
      { name: 'echo', arguments: { text: 'hi' }, id: 'call_1' },
      { name: 'raw', arguments: '{"a":1}' },
      { name: 'odd', arguments: {} },
    ])
    const many = normalizeLlmConfig({
      toolCalls: Array.from({ length: 20 }, (_, i) => ({ name: `t${i}`, arguments: {} })),
    })
    expect(many.toolCalls).toHaveLength(LLM_MAX_TOOL_CALLS)
  })

  it("stopReason 'tool_calls' without a tool call reads as 'stop'", () => {
    expect(normalizeLlmConfig({ stopReason: 'tool_calls' }).stopReason).toBe('stop')
    expect(
      normalizeLlmConfig({ stopReason: 'tool_calls', toolCalls: [{ name: 'a', arguments: {} }] })
        .stopReason,
    ).toBe('tool_calls')
  })

  it("usage: anything but 'auto' or two numbers → 'auto'; numbers clamped", () => {
    expect(normalizeLlmConfig({ usage: null }).usage).toBe('auto')
    expect(normalizeLlmConfig({ usage: { inputTokens: 1 } }).usage).toBe('auto')
    expect(normalizeLlmConfig({ usage: { inputTokens: -3, outputTokens: 2.4 } }).usage).toEqual({
      inputTokens: 0,
      outputTokens: 2,
    })
  })

  it('an SSE config stored under an llm row reads as the LLM defaults (and the other way round)', () => {
    const sse = { intervalMs: 50, loop: true, onEnd: 'keep-open', heartbeatMs: 0, resume: true }
    expect(normalizeLlmConfig(sse)).toEqual(LLM_CONFIG_DEFAULTS)
    expect(normalizeStreamConfig({ provider: 'anthropic', chunkIntervalMs: 5 })).toMatchObject({
      intervalMs: 1000,
    })
  })
})

describe('validateLlmConfig — strict, save time', () => {
  it('unset and partial configs are valid', () => {
    expect(validateLlmConfig(null)).toBeNull()
    expect(validateLlmConfig(undefined)).toBeNull()
    expect(validateLlmConfig({})).toBeNull()
    expect(validateLlmConfig({ provider: 'anthropic' })).toBeNull()
    expect(
      validateLlmConfig({
        ...LLM_CONFIG_DEFAULTS,
        toolCalls: [{ name: 'echo', arguments: { text: '{{lastUserMessage}}' } }],
        stopReason: 'tool_calls',
        usage: { inputTokens: 0, outputTokens: 10 },
      }),
    ).toBeNull()
    // A templated JSON text can only be checked once rendered.
    expect(
      validateLlmConfig({ toolCalls: [{ name: 'e', arguments: '{"t": {{json model}}}' }] }),
    ).toBeNull()
  })

  it.each([
    ['x', 'LLM settings must be an object'],
    [[], 'LLM settings must be an object'],
    [{ intervalMs: 5 }, 'Unknown LLM setting: intervalMs'],
    [{ provider: 'gemini' }, 'Provider must be "openai" or "anthropic"'],
    [{ chunking: 'line' }, 'Chunking must be "word", "char", "sentence", "fixed" or "whole"'],
    [
      { chunkIntervalMs: 10_001 },
      'Chunk interval must be a whole number of milliseconds between 0 and 10000',
    ],
    [
      { chunkIntervalMs: 1.5 },
      'Chunk interval must be a whole number of milliseconds between 0 and 10000',
    ],
    [
      { stopReason: 'end_turn' },
      'Stop reason must be "stop", "length", "tool_calls", "content_filter" or "stop_sequence"',
    ],
    [{ stopReason: 'tool_calls' }, 'Stop reason "tool_calls" needs at least one tool call'],
    [{ toolCalls: {} }, 'Tool calls must be a list'],
    [
      { toolCalls: Array.from({ length: 17 }, () => ({ name: 'a', arguments: {} })) },
      'At most 16 tool calls per reply',
    ],
    [{ toolCalls: ['x'] }, 'Tool call 1 must be an object with a name and arguments'],
    [{ toolCalls: [{ name: 'a', args: {} }] }, 'Tool call 1: unknown field args'],
    [{ toolCalls: [{ name: ' ', arguments: {} }] }, 'Tool call 1 needs a name'],
    [
      { toolCalls: [{ name: 'a', arguments: {}, id: '' }] },
      'Tool call 1: the id must be non-empty text (or left out to generate one)',
    ],
    [
      {
        toolCalls: [
          { name: 'a', arguments: {} },
          { name: 'b', arguments: 3 },
        ],
      },
      'Tool call 2: arguments must be a JSON object or JSON text',
    ],
    [
      { toolCalls: [{ name: 'a', arguments: 'x'.repeat(32_001) }] },
      'Tool call 1: arguments are longer than 32000 characters',
    ],
    [
      { toolCalls: [{ name: 'a', arguments: '{oops' }] },
      'Tool call 1: arguments are not valid JSON',
    ],
    [
      { toolCalls: [{ name: 'a', arguments: '[1]' }] },
      'Tool call 1: arguments must be a JSON object',
    ],
    [{ usage: 'none' }, 'Usage must be "auto" or { inputTokens, outputTokens }'],
    [{ usage: null }, 'Usage must be "auto" or { inputTokens, outputTokens }'],
    [{ usage: { inputTokens: 1, outputTokens: 1, total: 2 } }, 'Unknown usage field: total'],
    [
      { usage: { inputTokens: 1 } },
      'Usage outputTokens must be a whole number between 0 and 10000000',
    ],
    [
      { usage: { inputTokens: -1, outputTokens: 1 } },
      'Usage inputTokens must be a whole number between 0 and 10000000',
    ],
  ])('%j → %s', (raw, message) => {
    expect(validateLlmConfig(raw)).toBe(message)
  })
})
