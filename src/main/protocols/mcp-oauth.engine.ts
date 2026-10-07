/**
 * MCP OAuth 2.1 debugger (issue #141) — walks the MCP authorization handshake
 * one step at a time, records every HTTP exchange, and on success keeps the
 * token in main-process memory for `mcp:connect` (Postman's "OAuth 2.1" tab).
 *
 * Steps (ids in brackets; each emits a record as it changes):
 *   1. [probe]                  unauthenticated `initialize` (GET for legacy
 *                               SSE) — expect 401 + WWW-Authenticate
 *                               `resource_metadata` (RFC 9728 §5.1); 2xx means
 *                               the server needs no auth and the flow stops.
 *   2. [resource-metadata]      RFC 9728 Protected Resource Metadata.
 *   3. [auth-server-metadata]   RFC 8414 / OIDC discovery of the AS.
 *   4. [client-registration]    RFC 7591 DCR, or skipped for a manual client.
 *   5. [authorization-request]  PKCE S256 + state + RFC 8707 `resource`.
 *   6. [authorization-callback] system browser → loopback redirect on
 *                               127.0.0.1:<ephemeral>; `state` and RFC 9207
 *                               `iss` validated.
 *   7. [token-exchange]         authorization_code grant.
 *
 * The protocol work is the SDK's (`@modelcontextprotocol/sdk/client/auth.js`):
 * `extractWWWAuthenticateParams`, `discoverOAuthProtectedResourceMetadata`,
 * `discoverAuthorizationServerMetadata`, `registerClient`,
 * `startAuthorization`, `exchangeAuthorization`, `refreshAuthorization`,
 * `selectClientAuthMethod`. Every one of them takes a `fetchFn`; ours records
 * the exchange (redacted) onto the running step, applies a hard timeout and
 * the flow's cancel signal.
 *
 * Secrets discipline (CLAUDE.md "Anahtar materyali — TEK KAPI" spirit): the
 * access / refresh token, the client secret, the PKCE verifier and the
 * authorization code NEVER leave this module — step records are redacted by
 * key AND scrubbed by value before they are emitted. `mcp.engine.ts` reaches
 * the token only through `createMcpOAuthFetch`, which injects it on the wire.
 *
 * Electron-free on purpose (like `mcp.engine.ts`): the browser is opened
 * through the injected `openUrl` hook, so tests drive the whole flow under
 * plain Node.
 */

import http from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  exchangeAuthorization,
  extractWWWAuthenticateParams,
  refreshAuthorization,
  registerClient,
  selectClientAuthMethod,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js'
import {
  checkResourceAllowed,
  resourceUrlFromServerUrl,
} from '@modelcontextprotocol/sdk/shared/auth-utils.js'
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthProtectedResourceMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'

// ─── Public shapes ──────────────────────────────────────────

export type McpOAuthStepId =
  | 'probe'
  | 'resource-metadata'
  | 'auth-server-metadata'
  | 'client-registration'
  | 'authorization-request'
  | 'authorization-callback'
  | 'token-exchange'

export type McpOAuthStepStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped'

export interface McpOAuthHttpRequest {
  method: string
  url: string
  headers: Record<string, string>
  /** Redacted request body (DCR JSON, token form) when there was one. */
  body?: string
}

export interface McpOAuthHttpResponse {
  status: number
  headers: Record<string, string>
  /** Redacted, truncated body preview. */
  body?: string
}

export interface McpOAuthExchange {
  request: McpOAuthHttpRequest
  response?: McpOAuthHttpResponse
  /** Network-level failure (no HTTP response). */
  error?: string
}

export interface McpOAuthStep {
  id: McpOAuthStepId
  /** 1-based position in the flow. */
  index: number
  title: string
  status: McpOAuthStepStatus
  /** The step's decisive (last) HTTP exchange. */
  request?: McpOAuthHttpRequest
  response?: McpOAuthHttpResponse
  /** Every exchange the step made — discovery tries several URLs — oldest first. */
  attempts?: McpOAuthExchange[]
  note?: string
  error?: string
  durationMs?: number
}

export interface McpOAuthSummary {
  tokenType: string
  /** Epoch ms; absent when the AS gave no `expires_in`. */
  expiresAt?: number
  scope?: string
  issuer: string
  clientId: string
  hasRefreshToken: boolean
  clientAuthMethod: string
  resource?: string
}

export interface McpOAuthDone {
  oauthSessionId: string
  ok: boolean
  summary?: McpOAuthSummary
  /** The probe got a 2xx without credentials — nothing to authorize. */
  noAuthRequired?: boolean
  cancelled?: boolean
  error?: string
  failedStep?: McpOAuthStepId
}

