/**
 * Issue #154 — a cross-origin redirect must not replay credential headers.
 *
 * The engine keeps following redirects (v1 parity: gateways that move an MCP
 * endpoint with a 307/308), but it follows them ITSELF: on a hop to another
 * origin every header `isCredentialHeaderName` matches is dropped — not only
 * `Authorization` / `Cookie` (which native fetch already strips) but gateway
 * keys such as `X-API-Key` that native fetch would replay to the new origin.
 * A same-origin hop keeps every header.
 *
 * Real SDK 2.x client against real loopback servers. Two servers on different
 * ports are different origins.
 */
import http from 'node:http'
import net from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { startMcpServer } from '../e2e/servers/mcp-server'
import {
  fetchFollowingRedirects,
  mcpCallTool,
  mcpConnect,
  mcpDisconnect,
  setMcpEventSink,
  type McpEngineEvent,
  type McpNotificationEvent,
} from '../../src/main/protocols/mcp.engine'

const HEADERS = {
  'X-API-Key': 'gw-key-154',
  Authorization: 'Bearer user-token-154',
  'X-Trace': 'trace-154',
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
    srv.on('error', reject)
  })
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!().catch(() => {})
})

async function listen(server: http.Server): Promise<number> {
  const port = await freePort()
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', () => resolve()))
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  return port
}

/** Origin A: answers EVERY request with a 307 to the same path + query on `target`. */
async function redirector(targetOrigin: string): Promise<string> {
  const port = await listen(
    http.createServer((req, res) => {
      req.resume()
      res.writeHead(307, { Location: `${targetOrigin}${req.url ?? '/'}` })
      res.end()
    }),
  )
  return `http://127.0.0.1:${port}`
}

/** Pipes `req` (already-read `body`) to `upstream`, streaming the answer back. */
function proxy(
  upstream: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  body: Buffer,
): void {
  const up = http.request(
    {
      host: upstream.hostname,
      port: upstream.port,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (ur) => {
      res.writeHead(ur.statusCode ?? 502, ur.headers)
      ur.pipe(res)
    },
  )
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502)
    res.end()
  })
  up.end(body)
}

interface Seen {
  method: string
  path: string
  headers: http.IncomingHttpHeaders
}

/** Legacy MCP-over-SSE server (v1 SDK — the legacy transport) recording every request. */
async function recordingSseServer(): Promise<{ origin: string; seen: Seen[] }> {
  const seen: Seen[] = []
  const transports = new Map<string, SSEServerTransport>()
  let origin = ''
  const server = http.createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0]
    seen.push({ method: req.method ?? '', path, headers: req.headers })
    if (req.method === 'GET' && path === '/sse') {
      const transport = new SSEServerTransport('/messages', res)
      transports.set(transport.sessionId, transport)
      transport.onclose = () => transports.delete(transport.sessionId)
      const mcp = new McpServer({ name: 'redirect-sse', version: '1.0.0' })
      mcp.registerTool('ping', { description: 'pong', inputSchema: {} }, async () => ({
        content: [{ type: 'text', text: 'pong' }],
      }))
      await mcp.connect(transport)
      return
    }
    if (req.method === 'POST' && path === '/messages') {
      const sid = new URL(req.url ?? '', origin).searchParams.get('sessionId')
      const t = sid ? transports.get(sid) : undefined
      if (t) {
        await t.handlePostMessage(req, res)
        return
      }
    }
    res.writeHead(404)
    res.end()
  })
  const port = await listen(server)
  origin = `http://127.0.0.1:${port}`
  return { origin, seen }
}

async function echoHeaders(connectionId: string): Promise<Record<string, string>> {
  const result = (await mcpCallTool(connectionId, 'echo_headers', {})) as {
    content: Array<{ type: string; text: string }>
  }
  return JSON.parse(result.content[0].text) as Record<string, string>
}

