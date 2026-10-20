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
import { llmRequestShortcuts, renderTemplate, type TemplateContext } from './template'
import { loadEnvVars } from '../lib/env-vars'
import { getState, clearState } from './state'
import { runScript, type ScriptResponse } from './script'
import { checkAuth, resolveAuthConfig } from './auth'
import { rollFailure } from './failure'
import { checkRateLimit, clearLimiter } from './rateLimit'
import { validateBody } from './schemaValidator'
import { buildEchoResponse, forwardRequest } from './proxy'
import { splitSseBlocks, resumeCursor } from './stream/sse-blocks'
import {
  SSE_MAX_FRAME_BYTES,
  SSE_MAX_OPEN_STREAMS,
  SSE_MAX_PLAN_FRAMES,
  renderBlocksOnce,
  sseResponseHeaders,
  startSseStream,
  type SseFinishReason,
  type SseFrameContext,
  type SseStreamHandle,
  type SseStreamSummary,
} from './stream/sse-writer'
import { normalizeStreamConfig, type MockSseStreamConfig } from '../../shared/mock-stream'
import {
  NAME_ONLY,
  maskHeaderRecord,
  maskUrlText,
  withCredentialValues,
} from '../lib/sensitive-scrub'
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
  /**
   * Stream settings of a `bodyType: 'sse'` response (issue #221), already
   * normalized by `buildServerDef`. Absent / null = the defaults.
   */
  streamConfig?: MockSseStreamConfig | null
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
  /**
   * Project + workspace the server belongs to. Used at request time to
   * load env / globals so response templates can use `{{baseUrl}}` etc.
   */
  projectId?: string
  workspaceId?: string
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
  /** Set by `stop()`: a request still in flight must not open a stream any more. */
  stopped: boolean
  /** Open SSE streams (issue #221) — `stop()` ends them all. */
  openStreams: Set<SseStreamHandle>
  /**
   * SSE requests waiting out their `delayMs` (design Ek B R06): `stop()`
   * cancels them, so no stream is created after the server stopped.
   */
  pendingStreams: Set<() => void>
}

const MAX_LOG_BUFFER = 500

