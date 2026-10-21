/**
 * Issue #221 (Faz 1a) — `bodyType: 'sse'` mock responses stream through the
 * one SSE writer (`src/main/mock/stream/sse-writer.ts`), on a real loopback
 * listener. Before this phase the engine answered an `sse` body in one shot
 * as plain text, so every case here fails on the old engine.
 *
 * Covers the design's writer contract (Ek C): R02 per-frame render, R03
 * lifecycle from the response, R04 backpressure + fixed limits, R06 snapshot
 * + Stop, R07 resume of a fixed-id finite list, R08 verbatim blocks.
 */
import net from 'node:net'
import { describe, it, expect, afterEach } from 'vitest'
import { EventSource } from 'eventsource'
import { mockServerManager, type MockServerDef } from '../../src/main/mock/server'
import { sseWriterLiveTimers } from '../../src/main/mock/stream/sse-writer'
import type { MockLogEntry } from '../../src/main/mock/types'
import {
  freePort,
  rawRead,
  serverDef,
  sleep,
  sseResponse,
  waitFor,
  type RouteSpec,
} from './mock-sse-fixtures'

const ID = 'sse-mock'

async function start(routes: RouteSpec[], over: Partial<MockServerDef> = {}): Promise<number> {
  const port = await freePort()
  const r = await mockServerManager.start(serverDef(ID, port, routes, over))
  expect(r.ok).toBe(true)
  return port
}

/** Every log entry the manager broadcasts while the test runs (Stop clears the buffer). */
function captureLogs(): MockLogEntry[] {
  const seen: MockLogEntry[] = []
  const on = (e: MockLogEntry): void => {
    seen.push(e)
  }
  mockServerManager.on('log', on)
  cleanups.push(() => mockServerManager.off('log', on))
  return seen
}

const cleanups: (() => void)[] = []

afterEach(async () => {
  for (const c of cleanups.splice(0)) c()
  await mockServerManager.stopAll()
  expect(await waitFor(() => sseWriterLiveTimers() === 0, 1000)).toBe(true)
})

describe('an sse response streams its blocks (fail-before: one-shot text/plain)', () => {
  it('SSE headers, each block once, intervalMs apart, then the response ends', async () => {
    const port = await start([
      {
        path: '/events',
        response: sseResponse('data: one\n\ndata: two\n\ndata: three\n\n', { intervalMs: 60 }),
      },
    ])
    const r = await rawRead(port, '/events')
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(r.headers['cache-control']).toBe('no-cache')
    expect(r.headers['connection']).toBe('keep-alive')
    expect(r.text).toBe('data: one\n\ndata: two\n\ndata: three\n\n')
    expect(r.ended).toBe(true)
    const at = (s: string): number => r.chunks.find((c) => c.text.includes(s))!.at
    expect(at('three') - at('one')).toBeGreaterThanOrEqual(2 * 60 - 20)
  })

  it("a user header wins over the SSE default; the response's status is used", async () => {
    const port = await start([
      {
        path: '/e',
        response: sseResponse(
          'data: x',
          {},
          {
            statusCode: 201,
            headers: [{ name: 'Cache-Control', value: 'no-store' }],
          },
        ),
      },
    ])
    const r = await rawRead(port, '/e')
    expect(r.status).toBe(201)
    expect(r.headers['cache-control']).toBe('no-store')
    expect(r.text).toBe('data: x\n\n')
  })

  it('an empty body opens an empty stream that ends at once; the open entry notes it', async () => {
    const logs = captureLogs()
    const port = await start([{ path: '/none', response: sseResponse('\n\n') }])
    const r = await rawRead(port, '/none')
    expect([r.status, r.text, r.ended]).toEqual([200, '', true])
    expect(logs[0].error).toBe('The SSE body has no events')
  })

  it('a non-2xx status answers once: every block rendered back to back, no stream', async () => {
    const port = await start([
      {
        path: '/e',
        response: sseResponse(
          'data: {{stream.seq}}\n\ndata: {{stream.seq}}',
          { intervalMs: 5000 },
          {
            statusCode: 503,
          },
        ),
      },
    ])
    const r = await rawRead(port, '/e', { maxMs: 1000 })
    expect(r.status).toBe(503)
    expect(r.text).toBe('data: 1\n\ndata: 2\n\n')
    expect(r.ended).toBe(true)
  })
})