export interface McpOAuthStartOptions {
  /** MCP server URL (Streamable HTTP endpoint, or the legacy SSE URL). */
  url: string
  /** Probe style: POST `initialize` (default) or GET event-stream for legacy SSE. */
  transport?: 'http' | 'sse'
  /** The tab's custom headers — sent on the probe minus any `Authorization`. */
  headers?: Record<string, string>
  /** Pre-registered client: skips DCR. */
  clientId?: string
  clientSecret?: string
  scope?: string
  /** Fixed loopback port for a pre-registered redirect URI; 0 / absent = ephemeral. */
  callbackPort?: number
}

export interface McpOAuthHooks {
  /** Opens the authorization URL in the system browser (`shell.openExternal` in the app). */
  openUrl: (url: string) => void | Promise<void>
  onStep?: (oauthSessionId: string, step: McpOAuthStep) => void
  onDone?: (done: McpOAuthDone) => void
  /** How long to wait for the browser to come back (default 180 s). */
  callbackTimeoutMs?: number
  /** Per-HTTP-request timeout (default 15 s). */
  httpTimeoutMs?: number
}

// ─── Constants ──────────────────────────────────────────────

const STEP_DEFS: ReadonlyArray<{ id: McpOAuthStepId; title: string }> = [
  { id: 'probe', title: 'Unauthenticated probe' },
  { id: 'resource-metadata', title: 'Protected Resource Metadata (RFC 9728)' },
  { id: 'auth-server-metadata', title: 'Authorization Server Metadata (RFC 8414)' },
  { id: 'client-registration', title: 'Client registration (RFC 7591)' },
  { id: 'authorization-request', title: 'PKCE + authorization URL' },
  { id: 'authorization-callback', title: 'Browser sign-in + loopback redirect' },
  { id: 'token-exchange', title: 'Token exchange' },
]

const DEFAULT_CALLBACK_TIMEOUT_MS = 180_000
const DEFAULT_HTTP_TIMEOUT_MS = 15_000
const BODY_PREVIEW_CHARS = 8 * 1024
const REDACTED = '••••'
const CALLBACK_PATH = '/callback'

/** Body keys whose values are credentials (token / DCR / form bodies). */
const SECRET_KEY =
  /^(access_token|refresh_token|id_token|client_secret|registration_access_token|code|code_verifier|password|assertion|client_assertion|device_code)$/i
/** Header names whose values are credentials. `WWW-Authenticate` is the challenge — kept. */
const SECRET_HEADER =
  /^(authorization|proxy-authorization|cookie|set-cookie)$|token|secret|api[-_]?key|password|passwd/i

// ─── State ──────────────────────────────────────────────────

interface TokenSession {
  accessToken: string
  tokenType: string
  refreshToken?: string
  expiresAt?: number
  scope?: string
  authorizationServerUrl: string
  metadata?: AuthorizationServerMetadata
  clientInformation: OAuthClientInformationMixed
  resource?: URL
  /** Single-flight refresh shared by concurrent 401s. */
  refreshing?: Promise<boolean>
  /** A refresh already failed — later 401s are surfaced, not retried. */
  refreshFailed?: boolean
}

interface Flow {
  id: string
  abort: AbortController
  steps: McpOAuthStep[]
  current: McpOAuthStep | null
  hooks: McpOAuthHooks
  /** Values scrubbed from every emitted record (tokens, secret, verifier, code). */
  secrets: Set<string>
  httpTimeoutMs: number
}

const flows = new Map<string, Flow>()
const tokenSessions = new Map<string, TokenSession>()

class FlowCancelled extends Error {
  constructor() {
    super('Cancelled by user')
    this.name = 'FlowCancelled'
  }
}

// ─── Redaction ──────────────────────────────────────────────

function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, name) => {
    if (name.toLowerCase() === 'www-authenticate' || !SECRET_HEADER.test(name)) {
      out[name] = value
      return
    }
    // Keep the scheme ("Basic ••••", "Bearer ••••") — that is what users debug.
    const scheme = /^(\w+)\s+\S/.exec(value)?.[1]
    out[name] = scheme ? `${scheme} ${REDACTED}` : REDACTED
  })
  return out
}

function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) && v !== undefined && v !== null ? REDACTED : redactJson(v)
    }
    return out
  }
  return value
}

function redactForm(params: URLSearchParams): string {
  const out = new URLSearchParams()
  params.forEach((v, k) => out.append(k, SECRET_KEY.test(k) ? REDACTED : v))
  return out.toString()
}

function truncate(text: string): string {
  return text.length > BODY_PREVIEW_CHARS
    ? `${text.slice(0, BODY_PREVIEW_CHARS)}… (${text.length} chars, truncated)`
    : text
}

function redactBodyText(text: string, contentType: string): string {
  if (!text) return text
  const trimmed = text.trim()
  if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return truncate(JSON.stringify(redactJson(JSON.parse(trimmed)), null, 2))
    } catch {
      /* not JSON after all */
    }
  }
  if (contentType.includes('x-www-form-urlencoded')) {
    return truncate(redactForm(new URLSearchParams(text)))
  }
  return truncate(text)
}