/** How a stream ended, in the "closed" log entry. */
const FINISH_REASON_TEXT: Record<SseFinishReason, string> = {
  completed: 'ended by the server',
  client: 'closed by the client',
  stopped: 'server stopped',
  error: 'write error',
  'frame-too-large': 'event too large',
}
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
    // Pre-bind check: refuse to start if another running server is bound
    // to the same port. listen() would otherwise emit EADDRINUSE
    // asynchronously and we'd surface a confusing message to the user.
    for (const [otherId, s] of this.servers) {
      if (
        otherId !== def.id &&
        s.def.port === def.port &&
        s.def.host === def.host &&
        (s.status === 'running' || s.status === 'starting')
      ) {
        /*
         * This manager is process-global: it holds the running servers of
         * EVERY project, and nothing stops another project's servers when the
         * user switches. The message used to say "in this project", which sent
         * the user looking through the current project for a server that is
         * not there — the port is held by one they cannot see from here.
         */
        const sameProject =
          (s.def.projectId ?? null) === (def.projectId ?? null) || !s.def.projectId
        return {
          ok: false,
          error: sameProject
            ? `Port ${def.port} is already in use by mock server "${s.def.name}" in this project`
            : `Port ${def.port} is already in use by mock server "${s.def.name}", which belongs to ` +
              'another project. Mock servers keep running when you switch projects — stop it there, ' +
              'or use a different port.',
        }
      }
    }

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
      stopped: false,
      openStreams: new Set(),
      pendingStreams: new Set(),
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
    // Order matters: mark stopped, drop the SSE requests still in their
    // delay, end every open stream — only then close the listener, which
    // would otherwise wait for the 500 ms force-close below.
    s.stopped = true
    for (const cancel of Array.from(s.pendingStreams)) cancel()
    s.pendingStreams.clear()
    for (const h of Array.from(s.openStreams)) h.close('stopped')
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

  /**
   * Number of open SSE streams of a server (issue #221). Used by tests and
   * a future "connected clients" indicator.
   */
  openStreamCount(serverId: string): number {
    return this.servers.get(serverId)?.openStreams.size ?? 0
  }

  /** Per-stream counters of a server's open SSE streams (test hook). */
  streamStats(serverId: string): { framesSent: number; writableLength: number; paused: boolean }[] {
    const s = this.servers.get(serverId)
    if (!s) return []
    return Array.from(s.openStreams, (h) => ({
      framesSent: h.framesSent,
      writableLength: h.writableLength,
      paused: h.paused,
    }))
  }

  /**
   * Replace running server's definition without dropping the port (hot reload).
   * Open SSE streams are NOT closed (design Ek C R06): each runs on the
   * snapshot it opened with; the new definition applies to the next request.
   */
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

    const isSse = picked.bodyType === 'sse'

    // Apply optional latency. An SSE request is tracked while it waits, so a
    // Stop or a client abort during the delay never opens a stream later.
    if (picked.delayMs > 0) {
      if (isSse) {
        if (!(await this.waitBeforeStream(s, res, picked.delayMs))) return
      } else {
        await delay(picked.delayMs)
      }
    }

    // Render templates against the request context. Env vars resolved
    // per-request so projects that change their active environment mid-run
    // pick up the new values without restarting the mock server.
    let envVars: Record<string, string> | undefined
    if (s.def.projectId) {
      try {
        envVars = loadEnvVars({
          projectId: s.def.projectId,
          workspaceId: s.def.workspaceId,
        })
      } catch {
        /* fall through with no env — mock still responds */
      }
    }
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
      envVars,
      // `{{lastUserMessage}}` / `{{lastToolResult}}` / `{{model}}` (issue #221)
      // — every body type; empty for a body without that shape.
      ...llmRequestShortcuts(body),
    }
    // SSE (design Ek C R02): no render of the whole body — every block is
    // rendered once, when it is written, with `stream.*` in the context.
    const renderedBody = isSse ? picked.body : renderTemplate(picked.body, ctx)
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

    // A script error answers as before (plain JSON), whatever the body type.
    if (isSse && scriptError === null) {
      this.streamAndLog(
        s,
        res,
        startedAt,
        headers,
        query,
        path,
        bodyText,
        endpoint.id,
        picked.id,
        { statusCode: finalStatus, headers: finalHeaders, body: finalBody },
        ctx,
        normalizeStreamConfig(picked.streamConfig ?? null),
        scriptLog,
      )
      return
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
    const responseHeaders = { ...out.headers }
    if (scriptLog.length > 0) {
      // Surface script console output as part of the log entry's response body
      // when not strictly typed for it; for now we append to error or attach via headers.
      responseHeaders['x-mock-script-log'] = scriptLog.join(' | ')
    }
    this.pushLog(s, {
      ts: startedAt,
      method: res.req.method ?? 'GET',
      path,
      query,
      reqHeaders,
      bodyText,
      statusCode: out.statusCode,
      latencyMs: Date.now() - startedAt,
      matchedEndpointId,
      matchedResponseId,
      responseHeaders,
      responseBody: out.body,
      error: scriptError,
    })
  }

  /**
   * Append one entry to the server's log ring buffer and broadcast it. The
   * ONE place a mock log entry is built, so the credential mask applies to
   * every path (matched response, SSE, 404, echo, proxy, auth failure, …):
   * credential-named request headers and query params are masked by name
   * (`src/shared/credential-headers.ts` rules, via `sensitive-scrub.ts`),
   * and the credential values they carried are scrubbed from the rest of the
   * entry — an echo template returning `{{request.headers.authorization}}`
   * does not undo the mask. Only the LOG is masked: auth checks, templates
   * and the proxy have long since used the real values.
   */
  private pushLog(
    s: RunningServer,
    e: {
      ts: number
      method: string
      path: string
      query: Record<string, string>
      reqHeaders: Record<string, string>
      bodyText: string
      statusCode: number
      latencyMs: number
      matchedEndpointId: string | null
      matchedResponseId: string | null
      responseHeaders: Record<string, string>
      responseBody: string
      error: string | null
    },
  ): void {
    const scrub = withCredentialValues(NAME_ONLY, { headers: e.reqHeaders, query: e.query })
    const qs = new URLSearchParams(e.query).toString()
    const maskedResponseHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(e.responseHeaders)) maskedResponseHeaders[k] = scrub.text(v)
    const log: MockLogEntry = {
      id: randomUUID(),
      serverId: s.def.id,
      ts: e.ts,
      method: e.method,
      path: scrub.text(e.path),
      query: qs ? maskUrlText(`?${qs}`, scrub).slice(1) : '',
      statusCode: e.statusCode,
      latencyMs: e.latencyMs,
      matchedEndpointId: e.matchedEndpointId,
      matchedResponseId: e.matchedResponseId,
      request: {
        headers: maskHeaderRecord(e.reqHeaders, scrub) ?? {},
        body: scrub.text(e.bodyText),
      },
      response: { headers: maskedResponseHeaders, body: scrub.text(e.responseBody) },
      error: e.error === null ? null : scrub.text(e.error),
    }
    s.logBuffer.push(log)
    if (s.logBuffer.length > MAX_LOG_BUFFER) s.logBuffer.shift()
    this.emit('log', log)
  }

  // ─── SSE (issue #221) ──────────────────────────────────────────

  /**
   * Wait out an SSE response's `delayMs` while tracked by the server.
   * Resolves false — and the caller does nothing more — when the server
   * stopped (the request's socket is destroyed) or the client went away.
   */
  private waitBeforeStream(
    s: RunningServer,
    res: http.ServerResponse,
    ms: number,
  ): Promise<boolean> {
    if (s.stopped || res.destroyed) return Promise.resolve(false)
    return new Promise((resolve) => {
      let done = false
      const settle = (alive: boolean): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        res.off('close', onClose)
        s.pendingStreams.delete(cancel)
        resolve(alive && !s.stopped && !res.destroyed && !res.writableEnded)
      }
      const onClose = (): void => settle(false)
      const cancel = (): void => {
        settle(false)
        try {
          res.destroy()
        } catch {
          /* already gone */
        }
      }
      const timer = setTimeout(() => settle(true), ms)
      res.on('close', onClose)
      s.pendingStreams.add(cancel)
    })
  }

  /**
   * Answer a `bodyType: 'sse'` response by streaming its blocks (design Ek C
   * R02–R08) — the last step of the normal pipeline, after auth, schema,
   * failure injection, condition, delay and script. Writes one "open" log
   * entry when the stream starts and one "closed" entry when it ends (Ek C
   * C.3-4: no per-frame IPC); both carry the same `x-mock-stream-id`.
   *
   * Not streamed (one plain reply instead): a status outside 2xx or 204 —
   * every block rendered once, back to back; a body over the fixed limits or
   * the server's open-stream limit — 503 JSON; a finished finite list on
   * reconnect with `onEnd: 'close'` — 204, so EventSource stops reconnecting.
   */
  private streamAndLog(
    s: RunningServer,
    res: http.ServerResponse,
    startedAt: number,
    reqHeaders: Record<string, string>,
    query: Record<string, string>,
    path: string,
    bodyText: string,
    matchedEndpointId: string,
    matchedResponseId: string,
    out: { statusCode: number; headers: Record<string, string>; body: string },
    ctx: TemplateContext,
    config: MockSseStreamConfig,
    scriptLog: string[],
  ): void {
    if (s.stopped || res.destroyed) return
    const plain = (statusCode: number, headers: Record<string, string>, body: string): void =>
      this.respondAndLog(
        s,
        res.req,
        res,
        startedAt,
        reqHeaders,
        query,
        path,
        bodyText,
        matchedEndpointId,
        matchedResponseId,
        { statusCode, headers, body },
        scriptLog,
      )
    const corsHeaders = s.def.cors.enabled ? corsResponseHeaders(s.def.cors, reqHeaders) : {}
    const jsonError = (error: string, message: string): void =>
      plain(
        503,
        { 'content-type': 'application/json; charset=utf-8', ...corsHeaders },
        JSON.stringify({ error, message }),
      )

    const blocks = splitSseBlocks(out.body)
    if (blocks.length > SSE_MAX_PLAN_FRAMES) {
      jsonError(
        'sse_body_too_large',
        `The SSE body has ${blocks.length} events; a mock stream serves at most ${SSE_MAX_PLAN_FRAMES}`,
      )
      return
    }
    if (blocks.some((b) => Buffer.byteLength(b.raw) + b.separator.length > SSE_MAX_FRAME_BYTES)) {
      jsonError(
        'sse_event_too_large',
        `An event of the SSE body is larger than ${SSE_MAX_FRAME_BYTES} bytes`,
      )
      return
    }

    const render = (raw: string, frame: SseFrameContext): string =>
      renderTemplate(raw, { ...ctx, stream: frame })

    if (out.statusCode < 200 || out.statusCode >= 300 || out.statusCode === 204) {
      plain(out.statusCode, out.headers, renderBlocksOnce(blocks, render))
      return
    }
    // HEAD carries no body: answer the stream's headers and stop.
    if (res.req.method === 'HEAD') {
      plain(out.statusCode, sseResponseHeaders(out.headers), '')
      return
    }
    if (s.openStreams.size >= SSE_MAX_OPEN_STREAMS) {
      jsonError(
        'too_many_streams',
        `This mock server already has ${SSE_MAX_OPEN_STREAMS} open streams`,
      )
      return
    }

    const cursor = resumeCursor(blocks, reqHeaders['last-event-id'], config)
    if (cursor.finished && config.onEnd === 'close') {
      plain(204, { ...corsHeaders }, '')
      return
    }

    const headers = sseResponseHeaders(out.headers)
    try {
      res.writeHead(out.statusCode, headers)
      res.flushHeaders()
    } catch {
      return // socket already gone
    }

    const streamId = randomUUID()
    const method = res.req.method ?? 'GET'
    const openHeaders: Record<string, string> = {
      ...headers,
      'x-mock-stream': cursor.resumed ? `open;resumeAt=${cursor.start}` : 'open',
      'x-mock-stream-id': streamId,
    }
    if (scriptLog.length > 0) openHeaders['x-mock-script-log'] = scriptLog.join(' | ')
    const base = {
      method,
      path,
      query,
      reqHeaders,
      bodyText,
      statusCode: out.statusCode,
      matchedEndpointId,
      matchedResponseId,
    }
    this.pushLog(s, {
      ...base,
      ts: startedAt,
      latencyMs: Date.now() - startedAt,
      responseHeaders: openHeaders,
      responseBody: '',
      // v1 §6.3.3-1: an empty body is served (an empty stream), but say so.
      error: blocks.length === 0 ? 'The SSE body has no events' : null,
    })

    const handle = startSseStream(
      res,
      { blocks, startIndex: cursor.start, config, render },
      (summary: SseStreamSummary) => {
        s.openStreams.delete(handle)
        this.pushLog(s, {
          ...base,
          ts: Date.now(),
          latencyMs: Date.now() - startedAt,
          responseHeaders: {
            ...headers,
            'x-mock-stream': `frames=${summary.framesSent};reason=${summary.reason}`,
            'x-mock-stream-id': streamId,
          },
          responseBody:
            summary.preview +
            (summary.previewTruncated ? '\n…' : '') +
            `\n… (stream: ${summary.framesSent} frames, ${(summary.durationMs / 1000).toFixed(1)} s, ` +
            `${FINISH_REASON_TEXT[summary.reason]})`,
          error: summary.error,
        })
      },
    )
    s.openStreams.add(handle)
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
    case 'sse':
      return 'text/event-stream; charset=utf-8'
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
    'access-control-allow-methods':
      cors.allowMethods || 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS,QUERY',
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
