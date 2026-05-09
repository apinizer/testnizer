/**
 * Mock-server runtime: manages a pool of Node http.Server instances, each
 * representing a user-configured mock. Servers can be started/stopped
 * independently and route incoming requests through the matcher → condition →
 * template pipeline.
 *
 * Logs are kept in a per-server bounded ring buffer; the renderer subscribes
 * via IPC events.
 */

import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import { EventEmitter } from 'node:events'
import { matchEndpoint, type MatchableEndpoint } from './matcher'
import { evaluateCondition } from './condition'
import { renderTemplate, type TemplateContext } from './template'
import { getState, clearState } from './state'
import { runScript, type ScriptResponse } from './script'
import { checkAuth, resolveAuthConfig } from './auth'
import { rollFailure } from './failure'
import { checkRateLimit, clearLimiter } from './rateLimit'
import { validateBody } from './schemaValidator'
import { buildEchoResponse, forwardRequest } from './proxy'
import {
  createMockEndpoint as repoCreateEndpoint,
  createMockResponse as repoCreateResponse,
} from '../db/mock.repo'
import type {
  AuthConfig,
  CorsConfig,
  FailureConfig,
  MockBodyType,
  MockCondition,
  MockLogEntry,
  MockMethod,
  MockPathMode,
  MockResponseHeader,
  MockServerStatus,
  RateLimitConfig,
  SchemaValidation,
} from './types'

export interface MockResponseDef {
  id: string
  name: string
  statusCode: number
  headers: MockResponseHeader[]
  bodyType: MockBodyType
  body: string
  delayMs: number
  condition: MockCondition
  /** Optional sandboxed JS executed before sending. Empty = skip. */
  script: string
  order: number
  enabled: boolean
}

export interface MockEndpointDef {
  id: string
  method: MockMethod
  path: string
  pathMode: MockPathMode
  description: string
  priority: number
  enabled: boolean
  authOverride: AuthConfig | null
  schemaValidation: SchemaValidation | null
  responses: MockResponseDef[]
}

export interface MockServerDef {
  id: string
  name: string
  host: '127.0.0.1' | '0.0.0.0'
  port: number
  basePath: string
  cors: CorsConfig
  auth: AuthConfig
  failure: FailureConfig
  rateLimit: RateLimitConfig
  echoEnabled: boolean
  proxyEnabled: boolean
  proxyTarget: string
  proxyRecord: boolean
  endpoints: MockEndpointDef[]
}

interface RunningServer {
  def: MockServerDef
  http: http.Server
  status: MockServerStatus
  startedAt: number
  errorMessage: string | null
  logBuffer: MockLogEntry[]
  /** Index of next response to use, per endpoint, for sequential delivery. */
  sequenceCursor: Map<string, number>
}

const MAX_LOG_BUFFER = 500
const REQUEST_BODY_LIMIT_BYTES = 5 * 1024 * 1024 // 5 MB

class MockServerManager extends EventEmitter {
  private servers = new Map<string, RunningServer>()

  /** Currently running server IDs. */
  list(): { id: string; status: MockServerStatus; port: number; errorMessage: string | null }[] {
    const out: {
      id: string
      status: MockServerStatus
      port: number
      errorMessage: string | null
    }[] = []
    for (const [id, s] of this.servers) {
      out.push({ id, status: s.status, port: s.def.port, errorMessage: s.errorMessage })
    }
    return out
  }

  status(serverId: string): MockServerStatus {
    return this.servers.get(serverId)?.status ?? 'stopped'
  }

  /** Start (or restart) a server with the given configuration. */
  async start(def: MockServerDef): Promise<{ ok: true } | { ok: false; error: string }> {
    // If something is running for this id, stop it first.
    if (this.servers.has(def.id)) {
      await this.stop(def.id)
    }

    const running: RunningServer = {
      def,
      http: http.createServer(),
      status: 'starting',
      startedAt: 0,
      errorMessage: null,
      logBuffer: [],
      sequenceCursor: new Map(),
    }
    running.http.on('request', (req, res) => this.handleRequest(running, req, res))

    this.servers.set(def.id, running)
    this.emitStatus(def.id)

    return new Promise((resolve) => {
      running.http.once('error', (err) => {
        running.status = 'error'
        running.errorMessage = err.message
        this.servers.delete(def.id)
        this.emitStatus(def.id, err.message)
        resolve({ ok: false, error: err.message })
      })
      running.http.listen(def.port, def.host, () => {
        running.status = 'running'
        running.startedAt = Date.now()
        this.emitStatus(def.id)
        resolve({ ok: true })
      })
    })
  }

