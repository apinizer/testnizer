/**
 * Mock MCP server runtime (issue #140; v2 SDK, both protocol eras — issue
 * #152): a pool of Node `http.Server`s, one per running mock.
 *
 * Routes (per server, `<path>` defaults to `/mcp`):
 *   POST/GET/DELETE <path>          Streamable HTTP, served by the v2 SDK's
 *                                   `createMcpHandler` (handler.ts): 2026-07-28
 *                                   stateless requests AND 2025-era clients
 *                                   (stateless legacy fallback — no sessions,
 *                                   GET/DELETE → 405), or modern-only with
 *                                   `legacyMode: 'reject'` / a 2026-07-28 pin.
 *   GET  <path>/sse                 Legacy HTTP+SSE (when `legacySse`, legacy-sse.ts).
 *   POST <path>/messages?sessionId  Legacy HTTP+SSE client→server messages.
 *   GET  /.well-known/oauth-protected-resource[<path>]
 *                                   RFC 9728 metadata (bearer mode only).
 *
 * Layers in front of the SDK, applied to both eras and read per request (a
 * hot reload applies at once): Host-header validation (only when bound to a
 * loopback address — DNS-rebinding protection that cannot break a LAN /
 * 0.0.0.0 binding; Origin validation is not composed: the endpoint has no
 * CORS and requires `application/json`, so browsers cannot reach it
 * cross-origin anyway), bearer auth (401 + `WWW-Authenticate: Bearer
 * resource_metadata=…`), error mode `http` (bare status for a POST carrying
 * `tools/call`), and latency before the request is dispatched. The other
 * error modes, the tools / resources / prompts and elicitation live in
 * `sdk-server.ts`; protocol pins (`?rev=` overrides the server's) in
 * handler.ts / legacy-sse.ts.
 *
 * Every JSON-RPC request is logged (ring buffer, 500) with its era.
 */

import http from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { AddressInfo } from 'node:net'
import { localhostHostValidation } from '@modelcontextprotocol/node'
import type { Server } from '@modelcontextprotocol/server'
import { loadEnvVars } from '../lib/env-vars'
import { servedEras, subPath } from './config'
import { createElicitationCodec, type ElicitationCodec } from './elicitation'
import { McpEndpoint, type LogDraft } from './handler'
import { callsOf, classifyEra, firstRequest, safeStringify, truncate } from './jsonrpc'
import { LegacySseSessions } from './legacy-sse'
import { createMockMcpSdkServer, effectiveErrorMode } from './sdk-server'
import type {
  MockMcpEra,
  MockMcpLogEntry,
  MockMcpNotifyKind,
  MockMcpServerDef,
  MockMcpServerState,
  MockMcpServerStatus,
  MockMcpTransportKind,
} from './types'

const MAX_LOG_BUFFER = 500
const REQUEST_BODY_LIMIT_BYTES = 4 * 1024 * 1024 // the SDK's own default bound
const WELL_KNOWN_PRM = '/.well-known/oauth-protected-resource'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const NOTIFY_KINDS: readonly MockMcpNotifyKind[] = ['tools', 'resources', 'prompts']

interface RunningServer {
  def: MockMcpServerDef
  http: http.Server
  status: MockMcpServerStatus
  errorMessage: string | null
  boundPort: number | null
  /** `<path>`: both eras through `createMcpHandler`. */
  endpoint: McpEndpoint
  /** `<path>/sse` + `<path>/messages` sessions. */
  sse: LegacySseSessions
  /** HMAC codec for elicitation `requestState` (one random key per run). */
  codec: ElicitationCodec
  logBuffer: MockMcpLogEntry[]
  /** everyN counters: `*` for the server-level mode, `tool:<name>` per override. */
  counters: Map<string, number>
  stopped: boolean
}

export type MockMcpStartResult =
  | { ok: true; state: MockMcpServerState }
  | { ok: false; error: string }