describe('R02 — each frame is rendered once, at write time, with stream.*', () => {
  it("Testnizer's SSE client (eventsource) gets a growing seq, parseable JSON and fresh times", async () => {
    const port = await start([
      {
        path: '/tick',
        response: sseResponse(
          'id: {{stream.seq}}\nevent: tick\ndata: {"n": {{stream.seq}}, "at": "{{stream.now}}", "pass": {{stream.iteration}} }',
          { intervalMs: 30, loop: true },
        ),
      },
    ])
    const es = new EventSource(`http://127.0.0.1:${port}/tick`)
    try {
      const got: { id: string; data: { n: number; at: string; pass: number } }[] = []
      es.addEventListener('tick', (ev) => {
        got.push({ id: ev.lastEventId, data: JSON.parse(ev.data) })
      })
      expect(await waitFor(() => got.length >= 3, 3000)).toBe(true)
      expect(got.slice(0, 3).map((g) => g.data.n)).toEqual([1, 2, 3])
      expect(got.slice(0, 3).map((g) => g.id)).toEqual(['1', '2', '3'])
      expect(got.slice(0, 3).map((g) => g.data.pass)).toEqual([1, 2, 3])
      expect(new Set(got.map((g) => g.data.at)).size).toBe(got.length)
    } finally {
      es.close()
    }
  })

  it('R03: a POST whose body was fully read keeps streaming; the LLM shortcuts are in the context', async () => {
    const port = await start([
      {
        path: '/chat',
        method: 'POST',
        response: sseResponse('data: {{stream.seq}} {{lastUserMessage}} {{request.body.n}}', {
          intervalMs: 30,
          loop: true,
        }),
      },
    ])
    const r = await rawRead(port, '/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ n: 7, messages: [{ role: 'user', content: 'hello' }] }),
      until: (t) => t.split('\n\n').length > 4,
    })
    expect(
      r.text.startsWith('data: 1 hello 7\n\ndata: 2 hello 7\n\ndata: 3 hello 7\n\ndata: 4 hello 7'),
    ).toBe(true)
  })

  it('the script sees the raw template; its output is rendered per frame, not twice', async () => {
    const port = await start([
      {
        path: '/s',
        response: sseResponse(
          'data: a{{stream.seq}}',
          {},
          {
            script: "response.body = response.body + '\\n\\ndata: b{{stream.seq}}'",
          },
        ),
      },
    ])
    expect((await rawRead(port, '/s')).text).toBe('data: a1\n\ndata: b2\n\n')
  })

  it('a script error answers the usual 500 JSON — no stream', async () => {
    const port = await start([
      { path: '/s', response: sseResponse('data: a', {}, { script: 'throw new Error("boom")' }) },
    ])
    const r = await rawRead(port, '/s')
    expect(r.status).toBe(500)
    expect(JSON.parse(r.text)).toEqual({ error: 'Script error', message: 'Error: boom' })
  })

  it('other body types are untouched: stream.* is empty there, output byte-identical', async () => {
    const port = await start([
      {
        path: '/j',
        response: { bodyType: 'json', body: '{"seq":"{{stream.seq}}","m":"{{request.method}}"}' },
      },
      { path: '/x', response: { bodyType: 'xml', body: '<a>{{request.path}}</a>' } },
      { path: '/t', response: { bodyType: 'text', body: 'plain {{request.query.q}}' } },
      { path: '/h', response: { bodyType: 'html', body: '<p>hi</p>' } },
    ])
    const j = await rawRead(port, '/j')
    expect([j.headers['content-type'], j.text]).toEqual([
      'application/json; charset=utf-8',
      '{"seq":"","m":"GET"}',
    ])
    const x = await rawRead(port, '/x')
    expect([x.headers['content-type'], x.text]).toEqual([
      'application/xml; charset=utf-8',
      '<a>/x</a>',
    ])
    const t = await rawRead(port, '/t?q=1')
    expect([t.headers['content-type'], t.text]).toEqual(['text/plain; charset=utf-8', 'plain 1'])
    const h = await rawRead(port, '/h')
    expect([h.headers['content-type'], h.text]).toEqual(['text/html; charset=utf-8', '<p>hi</p>'])
  })
})