  async stop(serverId: string): Promise<{ ok: true }> {
    const s = this.servers.get(serverId)
    if (!s) return { ok: true }
    return new Promise((resolve) => {
      s.http.close(() => {
        this.servers.delete(serverId)
        clearState(serverId)
        clearLimiter(serverId)
        this.emit('status', { serverId, status: 'stopped', errorMessage: null })
        resolve({ ok: true })
      })
      // Force-close pending sockets after a grace period
      setTimeout(() => {
        try {
          s.http.closeAllConnections?.()
        } catch {
          /* ignore */
        }
      }, 500)
    })
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.servers.keys())
    await Promise.all(ids.map((id) => this.stop(id)))
  }

  /** Replace running server's definition without dropping the port (hot reload). */
  async update(def: MockServerDef): Promise<{ ok: boolean }> {
    const cur = this.servers.get(def.id)
    if (!cur) return { ok: true }
    // If host/port changed, must restart.
    if (cur.def.host !== def.host || cur.def.port !== def.port) {
      const r = await this.start(def)
      return { ok: r.ok }
    }
    cur.def = def
    return { ok: true }
  }

  getLogs(serverId: string): MockLogEntry[] {
    return this.servers.get(serverId)?.logBuffer.slice() ?? []
  }

  clearLogs(serverId: string): void {
    const s = this.servers.get(serverId)
    if (s) s.logBuffer.length = 0
    this.emit('logs', { serverId, logs: [] })
  }

  // ─── Request pipeline ──────────────────────────────────────────

  private async handleRequest(
    s: RunningServer,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const startedAt = Date.now()
    const method = (req.method ?? 'GET').toUpperCase()
    const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
    const headers = headersToRecord(req.headers)
    const query = Object.fromEntries(reqUrl.searchParams)
    const path = stripBasePath(reqUrl.pathname, s.def.basePath)

    let bodyText = ''
    try {
      bodyText = await readBody(req, REQUEST_BODY_LIMIT_BYTES)
    } catch (e) {
      this.respondAndLog(s, req, res, startedAt, headers, query, path, bodyText, null, null, {
        statusCode: 413,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        body: 'Request body too large',
      })
      return
    }
    const body = parseBody(bodyText, headers['content-type'] ?? '')
    const remoteAddress = req.socket.remoteAddress ?? ''

    // CORS preflight handling
    if (s.def.cors.enabled && method === 'OPTIONS') {
      const corsHeaders = corsResponseHeaders(s.def.cors, headers)
      this.respondAndLog(s, req, res, startedAt, headers, query, path, bodyText, null, null, {
        statusCode: 204,
        headers: corsHeaders,
        body: '',
      })
      return
    }

    // ── Rate limit check ───────────────────────────────────────
    const rl = checkRateLimit(s.def.id, s.def.rateLimit, remoteAddress)
    if (!rl.allowed) {
      const corsHeaders = s.def.cors.enabled ? corsResponseHeaders(s.def.cors, headers) : {}
      this.respondAndLog(s, req, res, startedAt, headers, query, path, bodyText, null, null, {
        statusCode: 429,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'retry-after': String(rl.retryAfterSec),
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(rl.resetAt),
          ...corsHeaders,
        },
        body: JSON.stringify({
          error: 'rate_limit_exceeded',
          retryAfterSec: rl.retryAfterSec,
        }),
      })
      return
    }

    const matchableEndpoints: MatchableEndpoint[] = s.def.endpoints.map((ep) => ({
      id: ep.id,
      method: ep.method,
      path: ep.path,
      pathMode: ep.pathMode,
      priority: ep.priority,
      enabled: ep.enabled,
    }))
    const matched = matchEndpoint(matchableEndpoints, method, path)
    if (!matched) {
      // Echo branch: echoes the request when path is /__echo and feature is on.
      if (s.def.echoEnabled && (path === '/__echo' || path === '/__echo/')) {
        const corsHeaders = s.def.cors.enabled ? corsResponseHeaders(s.def.cors, headers) : {}
        const echo = buildEchoResponse({ method, path, headers, query, body, bodyText })
        this.respondAndLog(s, req, res, startedAt, headers, query, path, bodyText, null, null, {
          statusCode: echo.status,
          headers: { ...echo.headers, ...corsHeaders },
          body: echo.body,
        })
        return
      }

      // Proxy passthrough: forward to upstream when configured.
      if (s.def.proxyEnabled && s.def.proxyTarget) {
        try {
          const queryStr = new URLSearchParams(query).toString()
          const fullPath = `${path}${queryStr ? `?${queryStr}` : ''}`
          const upstream = await forwardRequest({
            target: s.def.proxyTarget,
            method,
            pathWithQuery: fullPath,
            headers,
            body: bodyText,
          })

          // Recording mode: persist as a new mock endpoint + response.
          if (s.def.proxyRecord) {
            try {
              recordProxiedResponse(s.def.id, method, path, upstream)
            } catch {
              // Recording errors should not break the proxy itself.
            }
          }

          const corsHeaders = s.def.cors.enabled ? corsResponseHeaders(s.def.cors, headers) : {}
          this.respondAndLog(s, req, res, startedAt, headers, query, path, bodyText, null, null, {
            statusCode: upstream.status,
            headers: { ...upstream.headers, ...corsHeaders },
            body: upstream.body,
          })
          return
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          this.respondAndLog(s, req, res, startedAt, headers, query, path, bodyText, null, null, {
            statusCode: 502,
            headers: { 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ error: 'proxy_error', message: msg }),
          })
          return
        }
      }

      const corsHeaders = s.def.cors.enabled ? corsResponseHeaders(s.def.cors, headers) : {}
      this.respondAndLog(s, req, res, startedAt, headers, query, path, bodyText, null, null, {
        statusCode: 404,
        headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders },
        body: JSON.stringify({
          error: 'No matching endpoint',
          method,
          path,
        }),
      })
      return
    }

    const endpoint = s.def.endpoints.find((ep) => ep.id === matched.endpoint.id)!

    // ── Auth check (endpoint override > server default) ───────
    const effectiveAuth = resolveAuthConfig(s.def.auth, endpoint.authOverride)
    const authResult = checkAuth({ config: effectiveAuth, headers, query })
    if (!authResult.ok) {
      const corsHeaders = s.def.cors.enabled ? corsResponseHeaders(s.def.cors, headers) : {}
      this.respondAndLog(
        s,
        req,
        res,
        startedAt,
        headers,
        query,
        path,
        bodyText,
        endpoint.id,
        null,
        {
          statusCode: authResult.failure.status,
          headers: { ...authResult.failure.headers, ...corsHeaders },
          body: authResult.failure.body,
        },
      )
      return
    }

    // ── JSON Schema validation (per-endpoint) ─────────────────
    if (endpoint.schemaValidation && endpoint.schemaValidation.enabled) {
      const v = validateBody(endpoint.schemaValidation, body)
      if (!v.ok) {
        const corsHeaders = s.def.cors.enabled ? corsResponseHeaders(s.def.cors, headers) : {}
        this.respondAndLog(
          s,
          req,
          res,
          startedAt,
          headers,
          query,
          path,
          bodyText,
          endpoint.id,
          null,
          {
            statusCode: v.failure.status,
            headers: { ...v.failure.headers, ...corsHeaders },
            body: v.failure.body,
          },
        )
        return
      }
    }

    // ── Failure injection (after auth/schema, before normal response) ─
    const fail = rollFailure(s.def.failure)
    if (fail.kind !== 'none') {
      if (fail.kind === 'timeout' && fail.delayMs) await delay(fail.delayMs)
      const corsHeaders = s.def.cors.enabled ? corsResponseHeaders(s.def.cors, headers) : {}
      this.respondAndLog(
        s,
        req,
        res,
        startedAt,
        headers,
        query,
        path,
        bodyText,
        endpoint.id,
        null,
        {
          statusCode: fail.status ?? 500,
          headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders },
          body: fail.body ?? '',
        },
      )
      return
    }

    const enabledResponses = endpoint.responses
      .slice()
      .sort((a, b) => a.order - b.order)
      .filter((r) => r.enabled)

    if (enabledResponses.length === 0) {
      const corsHeaders = s.def.cors.enabled ? corsResponseHeaders(s.def.cors, headers) : {}
      this.respondAndLog(
        s,
        req,
        res,
        startedAt,
        headers,
        query,
        path,
        bodyText,
        endpoint.id,
        null,
        {
          statusCode: 501,
          headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders },
          body: JSON.stringify({ error: 'Endpoint has no enabled responses' }),
        },
      )
      return
    }

    // Pick the first response whose condition matches.
    const condCtx = {
      method,
      headers,
      query,
      pathParams: matched.params,
      body,
      bodyText,
    }
    const picked =
      enabledResponses.find((r) => evaluateCondition(r.condition, condCtx)) ?? enabledResponses[0]

    // Apply optional latency.
    if (picked.delayMs > 0) await delay(picked.delayMs)

    // Render templates against the request context.
    const ctx: TemplateContext = {
      request: {
        method,
        path,
        headers,
        query,
        params: matched.params,
        body,
        bodyText,
      },
      state: getState(s.def.id),
    }
    const renderedBody = renderTemplate(picked.body, ctx)
    const renderedHeaders: Record<string, string> = {}
    for (const h of picked.headers) {
      renderedHeaders[h.name.toLowerCase()] = renderTemplate(h.value, ctx)
    }
    if (!renderedHeaders['content-type']) {
      renderedHeaders['content-type'] = defaultContentType(picked.bodyType)
    }

    // Pre-response script can mutate state and override status/headers/body.
    const initial: ScriptResponse = {
      status: picked.statusCode,
      headers: renderedHeaders,
      body: renderedBody,
    }
    let finalStatus = initial.status
    let finalHeaders = initial.headers
    let finalBody = initial.body
    let scriptError: string | null = null
    let scriptLog: string[] = []
    if (picked.script && picked.script.trim()) {
      const r = runScript(
        picked.script,
        initial,
        {
          method,
          path,
          headers,
          query,
          params: matched.params,
          body,
          bodyText,
        },
        getState(s.def.id),
      )
      finalStatus = r.response.status
      finalHeaders = r.response.headers
      finalBody = r.response.body
      scriptLog = r.consoleLines
      if (!r.ok) {
        scriptError = r.error
        // On script failure, return a 500 unless the script already set its own status.
        if (finalStatus === initial.status) {
          finalStatus = 500
          finalHeaders = { 'content-type': 'application/json; charset=utf-8' }
          finalBody = JSON.stringify({ error: 'Script error', message: r.error })
        }
      }
    }

    if (s.def.cors.enabled) {
      Object.assign(finalHeaders, corsResponseHeaders(s.def.cors, headers))
    }

    this.respondAndLog(
      s,
      req,
      res,
      startedAt,
      headers,
      query,
      path,
      bodyText,
      endpoint.id,
      picked.id,
      {
        statusCode: finalStatus,
        headers: finalHeaders,
        body: finalBody,
      },
      scriptLog,
      scriptError,
    )
  }

  private respondAndLog(
    s: RunningServer,
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    startedAt: number,
    reqHeaders: Record<string, string>,
    query: Record<string, string>,
    path: string,
    bodyText: string,
    matchedEndpointId: string | null,
    matchedResponseId: string | null,
    out: { statusCode: number; headers: Record<string, string>; body: string },
    scriptLog: string[] = [],
    scriptError: string | null = null,
  ): void {
    try {
      res.statusCode = out.statusCode
      for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v)
      res.end(out.body)
    } catch {
      /* socket already closed */
    }
    const log: MockLogEntry = {
      id: randomUUID(),
      serverId: s.def.id,
      ts: startedAt,
      method: res.req.method ?? 'GET',
      path,
      query: new URLSearchParams(query).toString(),
      statusCode: out.statusCode,
      latencyMs: Date.now() - startedAt,
      matchedEndpointId,
      matchedResponseId,
      request: { headers: reqHeaders, body: bodyText },
      response: { headers: out.headers, body: out.body },
      error: scriptError,
    }
    if (scriptLog.length > 0) {
      // Surface script console output as part of the log entry's response body
      // when not strictly typed for it; for now we append to error or attach via headers.
      log.response.headers['x-mock-script-log'] = scriptLog.join(' | ')
    }
    s.logBuffer.push(log)
    if (s.logBuffer.length > MAX_LOG_BUFFER) s.logBuffer.shift()
    this.emit('log', log)
  }

  private emitStatus(serverId: string, errorMessage: string | null = null): void {
    this.emit('status', {
      serverId,
      status: this.status(serverId),
      errorMessage,
    })
  }
}

