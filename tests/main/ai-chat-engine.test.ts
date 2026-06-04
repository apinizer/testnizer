import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  resolveProviderUrl,
  buildHeaders,
  buildBody,
  extractDelta,
  streamChatCompletion,
} from '../../src/main/protocols/ai-chat.engine'

describe('resolveProviderUrl', () => {
  it('returns the OpenAI default when no override is given', () => {
    expect(resolveProviderUrl('openai')).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('returns the Anthropic default when no override is given', () => {
    expect(resolveProviderUrl('anthropic')).toBe('https://api.anthropic.com/v1/messages')
  })

  it('returns the OpenRouter default when no override is given', () => {
    expect(resolveProviderUrl('openrouter')).toBe('https://openrouter.ai/api/v1/chat/completions')
  })

  it('uses the custom URL for the custom provider', () => {
    expect(resolveProviderUrl('custom', 'https://example.com/v1/chat')).toBe(
      'https://example.com/v1/chat',
    )
  })

  it('throws when custom provider is selected without a URL', () => {
    expect(() => resolveProviderUrl('custom')).toThrow(/Custom provider requires a URL/)
  })

  it('lets a built-in provider be overridden by a non-empty custom URL', () => {
    expect(resolveProviderUrl('openai', 'https://proxy/internal/openai')).toBe(
      'https://proxy/internal/openai',
    )
  })
})

describe('buildHeaders', () => {
  it('uses Bearer auth for OpenAI', () => {
    const h = buildHeaders('openai', 'sk-test')
    expect(h['Authorization']).toBe('Bearer sk-test')
    expect(h['Content-Type']).toBe('application/json')
    expect(h['x-api-key']).toBeUndefined()
  })

  it('uses x-api-key + anthropic-version for Anthropic', () => {
    const h = buildHeaders('anthropic', 'sk-ant-test')
    expect(h['x-api-key']).toBe('sk-ant-test')
    expect(h['anthropic-version']).toBe('2023-06-01')
    expect(h['Authorization']).toBeUndefined()
  })

  it('adds OpenRouter referrer + title headers', () => {
    const h = buildHeaders('openrouter', 'sk-or-test')
    expect(h['Authorization']).toBe('Bearer sk-or-test')
    expect(h['HTTP-Referer']).toBeDefined()
    expect(h['X-Title']).toBe('Testnizer')
  })

  it('uses Bearer auth for custom (OpenAI-compatible default)', () => {
    const h = buildHeaders('custom', 'whatever')
    expect(h['Authorization']).toBe('Bearer whatever')
  })
})

describe('buildBody', () => {
  it('produces an OpenAI-compatible body with stream=true', () => {
    const body = buildBody({
      provider: 'openai',
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
    })
    expect(body).toMatchObject({
      model: 'gpt-4o',
      stream: true,
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
    })
  })

  it('hoists system prompts out of messages[] for Anthropic', () => {
    const body = buildBody({
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'hi' },
      ],
    })
    expect(body.system).toBe('be brief')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.stream).toBe(true)
    expect(body.max_tokens).toBeDefined()
  })

  it('forwards temperature/maxTokens for OpenAI', () => {
    const body = buildBody({
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2,
      maxTokens: 256,
    })
    expect(body.temperature).toBe(0.2)
    expect(body.max_tokens).toBe(256)
  })
})

describe('extractDelta', () => {
  it('extracts content from an OpenAI streaming chunk', () => {
    const chunk = { choices: [{ delta: { content: 'Hello' } }] }
    expect(extractDelta('openai', chunk)).toBe('Hello')
  })

  it('returns empty for OpenAI role-only chunks', () => {
    const chunk = { choices: [{ delta: { role: 'assistant' } }] }
    expect(extractDelta('openai', chunk)).toBe('')
  })

  it('extracts text from an Anthropic content_block_delta', () => {
    const chunk = {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'World' },
    }
    expect(extractDelta('anthropic', chunk)).toBe('World')
  })

  it('returns empty for Anthropic non-content events', () => {
    expect(extractDelta('anthropic', { type: 'message_start' })).toBe('')
    expect(extractDelta('anthropic', { type: 'message_stop' })).toBe('')
  })
})

// ─── Streaming integration (mock fetch) ────────────────────

function makeSseStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(ev))
      }
      controller.close()
    },
  })
}

describe('streamChatCompletion', () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => {
    // each test sets its own fetch mock
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('yields deltas in order for an OpenAI-style stream', async () => {
    const events = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: [DONE]\n\n',
    ]
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeSseStream(events), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    ) as unknown as typeof fetch

    const out: string[] = []
    for await (const chunk of streamChatCompletion({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      out.push(chunk.delta)
    }
    expect(out).toEqual(['Hel', 'lo'])
  })

  it('parses an Anthropic content_block_delta stream', async () => {
    const events = [
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"World"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(makeSseStream(events), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    ) as unknown as typeof fetch

    const out: string[] = []
    for await (const chunk of streamChatCompletion({
      provider: 'anthropic',
      apiKey: 'sk-ant',
      model: 'claude-sonnet-4-5',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      out.push(chunk.delta)
    }
    expect(out).toEqual(['World'])
  })

  it('throws with HTTP error body when response is not ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{"error":"bad key"}', {
        status: 401,
        statusText: 'Unauthorized',
      }),
    ) as unknown as typeof fetch

    await expect(async () => {
      for await (const _ of streamChatCompletion({
        provider: 'openai',
        apiKey: 'sk-bad',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        void _
      }
    }).rejects.toThrow(/401/)
  })

  it('rejects when no API key is supplied', async () => {
    await expect(async () => {
      for await (const _ of streamChatCompletion({
        provider: 'openai',
        apiKey: '',
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
      })) {
        void _
      }
    }).rejects.toThrow(/API key is required/)
  })
})
