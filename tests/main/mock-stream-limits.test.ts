/**
 * Issue #221 review (PR #225), item 4 — limits before work.
 *
 *  - An AI reply's 10 000-frame limit was checked AFTER `encodeLlmEvents`
 *    had built every event: `chunking: 'char'` over an echoed 3 MB prompt
 *    built a million JSON chunks (seconds of blocked main process, hundreds
 *    of MB) only to answer 503. The chunk count is now estimated from the
 *    text first.
 *  - Requests waiting out their `delayMs` were not counted toward the
 *    64-stream limit: any number of delayed requests could be admitted and
 *    then all open streams at once. Pending + open is now ≤ 64, on the SSE
 *    and the AI path.
 */
import net from 'node:net'
import { describe, it, expect, afterEach } from 'vitest'
import { mockServerManager } from '../../src/main/mock/server'
import { SSE_MAX_OPEN_STREAMS, SSE_MAX_PLAN_FRAMES } from '../../src/main/mock/stream/sse-writer'
import { chunkText, countChunks } from '../../src/main/mock/stream/chunking'
import { buildLlmPlan, encodeLlmEvents, llmStreamFrameCount } from '../../src/main/mock/stream/llm'
import { normalizeLlmConfig } from '../../src/shared/mock-stream'
import {
  freePort,
  llmResponse,
  rawRead,
  serverDef,
  sseResponse,
  waitFor,
  type RawRead,
} from './mock-sse-fixtures'

const ID = 'limits-mock'
const sockets: net.Socket[] = []

afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy()
  await mockServerManager.stopAll()
})

async function readOrHang(
  port: number,
  path: string,
  opts: Parameters<typeof rawRead>[2] = {},
  ms = 1000,
): Promise<RawRead | 'hung'> {
  return Promise.race([
    rawRead(port, path, { maxMs: 500, ...opts }),
    new Promise<'hung'>((r) => setTimeout(() => r('hung'), ms)),
  ])
}

describe('frame estimate (pure)', () => {
  const samples = [
    '',
    ' ',
    'Hello world, how are you?',
    'One. Two! Three?\nFour',
    '🙂 emoji 👍🏽 text',
    `${'x'.repeat(9000)} tail`,
    '   leading and trailing   ',
  ]
  it('countChunks equals chunkText(...).length for every mode', () => {
    for (const mode of ['word', 'char', 'sentence', 'fixed', 'whole'] as const) {
      for (const t of samples) expect(countChunks(t, mode)).toBe(chunkText(t, mode).length)
    }
  })

  it('countChunks stops counting past the limit', () => {
    expect(countChunks('x'.repeat(100), 'char', 10)).toBe(11)
    expect(countChunks('a '.repeat(100), 'word', 10)).toBe(11)
  })

  it('llmStreamFrameCount equals the encoded event count (both providers, tool calls, usage)', () => {
    for (const provider of ['openai', 'anthropic'] as const) {
      for (const chunking of ['word', 'char', 'sentence', 'fixed', 'whole'] as const) {
        for (const text of ['', 'Hi there. Bye!', 'Ünïcödé 🙂 text']) {
          for (const toolCalls of [[], [{ name: 'echo', arguments: { text: 'hello world' } }]]) {
            for (const includeUsage of [false, true]) {
              const built = buildLlmPlan(
                normalizeLlmConfig({ provider, chunking, toolCalls }),
                { stream: true, model: 'm', includeUsage, promptChars: 3 },
                text,
                (s) => s,
              )
              expect(built.ok).toBe(true)
              if (!built.ok) continue
              expect(llmStreamFrameCount(built.value)).toBe(encodeLlmEvents(built.value).length)
            }
          }
        }
      }
    }
  })
})