describe('mcp.engine — redirects and credential headers (issue #154)', () => {
  it.each(['legacy', 'auto'] as const)(
    'http (protocol %s): a cross-origin 307 is followed, but credential headers stay behind',
    async (protocol) => {
      const target = await startMcpServer(await freePort())
      cleanups.push(target.close)
      const origin = await redirector(new URL(target.url).origin)

      const info = await mcpConnect({
        transport: 'http',
        url: `${origin}/mcp`,
        headers: HEADERS,
        protocol,
      })
      cleanups.push(() => mcpDisconnect(info.connectionId))
      expect(info.serverName).toBe('testnizer-e2e-mcp')

      const seen = await echoHeaders(info.connectionId)
      expect(seen['x-trace']).toBe('trace-154')
      expect(seen['x-api-key']).toBeUndefined()
      expect(seen.authorization).toBeUndefined()
    },
  )

  it('sse: the GET EventSource stream and the POSTs are redirected without credential headers', async () => {
    const target = await recordingSseServer()
    const origin = await redirector(target.origin)

    const info = await mcpConnect({
      transport: 'sse',
      url: `${origin}/sse`,
      headers: HEADERS,
    })
    cleanups.push(() => mcpDisconnect(info.connectionId))
    await mcpCallTool(info.connectionId, 'ping', {})

    const gets = target.seen.filter((r) => r.method === 'GET' && r.path === '/sse')
    const posts = target.seen.filter((r) => r.method === 'POST' && r.path === '/messages')
    expect(gets.length).toBeGreaterThan(0)
    expect(posts.length).toBeGreaterThan(0)
    for (const r of [...gets, ...posts]) {
      expect(r.headers['x-trace']).toBe('trace-154')
      expect(r.headers['x-api-key']).toBeUndefined()
      expect(r.headers.authorization).toBeUndefined()
    }
  })

  it('http: a same-origin 307 keeps every header, credentials included', async () => {
    const target = await startMcpServer(await freePort())
    cleanups.push(target.close)
    const upstream = new URL(target.url)
    // One origin that moves `/old` to `/mcp` and serves `/mcp` itself (proxied).
    const port = await listen(
      http.createServer((req, res) => {
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          if ((req.url ?? '').startsWith('/old')) {
            res.writeHead(307, { Location: '/mcp' })
            res.end()
            return
          }
          proxy(upstream, req, res, Buffer.concat(chunks))
        })
      }),
    )

    const info = await mcpConnect({
      transport: 'http',
      url: `http://127.0.0.1:${port}/old`,
      headers: HEADERS,
      protocol: 'legacy',
    })
    cleanups.push(() => mcpDisconnect(info.connectionId))
    const seen = await echoHeaders(info.connectionId)
    expect(seen['x-trace']).toBe('trace-154')
    expect(seen['x-api-key']).toBe('gw-key-154')
    expect(seen.authorization).toBe('Bearer user-token-154')
  })
})