describe('R08 — blocks go out verbatim; no data: is ever synthesised', () => {
  const BODY =
    'retry: 5000\n\n: a comment\n\nid: 7\n\ndata: line1\ndata: line2\nevent: multi\n\ndata: last-no-sep'

  it('retry-only, comment, id-only, multi-line data and a missing final separator', async () => {
    const port = await start([{ path: '/v', response: sseResponse(BODY, { intervalMs: 0 }) }])
    expect((await rawRead(port, '/v')).text).toBe(`${BODY}\n\n`)
  })

  it('CRLF bodies keep CRLF', async () => {
    const crlf = BODY.replace(/\n/g, '\r\n')
    const port = await start([{ path: '/v', response: sseResponse(crlf, { intervalMs: 0 }) }])
    expect((await rawRead(port, '/v')).text).toBe(`${crlf}\r\n\r\n`)
  })

  it('a client sees exactly the two application messages — control blocks add none', async () => {
    const port = await start([
      { path: '/v', response: sseResponse(BODY, { intervalMs: 10, resume: false }) },
    ])
    const es = new EventSource(`http://127.0.0.1:${port}/v`)
    try {
      const got: string[] = []
      es.addEventListener('multi', (ev) => got.push(`multi:${ev.data}`))
      es.onmessage = (ev) => got.push(`message:${ev.data}`)
      expect(await waitFor(() => got.length >= 2, 2000)).toBe(true)
      await sleep(50)
      expect(got).toEqual(['multi:line1\nline2', 'message:last-no-sep'])
    } finally {
      es.close()
    }
  })
})

describe('R07 — Last-Event-ID resume of a fixed-id finite list', () => {
  const FIXED = 'id: 1\ndata: a\n\nid: 2\ndata: b\n\nid: 3\ndata: c'

  it('resumes after the given id; an unknown id starts over', async () => {
    const port = await start([{ path: '/r', response: sseResponse(FIXED, { intervalMs: 0 }) }])
    expect((await rawRead(port, '/r', { headers: { 'last-event-id': '2' } })).text).toBe(
      'id: 3\ndata: c\n\n',
    )
    expect((await rawRead(port, '/r', { headers: { 'last-event-id': '9' } })).text).toBe(
      `${FIXED}\n\n`,
    )
  })

  it('the finished list on reconnect → 204 (onEnd close); keep-open → an open, silent stream', async () => {
    const port = await start([
      { path: '/r', response: sseResponse(FIXED, { intervalMs: 0 }) },
      { path: '/k', response: sseResponse(FIXED, { intervalMs: 0, onEnd: 'keep-open' }) },
    ])
    const done = await rawRead(port, '/r', { headers: { 'last-event-id': '3' } })
    expect([done.status, done.text, done.ended]).toEqual([204, '', true])
    const open = await rawRead(port, '/k', { headers: { 'last-event-id': '3' }, maxMs: 200 })
    expect([open.status, open.text, open.ended]).toEqual([200, '', false])
  })

  it('the open log entry says where a resumed stream started; HEAD opens no stream', async () => {
    const logs = captureLogs()
    const port = await start([{ path: '/r', response: sseResponse(FIXED, { intervalMs: 0 }) }])
    await rawRead(port, '/r', { headers: { 'last-event-id': '1' } })
    expect(logs[0].response.headers['x-mock-stream']).toBe('open;resumeAt=1')
    const head = await rawRead(port, '/r', { method: 'HEAD' })
    expect([head.status, head.headers['content-type'], head.ended]).toEqual([
      200,
      'text/event-stream; charset=utf-8',
      true,
    ])
    expect(mockServerManager.openStreamCount(ID)).toBe(0)
  })

  it('a loop or a templated id never resumes', async () => {
    const port = await start([
      { path: '/loop', response: sseResponse(FIXED, { intervalMs: 10, loop: true }) },
      {
        path: '/dyn',
        response: sseResponse('id: {{stream.seq}}\ndata: a\n\nid: {{stream.seq}}\ndata: b', {
          intervalMs: 0,
        }),
      },
    ])
    const loop = await rawRead(port, '/loop', {
      headers: { 'last-event-id': '2' },
      until: (t) => t.includes('\n\n'),
    })
    expect(loop.text.startsWith('id: 1\ndata: a\n\n')).toBe(true)
    const dyn = await rawRead(port, '/dyn', { headers: { 'last-event-id': '1' } })
    expect(dyn.text).toBe('id: 1\ndata: a\n\nid: 2\ndata: b\n\n')
  })

  it('end to end: EventSource auto-reconnects with Last-Event-ID, gets 204 and stops', async () => {
    const port = await start([
      {
        path: '/replay',
        response: sseResponse(`retry: 50\n\n${FIXED}`, { intervalMs: 10 }),
      },
    ])
    const es = new EventSource(`http://127.0.0.1:${port}/replay`)
    try {
      const got: string[] = []
      es.onmessage = (ev) => got.push(`${ev.lastEventId}:${ev.data}`)
      expect(await waitFor(() => es.readyState === EventSource.CLOSED, 3000)).toBe(true)
      expect(got).toEqual(['1:a', '2:b', '3:c'])
    } finally {
      es.close()
    }
  })
})

