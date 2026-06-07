/**
 * Integration tests for `src/main/protocols/sse.engine.ts`.
 *
 * Spins up an in-process Node `http` SSE server and drives the engine via the
 * real `eventsource@3` client. `electron`'s `BrowserWindow` is mocked so we
 * intercept `sendEventToRenderer` payloads without booting Electron.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

// ─── Mock electron BEFORE importing the engine ─────────────────
const sentEvents: Array<{ channel: string; payload: unknown }> = []
const mockWebContents = {
  send: (channel: string, payload: unknown) => {
    sentEvents.push({ channel, payload })
  },
}

vi.mock('electron', () => ({
  BrowserWindow: {
    fromId: (_id: number) => ({ isDestroyed: () => false, webContents: mockWebContents }),
  },
}))

import {
  connect,
  disconnect,
  describeSseError,
  getConnectionInfo,
  type SseEventPayload,
} from '../../src/main/protocols/sse.engine'

// ─── Test server helpers ───────────────────────────────────────
interface TestServer {
  server: Server
  url: string
  push: (data: string, opts?: { id?: string; eventType?: string }) => void
  killAll: () => void
}

async function startSseServer(): Promise<TestServer> {
  const responses = new Set<ServerResponse>()
  const server = createServer((req, res) => {
    if (req.url === '/never-opens') return // Hang to exercise the 15s timeout.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write(': ok\n\n') // Flush headers immediately so onopen fires.
    responses.add(res)
    res.on('close', () => responses.delete(res))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    push: (data, opts = {}) => {
      for (const res of responses) {
        const lines: string[] = []
        if (opts.eventType) lines.push(`event: ${opts.eventType}`)
        if (opts.id) lines.push(`id: ${opts.id}`)
        lines.push(`data: ${data}`)
        res.write(lines.join('\n') + '\n\n')
      }
    },
    killAll: () => {
      for (const res of responses) res.destroy()
      responses.clear()
    },
  }
}

function stopServer(t: TestServer): Promise<void> {
  t.killAll()
  // Force-close any keep-alive sockets the platform leaves dangling. Without
  // this, `server.close()` waits for them and the afterAll hook can exceed the
  // default 10s on slower CI runners (the test passes locally because macOS /
  // Linux desktops drain the socket pool faster than GitHub-hosted Ubuntu).
  t.server.closeAllConnections?.()
  return new Promise((resolve) => t.server.close(() => resolve()))
}

const sseEvents = (): SseEventPayload[] =>
  sentEvents.filter((e) => e.channel === 'sse:event').map((e) => e.payload as SseEventPayload)

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 2000): Promise<T> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const v = fn()
    if (v !== undefined && v !== null && v !== false) return v as T
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('waitFor timed out')
}

// ─── Tests ─────────────────────────────────────────────────────

let srv: TestServer
beforeAll(async () => { srv = await startSseServer() })
afterAll(async () => { await stopServer(srv) })
beforeEach(() => { sentEvents.length = 0 })

describe('sse.engine — connect / open', () => {
  it('resolves with connection info and pushes an `open` event to the renderer', async () => {
    const info = await connect({ url: srv.url + '/' }, 1)
    expect(info.connectionId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(info.url).toBe(srv.url + '/')
    expect(info.readyState).toBe(1) // EventSource.OPEN
    expect(typeof info.connectedAt).toBe('number')

    const open = await waitFor(() => sseEvents().find((e) => e.type === 'open'))
    expect(open.connectionId).toBe(info.connectionId)

    const live = getConnectionInfo(info.connectionId)
    expect(live).not.toBeNull()
    expect(live!.url).toBe(srv.url + '/')

    expect(disconnect(info.connectionId)).toBe(true)
    expect(getConnectionInfo(info.connectionId)).toBeNull()
  })
})

describe('sse.engine — message delivery', () => {
  it('forwards default `message` events with data + id', async () => {
    const info = await connect({ url: srv.url + '/' }, 1)
    srv.push('hello world', { id: '42' })

    const evt = await waitFor(() => sseEvents().find((e) => e.type === 'event'))
    expect(evt.eventType).toBe('message')
    expect(evt.data).toBe('hello world')
    expect(evt.id).toBe('42')
    expect(evt.connectionId).toBe(info.connectionId)

    disconnect(info.connectionId)
  })

  it('forwards named SSE events to the renderer (eventsource@3 dispatchEvent capture)', async () => {
    // Wikimedia-style streams emit `event: recentchange` lines. With the
    // engine's `dispatchEvent` interception we now surface every named event
    // alongside the default `message` type, with the original event name
    // preserved on `eventType`.
    const info = await connect({ url: srv.url + '/' }, 1)
    srv.push('{"x":1}', { eventType: 'recentchange', id: 'rc-1' })
    srv.push('default-payload', { id: 'd-1' })

    await waitFor(() => sseEvents().some((e) => e.type === 'event' && e.data === 'default-payload'))
    const eventPayloads = sseEvents().filter((e) => e.type === 'event')

    const named = eventPayloads.find((e) => e.data === '{"x":1}')
    expect(named).toBeDefined()
    expect(named!.eventType).toBe('recentchange')
    expect(named!.id).toBe('rc-1')

    const defaultEvt = eventPayloads.find((e) => e.data === 'default-payload')
    expect(defaultEvt).toBeDefined()
    expect(defaultEvt!.eventType).toBe('message')

    disconnect(info.connectionId)
  })
})

// ─── Last-Event-ID forwarding (MST-124 regression) ─────────────
//
// `eventsource@3` does not accept a `headers` init field, so the engine merges
// caller headers (incl. a hand-entered `Last-Event-ID`) into a wrapped `fetch`.
// Two things must hold: (1) a clean `Last-Event-ID` reaches the server on the
// first connect, and (2) a `Last-Event-ID` value that is illegal as an HTTP
// header (CR/LF/NUL, or a non-Latin1 char) must NOT abort the connection — the
// old plain-object merge let `Headers` throw inside `fetch`, which surfaced as a
// connect failure with zero events.

interface HeaderCaptureServer {
  server: Server
  url: string
  /** Most-recent inbound `Last-Event-ID` request header (undefined if absent). */
  lastEventIdHeader: () => string | undefined
  close: () => Promise<void>
}

