/**
 * Issue #222 (5) — the SSE mock's mid-stream error event, through the ONE
 * SSE writer on a real loopback port: after N events written on the
 * connection (or when the list runs out first) one `event: error` with the
 * configured data (a template, rendered like any block) goes out and the
 * response ENDS cleanly (`end()`, the client sees the error then the end of
 * the stream; never `destroy()`). Loop, keep-open and multi-line data are
 * covered; every timer is gone afterwards.
 *
 * Fail-before: `validateStreamConfig` rejected `errorEvent` and the writer
 * had no terminal block — the stream never sent an error.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mockServerManager } from '../../src/main/mock/server'
import { sseWriterLiveTimers } from '../../src/main/mock/stream/sse-writer'
import {
  normalizeStreamConfig,
  validateStreamConfig,
  type MockSseStreamConfig,
} from '../../src/shared/mock-stream'
import { freePort, rawRead, serverDef, sseResponse, waitFor } from './mock-sse-fixtures'

const ID = 'sse-error-event'

afterEach(async () => {
  await mockServerManager.stopAll()
  expect(await waitFor(() => sseWriterLiveTimers() === 0, 1000)).toBe(true)
})

async function serve(body: string, cfg: Partial<MockSseStreamConfig>): Promise<number> {
  const port = await freePort()
  const r = await mockServerManager.start(
    serverDef(ID, port, [
      { path: '/events', response: sseResponse(body, { intervalMs: 10, ...cfg }) },
    ]),
  )
  expect(r.ok).toBe(true)
  return port
}

const FIVE = [1, 2, 3, 4, 5].map((n) => `id: ${n}\ndata: event ${n}\n`).join('\n')

describe('SSE error event on the wire', () => {
  it('after N events: event: error with the rendered data, then the response ends', async () => {
    const port = await serve(FIVE, {
      errorEvent: { afterEvents: 2, data: '{"seq": {{stream.seq}}, "error": "boom"}' },
    })
    const r = await rawRead(port, '/events')
    expect(r.status).toBe(200)
    expect(r.ended).toBe(true)
    expect(r.text).toBe(
      'id: 1\ndata: event 1\n\nid: 2\ndata: event 2\n\nevent: error\ndata: {"seq": 3, "error": "boom"}\n\n',
    )
    expect(mockServerManager.openStreamCount(ID)).toBe(0)
  })

  it('the error comes one interval after the last event, like a frame', async () => {
    const port = await serve(FIVE, { intervalMs: 60, errorEvent: { afterEvents: 1, data: 'x' } })
    const r = await rawRead(port, '/events')
    const at = (s: string): number => r.chunks.find((c) => c.text.includes(s))!.at
    expect(at('event: error') - at('event 1')).toBeGreaterThanOrEqual(60 - 15)
  })

  it('a list shorter than N: every event, then the error in place of the end (also with keep-open)', async () => {
    for (const onEnd of ['close', 'keep-open'] as const) {
      const port = await serve('data: a\n\ndata: b\n', {
        onEnd,
        errorEvent: { afterEvents: 5, data: 'late' },
      })
      const r = await rawRead(port, '/events')
      expect(r.ended).toBe(true)
      expect(r.text).toBe('data: a\n\ndata: b\n\nevent: error\ndata: late\n\n')
      await mockServerManager.stopAll()
    }
  })

  it('loop: N counts frames across passes', async () => {
    const port = await serve('data: tick {{stream.seq}}\n', {
      loop: true,
      onEnd: 'keep-open',
      resume: false,
      errorEvent: { afterEvents: 3, data: 'stop' },
    })
    const r = await rawRead(port, '/events')
    expect(r.ended).toBe(true)
    expect(r.text).toBe(
      'data: tick 1\n\ndata: tick 2\n\ndata: tick 3\n\nevent: error\ndata: stop\n\n',
    )
  })

  it('afterEvents 0: the error is the first event; multi-line data → one data: line each', async () => {
    const port = await serve(FIVE, { errorEvent: { afterEvents: 0, data: 'line one\nline two' } })
    const r = await rawRead(port, '/events')
    expect(r.text).toBe('event: error\ndata: line one\ndata: line two\n\n')
  })

  it('the closed log entry says the stream ended with the error event', async () => {
    const port = await serve(FIVE, { errorEvent: { afterEvents: 1, data: 'e' } })
    await rawRead(port, '/events')
    expect(await waitFor(() => mockServerManager.getLogs(ID).length >= 2)).toBe(true)
    const closed = mockServerManager.getLogs(ID).at(-1)!
    expect(closed.response.headers['x-mock-stream']).toBe('frames=2;reason=error-event')
    expect(closed.response.body).toContain('event: error')
    expect(closed.response.body).toContain('ended with the mid-stream error event')
  })

  it('a reconnect with Last-Event-ID resumes and counts from zero again', async () => {
    const port = await serve(FIVE, { errorEvent: { afterEvents: 2, data: 'e' } })
    const r = await rawRead(port, '/events', { headers: { 'last-event-id': '2' } })
    expect(r.text).toBe('id: 3\ndata: event 3\n\nid: 4\ndata: event 4\n\nevent: error\ndata: e\n\n')
  })
})

describe('errorEvent in the stream settings', () => {
  it('validates the shape with sentences the editor translates', () => {
    expect(validateStreamConfig({ errorEvent: { afterEvents: 3, data: '{}' } })).toBeNull()
    expect(validateStreamConfig({ errorEvent: 'x' })).toBe(
      'Error event must be an object with afterEvents and data',
    )
    expect(validateStreamConfig({ errorEvent: { afterEvents: 1, data: '', event: 'oops' } })).toBe(
      'Error event: unknown field event',
    )
    expect(validateStreamConfig({ errorEvent: { afterEvents: 1.5, data: '' } })).toBe(
      'Error event: afterEvents must be a whole number between 0 and 10000',
    )
    expect(validateStreamConfig({ errorEvent: { afterEvents: 1 } })).toBe(
      'Error event: data must be text of at most 16384 characters',
    )
  })

  it('reads tolerantly; a config without it stays byte-identical', () => {
    const old = { intervalMs: 1000, heartbeatMs: 0, loop: false, onEnd: 'close', resume: true }
    expect(JSON.stringify(normalizeStreamConfig(old))).toBe(JSON.stringify(old))
    expect(normalizeStreamConfig({ errorEvent: { afterEvents: 99999 } }).errorEvent).toEqual({
      afterEvents: 10_000,
      data: '{"message": "Mock stream error"}',
    })
    expect(normalizeStreamConfig({ errorEvent: 'nope' }).errorEvent).toBeUndefined()
  })
})