describe('R03 / R06 — lifecycle, snapshot and Stop', () => {
  it('a client abort clears the timers and the open-stream registry, and logs closed-by-client', async () => {
    const logs = captureLogs()
    const port = await start([
      {
        path: '/t',
        response: sseResponse('data: {{stream.seq}}', {
          intervalMs: 20,
          loop: true,
          heartbeatMs: 15,
        }),
      },
    ])
    const r = await rawRead(port, '/t', { until: (t) => t.split('data:').length > 3 })
    expect(r.text.startsWith('data: 1\n\n')).toBe(true)
    expect(await waitFor(() => mockServerManager.openStreamCount(ID) === 0)).toBe(true)
    expect(sseWriterLiveTimers()).toBe(0)
    const closed = logs.find((l) => /reason=client/.test(l.response.headers['x-mock-stream'] ?? ''))
    expect(closed).toBeDefined()
    const opened = logs.find((l) => l.response.headers['x-mock-stream'] === 'open')
    expect(opened?.response.headers['x-mock-stream-id']).toBe(
      closed?.response.headers['x-mock-stream-id'],
    )
    expect(closed?.response.body).toMatch(/\(stream: \d+ frames, [\d.]+ s, closed by the client\)$/)
  })

  it('Stop during delayMs: the waiting request is dropped at once and no stream is created later', async () => {
    const logs = captureLogs()
    const port = await start([
      { path: '/slow', response: sseResponse('data: late', {}, { delayMs: 1500 }) },
    ])
    let settledAt = 0
    const pending = rawRead(port, '/slow', { maxMs: 3000 })
      .catch(() => null)
      .then((r) => {
        settledAt = Date.now()
        return r
      })
    await sleep(60)
    const t0 = Date.now()
    await mockServerManager.stop(ID)
    // Not waiting out the delay (old engine) nor the 500 ms force-close.
    expect(Date.now() - t0).toBeLessThan(200)
    const r = await pending
    expect(settledAt - t0).toBeLessThan(200)
    expect(r?.text ?? '').toBe('')
    await sleep(1600)
    expect(logs.some((l) => l.response.headers['x-mock-stream'])).toBe(false)
    expect(sseWriterLiveTimers()).toBe(0)
  })

  it('a client abort during delayMs: no stream is created afterwards', async () => {
    const logs = captureLogs()
    const port = await start([
      { path: '/slow', response: sseResponse('data: late', {}, { delayMs: 200 }) },
    ])
    await new Promise<void>((resolve) => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.write('GET /slow HTTP/1.1\r\nHost: x\r\n\r\n')
        setTimeout(() => {
          sock.destroy()
          resolve()
        }, 40)
      })
    })
    await sleep(350)
    expect(logs.some((l) => l.response.headers['x-mock-stream'])).toBe(false)
    expect(mockServerManager.openStreamCount(ID)).toBe(0)
  })

  it('R06: a hot reload keeps the open stream on its snapshot; the next request gets the new body; Stop ends it', async () => {
    const logs = captureLogs()
    const port = await freePort()
    const routes = (body: string): RouteSpec[] => [
      { path: '/t', response: sseResponse(body, { intervalMs: 25, loop: true }) },
      { path: '/other', response: { bodyType: 'json', body: '{}' } },
    ]
    expect(
      (await mockServerManager.start(serverDef(ID, port, routes('data: old-{{stream.seq}}')))).ok,
    ).toBe(true)
    let firstEnded = false
    const first = rawRead(port, '/t', { maxMs: 5000 }).then((r) => {
      firstEnded = true
      return r
    })
    await waitFor(() => mockServerManager.streamStats(ID).some((s) => s.framesSent >= 2))
    // Same response id, new body + an unrelated edit — what autosave does.
    const next = serverDef(ID, port, routes('data: new-{{stream.seq}}'))
    next.endpoints[1].responses[0].body = '{"changed":true}'
    await mockServerManager.update(next)
    await sleep(120)
    expect(firstEnded).toBe(false)
    expect(mockServerManager.openStreamCount(ID)).toBe(1)
    const second = await rawRead(port, '/t', { until: (t) => t.includes('\n\n') })
    expect(second.text.startsWith('data: new-1\n\n')).toBe(true)

    await mockServerManager.stop(ID)
    const r = await first
    expect(r.ended).toBe(true)
    expect(r.text).not.toContain('new-')
    expect(r.text).toMatch(/^data: old-1\n\ndata: old-2\n\n/)
    expect(logs.some((l) => /reason=stopped/.test(l.response.headers['x-mock-stream'] ?? ''))).toBe(
      true,
    )
  })
})

