/**
 * Mock MCP server runtime (issue #140): a pool of Node `http.Server`s, one per
 * running mock, each speaking MCP through the SDK's own server transports.
 *
 * Routes (per server, `<path>` defaults to `/mcp`):
 *   POST/GET/DELETE <path>          Streamable HTTP. An `initialize` without a
 *                                   session id opens a stateful session (the
 *                                   SDK assigns `Mcp-Session-Id`); a POST with
 *                                   neither a session id nor `initialize` is
 *                                   served statelessly by a throw-away
 *                                   server + transport.
 *   GET  <path>/sse                 Legacy HTTP+SSE (when `legacySse`).
 *   POST <path>/messages?sessionId  Legacy HTTP+SSE client→server messages.
 *   GET  /.well-known/oauth-protected-resource[<path>]
 *                                   RFC 9728 metadata (bearer mode only).
 *
 * Scenario knobs live on the definition and are read per request, so a hot
 * reload applies without dropping sessions: bearer auth (401 +
 * `WWW-Authenticate: Bearer resource_metadata=…`), latency before every
 * JSON-RPC request is dispatched, error injection on `tools/call`
 * (`http` here at the HTTP layer, the rest in `sdk-server.ts`), and the
 * protocol pin (`?rev=` on the URL overrides it per session).
 *
 * Every JSON-RPC request is logged (ring buffer, 500) by wrapping the session
 * transport's `onmessage` / `send`, which pairs requests with responses by id
 * whichever transport carried them.
 */

import http from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { AddressInfo } from 'node:net'
import type { Server as SdkServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  isInitializeRequest,
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type JSONRPCMessage,
  type MessageExtraInfo,
} from '@modelcontextprotocol/sdk/types.js'
import { loadEnvVars } from '../lib/env-vars'
import { subPath } from './config'
import { createMockMcpSdkServer, effectiveErrorMode } from './sdk-server'
import type {
  MockMcpLogEntry,
  MockMcpServerDef,
  MockMcpServerState,
  MockMcpServerStatus,
  MockMcpTransportKind,
} from './types'

const MAX_LOG_BUFFER = 500
const MAX_LOG_TEXT = 8 * 1024
const REQUEST_BODY_LIMIT_BYTES = 5 * 1024 * 1024
const WELL_KNOWN_PRM = '/.well-known/oauth-protected-resource'

interface Session {
  kind: MockMcpTransportKind
  transport: StreamableHTTPServerTransport | SSEServerTransport
  sdk: SdkServer
}

interface RunningServer {
  def: MockMcpServerDef
  http: http.Server
  status: MockMcpServerStatus
  errorMessage: string | null
  boundPort: number | null
  /** Stateful Streamable HTTP + legacy SSE sessions, by session id. */
  sessions: Map<string, Session>
  /** Stateless per-request sessions (closed when their response ends). */
  transient: Set<Session>
  logBuffer: MockMcpLogEntry[]
  /** everyN counters: `*` for the server-level mode, `tool:<name>` per override. */
  counters: Map<string, number>
  stopped: boolean
}

interface PendingRequest {
  ts: number
  method: string
  toolName?: string
  request: string
}

export type MockMcpStartResult =
  | { ok: true; state: MockMcpServerState }
  | { ok: false; error: string }

function truncate(text: string): string {
  return text.length > MAX_LOG_TEXT ? `${text.slice(0, MAX_LOG_TEXT)}… (truncated)` : text
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return String(v)
  }
}

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

function messagesOf(body: unknown): unknown[] {
  return Array.isArray(body) ? body : [body]
}

function isInitBody(body: unknown): boolean {
  return messagesOf(body).some((m) => isInitializeRequest(m))
}

/** First JSON-RPC request in the body, for HTTP-level log lines. */
function firstRequest(body: unknown): { method: string; toolName?: string } | null {
  for (const m of messagesOf(body)) {
    if (isJSONRPCRequest(m)) {
      const toolName =
        m.method === 'tools/call' && typeof m.params?.name === 'string' ? m.params.name : undefined
      return { method: m.method, ...(toolName ? { toolName } : {}) }
    }
  }
  return null
}