export const mockServerManager = new MockServerManager()

// ─── Helpers ─────────────────────────────────────────────────────

function headersToRecord(h: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h)) {
    if (Array.isArray(v)) out[k.toLowerCase()] = v.join(', ')
    else if (v !== undefined) out[k.toLowerCase()] = String(v)
  }
  return out
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > limit) {
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

function parseBody(bodyText: string, contentType: string): unknown {
  if (!bodyText) return null
  if (/json/i.test(contentType)) {
    try {
      return JSON.parse(bodyText)
    } catch {
      return bodyText
    }
  }
  return bodyText
}

function stripBasePath(path: string, basePath: string): string {
  if (!basePath) return path
  const norm = basePath.startsWith('/') ? basePath : `/${basePath}`
  return path.startsWith(norm) ? path.slice(norm.length) || '/' : path
}

function defaultContentType(bodyType: MockBodyType): string {
  switch (bodyType) {
    case 'json':
      return 'application/json; charset=utf-8'
    case 'xml':
      return 'application/xml; charset=utf-8'
    case 'html':
      return 'text/html; charset=utf-8'
    case 'text':
    default:
      return 'text/plain; charset=utf-8'
  }
}

function corsResponseHeaders(
  cors: CorsConfig,
  reqHeaders: Record<string, string>,
): Record<string, string> {
  const origin = reqHeaders['origin']
  const allow = cors.allowOrigins || '*'
  const allowOrigin =
    allow === '*'
      ? cors.allowCredentials && origin
        ? origin
        : '*'
      : origin &&
          allow
            .split(',')
            .map((s) => s.trim())
            .includes(origin)
        ? origin
        : allow.split(',')[0].trim()
  const out: Record<string, string> = {
    'access-control-allow-origin': allowOrigin,
    'access-control-allow-methods': cors.allowMethods || 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
    'access-control-allow-headers':
      cors.allowHeaders && cors.allowHeaders !== '*'
        ? cors.allowHeaders
        : (reqHeaders['access-control-request-headers'] ?? 'Content-Type, Authorization, *'),
    'access-control-max-age': String(cors.maxAge ?? 600),
  }
  if (cors.allowCredentials) out['access-control-allow-credentials'] = 'true'
  if (allowOrigin !== '*') out['vary'] = 'Origin'
  return out
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Persist a proxied upstream response as a new mock endpoint + 'always' response.
 *  This is invoked by recording mode to capture real-API replies for offline replay. */
function recordProxiedResponse(
  serverId: string,
  method: string,
  path: string,
  upstream: { status: number; headers: Record<string, string>; body: string },
): void {
  const ep = repoCreateEndpoint({
    serverId,
    method,
    path,
    pathMode: 'exact',
    description: `Recorded ${method} ${path}`,
    priority: 0,
    enabled: true,
  })
  const ct = upstream.headers['content-type'] ?? 'application/json'
  const bodyType = /xml/i.test(ct)
    ? 'xml'
    : /html/i.test(ct)
      ? 'html'
      : /json/i.test(ct)
        ? 'json'
        : 'text'
  repoCreateResponse({
    endpointId: ep.id,
    name: 'Recorded',
    statusCode: upstream.status,
    headers: Object.entries(upstream.headers).map(([name, value]) => ({ name, value })),
    bodyType,
    body: upstream.body,
    delayMs: 0,
    condition: { type: 'always' },
    order: 0,
    enabled: true,
  })
}