describe('an AI reply over the frame limit is refused before it is encoded', () => {
  it('char chunking over an echoed 3 MB prompt → 503 quickly', async () => {
    const port = await freePort()
    const r = await mockServerManager.start(
      serverDef(ID, port, [
        { path: '/llm', response: llmResponse('{{lastUserMessage}}', { chunking: 'char' }) },
      ]),
    )
    expect(r.ok).toBe(true)
    const prompt = 'x'.repeat(3_000_000)
    const t0 = Date.now()
    const res = await rawRead(port, '/llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: prompt }] }),
      maxMs: 30_000,
    })
    const elapsed = Date.now() - t0
    expect(res.status).toBe(503)
    const body = JSON.parse(res.text)
    expect(body.error.type).toBe('server_error')
    expect(body.error.message).toContain(`at most ${SSE_MAX_PLAN_FRAMES}`)
    expect(body.error.message).toContain('word chunking')
    expect(elapsed).toBeLessThan(1000)
  }, 60_000)
})

describe('requests waiting out their delay count toward the open-stream limit', () => {
  it(`${SSE_MAX_OPEN_STREAMS} delayed SSE requests + 1 → 503 (SSE and AI); the 64 then stream`, async () => {
    const port = await freePort()
    const r = await mockServerManager.start(
      serverDef(ID, port, [
        {
          path: '/slow',
          response: sseResponse(': hi', { intervalMs: 0, onEnd: 'keep-open' }, { delayMs: 1500 }),
        },
        { path: '/fast', response: sseResponse('data: a', { intervalMs: 0 }) },
        { path: '/llm-slow', response: llmResponse('Hi', {}, { delayMs: 1500 }) },
        { path: '/llm-fast', response: llmResponse('Hi', { provider: 'anthropic' }) },
      ]),
    )
    expect(r.ok).toBe(true)
    for (let i = 0; i < SSE_MAX_OPEN_STREAMS; i++) {
      const s = net.connect(port, '127.0.0.1')
      s.on('error', () => {})
      s.write('GET /slow HTTP/1.1\r\nHost: x\r\n\r\n')
      sockets.push(s)
    }
    expect(
      await waitFor(() => mockServerManager.pendingStreamCount(ID) === SSE_MAX_OPEN_STREAMS, 4000),
    ).toBe(true)
    expect(mockServerManager.openStreamCount(ID)).toBe(0)

    // One more delayed SSE request: refused at once, not after its delay.
    const slow = await readOrHang(port, '/slow')
    expect(slow).not.toBe('hung')
    expect((slow as RawRead).status).toBe(503)
    expect(JSON.parse((slow as RawRead).text).error).toBe('too_many_streams')

    // An undelayed one: refused at stream time.
    const fast = await readOrHang(port, '/fast')
    expect(fast).not.toBe('hung')
    expect((fast as RawRead).status).toBe(503)
    expect(JSON.parse((fast as RawRead).text).error).toBe('too_many_streams')

    const chat = JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'hi' }] })
    // AI, delayed: the provider's error envelope.
    const llmSlow = await readOrHang(port, '/llm-slow', { method: 'POST', body: chat })
    expect(llmSlow).not.toBe('hung')
    expect((llmSlow as RawRead).status).toBe(503)
    expect(JSON.parse((llmSlow as RawRead).text).error.type).toBe('server_error')
    // AI, undelayed (anthropic).
    const llmFast = await readOrHang(port, '/llm-fast', { method: 'POST', body: chat })
    expect(llmFast).not.toBe('hung')
    expect((llmFast as RawRead).status).toBe(503)
    expect(JSON.parse((llmFast as RawRead).text)).toMatchObject({
      type: 'error',
      error: { type: 'api_error' },
    })

    // The 64 admitted requests are never refused by their own pending slots.
    expect(
      await waitFor(() => mockServerManager.openStreamCount(ID) === SSE_MAX_OPEN_STREAMS, 5000),
    ).toBe(true)
    expect(mockServerManager.pendingStreamCount(ID)).toBe(0)
  }, 20_000)
})