function requestBodyPreview(body: unknown, contentType: string): string | undefined {
  if (body === undefined || body === null) return undefined
  if (body instanceof URLSearchParams) return truncate(redactForm(body))
  if (typeof body === 'string') return redactBodyText(body, contentType)
  return '(binary body)'
}

/** The callback URL as shown in step 6 — `code` redacted. */
function redactedUrl(url: URL): string {
  const copy = new URL(url.href)
  for (const key of [...copy.searchParams.keys()]) {
    if (SECRET_KEY.test(key)) copy.searchParams.set(key, REDACTED)
  }
  return copy.href
}

/** Value-based scrub of a record about to leave the module (defence in depth). */
function scrub<T>(record: T, secrets: Set<string>): T {
  let json = JSON.stringify(record)
  for (const secret of secrets) {
    if (!secret || secret.length < 6) continue
    json = json.split(secret).join(REDACTED)
    const escaped = JSON.stringify(secret).slice(1, -1)
    if (escaped !== secret) json = json.split(escaped).join(REDACTED)
    const encoded = encodeURIComponent(secret)
    if (encoded !== secret) json = json.split(encoded).join(REDACTED)
  }
  return JSON.parse(json) as T
}

// ─── HTTP plumbing ──────────────────────────────────────────

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as Error & { cause?: unknown }).cause
    if (cause && typeof cause === 'object') {
      const c = cause as { code?: unknown; message?: unknown }
      const detail =
        typeof c.code === 'string' ? c.code : typeof c.message === 'string' ? c.message : ''
      if (detail && !err.message.includes(detail)) return `${err.message} (${detail})`
    }
    return err.message
  }
  return String(err)
}

function anySignal(signals: Array<AbortSignal | null | undefined>): AbortSignal {
  const live = signals.filter((s): s is AbortSignal => !!s)
  return AbortSignal.any(live)
}

async function bodyPreview(res: Response): Promise<string | undefined> {
  const contentType = res.headers.get('content-type') ?? ''
  if (contentType.includes('text/event-stream')) return '(event stream — not read)'
  try {
    return redactBodyText(await res.clone().text(), contentType)
  } catch {
    return undefined
  }
}

function recordExchange(step: McpOAuthStep | null, exchange: McpOAuthExchange): void {
  if (!step) return
  step.attempts = [...(step.attempts ?? []), exchange]
  step.request = exchange.request
  if (exchange.response) step.response = exchange.response
  else delete step.response
}

/**
 * The `fetchFn` handed to every SDK auth call: per-request timeout + the
 * flow's cancel signal, and a redacted copy of the exchange on the running
 * step. The SDK reads the original response; we read a clone.
 */
function recordingFetch(flow: Flow): FetchLike {
  return async (url, init) => {
    const headers = new Headers(init?.headers)
    const request: McpOAuthHttpRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url: String(url),
      headers: redactHeaders(headers),
    }
    const body = requestBodyPreview(init?.body, headers.get('content-type') ?? '')
    if (body !== undefined) request.body = body
    const step = flow.current
    const signal = anySignal([
      init?.signal,
      flow.abort.signal,
      AbortSignal.timeout(flow.httpTimeoutMs),
    ])
    try {
      const res = await fetch(url, { ...init, signal })
      recordExchange(step, {
        request,
        response: {
          status: res.status,
          headers: redactHeaders(res.headers),
          ...(await bodyPreview(res).then((b) => (b === undefined ? {} : { body: b }))),
        },
      })
      return res
    } catch (err) {
      if (flow.abort.signal.aborted) throw new FlowCancelled()
      recordExchange(step, { request, error: errorMessage(err) })
      throw err
    }
  }
}

/** `fetch` with a hard timeout — used outside a flow (token refresh, probe clean-up). */
function timeoutFetch(timeoutMs: number): FetchLike {
  return (url, init) =>
    fetch(url, { ...init, signal: anySignal([init?.signal, AbortSignal.timeout(timeoutMs)]) })
}

// ─── Step bookkeeping ───────────────────────────────────────

function emitStep(flow: Flow, step: McpOAuthStep): void {
  if (!flow.hooks.onStep) return
  try {
    flow.hooks.onStep(flow.id, scrub(step, flow.secrets))
  } catch {
    // A broken consumer must never break the flow.
  }
}

function stepOf(flow: Flow, id: McpOAuthStepId): McpOAuthStep {
  const step = flow.steps.find((s) => s.id === id)
  if (!step) throw new Error(`Unknown OAuth step ${id}`)
  return step
}

class StepFailed extends Error {
  constructor(
    readonly stepId: McpOAuthStepId,
    message: string,
    readonly cancelled: boolean,
  ) {
    super(message)
  }
}

