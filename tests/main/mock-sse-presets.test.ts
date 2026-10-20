/**
 * SSE presets of the "New mock server" dialog (issue #221, design Ek D
 * §D.3.1) served by the REAL mock engine on a loopback port.
 *
 * A preset's hint must be true to what it serves, so each one is turned into
 * a `MockServerDef` exactly as `createFromHttpPreset` would store it and read
 * back over HTTP — not rendered by a renderer copy of the template code.
 * Intervals are shortened for the test (the preset's own values are checked
 * separately); everything else — body, loop, heartbeat, resume — is the
 * preset's.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mockServerManager } from '../../src/main/mock/server'
import { sseWriterLiveTimers } from '../../src/main/mock/stream/sse-writer'
import { splitSseBlocks } from '../../src/shared/mock-sse-blocks'
import {
  normalizeStreamConfig,
  validateStreamConfig,
  type MockSseStreamConfig,
} from '../../src/shared/mock-stream'
import {
  buildSsePreset,
  MOCK_SSE_PRESET_IDS,
  tickerResponse,
  type MockSsePresetId,
} from '../../src/renderer/components/mock/mock-sse-presets'
import { freePort, rawRead, serverDef, waitFor, type RouteSpec } from './mock-sse-fixtures'

const ID = 'sse-preset'

afterEach(async () => {
  await mockServerManager.stopAll()
  expect(await waitFor(() => sseWriterLiveTimers() === 0, 1000)).toBe(true)
})

/** Serve a preset; `fast` shrinks intervals / heartbeats so the test runs in ms. */
async function serve(
  id: MockSsePresetId,
  fast: Partial<MockSseStreamConfig> = {},
): Promise<number> {
  const preset = buildSsePreset(id)
  const routes: RouteSpec[] = preset.endpoints.map(({ endpoint, responses }) => {
    const r = responses[0]
    return {
      path: endpoint.path,
      method: endpoint.method,
      response: {
        name: r.name,
        statusCode: r.statusCode,
        headers: r.headers,
        bodyType: r.bodyType,
        body: r.body,
        delayMs: r.delayMs,
        streamConfig: r.streamConfig ? normalizeStreamConfig({ ...r.streamConfig, ...fast }) : null,
      },
    }
  })
  const port = await freePort()
  const ok = await mockServerManager.start(serverDef(ID, port, routes))
  expect(ok.ok).toBe(true)
  return port
}

/** `data:` payloads of every event in a raw stream, parsed as JSON. */
function dataJson(text: string): Record<string, unknown>[] {
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)) as Record<string, unknown>)
}

describe('SSE presets — shape', () => {
  it.each(MOCK_SSE_PRESET_IDS)('preset "%s" is a valid SSE server', (id) => {
    const preset = buildSsePreset(id)
    expect(preset.server.kind).toBe('sse')
    expect(preset.endpoints.length).toBeGreaterThan(0)
    for (const { endpoint, responses } of preset.endpoints) {
      expect(endpoint.method).toBe('GET')
      expect(endpoint.pathMode).toBe('exact')
      for (const r of responses) {
        // Handlebars would read `}}}` as a triple-stash close and fail the render.
        expect(r.body).not.toContain('}}}')
        if (r.bodyType === 'sse') {
          expect(validateStreamConfig(r.streamConfig)).toBeNull()
          expect(splitSseBlocks(r.body).length).toBeGreaterThan(0)
          // A looping list or a templated id can never resume (Ek C R07).
          const dynamicIds = splitSseBlocks(r.body).some((b) => b.dynamicId)
          if (r.streamConfig?.loop || dynamicIds) expect(r.streamConfig?.resume).toBe(false)
        }
      }
    }
  })

  it('the preset values match the dialog table (Ek D §D.3.1)', () => {
    const cfg = (id: MockSsePresetId): MockSseStreamConfig | undefined =>
      buildSsePreset(id).endpoints[0].responses[0].streamConfig
    expect(cfg('ticker')).toEqual({
      intervalMs: 1000,
      heartbeatMs: 15000,
      loop: true,
      onEnd: 'keep-open',
      resume: false,
    })
    expect(cfg('replay')).toMatchObject({
      intervalMs: 500,
      loop: false,
      onEnd: 'close',
      resume: true,
    })
    expect(cfg('notifications')).toMatchObject({ intervalMs: 2000, heartbeatMs: 10000, loop: true })
    expect(cfg('slow')).toMatchObject({ intervalMs: 10000, heartbeatMs: 5000, loop: true })
    expect(buildSsePreset('slow').endpoints[0].responses[0].delayMs).toBe(1500)
    expect(buildSsePreset('notifications').endpoints.map((e) => e.endpoint.path)).toEqual([
      '/notifications',
      '/notifications/unread',
    ])
    // The editor's "Add" uses the very same ticker response.
    expect(tickerResponse()).toEqual(buildSsePreset('ticker').endpoints[0].responses[0])
  })
})

describe('SSE presets — served by the real engine', () => {
  it('ticker: every frame is JSON with n = 1, 2, 3 … and a fresh timestamp', async () => {
    const port = await serve('ticker', { intervalMs: 15 })
    const r = await rawRead(port, '/events', {
      until: (text) => (text.match(/^data: /gm) ?? []).length >= 3,
    })
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    const frames = dataJson(r.text).slice(0, 3)
    expect(frames.map((f) => f.n)).toEqual([1, 2, 3])
    for (const f of frames) expect(Number.isNaN(Date.parse(String(f.at)))).toBe(false)
    expect(r.text).toMatch(/^id: 1\nevent: tick\n/)
    expect(r.text).toContain('\nid: 2\nevent: tick\n')
  })

  it('replay: ids 1–5 then close; Last-Event-ID 3 resumes at 4; the last id gets 204', async () => {
    const port = await serve('replay', { intervalMs: 5 })
    const all = await rawRead(port, '/events')
    expect(all.ended).toBe(true)
    expect(dataJson(all.text).map((f) => f.id)).toEqual([1, 2, 3, 4, 5])
    expect(all.text.startsWith('retry: 3000\nid: 1\n')).toBe(true)

    const resumed = await rawRead(port, '/events', { headers: { 'last-event-id': '3' } })
    expect(dataJson(resumed.text).map((f) => f.id)).toEqual([4, 5])

    const done = await rawRead(port, '/events', { headers: { 'last-event-id': '5' } })
    expect(done.status).toBe(204)
  })

  it('notifications: named order / message / alert events with JSON data, plus a JSON endpoint', async () => {
    const port = await serve('notifications', { intervalMs: 5 })
    const r = await rawRead(port, '/notifications', {
      until: (text) => (text.match(/^data: /gm) ?? []).length >= 4,
    })
    const events = [...r.text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]).slice(0, 4)
    expect(events).toEqual(['order', 'message', 'alert', 'order'])
    const frames = dataJson(r.text).slice(0, 4)
    expect(frames.map((f) => f.seq)).toEqual([1, 2, 3, 4])

    const unread = await rawRead(port, '/notifications/unread')
    expect(unread.status).toBe(200)
    const body = JSON.parse(unread.text) as { unread: number }
    expect(body.unread).toBeGreaterThanOrEqual(0)
    expect(body.unread).toBeLessThanOrEqual(9)
  })

  it('slow: nothing (not even headers) before the delay, then a tick', async () => {
    const port = await serve('slow')
    const t0 = Date.now()
    const r = await rawRead(port, '/events', {
      maxMs: 4000,
      until: (text) => text.includes('data: '),
    })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1400)
    expect(r.status).toBe(200)
    expect(dataJson(r.text)[0]).toMatchObject({ n: 1 })
  })
})