function displayHost(host: string): string {
  if (host === '0.0.0.0' || host === '::') return '127.0.0.1'
  return host.includes(':') ? `[${host}]` : host
}

class MockMcpServerManager extends EventEmitter {
  private servers = new Map<string, RunningServer>()

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

    const running: RunningServer = {
      def,
      http: http.createServer(),
      status: 'starting',
      errorMessage: null,
      boundPort: null,
      sessions: new Map(),
      transient: new Set(),
      logBuffer: [],
      counters: new Map(),
      stopped: false,
    }
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

  async stop(serverId: string): Promise<void> {
    const s = this.servers.get(serverId)
    if (!s) return
    s.stopped = true
    const sessions = [...s.sessions.values(), ...s.transient]
    s.sessions.clear()
    s.transient.clear()
    await Promise.all(sessions.map((sess) => this.closeSession(sess)))
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
   * live sessions see it at once (and get a best-effort list_changed). A new
   * protocol pin applies to sessions initialised after the edit.
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
    cur.def = def
    for (const sess of cur.sessions.values()) {
      void sess.sdk.sendToolListChanged().catch(() => {})
      void sess.sdk.sendResourceListChanged().catch(() => {})
      void sess.sdk.sendPromptListChanged().catch(() => {})
    }
    return { ok: true, state: this.state(def.id) }
  }

  getLogs(serverId: string): MockMcpLogEntry[] {
    return this.servers.get(serverId)?.logBuffer.slice() ?? []
  }

  clearLogs(serverId: string): void {
    const s = this.servers.get(serverId)
    if (s) s.logBuffer.length = 0
    this.emit('logs', { serverId, logs: [] })
  }

  // ─── HTTP routing ──────────────────────────────────────────────