async function runStep<T>(
  flow: Flow,
  id: McpOAuthStepId,
  work: (step: McpOAuthStep) => Promise<T>,
): Promise<T> {
  if (flow.abort.signal.aborted) throw new StepFailed(id, 'Cancelled by user', true)
  const step = stepOf(flow, id)
  const started = Date.now()
  step.status = 'running'
  flow.current = step
  emitStep(flow, step)
  try {
    const result = await work(step)
    if (step.status === 'running') step.status = 'passed'
    return result
  } catch (err) {
    const cancelled = flow.abort.signal.aborted || err instanceof FlowCancelled
    step.status = 'failed'
    step.error = cancelled ? 'Cancelled by user' : errorMessage(err)
    throw new StepFailed(id, step.error, cancelled)
  } finally {
    step.durationMs = Date.now() - started
    flow.current = null
    emitStep(flow, step)
  }
}

function skipStep(flow: Flow, id: McpOAuthStepId, note: string): void {
  const step = stepOf(flow, id)
  step.status = 'skipped'
  step.note = note
  emitStep(flow, step)
}

function skipRemaining(flow: Flow, note: string): void {
  for (const step of flow.steps) {
    if (step.status === 'pending') skipStep(flow, step.id, note)
  }
}

// ─── Loopback redirect listener ─────────────────────────────

interface CallbackResult {
  url: URL
  code: string
  iss?: string
}

interface Loopback {
  redirectUri: string
  /** Resolves on the first `GET /callback` that passes `validate`; rejects on failure / timeout / cancel. */
  wait: (
    validate: (params: URLSearchParams) => string | null,
    timeoutMs: number,
    signal: AbortSignal,
  ) => Promise<CallbackResult>
  close: () => Promise<void>
}

function callbackPage(ok: boolean, message: string): string {
  const safe = message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!doctype html><html><head><meta charset="utf-8"><title>Testnizer</title></head><body style="font-family:system-ui,sans-serif;padding:40px;text-align:center"><h2>${
    ok ? 'Authorization complete' : 'Authorization failed'
  }</h2><p>${safe}</p><p>You can close this window and return to Testnizer.</p></body></html>`
}

async function startLoopback(port: number): Promise<Loopback> {
  const server = http.createServer()
  let handler: ((req: http.IncomingMessage, res: http.ServerResponse) => void) | null = null
  server.on('request', (req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    if (req.method !== 'GET' || path !== CALLBACK_PATH || !handler) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }
    handler(req, res)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const bound = (server.address() as AddressInfo).port
  const redirectUri = `http://127.0.0.1:${bound}${CALLBACK_PATH}`

  return {
    redirectUri,
    wait: (validate, timeoutMs, signal) =>
      new Promise<CallbackResult>((resolve, reject) => {
        let settled = false
        const finish = (fn: () => void): void => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
          handler = null
          fn()
        }
        const timer = setTimeout(
          () =>
            finish(() =>
              reject(
                new Error(
                  `Timed out after ${Math.round(timeoutMs / 1000)} s waiting for the browser to return to ${redirectUri}`,
                ),
              ),
            ),
          timeoutMs,
        )
        const onAbort = (): void => finish(() => reject(new FlowCancelled()))
        signal.addEventListener('abort', onAbort)
        handler = (req, res) => {
          const url = new URL(req.url ?? '/', redirectUri)
          const problem = validate(url.searchParams)
          res.writeHead(problem ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(callbackPage(!problem, problem ?? 'Testnizer received the authorization code.'))
          finish(() => {
            if (problem) reject(new Error(problem))
            else {
              const iss = url.searchParams.get('iss')
              resolve({
                url,
                code: url.searchParams.get('code') ?? '',
                ...(iss ? { iss } : {}),
              })
            }
          })
        }
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

// ─── Helpers ────────────────────────────────────────────────

/** RFC 8707 canonical URI of the MCP server: no fragment, no trailing slash (except the root). */
function canonicalResource(serverUrl: URL): URL {
  const url = resourceUrlFromServerUrl(serverUrl)
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  return url
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function lastStatus(step: McpOAuthStep): number | undefined {
  return step.attempts?.[step.attempts.length - 1]?.response?.status
}

function attemptedUrls(step: McpOAuthStep): string {
  return (step.attempts ?? [])
    .map((a) => `${a.request.url} → ${a.response ? a.response.status : (a.error ?? 'error')}`)
    .join('; ')
}

function metadataFlag(metadata: AuthorizationServerMetadata, key: string): unknown {
  return (metadata as Record<string, unknown>)[key]
}

// ─── The flow ───────────────────────────────────────────────

interface ProbeOutcome {
  authRequired: boolean
  resourceMetadataUrl?: URL
  scope?: string
}

async function probe(
  flow: Flow,
  serverUrl: URL,
  opts: McpOAuthStartOptions,
  fetchFn: FetchLike,
  step: McpOAuthStep,
): Promise<ProbeOutcome> {
  const headers = new Headers()
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (k.toLowerCase() !== 'authorization') headers.set(k, v)
  }
  let res: Response
  if (opts.transport === 'sse') {
    headers.set('Accept', 'text/event-stream')
    res = await fetchFn(serverUrl, { method: 'GET', headers })
  } else {
    headers.set('Content-Type', 'application/json')
    headers.set('Accept', 'application/json, text/event-stream')
    res = await fetchFn(serverUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'testnizer-oauth-probe',
        method: 'initialize',
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'Testnizer', version: '1.0.0' },
        },
      }),
    })
  }
  const params = extractWWWAuthenticateParams(res)
  await res.body?.cancel().catch(() => {})

  if (res.ok) {
    // A stateful server opened a session for our probe — close it again.
    const sessionId = res.headers.get('mcp-session-id')
    if (sessionId) {
      void timeoutFetch(flow.httpTimeoutMs)(serverUrl, {
        method: 'DELETE',
        headers: { 'mcp-session-id': sessionId },
      })
        .then((r) => r.body?.cancel())
        .catch(() => {})
    }
    step.note = `HTTP ${res.status} without credentials — the server does not require authorization.`
    return { authRequired: false }
  }
  if (res.status !== 401 && res.status !== 403) {
    throw new Error(
      `Expected 401 Unauthorized with a WWW-Authenticate challenge, got HTTP ${res.status}`,
    )
  }
  const notes = [`HTTP ${res.status}`]
  if (params.resourceMetadataUrl) {
    notes.push(`WWW-Authenticate resource_metadata=${params.resourceMetadataUrl.href}`)
  } else if (res.headers.get('www-authenticate')) {
    notes.push(
      'WWW-Authenticate has no resource_metadata (pre-2025-06-18 server) — falling back to /.well-known discovery',
    )
  } else {
    notes.push('no WWW-Authenticate header — falling back to /.well-known discovery')
  }
  if (params.scope) notes.push(`challenge scope="${params.scope}"`)
  if (params.error) notes.push(`error=${params.error}`)
  step.note = notes.join('; ')
  return {
    authRequired: true,
    ...(params.resourceMetadataUrl ? { resourceMetadataUrl: params.resourceMetadataUrl } : {}),
    ...(params.scope ? { scope: params.scope } : {}),
  }
}