async function startHeaderCaptureServer(): Promise<HeaderCaptureServer> {
  let captured: string | undefined
  const server = createServer((req, res) => {
    const v = req.headers['last-event-id']
    captured = Array.isArray(v) ? v.join(',') : v
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write('event: tick\nid: 1\ndata: hi\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    server,
    url: `http://127.0.0.1:${port}/`,
    lastEventIdHeader: () => captured,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

describe('sse.engine — Last-Event-ID header merge', () => {
  it('forwards a clean Last-Event-ID on the first connect', async () => {
    const hs = await startHeaderCaptureServer()
    try {
      const info = await connect({ url: hs.url, lastEventId: '42' }, 1)
      await waitFor(() => sseEvents().find((e) => e.type === 'open'))
      expect(hs.lastEventIdHeader()).toBe('42')
      disconnect(info.connectionId)
    } finally {
      await hs.close()
    }
  })

  it('skips an illegal Last-Event-ID value instead of aborting the connection', async () => {
    // A hand-typed id with an embedded control char is rejected by `Headers`.
    // The connection must still open and stream events — only the bad header
    // is dropped. Previously this produced zero events (the wrapped fetch threw).
    const hs = await startHeaderCaptureServer()
    try {
      const info = await connect({ url: hs.url, lastEventId: 'bad\r\nvalue' }, 1)
      const evt = await waitFor(() => sseEvents().find((e) => e.type === 'event'))
      expect(evt.eventType).toBe('tick')
      expect(evt.data).toBe('hi')
      // The malformed header must not have been forwarded.
      expect(hs.lastEventIdHeader()).toBeUndefined()
      disconnect(info.connectionId)
    } finally {
      await hs.close()
    }
  })

  it('keeps a custom header alongside a clean Last-Event-ID', async () => {
    const hs = await startHeaderCaptureServer()
    try {
      const info = await connect(
        { url: hs.url, lastEventId: '7', headers: { 'X-Trace-Id': 'abc' } },
        1,
      )
      await waitFor(() => sseEvents().find((e) => e.type === 'open'))
      expect(hs.lastEventIdHeader()).toBe('7')
      disconnect(info.connectionId)
    } finally {
      await hs.close()
    }
  })
})

describe('sse.engine — error path', () => {
  it('emits an `error` payload when the server drops the connection', async () => {
    const info = await connect({ url: srv.url + '/' }, 1)
    await waitFor(() => sseEvents().find((e) => e.type === 'open'))
    srv.killAll()

    const err = await waitFor(() => sseEvents().find((e) => e.type === 'error'))
    expect(err.connectionId).toBe(info.connectionId)
    expect(typeof err.timestamp).toBe('number')

    disconnect(info.connectionId)
  })
})

describe('sse.engine — disconnect', () => {
  it('returns false for unknown connection ids', () => {
    expect(disconnect('does-not-exist')).toBe(false)
  })

  it('clears the connection map; second disconnect is a no-op', async () => {
    const info = await connect({ url: srv.url + '/' }, 1)
    expect(getConnectionInfo(info.connectionId)).not.toBeNull()
    expect(disconnect(info.connectionId)).toBe(true)
    expect(getConnectionInfo(info.connectionId)).toBeNull()
    expect(disconnect(info.connectionId)).toBe(false)
  })
})

describe('sse.engine — HTTP error enrichment', () => {
  async function startStatusServer(status: number, statusMessage?: string): Promise<Server> {
    const server = createServer((_req, res) => {
      res.writeHead(status, statusMessage)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    return server
  }

  it('surfaces HTTP 401 with an Authorization hint and httpStatus on the error event', async () => {
    const server = await startStatusServer(401, 'Unauthorized')
    const port = (server.address() as AddressInfo).port
    try {
      await expect(connect({ url: `http://127.0.0.1:${port}/` }, 1)).rejects.toThrow(/401/)
      const err = sseEvents().find((e) => e.type === 'error')
      expect(err).toBeDefined()
      expect(err!.httpStatus).toBe(401)
      expect(err!.data).toMatch(/401/)
      expect(err!.data).toMatch(/Unauthorized|Authorization/i)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('surfaces HTTP 404 with a "check the URL" hint', async () => {
    const server = await startStatusServer(404, 'Not Found')
    const port = (server.address() as AddressInfo).port
    try {
      await expect(connect({ url: `http://127.0.0.1:${port}/missing` }, 1)).rejects.toThrow(/404/)
      const err = sseEvents().find((e) => e.type === 'error')
      expect(err!.httpStatus).toBe(404)
      expect(err!.data).toMatch(/404/)
      expect(err!.data).toMatch(/Not Found|URL/i)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('reports a connection-refused error when nothing is listening on the port', async () => {
    // Bind+release a port to grab one we know is free, then connect there.
    const probe = createServer()
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
    const port = (probe.address() as AddressInfo).port
    await new Promise<void>((resolve) => probe.close(() => resolve()))

    await expect(connect({ url: `http://127.0.0.1:${port}/` }, 1)).rejects.toThrow(
      /ECONNREFUSED|refused/i,
    )
    const err = sseEvents().find((e) => e.type === 'error')
    expect(err!.httpStatus).toBeUndefined()
    expect(err!.data).toMatch(/ECONNREFUSED|refused/i)
  })

  it('describeSseError formats known statuses, transport failures and unknown shapes', () => {
    expect(describeSseError({ status: 401, message: 'Unauthorized' })).toEqual({
      message: 'HTTP 401 Unauthorized — check Authorization header / token',
      httpStatus: 401,
    })
    expect(describeSseError({ status: 418, message: 'I\'m a teapot' })).toEqual({
      message: "HTTP 418 I'm a teapot",
      httpStatus: 418,
    })
    expect(describeSseError({ message: 'connect ECONNREFUSED 127.0.0.1:9' }).message).toMatch(
      /Connection refused/,
    )
    expect(describeSseError({}).message).toBe('SSE connection error')
  })
})

describe('sse.engine — connection timeout branch', () => {
  it('rejects after 15s when the server never sends headers', async () => {
    vi.useFakeTimers()
    try {
      const promise = connect({ url: srv.url + '/never-opens' }, 1)
      // Attach the rejection assertion BEFORE advancing fake timers, otherwise
      // vitest surfaces the synchronous flush as an "unhandled rejection".
      const expected = expect(promise).rejects.toThrow(/timeout/i)
      await vi.advanceTimersByTimeAsync(15_001)
      await expected
    } finally {
      vi.useRealTimers()
    }
  }, 20_000)
})

// ─── Fetch path: non-GET methods + request body ─────────────────
//
// `eventsource@3` is GET-only and won't accept a body, so the engine routes
// any non-GET method (or any body) through a manual `fetch` + ReadableStream
// reader. These tests spin up a tiny SSE server that asserts the inbound
// request shape (method, headers, body) before flushing one SSE event.

interface PostServer {
  server: Server
  url: string
  /** Captured most-recent request shape. */
  last: { method?: string; headers: Record<string, string>; body: string }
  close: () => Promise<void>
}

async function startPostSseServer(opts?: {
  expectMethod?: string
  /** When set, server returns `status` instead of streaming. */
  status?: number
}): Promise<PostServer> {
  const last: PostServer['last'] = { method: undefined, headers: {}, body: '' }
  const server = createServer((req, res) => {
    last.method = req.method
    last.headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : String(v)]),
    )
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      last.body = Buffer.concat(chunks).toString('utf-8')
      if (opts?.status && opts.status >= 400) {
        res.writeHead(opts.status, 'Forbidden')
        res.end()
        return
      }
      if (opts?.expectMethod && req.method !== opts.expectMethod) {
        res.writeHead(405, 'Method Not Allowed')
        res.end()
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      // One immediate event so the test sees a deterministic message.
      res.write('event: ack\nid: post-1\ndata: ' + last.body + '\n\n')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    last,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

describe('sse.engine — fetch path (POST + body)', () => {
  it('connects with POST + JSON body and forwards a streamed event', async () => {
    const ps = await startPostSseServer({ expectMethod: 'POST' })
    try {
      const payload = JSON.stringify({ hello: 'world' })
      const info = await connect(
        {
          url: ps.url + '/',
          method: 'POST',
          body: payload,
          headers: { 'Content-Type': 'application/json' },
        },
        1,
      )
      expect(info.connectionId).toMatch(/^[0-9a-f-]{36}$/i)

      // Server must have seen our POST + body
      expect(ps.last.method).toBe('POST')
      expect(ps.last.body).toBe(payload)
      expect(ps.last.headers['content-type']).toBe('application/json')

      const open = await waitFor(() => sseEvents().find((e) => e.type === 'open'))
      expect(open.connectionId).toBe(info.connectionId)

      // Custom event with id should round-trip via our streaming parser
      const evt = await waitFor(() => sseEvents().find((e) => e.type === 'event'))
      expect(evt.eventType).toBe('ack')
      expect(evt.id).toBe('post-1')
      expect(evt.data).toBe(payload)

      disconnect(info.connectionId)
    } finally {
      await ps.close()
    }
  })

  it('forwards custom request headers verbatim on the POST handshake', async () => {
    const ps = await startPostSseServer({ expectMethod: 'POST' })
    try {
      const info = await connect(
        {
          url: ps.url + '/',
          method: 'POST',
          body: 'plain text',
          headers: {
            'X-Trace-Id': 'abc-123',
            'X-Custom': 'testnizer',
            'Content-Type': 'text/plain',
          },
        },
        1,
      )
      expect(ps.last.headers['x-trace-id']).toBe('abc-123')
      expect(ps.last.headers['x-custom']).toBe('testnizer')
      expect(ps.last.headers['content-type']).toBe('text/plain')
      // Default Accept header should be auto-injected.
      expect(ps.last.headers['accept']).toBe('text/event-stream')

      await waitFor(() => sseEvents().find((e) => e.type === 'open'))
      disconnect(info.connectionId)
    } finally {
      await ps.close()
    }
  })

  it('rejects POST with HTTP-status enrichment when server returns 403', async () => {
    const ps = await startPostSseServer({ status: 403 })
    try {
      await expect(
        connect({ url: ps.url + '/', method: 'POST', body: '{}' }, 1),
      ).rejects.toThrow(/403/)
      const err = sseEvents().find((e) => e.type === 'error')
      expect(err).toBeDefined()
      expect(err!.httpStatus).toBe(403)
      expect(err!.data).toMatch(/403/)
      expect(err!.data).toMatch(/Forbidden|credentials/i)
    } finally {
      await ps.close()
    }
  })
})