  private async handleRequest(
    s: RunningServer,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
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

    // Body first (POST only): HTTP-level answers below still get a log line
    // naming the JSON-RPC method they rejected.
    let body: unknown = undefined
    if (method === 'POST') {
      let raw: string
      try {
        raw = await readBody(req)
      } catch (e) {
        this.rejectHttp(s, res, 413, { error: (e as Error).message }, `HTTP ${method}`, '')
        return
      }
      try {
        body = raw ? (JSON.parse(raw) as unknown) : undefined
      } catch {
        this.rejectHttp(
          s,
          res,
          400,
          { jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null },
          `HTTP ${method}`,
          raw,
        )
        return
      }
    }
    const rpc = firstRequest(body)
    const logMethod = rpc?.method ?? `HTTP ${method}`
    const transportKind: MockMcpTransportKind = isMcp ? 'streamable-http' : 'sse'

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
          401,
          {
            error: m ? 'invalid_token' : 'unauthorized',
            error_description: m ? 'The access token is invalid' : 'Bearer token required',
          },
          logMethod,
          body === undefined ? '' : safeStringify(body),
          rpc?.toolName,
          transportKind,
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
          httpFail.status,
          { error: `Mock HTTP error ${httpFail.status}`, message: httpFail.message },
          logMethod,
          safeStringify(body),
          rpc?.toolName,
          transportKind,
        )
        return
      }
    }

    if (isMcp) await this.handleStreamable(s, req, res, url, method, body)
    else if (isSse && method === 'GET') await this.openSseSession(s, res, url)
    else if (isMessages && method === 'POST') await this.handleSseMessage(s, req, res, url, body)
    else this.sendJson(res, 405, { error: 'method_not_allowed' })
  }

  private async handleStreamable(
    s: RunningServer,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    method: string,
    body: unknown,
  ): Promise<void> {
    const sessionHeader = req.headers['mcp-session-id']
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader

    if (sessionId) {
      const sess = s.sessions.get(sessionId)
      if (!sess || sess.kind !== 'streamable-http') {
        this.rejectHttp(
          s,
          res,
          404,
          { jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null },
          firstRequest(body)?.method ?? `HTTP ${method}`,
          body === undefined ? '' : safeStringify(body),
        )
        return
      }
      await (sess.transport as StreamableHTTPServerTransport).handleRequest(req, res, body)
      return
    }

    if (method === 'GET') {
      // No standalone server→client stream without a session.
      this.sendJson(res, 405, { error: 'method_not_allowed' }, { Allow: 'POST' })
      return
    }
    if (method !== 'POST') {
      this.sendJson(res, 400, {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Bad Request: Mcp-Session-Id header is required' },
        id: null,
      })
      return
    }
    if (body === undefined) {
      this.sendJson(res, 400, {
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid Request: empty body' },
        id: null,
      })
      return
    }

    const pin = url.searchParams.get('rev') || s.def.protocolPin
    if (isInitBody(body)) {
      // Stateful: the SDK assigns the session id while handling initialize.
      let session: Session | null = null
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          if (session && !s.stopped) s.sessions.set(sid, session)
        },
      })
      const sdk = this.createSdk(s, pin)
      session = { kind: 'streamable-http', transport, sdk }
      await sdk.connect(transport)
      this.instrument(s, session)
      await transport.handleRequest(req, res, body)
      return
    }

    // Stateless: no session id and not an initialize — serve this one POST
    // with a throw-away server + transport.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    const sdk = this.createSdk(s, pin)
    const session: Session = { kind: 'stateless', transport, sdk }
    s.transient.add(session)
    res.on('close', () => {
      s.transient.delete(session)
      void this.closeSession(session)
    })
    await sdk.connect(transport)
    this.instrument(s, session)
    await transport.handleRequest(req, res, body)
  }

  private async openSseSession(
    s: RunningServer,
    res: http.ServerResponse,
    url: URL,
  ): Promise<void> {
    const transport = new SSEServerTransport(subPath(s.def.path, '/messages'), res)
    const sdk = this.createSdk(s, url.searchParams.get('rev') || s.def.protocolPin)
    const session: Session = { kind: 'sse', transport, sdk }
    s.sessions.set(transport.sessionId, session)
    await sdk.connect(transport) // start(): writes the `endpoint` event
    this.instrument(s, session)
  }

  private async handleSseMessage(
    s: RunningServer,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL,
    body: unknown,
  ): Promise<void> {
    const sid = url.searchParams.get('sessionId') ?? ''
    const sess = s.sessions.get(sid)
    if (!sess || sess.kind !== 'sse') {
      this.rejectHttp(
        s,
        res,
        404,
        { error: 'Session not found' },
        firstRequest(body)?.method ?? 'HTTP POST',
        body === undefined ? '' : safeStringify(body),
        undefined,
        'sse',
      )
      return
    }
    await (sess.transport as SSEServerTransport).handlePostMessage(req, res, body)
  }

  // ─── Sessions ──────────────────────────────────────────────────

  private createSdk(s: RunningServer, pin: string | null): SdkServer {
    return createMockMcpSdkServer({
      getDef: () => s.def,
      pin: pin || null,
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

  private async closeSession(sess: Session): Promise<void> {
    try {
      await sess.transport.close()
    } catch {
      /* already closed */
    }
    try {
      await sess.sdk.close()
    } catch {
      /* already closed */
    }
  }

  /**
   * Wrap the transport the SDK server is connected to: delay dispatch by the
   * server latency, and pair each JSON-RPC request with its response for the
   * log. Must run AFTER `sdk.connect()` (which installs the handlers we wrap).
   */
  private instrument(s: RunningServer, session: Session): void {
    const t = session.transport as Transport
    const dispatch = t.onmessage
    const sendRaw = t.send.bind(t)
    const closeRaw = t.onclose
    const pending = new Map<string | number, PendingRequest>()

    const finish = (
      id: string | number,
      out: { ok: boolean; errorCode?: number; response: string },
    ): void => {
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      this.pushLog(s, {
        id: randomUUID(),
        serverId: s.def.id,
        ts: p.ts,
        method: p.method,
        ...(p.toolName ? { toolName: p.toolName } : {}),
        durationMs: Date.now() - p.ts,
        ok: out.ok,
        ...(out.errorCode !== undefined ? { errorCode: out.errorCode } : {}),
        ...(t.sessionId ? { sessionId: t.sessionId } : {}),
        transport: session.kind,
        request: p.request,
        response: truncate(out.response),
      })
    }

    t.onmessage = <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo): void => {
      if (isJSONRPCRequest(message)) {
        const toolName =
          message.method === 'tools/call' && typeof message.params?.name === 'string'
            ? message.params.name
            : undefined
        pending.set(message.id, {
          ts: Date.now(),
          method: message.method,
          ...(toolName ? { toolName } : {}),
          request: truncate(safeStringify(message)),
        })
        const latency = s.def.latencyMs
        if (latency > 0) {
          setTimeout(() => {
            if (!s.stopped) dispatch?.(message, extra)
          }, latency)
          return
        }
      } else if (
        isJSONRPCNotification(message) &&
        message.method === 'notifications/cancelled' &&
        message.params &&
        (typeof message.params.requestId === 'string' ||
          typeof message.params.requestId === 'number')
      ) {
        finish(message.params.requestId, {
          ok: false,
          response: `(no response — cancelled by the client${
            typeof message.params.reason === 'string' ? `: ${message.params.reason}` : ''
          })`,
        })
      }
      dispatch?.(message, extra)
    }

    t.send = async (message, options): Promise<void> => {
      let initFailed = false
      if (isJSONRPCResultResponse(message)) {
        finish(message.id, { ok: true, response: safeStringify(message) })
      } else if (isJSONRPCErrorResponse(message) && message.id !== undefined) {
        initFailed = pending.get(message.id)?.method === 'initialize'
        finish(message.id, {
          ok: false,
          errorCode: message.error.code,
          response: safeStringify(message),
        })
      }
      await sendRaw(message, options)
      // A rejected initialize (protocol pin) leaves a session nobody can use.
      if (initFailed && session.kind !== 'stateless') {
        setTimeout(() => void this.dropSession(s, session), 0)
      }
    }

    t.onclose = (): void => {
      closeRaw?.()
      for (const id of [...pending.keys()]) {
        finish(id, { ok: false, response: '(no response — session closed)' })
      }
      for (const [sid, sess] of s.sessions) if (sess === session) s.sessions.delete(sid)
    }
  }

  private async dropSession(s: RunningServer, session: Session): Promise<void> {
    for (const [sid, sess] of s.sessions) if (sess === session) s.sessions.delete(sid)
    await this.closeSession(session)
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
    for (const m of messagesOf(body)) {
      if (!isJSONRPCRequest(m) || m.method !== 'tools/call') continue
      const name = typeof m.params?.name === 'string' ? m.params.name : ''
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

  private rejectHttp(
    s: RunningServer,
    res: http.ServerResponse,
    status: number,
    payload: unknown,
    method: string,
    request: string,
    toolName?: string,
    transport?: MockMcpTransportKind,
  ): void {
    const ts = Date.now()
    this.sendJson(res, status, payload)
    this.pushLog(s, {
      id: randomUUID(),
      serverId: s.def.id,
      ts,
      method,
      ...(toolName ? { toolName } : {}),
      durationMs: 0,
      ok: false,
      httpStatus: status,
      ...(transport ? { transport } : {}),
      request: truncate(request),
      response: truncate(safeStringify(payload)),
    })
  }

  private pushLog(s: RunningServer, entry: MockMcpLogEntry): void {
    s.logBuffer.push(entry)
    if (s.logBuffer.length > MAX_LOG_BUFFER) s.logBuffer.shift()
    this.emit('log', entry)
  }

  private emitStatus(serverId: string): void {
    this.emit('status', this.state(serverId))
  }
}

export const mockMcpServerManager = new MockMcpServerManager()