// ─── Step bodies ────────────────────────────────────────────

/** Step 2 — RFC 9728 document, validated against the server URL; `undefined` = legacy fallback. */
async function resourceMetadataStep(
  flow: Flow,
  step: McpOAuthStep,
  serverUrl: URL,
  canonical: URL,
  advertisedUrl: URL | undefined,
  fetchFn: FetchLike,
): Promise<OAuthProtectedResourceMetadata | undefined> {
  let doc: OAuthProtectedResourceMetadata
  try {
    doc = await discoverOAuthProtectedResourceMetadata(
      serverUrl,
      advertisedUrl ? { resourceMetadataUrl: advertisedUrl } : {},
      fetchFn,
    )
  } catch (err) {
    if (err instanceof FlowCancelled || flow.abort.signal.aborted) throw err
    const status = lastStatus(step)
    // Only an absent well-known document (not an advertised-but-broken one,
    // not a timeout) is the legacy case the SDK falls back from.
    const absent =
      status === 404 || (status === undefined && /does not implement/i.test(errorMessage(err)))
    if (!advertisedUrl && absent) {
      step.status = 'skipped'
      step.note = `No Protected Resource Metadata (${attemptedUrls(step) || 'not reachable'}) — falling back to the legacy behaviour: the MCP server origin is treated as the authorization server.`
      return undefined
    }
    throw err
  }
  if (!checkResourceAllowed({ requestedResource: canonical, configuredResource: doc.resource })) {
    throw new Error(
      `Protected resource "${doc.resource}" does not match the server URL ${canonical.href} (RFC 9728 §3.3)`,
    )
  }
  const servers = doc.authorization_servers ?? []
  step.note = [
    `resource=${doc.resource}`,
    servers.length > 0
      ? `authorization_servers=[${servers.join(', ')}]`
      : 'no authorization_servers — using the MCP server origin as the authorization server',
    doc.scopes_supported?.length ? `scopes_supported=[${doc.scopes_supported.join(' ')}]` : '',
  ]
    .filter(Boolean)
    .join('; ')
  return doc
}

/** Step 3 — RFC 8414 / OIDC discovery plus the checks the later steps depend on. */
async function authServerMetadataStep(
  step: McpOAuthStep,
  authorizationServerUrl: string,
  fetchFn: FetchLike,
): Promise<AuthorizationServerMetadata> {
  const doc = await discoverAuthorizationServerMetadata(authorizationServerUrl, { fetchFn })
  if (!doc) {
    throw new Error(
      `No authorization server metadata for ${authorizationServerUrl} — tried ${attemptedUrls(step)}`,
    )
  }
  if (!doc.response_types_supported.includes('code')) {
    throw new Error('The authorization server does not support response_type=code')
  }
  const methods = doc.code_challenge_methods_supported
  if (methods && !methods.includes('S256')) {
    throw new Error(
      `The authorization server does not support PKCE S256 (code_challenge_methods_supported=[${methods.join(', ')}])`,
    )
  }
  const notes = [
    `issuer=${doc.issuer}`,
    `authorization_endpoint=${doc.authorization_endpoint}`,
    `token_endpoint=${doc.token_endpoint}`,
    `registration_endpoint=${doc.registration_endpoint ?? '(none)'}`,
  ]
  if (stripSlash(doc.issuer) !== stripSlash(authorizationServerUrl)) {
    notes.push(
      `Warning: issuer differs from the discovered authorization server URL ${authorizationServerUrl} (RFC 8414 §3.3)`,
    )
  }
  if (!methods) {
    notes.push(
      'Warning: code_challenge_methods_supported is absent — the server does not advertise PKCE support',
    )
  }
  if ((step.attempts?.length ?? 0) > 1) notes.push(`tried: ${attemptedUrls(step)}`)
  step.note = notes.join('; ')
  return doc
}