describe('fetchFollowingRedirects (issue #154)', () => {
  interface Hop {
    url: string
    method: string
    headers: Record<string, string>
    body: unknown
    redirect: RequestRedirect | undefined
  }

  /** A fake network: `routes[url]` answers that URL; every hop is recorded. */
  function fakeNet(routes: Record<string, () => Response>): {
    hops: Hop[]
    fetch: (url: string | URL, init?: RequestInit) => Promise<Response>
  } {
    const hops: Hop[] = []
    return {
      hops,
      fetch: async (url, init) => {
        hops.push({
          url: String(url),
          method: init?.method ?? 'GET',
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
          body: init?.body,
          redirect: init?.redirect,
        })
        const route = routes[String(url)]
        return route ? route() : new Response('not found', { status: 404 })
      },
    }
  }

  const redirect = (status: number, location: string) => () =>
    new Response(null, { status, headers: { Location: location } })
  const ok = () => new Response('{}', { status: 200 })

  it('follows each hop with redirect: manual and strips credentials only once the origin changes', async () => {
    const net = fakeNet({
      'http://a.test/mcp': redirect(307, '/v2/mcp'),
      'http://a.test/v2/mcp': redirect(308, 'http://b.test/mcp'),
      'http://b.test/mcp': ok,
    })
    const res = await fetchFollowingRedirects(net.fetch)('http://a.test/mcp', {
      method: 'POST',
      body: '{"x":1}',
      headers: {
        'X-API-Key': 'k',
        Cookie: 'c=1',
        'Ocp-Apim-Subscription-Key': 's',
        'X-Trace': 't',
        'Content-Type': 'application/json',
      },
    })
    expect(res.status).toBe(200)
    expect(net.hops.map((h) => h.url)).toEqual([
      'http://a.test/mcp',
      'http://a.test/v2/mcp',
      'http://b.test/mcp',
    ])
    expect(net.hops.every((h) => h.redirect === 'manual')).toBe(true)
    // Same-origin hop: everything kept.
    expect(net.hops[1].headers['x-api-key']).toBe('k')
    // Cross-origin hop: credentials gone, the rest (and the 307/308 body) kept.
    expect(net.hops[2].headers).toEqual({ 'x-trace': 't', 'content-type': 'application/json' })
    expect(net.hops[2].method).toBe('POST')
    expect(net.hops[2].body).toBe('{"x":1}')
  })

  it('a cross-origin hop keeps mcp-session-id (protocol state, not a user secret) while dropping x-api-key', async () => {
    const net = fakeNet({
      'http://a.test/mcp': redirect(307, 'http://b.test/mcp'),
      'http://b.test/mcp': ok,
    })
    await fetchFollowingRedirects(net.fetch)('http://a.test/mcp', {
      method: 'POST',
      body: '{}',
      headers: { 'Mcp-Session-Id': 'sess-154', 'X-API-Key': 'k' },
    })
    expect(net.hops[1].headers).toEqual({ 'mcp-session-id': 'sess-154' })
  })

  it('stripped headers stay stripped when a later hop returns to the first origin', async () => {
    const net = fakeNet({
      'http://a.test/mcp': redirect(307, 'http://b.test/hop'),
      'http://b.test/hop': redirect(307, 'http://a.test/final'),
      'http://a.test/final': ok,
    })
    await fetchFollowingRedirects(net.fetch)('http://a.test/mcp', {
      headers: { 'X-API-Key': 'k', 'X-Trace': 't' },
    })
    expect(net.hops[2].headers).toEqual({ 'x-trace': 't' })
  })

  it('303, and 301/302 after a POST, continue as a body-less GET', async () => {
    for (const status of [301, 302, 303]) {
      const net = fakeNet({
        'http://a.test/mcp': redirect(status, '/next'),
        'http://a.test/next': ok,
      })
      await fetchFollowingRedirects(net.fetch)('http://a.test/mcp', {
        method: 'POST',
        body: '{}',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'k' },
      })
      expect(net.hops[1]).toMatchObject({ method: 'GET', body: undefined })
      expect(net.hops[1].headers).toEqual({ 'x-api-key': 'k' })
    }
  })

  it('an http → https upgrade of the same host keeps the headers (no leak to another party)', async () => {
    const net = fakeNet({
      'http://a.test/mcp': redirect(308, 'https://a.test/mcp'),
      'https://a.test/mcp': ok,
    })
    await fetchFollowingRedirects(net.fetch)('http://a.test/mcp', { headers: { 'X-API-Key': 'k' } })
    expect(net.hops[1].headers).toEqual({ 'x-api-key': 'k' })
  })

  it("leaves 'manual' / 'error' callers alone and stops at a redirect loop", async () => {
    const net = fakeNet({ 'http://a.test/loop': redirect(307, '/loop') })
    const follow = fetchFollowingRedirects(net.fetch)
    const manual = await follow('http://a.test/loop', { redirect: 'manual' })
    expect(manual.status).toBe(307)
    expect(net.hops).toHaveLength(1)
    await expect(follow('http://a.test/loop')).rejects.toThrow(/redirect/i)
  })

  it('returns a 3xx without Location as is', async () => {
    const net = fakeNet({ 'http://a.test/mcp': () => new Response(null, { status: 302 }) })
    const res = await fetchFollowingRedirects(net.fetch)('http://a.test/mcp')
    expect(res.status).toBe(302)
  })
})

/**
 * Issue #169 — the credential drop of issue #154 is made VISIBLE: a
 * `notifications/testnizer/redirect_credentials_dropped` notification (names
 * only, never values) on the connection's notification stream, and a 401 /
 * 403 connect error that says which headers stayed behind.
 */