function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > REQUEST_BODY_LIMIT_BYTES) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function displayHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1'
  return host.includes(':') ? `[${host}]` : host
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** JSON key order is irrelevant here; any edit to the family counts as a change. */
function changedFamilies(prev: MockMcpServerDef, next: MockMcpServerDef): MockMcpNotifyKind[] {
  return NOTIFY_KINDS.filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]))
}

class MockMcpServerManager extends EventEmitter {
  private servers = new Map<string, RunningServer>()
  private readonly hostGuard = localhostHostValidation()

  // ─── Lifecycle ─────────────────────────────────────────────────

  state(serverId: string): MockMcpServerState {
    const s = this.servers.get(serverId)
    if (!s) {
      return {
        serverId,
        status: 'stopped',
        port: null,
        url: null,
        sseUrl: null,
        errorMessage: null,
        eras: [],
        legacyNotifications: false,
      }
    }
    const running = s.status === 'running' && s.boundPort !== null
    const origin = running ? `http://${displayHost(s.def.host)}:${s.boundPort}` : null
    return {
      serverId,
      status: s.status,
      port: s.boundPort,
      url: origin ? `${origin}${s.def.path}` : null,
      sseUrl: origin && s.def.legacySse ? `${origin}${subPath(s.def.path, '/sse')}` : null,
      errorMessage: s.errorMessage,
      eras: running ? servedEras(s.def.legacyMode, s.def.protocolPin) : [],
      legacyNotifications: false,
    }
  }

  status(serverId: string): MockMcpServerStatus {
    return this.servers.get(serverId)?.status ?? 'stopped'
  }

  list(): MockMcpServerState[] {
    return Array.from(this.servers.keys()).map((id) => this.state(id))
  }

  async start(def: MockMcpServerDef): Promise<MockMcpStartResult> {
    if (def.authMode === 'bearer' && !def.bearerToken.trim()) {
      return { ok: false, error: 'Bearer auth is enabled but no token is set' }
    }
    for (const [otherId, s] of this.servers) {
      if (
        otherId !== def.id &&
        def.port !== 0 &&
        s.boundPort === def.port &&
        (s.status === 'running' || s.status === 'starting')
      ) {
        return {
          ok: false,
          error: `Port ${def.port} is already in use by mock MCP server "${s.def.name}". Stop it or use a different port.`,
        }
      }
    }
    if (this.servers.has(def.id)) await this.stop(def.id)

    const running = this.createRunning(def)
    running.http.on('request', (req, res) => {
      this.handleRequest(running, req, res).catch((e) => {
        if (!res.headersSent) {
          this.sendJson(res, 500, {
            jsonrpc: '2.0',
            error: { code: -32603, message: `Internal server error: ${(e as Error).message}` },
            id: null,
          })
        } else {
          try {
            res.end()
          } catch {
            /* socket gone */
          }
        }
      })
    })
    this.servers.set(def.id, running)
    this.emitStatus(def.id)

    return new Promise((resolve) => {
      running.http.once('error', (err: NodeJS.ErrnoException) => {
        const message =
          err.code === 'EADDRINUSE'
            ? `Port ${def.port} is already in use on ${def.host}. Stop whatever is listening there (another mock server or app) or pick a different port.`
            : err.code === 'EACCES'
              ? `Permission denied binding ${def.host}:${def.port}. Ports below 1024 usually need elevated rights — pick a higher port.`
              : err.message
        running.status = 'error'
        running.errorMessage = message
        running.stopped = true
        void running.endpoint.close().catch(() => {})
        this.servers.delete(def.id)
        this.emit('status', { ...this.state(def.id), status: 'error', errorMessage: message })
        resolve({ ok: false, error: message })
      })
      running.http.listen(def.port, def.host, () => {
        running.status = 'running'
        running.boundPort = (running.http.address() as AddressInfo).port
        this.emitStatus(def.id)
        resolve({ ok: true, state: this.state(def.id) })
      })
    })
  }