/** Step 6 — why a loopback callback is rejected, or null when it is good. */
function callbackProblem(
  params: URLSearchParams,
  state: string,
  issuer: string,
  issSupported: boolean,
): string | null {
  const error = params.get('error')
  if (error) {
    const description = params.get('error_description')
    return `The authorization server returned error=${error}${description ? `: ${description}` : ''}`
  }
  if (params.get('state') !== state) {
    return 'state mismatch — the callback state does not match the one sent (possible CSRF or a stale browser tab)'
  }
  // RFC 9207 §2.4: simple string comparison with the issuer identifier.
  const iss = params.get('iss')
  if (iss !== null && iss !== issuer) {
    return `iss mismatch (RFC 9207 mix-up protection): the callback says iss=${iss} but the authorization server's issuer is ${issuer}`
  }
  if (iss === null && issSupported) {
    return 'The authorization server advertises authorization_response_iss_parameter_supported but the callback carries no iss (RFC 9207)'
  }
  if (!params.get('code')) return 'The callback carries no authorization code'
  return null
}

async function runFlow(flow: Flow, opts: McpOAuthStartOptions): Promise<McpOAuthDone> {
  const serverUrl = new URL(opts.url)
  const fetchFn = recordingFetch(flow)
  const callbackTimeoutMs = flow.hooks.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS
  let loopback: Loopback | null = null
  const clientSecret = opts.clientSecret?.trim() || undefined
  if (clientSecret) flow.secrets.add(clientSecret)

  try {
    // 1 ── Unauthenticated probe
    const probed = await runStep(flow, 'probe', (step) =>
      probe(flow, serverUrl, opts, fetchFn, step),
    )
    if (!probed.authRequired) {
      skipRemaining(flow, 'The server does not require authorization.')
      return { oauthSessionId: flow.id, ok: true, noAuthRequired: true }
    }

    // 2 ── Protected Resource Metadata
    const canonical = canonicalResource(serverUrl)
    const prm = await runStep(flow, 'resource-metadata', (step) =>
      resourceMetadataStep(flow, step, serverUrl, canonical, probed.resourceMetadataUrl, fetchFn),
    )
    const authorizationServerUrl = prm?.authorization_servers?.[0] ?? new URL('/', serverUrl).href
    const resource = prm ? new URL(prm.resource) : canonical

    // 3 ── Authorization Server Metadata
    const metadata = await runStep(flow, 'auth-server-metadata', (step) =>
      authServerMetadataStep(step, authorizationServerUrl, fetchFn),
    )

    // The redirect URI is part of the DCR body and the authorization URL, so
    // the loopback listener must be bound before step 4.
    try {
      loopback = await startLoopback(opts.callbackPort ?? 0)
    } catch (err) {
      const step = stepOf(flow, 'client-registration')
      step.status = 'failed'
      step.error = `Could not start the loopback redirect listener on 127.0.0.1:${opts.callbackPort ?? 0}: ${errorMessage(err)}`
      emitStep(flow, step)
      throw new StepFailed('client-registration', step.error, false)
    }
    const redirectUri = loopback.redirectUri
    const scope =
      opts.scope?.trim() || probed.scope || prm?.scopes_supported?.join(' ') || undefined

    // 4 ── Client registration
    let clientInformation: OAuthClientInformationMixed
    const manualClientId = opts.clientId?.trim()
    if (manualClientId) {
      clientInformation = {
        client_id: manualClientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
      }
      skipStep(
        flow,
        'client-registration',
        `Manual client "${manualClientId}" (${clientSecret ? 'confidential — secret kept in the main process' : 'public'}). Make sure ${redirectUri} is an allowed redirect URI.`,
      )
    } else {
      clientInformation = await runStep(flow, 'client-registration', async (step) => {
        if (!metadata.registration_endpoint) {
          throw new Error(
            'The authorization server has no registration_endpoint, so Dynamic Client Registration (RFC 7591) is not possible. Enter a Client ID registered with this server (and its secret, for a confidential client) and start again.',
          )
        }
        const clientMetadata = {
          client_name: 'Testnizer',
          application_type: 'native',
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }
        const info = await registerClient(authorizationServerUrl, {
          metadata,
          clientMetadata,
          ...(scope ? { scope } : {}),
          fetchFn,
        })
        if (info.client_secret) flow.secrets.add(info.client_secret)
        step.note = `Registered client_id=${info.client_id}; token_endpoint_auth_method=${info.token_endpoint_auth_method ?? '(not stated)'}; redirect_uri=${redirectUri}`
        return info
      })
    }

    // 5 ── PKCE + authorization URL
    const state = randomBytes(24).toString('base64url')
    const { authorizationUrl, codeVerifier } = await runStep(
      flow,
      'authorization-request',
      async (step) => {
        const started = await startAuthorization(authorizationServerUrl, {
          metadata,
          clientInformation,
          redirectUrl: redirectUri,
          state,
          resource,
          ...(scope ? { scope } : {}),
        })
        flow.secrets.add(started.codeVerifier)
        step.request = { method: 'GET', url: started.authorizationUrl.href, headers: {} }
        step.note = [
          'PKCE S256 challenge generated (verifier kept in the main process)',
          `resource=${resource.href}`,
          `scope=${scope ?? '(none)'}`,
          `redirect_uri=${redirectUri}`,
        ].join('; ')
        return started
      },
    )

    // 6 ── Browser + loopback redirect
    const issuer = metadata.issuer
    const issSupported =
      metadataFlag(metadata, 'authorization_response_iss_parameter_supported') === true
    const callback = await runStep(flow, 'authorization-callback', async (step) => {
      const waiting = loopback!.wait(
        (params) => callbackProblem(params, state, issuer, issSupported),
        callbackTimeoutMs,
        flow.abort.signal,
      )
      // The callback can settle (and reject) while `openUrl` is still being
      // awaited — mark the rejection handled now; `await waiting` below
      // still surfaces it.
      waiting.catch(() => {})
      step.request = { method: 'GET', url: authorizationUrl.href, headers: {} }
      step.note = `Waiting for the browser to return to ${redirectUri}…`
      emitStep(flow, step)
      try {
        await flow.hooks.openUrl(authorizationUrl.href)
      } catch (err) {
        step.note = `Could not open the system browser (${errorMessage(err)}) — open the authorization URL from step 5 manually. Waiting for ${redirectUri}…`
        emitStep(flow, step)
      }
      const result = await waiting
      flow.secrets.add(result.code)
      step.request = { method: 'GET', url: redactedUrl(result.url), headers: {} }
      step.response = {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '(“Authorization complete — you can close this window” page)',
      }
      step.note = [
        'Authorization code received',
        'state matches',
        result.iss ? 'iss matches the issuer (RFC 9207)' : 'no iss parameter',
      ].join('; ')
      return result
    })
    await loopback.close()
    loopback = null

    // 7 ── Token exchange
    const clientAuthMethod = selectClientAuthMethod(
      clientInformation,
      metadata.token_endpoint_auth_methods_supported ?? [],
    )
    const tokens: OAuthTokens = await runStep(flow, 'token-exchange', async (step) => {
      const t = await exchangeAuthorization(authorizationServerUrl, {
        metadata,
        clientInformation,
        authorizationCode: callback.code,
        codeVerifier,
        redirectUri,
        resource,
        fetchFn,
      })
      flow.secrets.add(t.access_token)
      if (t.refresh_token) flow.secrets.add(t.refresh_token)
      if (t.id_token) flow.secrets.add(t.id_token)
      const notes = [
        `token_type=${t.token_type}`,
        `expires_in=${t.expires_in ?? '(not given)'}`,
        `scope=${t.scope ?? '(not given)'}`,
        `refresh_token=${t.refresh_token ? 'yes' : 'no'}`,
        `client authentication=${clientAuthMethod}`,
      ]
      if (t.token_type.toLowerCase() !== 'bearer') {
        notes.push('Warning: MCP expects a Bearer token')
      }
      step.note = notes.join('; ')
      return t
    })

    const expiresAt =
      typeof tokens.expires_in === 'number' ? Date.now() + tokens.expires_in * 1000 : undefined
    tokenSessions.set(flow.id, {
      accessToken: tokens.access_token,
      tokenType: tokens.token_type,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      ...(tokens.scope ? { scope: tokens.scope } : {}),
      authorizationServerUrl,
      metadata,
      clientInformation,
      resource,
    })
    return {
      oauthSessionId: flow.id,
      ok: true,
      summary: {
        tokenType: tokens.token_type,
        ...(expiresAt ? { expiresAt } : {}),
        ...((tokens.scope ?? scope) ? { scope: tokens.scope ?? scope } : {}),
        issuer,
        clientId: clientInformation.client_id,
        hasRefreshToken: !!tokens.refresh_token,
        clientAuthMethod,
        resource: resource.href,
      },
    }
  } catch (err) {
    const failed = err instanceof StepFailed ? err : null
    const cancelled =
      failed?.cancelled ?? (err instanceof FlowCancelled || flow.abort.signal.aborted)
    skipRemaining(flow, cancelled ? 'Cancelled' : 'Not reached — an earlier step failed')
    return {
      oauthSessionId: flow.id,
      ok: false,
      error: cancelled ? 'Cancelled by user' : errorMessage(err),
      ...(cancelled ? { cancelled: true } : {}),
      ...(failed ? { failedStep: failed.stepId } : {}),
    }
  } finally {
    if (loopback) await loopback.close().catch(() => {})
  }
}

