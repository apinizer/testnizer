/**
 * Issue #222 (5) — AI Chat's model client must stop on a provider error that
 * arrives AFTER the 2xx response started streaming, like the official SDKs:
 *
 *  - openai-python `src/openai/_streaming.py`: for an unnamed event,
 *    `data = sse.json(); if is_mapping(data) and data.get("error"): raise
 *    APIError(message=error.get("message") or "An error occurred during
 *    streaming", body=data["error"])`;
 *  - anthropic-sdk-typescript `src/core/streaming.ts`: `if (sse.event ===
 *    'error') throw new APIError(undefined, body, undefined, headers,
 *    body?.error?.type)` — the payload is `{"type":"error","error":{"type":
 *    "overloaded_error","message":"Overloaded"}}` (Claude streaming docs,
 *    "Error events"; errors page: "an error can occur after the API returns
 *    a 200 response").
 *
 * Before: `streamChatRound` skipped both payloads; a cut stream (no
 * `[DONE]`) ended with `end`, stopReason null — a mid-stream failure read as
 * a successful (partial) answer, against real providers too. The tests use a
 * hand-written loopback server, so they pin the client rule independently of
 * the mock's encoder.
 */
import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  AiHttpError,
  streamChatRound,
  streamErrorOf,
  type AiProvider,
} from '../../src/main/protocols/ai-chat.engine'

describe('streamErrorOf — the SDKs’ rules', () => {
  it('openai-compatible: a truthy `error` key, message / type / code read like the SDK', () => {
    expect(
      streamErrorOf('openai', undefined, { error: { message: 'boom', type: 'server_error' } }),
    ).toEqual({ type: 'server_error', message: 'boom' })
    // OpenRouter adds a choices entry with finish_reason "error" — still an error.
    expect(
      streamErrorOf('custom', undefined, {
        error: { code: 'provider_error', message: 'Provider disconnected' },
        choices: [{ index: 0, delta: { content: '' }, finish_reason: 'error' }],
      }),
    ).toEqual({ type: 'provider_error', message: 'Provider disconnected' })
    expect(streamErrorOf('openrouter', undefined, { error: {} })).toEqual({
      message: 'An error occurred during streaming',
    })
    // Not errors: a normal chunk, `error: null`.
    expect(
      streamErrorOf('openai', undefined, { choices: [{ delta: { content: 'hi' } }] }),
    ).toBeNull()
    expect(streamErrorOf('openai', undefined, { error: null, choices: [] })).toBeNull()
  })

  it('anthropic: `event: error` (or a payload of type error)', () => {
    const body = { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }
    expect(streamErrorOf('anthropic', 'error', body)).toEqual({
      type: 'overloaded_error',
      message: 'Overloaded',
    })
    expect(streamErrorOf('anthropic', undefined, body)).toEqual({
      type: 'overloaded_error',
      message: 'Overloaded',
    })
    expect(
      streamErrorOf('anthropic', 'content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hi' },
      }),
    ).toBeNull()
    expect(streamErrorOf('anthropic', 'ping', { type: 'ping' })).toBeNull()
  })
})

// ─── Against a hand-written stream ───────────────────────────────

let server: http.Server | null = null
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()))
  server = null
})

/** Serve `frames` (raw SSE text) on 200, then end the response. */
async function serveFrames(frames: string[]): Promise<string> {
  server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const f of frames) res.write(f)
      res.end()
    })
  })
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1/x`
}

async function run(provider: AiProvider, url: string): Promise<{ text: string; error: unknown }> {
  let text = ''
  try {
    for await (const ev of streamChatRound({
      provider,
      url,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    })) {
      if (ev.type === 'text') text += ev.delta
    }
  } catch (e) {
    return { text, error: e }
  }
  return { text, error: null }
}

const oa = (content: string): string =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`

describe('streamChatRound raises the mid-stream error after the partial text', () => {
  it('openai-compatible: data: {"error":{…}} after two chunks', async () => {
    const url = await serveFrames([
      oa('Hello '),
      oa('wor'),
      `data: ${JSON.stringify({ error: { message: 'The server had an error', type: 'server_error' } })}\n\n`,
      // Anything after the error is never read (the SDK raises at once).
      oa('NEVER'),
    ])
    const r = await run('custom', url)
    expect(r.text).toBe('Hello wor')
    expect(r.error).toBeInstanceOf(AiHttpError)
    expect(r.error).toMatchObject({
      status: 200,
      midStream: true,
      errorType: 'server_error',
      message: 'Mid-stream error (server_error): The server had an error',
    })
    // Text came before the error: the failed call still has a TTFB (review #11).
    expect(typeof (r.error as AiHttpError).firstContentAt).toBe('number')
  })

  it('anthropic: event: error overloaded_error after a text delta', async () => {
    const ev = (event: string, data: Record<string, unknown>): string =>
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    const url = await serveFrames([
      ev('message_start', {
        type: 'message_start',
        message: { id: 'msg_1', usage: { input_tokens: 3, output_tokens: 1 } },
      }),
      ev('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }),
      ev('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Partial' },
      }),
      ev('error', { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
    ])
    const r = await run('anthropic', url)
    expect(r.text).toBe('Partial')
    expect(r.error).toMatchObject({
      status: 200,
      midStream: true,
      errorType: 'overloaded_error',
      message: 'Mid-stream error (overloaded_error): Overloaded',
    })
  })

  it('a named error event with a non-JSON body still ends the call', async () => {
    const url = await serveFrames([oa('a'), 'event: error\ndata: upstream gone\n\n'])
    const r = await run('custom', url)
    expect(r.text).toBe('a')
    expect(r.error).toMatchObject({ midStream: true, message: 'Mid-stream error: upstream gone' })
  })

  it('an HTTP error status is still a plain AiHttpError (not midStream)', async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end('{"error":{"message":"slow down"}}')
    })
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/x`
    const r = await run('custom', url)
    expect(r.error).toBeInstanceOf(AiHttpError)
    expect(r.error).toMatchObject({ status: 429, midStream: false })
  })
})
