/**
 * Issue #169 — Security Scan: `transport.cross_origin_redirect`.
 *
 * A server that redirects its MCP endpoint to ANOTHER origin forces every
 * client into a bad choice: replay its credentials to the new origin, or drop
 * them and fail to authenticate (what Testnizer does since issue #154). The
 * scan probes the endpoint once with `redirect: 'manual'` and anonymous
 * headers only, and warns when the Location leaves the origin. Plain
 * `node:http` redirectors in front of the real e2e MCP server, real fetches.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import {
  runMcpSecurityScan,
  type McpSecurityFinding,
  type McpSecurityReport,
} from '../../src/main/protocols/mcp-security.engine'
import { startMcpServer } from '../e2e/servers/mcp-server'
import { freePort } from './mcp-wire-fixtures'

const SECRET = 'gw-key-169-0123456789abcdef'
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function listen(handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  )
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** Answers every request with `status` → `location(req.url)`. */
function redirector(status: number, location: (path: string) => string): Promise<string> {
  return listen((req, res) => {
    req.resume()
    res.writeHead(status, { Location: location(req.url ?? '/') })
    res.end()
  })
}

async function mcpTarget(): Promise<string> {
  const srv = await startMcpServer(await freePort())
  cleanups.push(srv.close)
  return srv.url
}

function find(report: McpSecurityReport, id: string): McpSecurityFinding {
  const f = report.categories.flatMap((c) => c.findings).find((x) => x.id === id)
  if (!f) throw new Error(`no finding ${id}`)
  return f
}

async function scan(
  url: string,
  transport: 'http' | 'sse' = 'http',
  timeoutMs = 5000,
): Promise<McpSecurityReport> {
  return runMcpSecurityScan({
    url,
    transport,
    headers: { 'X-API-Key': SECRET },
    options: { rateLimitProbe: false, timeoutMs },
  })
}

describe('transport.cross_origin_redirect (issue #169)', () => {
  it('a 307 to another origin is a warning naming both origins — no credential reaches the evidence', async () => {
    const target = new URL(await mcpTarget())
    const origin = await redirector(307, (path) => `${target.origin}${path}`)
    const report = await scan(`${origin}/mcp`)
    const f = find(report, 'transport.cross_origin_redirect')
    expect(f).toMatchObject({ status: 'warn', severity: 'medium', category: 'transport' })
    expect(f.detail).toContain(origin)
    expect(f.detail).toContain(target.origin)
    expect(f.evidence?.response?.status).toBe(307)
    // The probe is anonymous: the gateway key is neither sent nor shown.
    expect(f.evidence?.request?.headers).not.toHaveProperty('x-api-key')
    expect(JSON.stringify(report)).not.toContain(SECRET)
  })

  it('legacy SSE: the GET stream redirected to another origin is flagged too', async () => {
    const target = await listen((req, res) => {
      req.resume()
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write(': hi\n\n')
    })
    const origin = await redirector(302, (path) => `${target}${path}`)
    // The fake stream never sends an `endpoint` event: short budget, the
    // session just fails — the redirect probe does not need one.
    const report = await scan(`${origin}/sse`, 'sse', 1000)
    expect(find(report, 'transport.cross_origin_redirect')).toMatchObject({ status: 'warn' })
  }, 30_000)

  it('a same-origin redirect and a direct endpoint pass', async () => {
    const target = new URL(await mcpTarget())
    const sameOrigin = await listen((req, res) => {
      req.resume()
      if ((req.url ?? '').startsWith('/elsewhere')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('not an MCP server')
        return
      }
      res.writeHead(307, { Location: '/elsewhere' })
      res.end()
    })
    expect(find(await scan(`${sameOrigin}/mcp`), 'transport.cross_origin_redirect').status).toBe(
      'pass',
    )
    expect(find(await scan(target.href), 'transport.cross_origin_redirect').status).toBe('pass')
  })
})

/**
 * The scan's OWN requests follow redirects too. Native fetch strips only
 * Authorization / Cookie on a cross-origin hop, so a gateway key such as
 * `X-API-Key` used to be replayed to the new origin. The scan now follows
 * redirects like the engine does (`fetchFollowingRedirects`): credential
 * headers stay behind on a cross-origin hop, everything else goes along.
 */
describe('the scan itself does not replay credential headers across origins (issue #169)', () => {
  it('origin B behind a cross-origin 307 never sees X-API-Key; it still gets the other headers', async () => {
    const upstream = new URL(await mcpTarget())
    const seenByB: http.IncomingHttpHeaders[] = []
    const b = await listen((req, res) => {
      seenByB.push(req.headers)
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
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
        up.on('error', () => res.destroy())
        up.end(Buffer.concat(chunks))
      })
    })
    const a = await redirector(307, (path) => `${b}${path}`)
    const report = await runMcpSecurityScan({
      url: `${a}/mcp`,
      transport: 'http',
      headers: { 'X-API-Key': SECRET, 'X-Trace': 'trace-169' },
      options: { rateLimitProbe: false, timeoutMs: 5000 },
    })
    expect(report.error).toBeUndefined()
    expect(seenByB.length).toBeGreaterThan(0)
    for (const h of seenByB) expect(h['x-api-key']).toBeUndefined()
    expect(seenByB.some((h) => h['x-trace'] === 'trace-169')).toBe(true)
  })
})