  private createRunning(def: MockMcpServerDef): RunningServer {
    // The closures run per request, after `s` is initialised.
    const log = (entry: LogDraft): void => this.pushLog(s, entry)
    const s: RunningServer = {
      def,
      http: http.createServer(),
      status: 'starting',
      errorMessage: null,
      boundPort: null,
      endpoint: new McpEndpoint({
        getDef: () => s.def,
        buildServer: (era) => this.buildServer(s, era),
        log,
      }),
      sse: new LegacySseSessions({
        getDef: () => s.def,
        buildServer: () => this.buildServer(s, 'legacy'),
        log,
        isLive: () => !s.stopped,
      }),
      codec: createElicitationCodec(),
      logBuffer: [],
      counters: new Map(),
      stopped: false,
    }
    return s
  }

  async stop(serverId: string): Promise<void> {
    const s = this.servers.get(serverId)
    if (!s) return
    s.stopped = true
    await Promise.all([s.endpoint.close().catch(() => {}), s.sse.closeAll()])
    await new Promise<void>((resolve) => {
      s.http.close(() => resolve())
      // SSE streams and keep-alive sockets would hold close() open forever.
      try {
        s.http.closeAllConnections()
      } catch {
        /* ignore */
      }
    })
    this.servers.delete(serverId)
    this.emitStatus(serverId)
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.servers.keys()).map((id) => this.stop(id)))
  }

  /**
   * Apply an edited definition. Binding-relevant changes (host, port, path,
   * legacy SSE) restart the server; everything else is read per request, so
   * the next request sees it. Changed tool / resource / prompt lists are
   * announced to 2026-07-28 `subscriptions/listen` streams and legacy SSE
   * sessions (stateless 2025 clients on `<path>` cannot be reached).
   */
  async update(def: MockMcpServerDef): Promise<MockMcpStartResult> {
    const cur = this.servers.get(def.id)
    if (!cur) return { ok: true, state: this.state(def.id) }
    if (
      cur.def.host !== def.host ||
      cur.def.port !== def.port ||
      cur.def.path !== def.path ||
      cur.def.legacySse !== def.legacySse
    ) {
      return this.start(def)
    }
    const changed = changedFamilies(cur.def, def)
    cur.def = def
    for (const kind of changed) this.announce(cur, kind)
    this.emitStatus(def.id)
    return { ok: true, state: this.state(def.id) }
  }

  /** Send a `list_changed` for `kind` now; false when the server is not running. */
  notify(serverId: string, kind: MockMcpNotifyKind): boolean {
    const s = this.servers.get(serverId)
    if (!s || s.status !== 'running') return false
    this.announce(s, kind)
    return true
  }

  getLogs(serverId: string): MockMcpLogEntry[] {
    return this.servers.get(serverId)?.logBuffer.slice() ?? []
  }

  clearLogs(serverId: string): void {
    const s = this.servers.get(serverId)
    if (s) s.logBuffer.length = 0
    this.emit('logs', { serverId, logs: [] })
  }

  private announce(s: RunningServer, kind: MockMcpNotifyKind): void {
    s.endpoint.notify(kind)
    s.sse.notify(kind)
  }

  private buildServer(s: RunningServer, era: MockMcpEra): Server {
    return createMockMcpSdkServer({
      getDef: () => s.def,
      era,
      codec: s.codec,
      rollError: (key, everyN) => this.roll(s, key, everyN),
      loadEnv: () => {
        if (!s.def.projectId) return undefined
        try {
          return loadEnvVars({ projectId: s.def.projectId, workspaceId: s.def.workspaceId })
        } catch {
          return undefined
        }
      },
    })
  }

  // ─── HTTP routing ──────────────────────────────────────────────

  private async handleRequest(
    s: RunningServer,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const ts = Date.now()
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    let pathname = url.pathname
    while (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1)
    const method = (req.method ?? 'GET').toUpperCase()
    const def = s.def
    const base = def.path

    if (pathname === WELL_KNOWN_PRM || pathname === `${WELL_KNOWN_PRM}${base}`) {
      if (def.authMode !== 'bearer' || method !== 'GET') {
        this.sendJson(res, 404, { error: 'not_found' })
        return
      }
      const origin = this.origin(s, req)
      this.sendJson(res, 200, {
        resource: `${origin}${base}`,
        resource_name: def.name,
        authorization_servers: def.authorizationServers ?? [],
        bearer_methods_supported: ['header'],
      })
      return
    }

    const isMcp = pathname === base
    const isSse = def.legacySse && pathname === subPath(base, '/sse')
    const isMessages = def.legacySse && pathname === subPath(base, '/messages')
    if (!isMcp && !isSse && !isMessages) {
      this.sendJson(res, 404, { error: 'not_found', path: pathname })
      return
    }

    // DNS-rebinding guard: only meaningful (and only safe) on a loopback bind.
    if (LOOPBACK_HOSTS.has(def.host) && !this.hostGuard(req, res)) {
      this.pushLog(s, this.httpLine(ts, `HTTP ${method}`, 403, 'Host header rejected', ''))
      return
    }

    // Body first (POST only): HTTP-level answers below still get a log line
    // naming the JSON-RPC method they rejected.
    let body: unknown = undefined
    if (method === 'POST') {
      let raw: string
      try {
        raw = await readBody(req)
      } catch (e) {
        this.rejectHttp(s, res, ts, 413, { error: (e as Error).message }, `HTTP ${method}`, '')
        return
      }
      try {
        body = raw ? (JSON.parse(raw) as unknown) : undefined
      } catch {
        this.rejectHttp(
          s,
          res,
          ts,
          400,
          { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null },
          `HTTP ${method}`,
          raw,
        )
        return
      }
    }
    const inbound = isMcp
      ? classifyEra(method, req.headers, body)
      : { era: 'legacy' as const, modernRoute: false }
    const rpc = firstRequest(body)
    const logMethod = rpc?.method ?? `HTTP ${method}`
    const transport: MockMcpTransportKind = !isMcp
      ? 'sse'
      : inbound.era === 'modern'
        ? 'streamable-http'
        : 'stateless'
    const requestText = body === undefined ? '' : safeStringify(body)
    const tag = { toolName: rpc?.toolName, transport, era: inbound.era }

    if (def.authMode === 'bearer') {
      const header = req.headers.authorization ?? ''
      const m = /^Bearer\s+(.+)$/i.exec(header)
      if (!m || !tokensEqual(m[1].trim(), def.bearerToken)) {
        const metadata = `${this.origin(s, req)}${WELL_KNOWN_PRM}`
        const challenge = m
          ? `Bearer error="invalid_token", error_description="The access token is invalid", resource_metadata="${metadata}"`
          : `Bearer resource_metadata="${metadata}"`
        res.setHeader('WWW-Authenticate', challenge)
        this.rejectHttp(
          s,
          res,
          ts,
          401,
          {
            error: m ? 'invalid_token' : 'unauthorized',
            error_description: m ? 'The access token is invalid' : 'Bearer token required',
          },
          logMethod,
          requestText,
          tag,
        )
        return
      }
    }

    if (method === 'POST' && body !== undefined) {
      const httpFail = this.httpErrorFor(s, body)
      if (httpFail) {
        this.rejectHttp(
          s,
          res,
          ts,
          httpFail.status,
          { error: `Mock HTTP error ${httpFail.status}`, message: httpFail.message },
          logMethod,
          requestText,
          tag,
        )
        return
      }
    }

    const pin = url.searchParams.get('rev') || def.protocolPin
    if (isMcp) {
      if (def.latencyMs > 0 && callsOf(body).length > 0) {
        await sleep(def.latencyMs)
        if (s.stopped || res.destroyed) return
      }
      const mcpMethod = req.headers['mcp-method']
      await s.endpoint.serve(req, res, {
        body,
        inbound,
        pin,
        ts,
        ...(typeof mcpMethod === 'string' ? { mcpMethod } : {}),
      })
    } else if (isSse && method === 'GET') {
      await s.sse.open(res, pin)
    } else if (isMessages && method === 'POST') {
      const sid = url.searchParams.get('sessionId') ?? ''
      if (!(await s.sse.message(sid, req, res, body))) {
        this.rejectHttp(
          s,
          res,
          ts,
          404,
          { error: 'Session not found' },
          logMethod,
          requestText,
          tag,
        )
      }
    } else {
      this.sendJson(res, 405, { error: 'method_not_allowed' })
    }
  }

  // ─── Scenarios ─────────────────────────────────────────────────

  private roll(s: RunningServer, key: string, everyN: number | undefined): boolean {
    const n = (s.counters.get(key) ?? 0) + 1
    s.counters.set(key, n)
    return everyN && everyN > 1 ? n % everyN === 0 : true
  }

  /** Error mode `http`: answer the POST carrying a tools/call with a bare status. */
  private httpErrorFor(
    s: RunningServer,
    body: unknown,
  ): { status: number; message: string } | null {
    for (const c of callsOf(body)) {
      if (c.method !== 'tools/call') continue
      const name = c.toolName ?? ''
      const tool = s.def.tools.find((t) => t.name === name)
      const { mode, counterKey } = effectiveErrorMode(s.def, tool)
      if (mode.kind !== 'http') return null
      if (!this.roll(s, counterKey, mode.everyN)) return null
      return {
        status: mode.httpStatus ?? 500,
        message: mode.message || `Injected HTTP error for tools/call ${name}`,
      }
    }
    return null
  }

  // ─── Output helpers ────────────────────────────────────────────

  private origin(s: RunningServer, req: http.IncomingMessage): string {
    const host = req.headers.host ?? `${displayHost(s.def.host)}:${s.boundPort ?? s.def.port}`
    return `http://${host}`
  }

  private sendJson(
    res: http.ServerResponse,
    status: number,
    payload: unknown,
    headers: Record<string, string> = {},
  ): void {
    try {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
      res.end(JSON.stringify(payload))
    } catch {
      /* socket already closed */
    }
  }

  private httpLine(
    ts: number,
    method: string,
    status: number,
    response: string,
    request: string,
    tag: { toolName?: string; transport?: MockMcpTransportKind; era?: MockMcpEra } = {},
  ): LogDraft {
    return {
      ts,
      method,
      ...(tag.toolName ? { toolName: tag.toolName } : {}),
      durationMs: Date.now() - ts,
      ok: false,
      httpStatus: status,
      ...(tag.transport ? { transport: tag.transport } : {}),
      ...(tag.era ? { era: tag.era } : {}),
      request: truncate(request),
      response: truncate(response),
    }
  }

  private rejectHttp(
    s: RunningServer,
    res: http.ServerResponse,
    ts: number,
    status: number,
    payload: unknown,
    method: string,
    request: string,
    tag: { toolName?: string; transport?: MockMcpTransportKind; era?: MockMcpEra } = {},
  ): void {
    this.sendJson(res, status, payload)
    this.pushLog(s, this.httpLine(ts, method, status, safeStringify(payload), request, tag))
  }

  private pushLog(s: RunningServer, draft: LogDraft): void {
    const entry: MockMcpLogEntry = { id: randomUUID(), serverId: s.def.id, ...draft }
    s.logBuffer.push(entry)
    if (s.logBuffer.length > MAX_LOG_BUFFER) s.logBuffer.shift()
    this.emit('log', entry)
  }

  private emitStatus(serverId: string): void {
    this.emit('status', this.state(serverId))
  }
}

export const mockMcpServerManager = new MockMcpServerManager()
