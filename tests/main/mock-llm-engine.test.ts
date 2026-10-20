/**
 * Issue #221 (Faz 2a) — the engine side of an AI (`bodyType: 'llm'`) reply
 * on a real loopback listener: it goes through the SAME stream lifecycle as
 * SSE (one writer, `openStreams`, Stop, snapshot, delay cancellation, fixed
 * limits) and the normal pipeline (script, content type). Fail-before: the
 * engine answered an `llm` body in one shot as text.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mockServerManager, type MockServerDef } from '../../src/main/mock/server'
import { SSE_MAX_PLAN_FRAMES, sseWriterLiveTimers } from '../../src/main/mock/stream/sse-writer'
import {
  freePort,
  llmResponse,
  rawRead,
  serverDef,
  sleep,
  waitFor,
  type RouteSpec,
} from './mock-sse-fixtures'

const ID = 'llm-engine'

afterEach(async () => {
  await mockServerManager.stopAll()
  expect(await waitFor(() => sseWriterLiveTimers() === 0, 1000)).toBe(true)
})

async function start(routes: RouteSpec[]): Promise<{ port: number; def: MockServerDef }> {
  const port = await freePort()
  const def = serverDef(
    ID,
    port,
    routes.map((r) => ({ method: 'POST' as const, ...r })),
  )
  const r = await mockServerManager.start(def)
  expect(r.ok).toBe(true)
  return { port, def }
}

const chat = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    model: 'm',
    stream: true,
    messages: [{ role: 'user', content: 'hello' }],
    ...over,
  })

const post = (port: number, body: string, opts: Parameters<typeof rawRead>[2] = {}) =>
  rawRead(port, '/v1/chat/completions', { method: 'POST', body, ...opts })

const dataOf = (text: string): string[] =>
  text
    .split('\n\n')
    .filter((b) => b.startsWith('data: '))
    .map((b) => b.slice(6))

describe('llm reply through the stream lifecycle', () => {
  it('chunks go out chunkIntervalMs apart; the response ends after [DONE]', async () => {
    const { port } = await start([
      {
        path: '/v1/chat/completions',
        response: llmResponse('one two three', { chunkIntervalMs: 40 }),
      },
    ])
    const r = await post(port, chat())
    expect(r.status).toBe(200)
    expect(r.ended).toBe(true)
    expect(dataOf(r.text).at(-1)).toBe('[DONE]')
    const at = (s: string): number => r.chunks.find((c) => c.text.includes(s))!.at
    expect(at('three') - at('one')).toBeGreaterThanOrEqual(2 * 40 - 15)
    expect(mockServerManager.openStreamCount(ID)).toBe(0)
  })

  it('Stop ends an open llm stream and its timers', async () => {
    const { port } = await start([
      {
        path: '/v1/chat/completions',
        response: llmResponse('a b c d e f g h i j', { chunkIntervalMs: 300 }),
      },
    ])
    const reading = post(port, chat(), { maxMs: 4000 })
    expect(await waitFor(() => mockServerManager.openStreamCount(ID) === 1)).toBe(true)
    const t0 = Date.now()
    await mockServerManager.stop(ID)
    const r = await reading
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(r.text).not.toContain('[DONE]')
    expect(sseWriterLiveTimers()).toBe(0)
  })

  it('a Stop during delayMs never opens the stream later (design Ek B R06)', async () => {
    const { port } = await start([
      {
        path: '/v1/chat/completions',
        response: llmResponse('late', {}, { delayMs: 300 }),
      },
    ])
    // The waiting request's socket is dropped: the client sees a hang-up, never a reply.
    const reading = post(port, chat(), { maxMs: 1500 }).catch(() => null)
    await sleep(60)
    await mockServerManager.stop(ID)
    const r = await reading
    expect(r === null || r.text === '').toBe(true)
    await sleep(400)
    expect(mockServerManager.openStreamCount(ID)).toBe(0)
    expect(sseWriterLiveTimers()).toBe(0)
  })

  it('a hot reload keeps the open reply on its snapshot (design Ek B R06)', async () => {
    const { port, def } = await start([
      {
        path: '/v1/chat/completions',
        response: llmResponse('first second third', { chunkIntervalMs: 80 }),
      },
    ])
    const reading = post(port, chat())
    expect(await waitFor(() => mockServerManager.openStreamCount(ID) === 1)).toBe(true)
    const next = structuredClone(def)
    next.endpoints[0].responses[0].body = 'CHANGED'
    await mockServerManager.update(next)
    const r = await reading
    const text = dataOf(r.text)
      .slice(0, -1)
      .map((d) => JSON.parse(d) as { choices: { delta: { content?: string } }[] })
      .map((c) => c.choices[0].delta.content ?? '')
      .join('')
    expect(text).toBe('first second third')
    // The next request uses the new definition.
    const again = await post(port, chat({ stream: false }))
    expect(JSON.parse(again.text).choices[0].message.content).toBe('CHANGED')
  })

  it('the response script edits the assistant text; a script error answers 500 JSON', async () => {
    const { port } = await start([
      {
        path: '/v1/chat/completions',
        response: llmResponse(
          'base',
          {},
          { script: "response.body = response.body + ' + script'" },
        ),
      },
      {
        path: '/broken',
        response: llmResponse('x', {}, { script: 'throw new Error("boom")' }),
      },
    ])
    const ok = await post(port, chat({ stream: false }))
    expect(JSON.parse(ok.text).choices[0].message.content).toBe('base + script')
    const bad = await rawRead(port, '/broken', { method: 'POST', body: chat() })
    expect(bad.status).toBe(500)
    expect(JSON.parse(bad.text)).toMatchObject({ error: 'Script error' })
  })

  it('a stored content-type header does not break either mode', async () => {
    const { port } = await start([
      {
        path: '/v1/chat/completions',
        response: llmResponse(
          'hi',
          {},
          {
            headers: [
              { name: 'Content-Type', value: 'text/plain' },
              { name: 'x-request-id', value: 'req-1' },
            ],
          },
        ),
      },
    ])
    const s = await post(port, chat())
    expect(s.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(s.headers['x-request-id']).toBe('req-1')
    const j = await post(port, chat({ stream: false }))
    expect(j.headers['content-type']).toBe('application/json; charset=utf-8')
    expect(j.headers['x-request-id']).toBe('req-1')
  })

  it(`a reply of more than ${SSE_MAX_PLAN_FRAMES} chunks is refused with a provider-shaped 503`, async () => {
    const { port } = await start([
      {
        path: '/v1/chat/completions',
        response: llmResponse('x'.repeat(SSE_MAX_PLAN_FRAMES + 10), { chunking: 'char' }),
      },
    ])
    const r = await post(port, chat())
    expect(r.status).toBe(503)
    expect(JSON.parse(r.text).error.type).toBe('server_error')
    expect(mockServerManager.openStreamCount(ID)).toBe(0)
    // Not streamed, the same reply is fine.
    const j = await post(port, chat({ stream: false }))
    expect(j.status).toBe(200)
  })

  it('the open and closed log entries share one stream id', async () => {
    const seen: { headers: Record<string, string> }[] = []
    const on = (e: { response: { headers: Record<string, string> } }): void => {
      seen.push(e.response)
    }
    mockServerManager.on('log', on)
    try {
      const { port } = await start([
        { path: '/v1/chat/completions', response: llmResponse('hi there') },
      ])
      await post(port, chat())
      expect(await waitFor(() => seen.length === 2)).toBe(true)
      expect(seen.map((r) => r.headers['x-mock-stream'])).toEqual([
        'open',
        expect.stringMatching(/^frames=\d+;reason=completed$/),
      ])
      expect(seen[0].headers['x-mock-stream-id']).toBe(seen[1].headers['x-mock-stream-id'])
    } finally {
      mockServerManager.off('log', on)
    }
  })
})
