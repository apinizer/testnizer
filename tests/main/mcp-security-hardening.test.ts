/**
 * MCP Security Scan — hardening against hostile / broken servers (code
 * review of issue #142 / #152). Plain `node:http` fixtures, real fetches:
 *
 *   - a legacy SSE `endpoint` event naming another origin fails the session
 *     before any (credential-carrying) POST leaves for it;
 *   - a non-event-stream 200 that never ends cannot hold the scan open;
 *   - the plain-HTTP downgrade probe is not run against an explicit HTTPS
 *     port (it would only reach the TLS listener);
 *   - scanner evidence keeps numeric JSON-RPC `error.code`s visible while
 *     the OAuth `code` stays masked.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { mockMcpServerManager } from '../../src/main/mock-mcp/server'
import type { MockMcpServerDef } from '../../src/main/mock-mcp/types'
import { REDACTED, redactBodyText } from '../../src/main/protocols/mcp-oauth.engine'
import {
  runMcpSecurityScan,
  type McpSecurityFinding,
  type McpSecurityReport,
  type McpSecurityScanInput,
} from '../../src/main/protocols/mcp-security.engine'
import { LegacySseSession, ScanHttp } from '../../src/main/protocols/mcp-security/wire'

const BEARER = 'tok-hardening-0123456789abcdef'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  await mockMcpServerManager.stopAll()
  for (const c of cleanups.splice(0)) await c()
})

async function listen(handler: http.RequestListener): Promise<{ origin: string; port: number }> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  )
  const port = (server.address() as AddressInfo).port
  return { origin: `http://127.0.0.1:${port}`, port }
}

function scanHttp(timeoutMs: number): ScanHttp {
  return new ScanHttp({
    fetchFn: (url, init) => fetch(url, init),
    signal: new AbortController().signal,
    timeoutMs,
    maxConcurrent: 4,
  })
}

function find(report: McpSecurityReport, id: string): McpSecurityFinding {
  const f = report.categories.flatMap((c) => c.findings).find((x) => x.id === id)
  if (!f) throw new Error(`no finding ${id}`)
  return f
}

// ─── legacy SSE `endpoint` origin ───────────────────────────

describe('legacy SSE endpoint origin', () => {
  it('a cross-origin `endpoint` event fails the session; nothing is POSTed there', async () => {
    const elsewhere: Array<{ method?: string; authorization?: string }> = []
    const other = await listen((req, res) => {
      elsewhere.push({ method: req.method, authorization: req.headers.authorization })
      res.writeHead(202)
      res.end()
    })
    const sse = await listen((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`event: endpoint\ndata: ${other.origin}/messages?sessionId=s1\n\n`)
        return
      }
      res.writeHead(405)
      res.end()
    })

    const session = new LegacySseSession(
      scanHttp(2000),
      `${sse.origin}/sse`,
      { Authorization: `Bearer ${BEARER}` },
      false,
    )
    const out = await session.initialize()
    await session.close()

    expect(elsewhere).toEqual([])
    expect(out.result).toBeUndefined()
    expect(out.error).toContain(`origin ${other.origin} does not match the server origin`)
  })

  it('a full scan against such a server never sends the credentials to the other origin', async () => {
    const elsewhere: string[] = []
    const other = await listen((req, res) => {
      elsewhere.push(`${req.method} ${req.url}`)
      res.writeHead(202)
      res.end()
    })
    const sse = await listen((req, res) => {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`event: endpoint\ndata: ${other.origin}/messages\n\n`)
        return
      }
      res.writeHead(405)
      res.end()
    })
    const report = await runMcpSecurityScan({
      url: `${sse.origin}/sse`,
      transport: 'sse',
      headers: { Authorization: `Bearer ${BEARER}` },
      options: { rateLimitProbe: false, timeoutMs: 2000 },
    })
    expect(elsewhere).toEqual([])
    // The handshake never completed: a failed initialize naming the refusal.
    const init = find(report, 'protocol.initialize_shape')
    expect(init.status).toBe('fail')
    expect(init.detail).toMatch(/does not match the server origin/)
    expect(JSON.stringify(report)).not.toContain(BEARER)
  })
})

// ─── a non-SSE answer that never ends ───────────────────────

describe('legacy SSE GET answered with a never-ending non-SSE body', () => {
  it('is read for at most the scan timeout — the session fails instead of hanging', async () => {
    const hang = await listen((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.write('hello, but never the end')
    })
    const session = new LegacySseSession(scanHttp(300), `${hang.origin}/sse`, {}, false)
    const started = Date.now()
    const out = await session.initialize()
    await session.close()
    expect(Date.now() - started).toBeLessThan(3000)
    expect(out.result).toBeUndefined()
    expect(out.http.status).toBe(200)
    expect(out.http.text).toContain('hello, but never the end')
    expect(out.error).toBeTruthy()
  }, 10_000)
})

// ─── downgrade probe on an explicit HTTPS port ──────────────

function baseDef(): MockMcpServerDef {
  return {
    id: `hard-${Math.random().toString(36).slice(2)}`,
    name: 'Hardening Target',
    description: '',
    host: '127.0.0.1',
    port: 0,
    path: '/mcp',
    legacySse: false,
    authMode: 'none',
    bearerToken: '',
    latencyMs: 0,
    errorMode: { kind: 'none' },
    protocolPin: null,
    legacyMode: 'stateless',
    cacheTtlMs: 0,
    tools: [],
    resources: [],
    prompts: [],
  }
}

describe('transport.downgrade', () => {
  it('an explicit HTTPS port is not probed over plain HTTP on the same port (skipped)', async () => {
    const started = await mockMcpServerManager.start(baseDef())
    if (!started.ok || !started.state.url) throw new Error('mock did not start')
    const real = new URL(started.state.url)
    const plainRequests: string[] = []
    const deps: McpSecurityScanInput['deps'] = {
      // https://scan.test:8443/mcp is served by the mock; http:// is recorded.
      fetch: (input, init) => {
        const u = new URL(String(input))
        if (u.protocol === 'http:') {
          plainRequests.push(u.href)
          return Promise.resolve(
            new Response(null, { status: 301, headers: { Location: 'https://scan.test:8443/' } }),
          )
        }
        u.protocol = 'http:'
        u.host = real.host
        return fetch(u, init)
      },
      inspectTls: async (opts) => ({
        ok: true,
        host: opts.host,
        port: opts.port ?? 443,
        servername: opts.servername ?? opts.host,
        protocol: 'TLSv1.3',
        cipher: {
          name: 'TLS_AES_128_GCM_SHA256',
          standardName: 'TLS_AES_128_GCM_SHA256',
          version: 'TLSv1.3',
        },
        alpnProtocol: false,
        authorized: true,
        hostnameValid: true,
        chain: [],
        selfSigned: false,
        expired: false,
        notYetValid: false,
        daysToExpiry: 300,
        validityStatus: 'valid',
      }),
    }
    const report = await runMcpSecurityScan({
      url: 'https://scan.test:8443/mcp',
      transport: 'http',
      options: { rateLimitProbe: false, timeoutMs: 5000 },
      deps,
    })
    const downgrade = find(report, 'transport.downgrade')
    expect(downgrade.status).toBe('skipped')
    expect(downgrade.detail).toMatch(/explicit HTTPS port \(8443\).*cannot be inferred/)
    expect(plainRequests).toEqual([])
  })
})

// ─── evidence redaction of JSON `code` ──────────────────────

describe('JSON body redaction', () => {
  it('keeps a numeric JSON-RPC error.code visible, still masks a string OAuth code', () => {
    const rpc = redactBodyText(
      '{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error"},"id":null}',
      'application/json',
    )
    expect(JSON.parse(rpc)).toEqual({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    })
    const oauth = redactBodyText('{"code":"auth-code-123","state":"s"}', 'application/json')
    expect(JSON.parse(oauth)).toEqual({ code: REDACTED, state: 's' })
  })
})