describe('visible credential drop on a cross-origin redirect (issue #169)', () => {
  const DROPPED = 'notifications/testnizer/redirect_credentials_dropped'
  let events: McpEngineEvent[] = []
  beforeEach(() => {
    events = []
    setMcpEventSink((e) => events.push(e))
  })
  afterEach(() => setMcpEventSink(null))

  const dropNotifications = (connectionId: string): McpNotificationEvent[] =>
    events.flatMap((e) =>
      e.type === 'notification' &&
      e.payload.connectionId === connectionId &&
      e.payload.method === DROPPED
        ? [e.payload]
        : [],
    )

  it('connect + calls through a cross-origin 307 emit ONE notification naming the dropped headers', async () => {
    const target = await startMcpServer(await freePort())
    cleanups.push(target.close)
    const targetOrigin = new URL(target.url).origin
    const origin = await redirector(targetOrigin)

    const info = await mcpConnect({
      transport: 'http',
      url: `${origin}/mcp`,
      headers: HEADERS,
      protocol: 'legacy',
    })
    cleanups.push(() => mcpDisconnect(info.connectionId))
    await echoHeaders(info.connectionId)
    await echoHeaders(info.connectionId)
    await new Promise((r) => setTimeout(r, 20))

    const drops = dropNotifications(info.connectionId)
    expect(drops).toHaveLength(1)
    const params = drops[0].params as { from: string; to: string; headers: string[] }
    expect(params.from).toBe(origin)
    expect(params.to).toBe(targetOrigin)
    // The user's spelling, names only.
    expect([...params.headers].sort()).toEqual(['Authorization', 'X-API-Key'])
    const serialised = JSON.stringify(events)
    expect(serialised).not.toContain('gw-key-154')
    expect(serialised).not.toContain('user-token-154')
  })

  it.each(['legacy', 'auto'] as const)(
    'protocol %s: a 401 after the drop names the headers that were not sent',
    async (protocol) => {
      const target = await startMcpServer(await freePort(), { bearerToken: 'tok-169' })
      cleanups.push(target.close)
      const targetOrigin = new URL(target.url).origin
      const origin = await redirector(targetOrigin)

      const err = (await mcpConnect({
        transport: 'http',
        url: `${origin}/mcp`,
        headers: { Authorization: 'Bearer tok-169', 'X-Trace': 't' },
        protocol,
      }).catch((e: unknown) => e)) as Error & { status?: number }
      expect(err).toBeInstanceOf(Error)
      expect(err.status).toBe(401)
      expect(err.message).toContain(
        `Credential headers Authorization were not sent to ${targetOrigin} after a cross-origin redirect.`,
      )
      expect(err.message).not.toContain('tok-169')
    },
  )

  it('a 403 gets the same hint; an error without a drop does not', async () => {
    const forbidding = await listen(
      http.createServer((req, res) => {
        req.resume()
        res.writeHead(403, { 'Content-Type': 'text/plain' })
        res.end('forbidden')
      }),
    )
    const targetOrigin = `http://127.0.0.1:${forbidding}`
    const origin = await redirector(targetOrigin)
    const err = (await mcpConnect({
      transport: 'http',
      url: `${origin}/mcp`,
      headers: { 'X-API-Key': 'k-169', Cookie: 'c=1' },
      protocol: 'legacy',
    }).catch((e: unknown) => e)) as Error
    expect(err.message).toMatch(
      new RegExp(
        `Credential headers (Cookie, X-API-Key|X-API-Key, Cookie) were not sent to ${targetOrigin.replace(/\./g, '\\.')} after a cross-origin redirect\\.`,
      ),
    )

    const direct = (await mcpConnect({
      transport: 'http',
      url: `${targetOrigin}/mcp`,
      headers: { 'X-API-Key': 'k-169' },
      protocol: 'legacy',
    }).catch((e: unknown) => e)) as Error
    expect(direct.message).not.toContain('cross-origin redirect')
  })

  it('fetchFollowingRedirects reports the drop (names only) to its callback', async () => {
    const drops: unknown[] = []
    const fetchFn = async (url: string | URL): Promise<Response> =>
      String(url) === 'http://a.test/mcp'
        ? new Response(null, { status: 307, headers: { Location: 'http://b.test/mcp' } })
        : new Response('{}', { status: 200 })
    await fetchFollowingRedirects(fetchFn, (d) => drops.push(d))('http://a.test/mcp', {
      headers: { 'X-API-Key': 'k', 'X-Trace': 't' },
    })
    expect(drops).toEqual([{ from: 'http://a.test', to: 'http://b.test', headers: ['x-api-key'] }])
  })
})