// ─── API ────────────────────────────────────────────────────

/**
 * Start a flow. Returns the session id at once; steps and the final result
 * arrive through the hooks. The flow itself starts one macrotask later so
 * the IPC reply carrying the id reaches the renderer before the first step
 * event does. `finished` never rejects.
 */
export function mcpOAuthStart(
  options: McpOAuthStartOptions,
  hooks: McpOAuthHooks,
): { oauthSessionId: string; finished: Promise<McpOAuthDone> } {
  let parsed: URL
  try {
    parsed = new URL(options.url)
  } catch {
    throw new Error(`Invalid MCP server URL: ${options.url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('OAuth applies to http(s) MCP servers only')
  }
  const id = `mcp-oauth-${randomUUID()}`
  const flow: Flow = {
    id,
    abort: new AbortController(),
    steps: STEP_DEFS.map((d, i) => ({ id: d.id, index: i + 1, title: d.title, status: 'pending' })),
    current: null,
    hooks,
    secrets: new Set(),
    httpTimeoutMs: hooks.httpTimeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
  }
  flows.set(id, flow)

  const finished = new Promise<void>((resolve) => setImmediate(resolve))
    .then(() => runFlow(flow, options))
    .catch((err): McpOAuthDone => ({ oauthSessionId: id, ok: false, error: errorMessage(err) }))
    .then((done) => {
      flows.delete(id)
      const safe = scrub(done, flow.secrets)
      try {
        hooks.onDone?.(safe)
      } catch {
        /* consumer errors are not the flow's */
      }
      return safe
    })
  return { oauthSessionId: id, finished }
}

/** Abort a running flow (pending fetch, browser wait). Returns false when none is running. */
export function mcpOAuthCancel(oauthSessionId: string): boolean {
  const flow = flows.get(oauthSessionId)
  if (!flow) return false
  flow.abort.abort()
  return true
}

/** Cancel the flow if it still runs and drop its tokens. Returns true when anything was dropped. */
export function mcpOAuthForget(oauthSessionId: string): boolean {
  const cancelled = mcpOAuthCancel(oauthSessionId)
  const dropped = tokenSessions.delete(oauthSessionId)
  return cancelled || dropped
}

/** True when `oauthSessionId` holds a token (for logging / UI only — never the token). */
export function mcpOAuthHasToken(oauthSessionId: string): boolean {
  return tokenSessions.has(oauthSessionId)
}

export function mcpOAuthCancelAll(): void {
  for (const flow of flows.values()) flow.abort.abort()
}

async function refreshSession(session: TokenSession, timeoutMs: number): Promise<boolean> {
  if (!session.refreshToken || session.refreshFailed) return false
  if (!session.refreshing) {
    const refreshToken = session.refreshToken
    session.refreshing = (async () => {
      try {
        const t = await refreshAuthorization(session.authorizationServerUrl, {
          metadata: session.metadata,
          clientInformation: session.clientInformation,
          refreshToken,
          resource: session.resource,
          fetchFn: timeoutFetch(timeoutMs),
        })
        session.accessToken = t.access_token
        session.tokenType = t.token_type
        if (t.refresh_token) session.refreshToken = t.refresh_token
        session.expiresAt =
          typeof t.expires_in === 'number' ? Date.now() + t.expires_in * 1000 : undefined
        return true
      } catch {
        session.refreshFailed = true
        return false
      } finally {
        session.refreshing = undefined
      }
    })()
  }
  return session.refreshing
}

/**
 * The `fetch` for an MCP transport authenticated by an OAuth session. Sets
 * `Authorization: Bearer <token>` on every request — after the user's headers,
 * so the token wins — and on a 401 refreshes the token once (single-flight)
 * and retries that request once. A forgotten / unknown session injects
 * nothing, so the server's 401 surfaces as it would without OAuth.
 */
export function createMcpOAuthFetch(
  oauthSessionId: string,
  baseFetch: FetchLike = (url, init) => fetch(url, init),
): FetchLike {
  return async (url, init) => {
    const session = tokenSessions.get(oauthSessionId)
    if (!session) return baseFetch(url, init)
    const send = (token: string): Promise<Response> => {
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${token}`)
      return baseFetch(url, { ...init, headers })
    }
    const res = await send(session.accessToken)
    if (res.status !== 401 || !session.refreshToken || session.refreshFailed) return res
    const refreshed = await refreshSession(session, DEFAULT_HTTP_TIMEOUT_MS)
    const current = tokenSessions.get(oauthSessionId)
    if (!refreshed || !current) return res
    await res.body?.cancel().catch(() => {})
    return send(current.accessToken)
  }
}