describe('R04 — backpressure and fixed limits', () => {
  it('a client that stops reading stops production; reading again resumes it', async () => {
    const big = 'x'.repeat(60 * 1024)
    const port = await start([
      {
        path: '/big',
        response: sseResponse(`data: {{stream.seq}} ${big}`, {
          intervalMs: 10,
          loop: true,
          heartbeatMs: 10,
        }),
      },
    ])
    const sock = net.connect(port, '127.0.0.1')
    cleanups.push(() => sock.destroy())
    await new Promise<void>((resolve) => sock.once('connect', () => resolve()))
    sock.write('GET /big HTTP/1.1\r\nHost: x\r\n\r\n')
    sock.pause()
    const stats = (): { framesSent: number; writableLength: number; paused: boolean } =>
      mockServerManager.streamStats(ID)[0]
    expect(await waitFor(() => stats()?.paused === true, 4000)).toBe(true)
    const before = stats().framesSent
    await sleep(500)
    expect(stats().framesSent).toBe(before)
    expect(stats().writableLength).toBeLessThanOrEqual(2 * 64 * 1024)
    sock.resume()
    expect(await waitFor(() => stats().framesSent > before + 5, 3000)).toBe(true)
  })

  it('more than 64 open streams on one server → 503', async () => {
    const port = await start([
      { path: '/k', response: sseResponse(': hi', { intervalMs: 0, onEnd: 'keep-open' }) },
    ])
    const socks: net.Socket[] = []
    cleanups.push(() => socks.forEach((s) => s.destroy()))
    for (let i = 0; i < 64; i++) {
      const s = net.connect(port, '127.0.0.1')
      s.on('error', () => {})
      s.write('GET /k HTTP/1.1\r\nHost: x\r\n\r\n')
      socks.push(s)
    }
    expect(await waitFor(() => mockServerManager.openStreamCount(ID) === 64, 4000)).toBe(true)
    const r = await rawRead(port, '/k', { maxMs: 1000 })
    expect(r.status).toBe(503)
    expect(JSON.parse(r.text).error).toBe('too_many_streams')
  })

  it('a body over 10 000 events or with an event over 64 KiB → 503 before any stream', async () => {
    const port = await start([
      {
        path: '/many',
        response: sseResponse(Array.from({ length: 10_001 }, (_, i) => `data: ${i}`).join('\n\n')),
      },
      { path: '/huge', response: sseResponse(`data: ${'y'.repeat(70 * 1024)}`) },
    ])
    const many = await rawRead(port, '/many')
    expect([many.status, JSON.parse(many.text).error]).toEqual([503, 'sse_body_too_large'])
    const huge = await rawRead(port, '/huge')
    expect([huge.status, JSON.parse(huge.text).error]).toEqual([503, 'sse_event_too_large'])
    expect(mockServerManager.openStreamCount(ID)).toBe(0)
  })

  it('an event that renders past 64 KiB ends the stream with a comment — never a cut frame', async () => {
    const port = await start([
      {
        path: '/grow',
        method: 'POST',
        response: sseResponse('data: ok\n\ndata: {{request.body.blob}}', { intervalMs: 0 }),
      },
    ])
    const r = await rawRead(port, '/grow', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blob: 'z'.repeat(70 * 1024) }),
    })
    expect(r.text).toBe(
      'data: ok\n\n: testnizer mock: event larger than 65536 bytes, stream closed\n\n',
    )
    expect(r.ended).toBe(true)
  })
})
