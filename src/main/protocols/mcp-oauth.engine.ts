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
 * The protocol work is the SDK's (`@modelcontextprotocol/client` 2.x, issue
 * #152): `extractWWWAuthenticateParams`, `discoverOAuthProtectedResourceMetadata`,
 * `discoverAuthorizationServerMetadata`, `registerClient`,
 * `startAuthorization`, `exchangeAuthorization`, `refreshAuthorization`,
 * `selectClientAuthMethod`. Every one of them takes a `fetchFn`; ours records
 * the exchange (redacted) onto the running step, applies a hard timeout and
 * the flow's cancel signal. SDK 2.x behaviour worth knowing here:
 *   - AS metadata issuer validation is skipped (`skipIssuerValidation`) so a
 *     mismatch stays a step-3 WARNING as before, not a hard failure;
 *   - the token endpoint must be https (or loopback) — `InsecureTokenEndpointError`.
 *     The one exception is the per-request intranet opt-in (issue #170,
 *     `allowHttpAuthServer`): a plain-HTTP token endpoint on the SAME host:port as
 *     the discovered authorization server is then reached through
 *     `plainHttpTokenRequest` (the SDK has no opt-out); every other host or
 *     port still needs https, and https / loopback endpoints keep the SDK path;
 *   - token-endpoint errors are one `OAuthError` class with the RFC 6749
 *     `error` string in `.code` (v1 had a class per code) — see `errorMessage`.
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
  LATEST_PROTOCOL_VERSION,
  checkResourceAllowed,
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  exchangeAuthorization,
  extractWWWAuthenticateParams,
  parseErrorResponse,
  prepareAuthorizationCodeRequest,
  refreshAuthorization,
  registerClient,
  resourceUrlFromServerUrl,
  selectClientAuthMethod,
  startAuthorization,
  type AuthorizationServerMetadata,
  type FetchLike,
  type OAuthClientInformationMixed,
  type OAuthProtectedResourceMetadata,
  type OAuthTokens,
} from '@modelcontextprotocol/client'
import { isCredentialHeaderName } from '../lib/credential-headers'

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
  /**
   * Issue #170: the token came from a plain-HTTP token endpoint (intranet
   * opt-in), so its refresh would go over HTTP too — the renderer forgets the
   * session when the user turns the opt-in off.
   */
  plainHttpTokenEndpoint?: boolean
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
  /**
   * Intranet opt-in (issue #170): allow a plain-HTTP token endpoint, but only
   * on the host of the authorization server this flow discovers. Token
   * exchange and refresh to that host then run over HTTP; any other non-TLS,
   * non-loopback token endpoint is still refused. Off by default.
   */
  allowHttpAuthServer?: boolean
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
export const REDACTED = '••••'
const CALLBACK_PATH = '/callback'

/** Body keys whose values are credentials (token / DCR / form bodies). */
const SECRET_KEY =
  /^(access_token|refresh_token|id_token|client_secret|registration_access_token|code|code_verifier|password|assertion|client_assertion|device_code)$/i

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
  /** RFC 8707 resource the token was issued for — the bearer goes to its origin only. */
  resource?: URL
  /** Origin of the MCP server URL the flow ran against (fallback when `resource` is absent). */
  serverOrigin: string
  /**
   * `host:port` whose plain-HTTP token endpoint the user opted into (issue
   * #170) — the authorization server's, pinned when the flow ran (see
   * `plainHttpPinOf`). Absent = the
   * SDK's https-or-loopback rule applies to refresh as well.
   */
  plainHttpTokenHost?: string
  /** Single-flight refresh shared by concurrent 401s. */
  refreshing?: Promise<boolean>
  /**
   * The authorization server definitively refused the refresh (`invalid_grant`
   * / `invalid_client` / `unauthorized_client`) — later 401s are surfaced, not
   * retried. A transient failure (network, 5xx, timeout) leaves it unset.
   */
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
// Exported for the MCP Security Scan (issue #142, `mcp-security.engine.ts`),
// which records its evidence with exactly these rules — one redaction policy
// for every MCP diagnostic that shows HTTP exchanges.

export function redactHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  headers.forEach((value, name) => {
    if (!isCredentialHeaderName(name)) {
      out[name] = value
      return
    }
    // Keep the scheme ("Basic ••••", "Bearer ••••") — that is what users debug.
    const scheme = /^(\w+)\s+\S/.exec(value)?.[1]
    out[name] = scheme ? `${scheme} ${REDACTED}` : REDACTED
  })
  return out
}

/**
 * A JSON value to mask by its key. A numeric `code` is a JSON-RPC / HTTP error
 * code (the Security Scan's evidence), never an OAuth authorization code —
 * those are strings — so it stays visible.
 */
function isSecretJsonValue(key: string, value: unknown): boolean {
  if (value === undefined || value === null || !SECRET_KEY.test(key)) return false
  return !(typeof value === 'number' && key.toLowerCase() === 'code')
}

function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = isSecretJsonValue(k, v) ? REDACTED : redactJson(v)
    }
    return out
  }
  return value
}

/** `••••` as URLSearchParams serialises it (`%E2%80%A2…`). */
const ENCODED_REDACTED = encodeURIComponent(REDACTED)

function redactForm(params: URLSearchParams): string {
  const out = new URLSearchParams()
  params.forEach((v, k) => out.append(k, SECRET_KEY.test(k) ? REDACTED : v))
  // Show the placeholder as-is (`code=••••`), not percent-encoded; every
  // other value keeps its wire encoding.
  return out.toString().split(ENCODED_REDACTED).join(REDACTED)
}

function truncate(text: string): string {
  return text.length > BODY_PREVIEW_CHARS
    ? `${text.slice(0, BODY_PREVIEW_CHARS)}… (${text.length} chars, truncated)`
    : text
}

export function redactBodyText(text: string, contentType: string): string {
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
  // Same as redactForm: show `code=••••`, not the percent-encoded placeholder.
  return copy.href.split(ENCODED_REDACTED).join(REDACTED)
}

/** Value-based scrub of a record about to leave the module (defence in depth). */
export function scrub<T>(record: T, secrets: Set<string>): T {
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

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // SDK 2.x `OAuthError`: the message is the AS's `error_description`
    // (or the bare code) and the RFC 6749 `error` string sits in `.code` —
    // show both, like the v1 per-code classes' names did.
    const oauthCode = (err as Error & { code?: unknown }).code
    if (
      err.name === 'OAuthError' &&
      typeof oauthCode === 'string' &&
      oauthCode &&
      !err.message.includes(oauthCode)
    ) {
      return `${oauthCode}: ${err.message}`
    }
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

export function anySignal(signals: Array<AbortSignal | null | undefined>): AbortSignal {
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

// ─── Plain-HTTP token endpoint (intranet opt-in, issue #170) ──

/**
 * The SDK's loopback list (`isLoopbackHost` in `@modelcontextprotocol/client`,
 * not exported) — those hosts are already exempt from the https rule, so the
 * opt-in never changes how they are reached.
 */
function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  )
}

/** The token endpoint the SDK would POST to (metadata, else `<AS>/token`). */
function tokenEndpointOf(
  authorizationServerUrl: string,
  metadata: AuthorizationServerMetadata | undefined,
): URL {
  return new URL(metadata?.token_endpoint ?? new URL('/token', authorizationServerUrl))
}

/**
 * The `host:port` the plain-HTTP opt-in is pinned to (issue #170): lower-cased
 * hostname plus the EFFECTIVE port — a missing port is the scheme's default
 * (80 / 443), so `http://as.corp` ≡ `http://as.corp:80`, while
 * `http://as.corp:9999` is a different service than `as.corp:8080` and an
 * `https://as.corp` server does not vouch for `http://as.corp` (port 80).
 */
export function plainHttpPinOf(url: URL): string {
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  return `${url.hostname.toLowerCase()}:${port}`
}

/**
 * Whether a token request must bypass the SDK because the user opted into a
 * plain-HTTP authorization server. `false` → the SDK path (https, loopback,
 * or no opt-in — the SDK then raises its own `InsecureTokenEndpointError`).
 * Throws when the opt-in is on but the http endpoint is on another host OR
 * port: the opt-in covers the authorization server's `host:port` only
 * (`allowedPin`, from `plainHttpPinOf`).
 */
export function usesPlainHttpTokenEndpoint(tokenUrl: URL, allowedPin: string | undefined): boolean {
  if (!allowedPin) return false
  if (tokenUrl.protocol !== 'http:' || isLoopbackHostname(tokenUrl.hostname)) return false
  if (plainHttpPinOf(tokenUrl) === allowedPin.toLowerCase()) return true
  throw new Error(
    `Insecure token endpoint ${tokenUrl.href}: the plain-HTTP authorization server opt-in covers ${allowedPin} only — every other host or port requires HTTPS`,
  )
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** RFC 6749 §5.1 token response, checked the way the SDK's `OAuthTokensSchema` does. */
function parseTokenResponse(json: unknown): OAuthTokens | null {
  if (!isRecord(json)) return null
  const { access_token, token_type, expires_in, refresh_token, scope, id_token } = json
  if (typeof access_token !== 'string' || typeof token_type !== 'string') return null
  if (expires_in !== undefined && typeof expires_in !== 'number') return null
  if (refresh_token !== undefined && typeof refresh_token !== 'string') return null
  if (scope !== undefined && typeof scope !== 'string') return null
  if (id_token !== undefined && typeof id_token !== 'string') return null
  return {
    access_token,
    token_type,
    ...(typeof id_token === 'string' ? { id_token } : {}),
    ...(typeof expires_in === 'number' ? { expires_in } : {}),
    ...(typeof scope === 'string' ? { scope } : {}),
    ...(typeof refresh_token === 'string' ? { refresh_token } : {}),
  }
}

/**
 * The SDK's `executeTokenRequest` minus `assertSecureTokenEndpoint`, for the
 * opted-in plain-HTTP host only: RFC 8707 `resource`, client authentication
 * picked by `selectClientAuthMethod` (client_secret_basic / client_secret_post
 * / none), errors as the SDK's `OAuthError` (via `parseErrorResponse`, so
 * `.code` drives the refresh give-up rule). Redirects are NOT followed — a
 * 3xx would re-send the code, verifier and secret to wherever it points.
 * The request goes through the caller's `fetchFn`, so the recorded exchange
 * is redacted exactly like the SDK path's.
 */
async function plainHttpTokenRequest(
  tokenUrl: URL,
  params: URLSearchParams,
  ctx: {
    metadata: AuthorizationServerMetadata | undefined
    clientInformation: OAuthClientInformationMixed
    resource: URL | undefined
  },
  fetchFn: FetchLike,
): Promise<OAuthTokens> {
  const headers = new Headers({
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  })
  if (ctx.resource) params.set('resource', ctx.resource.href)
  const { client_id, client_secret } = ctx.clientInformation
  const method = selectClientAuthMethod(
    ctx.clientInformation,
    ctx.metadata?.token_endpoint_auth_methods_supported ?? [],
  )
  switch (method) {
    case 'client_secret_basic':
      if (!client_secret) {
        throw new Error('client_secret_basic authentication requires a client_secret')
      }
      headers.set('Authorization', `Basic ${btoa(`${client_id}:${client_secret}`)}`)
      break
    case 'client_secret_post':
      params.set('client_id', client_id)
      if (client_secret) params.set('client_secret', client_secret)
      break
    case 'none':
      params.set('client_id', client_id)
      break
    default:
      throw new Error(`Unsupported client authentication method: ${String(method)}`)
  }
  const res = await fetchFn(tokenUrl, {
    method: 'POST',
    headers,
    body: params,
    redirect: 'manual',
  })
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => {})
    throw new Error(
      `The token endpoint answered HTTP ${res.status} (redirect) — not followed, so the credentials are not re-sent elsewhere`,
    )
  }
  if (!res.ok) throw await parseErrorResponse(res)
  const json: unknown = await res.json()
  const tokens = parseTokenResponse(json)
  if (tokens) return tokens
  if (isRecord(json) && 'error' in json) throw await parseErrorResponse(JSON.stringify(json))
  throw new Error('The token endpoint returned an invalid token response')
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
  // `skipIssuerValidation`: SDK 2.x would THROW on an issuer mismatch; the
  // debugger reports it as a warning below (v1 behaviour) and lets the user
  // see whether the rest of the flow works.
  const doc = await discoverAuthorizationServerMetadata(authorizationServerUrl, {
    fetchFn,
    skipIssuerValidation: true,
  })
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
    // Issue #170: the plain-HTTP opt-in is pinned to the host AND port of
    // the authorization server discovered above — a token endpoint on any
    // other host or port still needs https.
    const plainHttpTokenHost = opts.allowHttpAuthServer
      ? plainHttpPinOf(new URL(authorizationServerUrl))
      : undefined

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
    let plainHttp = false
    const tokens: OAuthTokens = await runStep(flow, 'token-exchange', async (step) => {
      const tokenUrl = tokenEndpointOf(authorizationServerUrl, metadata)
      plainHttp = usesPlainHttpTokenEndpoint(tokenUrl, plainHttpTokenHost)
      // Step 6 already compared `iss` with the issuer (RFC 9207); SDK 2.x
      // re-checks it in `exchangeAuthorization`, so pass what the callback carried.
      const t = plainHttp
        ? await plainHttpTokenRequest(
            tokenUrl,
            prepareAuthorizationCodeRequest(callback.code, codeVerifier, redirectUri),
            { metadata, clientInformation, resource },
            fetchFn,
          )
        : await exchangeAuthorization(authorizationServerUrl, {
            metadata,
            clientInformation,
            authorizationCode: callback.code,
            ...(callback.iss ? { iss: callback.iss } : {}),
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
      if (plainHttp) {
        notes.push(
          `Warning: plain-HTTP token endpoint ${tokenUrl.host} (intranet opt-in) — the authorization code, PKCE verifier and tokens crossed the network unencrypted`,
        )
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
      serverOrigin: serverUrl.origin,
      ...(plainHttpTokenHost ? { plainHttpTokenHost } : {}),
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
        ...(plainHttp ? { plainHttpTokenEndpoint: true } : {}),
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

/** RFC 6749 §5.2 errors after which the same refresh can never succeed. */
const DEFINITIVE_REFRESH_ERRORS = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
])

/**
 * True when the token endpoint answered 400 / 401 with a definitive OAuth
 * error. Duck-typed: the SDK's `OAuthError` is brand-checked and carries the
 * RFC error string in `.code`; an unparsable / 5xx body arrives as
 * `server_error`, a network failure or timeout as a plain error.
 */
function isDefinitiveRefreshFailure(err: unknown, status: number | undefined): boolean {
  if (status !== 400 && status !== 401) return false
  if (!(err instanceof Error) || err.name !== 'OAuthError') return false
  const code = (err as Error & { code?: unknown }).code
  return typeof code === 'string' && DEFINITIVE_REFRESH_ERRORS.has(code)
}

async function refreshSession(session: TokenSession, timeoutMs: number): Promise<boolean> {
  if (!session.refreshToken || session.refreshFailed) return false
  if (!session.refreshing) {
    const refreshToken = session.refreshToken
    let tokenStatus: number | undefined
    const base = timeoutFetch(timeoutMs)
    const fetchFn: FetchLike = async (url, init) => {
      const res = await base(url, init)
      tokenStatus = res.status
      return res
    }
    session.refreshing = (async () => {
      try {
        const tokenUrl = tokenEndpointOf(session.authorizationServerUrl, session.metadata)
        const t = usesPlainHttpTokenEndpoint(tokenUrl, session.plainHttpTokenHost)
          ? {
              refresh_token: refreshToken,
              ...(await plainHttpTokenRequest(
                tokenUrl,
                new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
                {
                  metadata: session.metadata,
                  clientInformation: session.clientInformation,
                  resource: session.resource,
                },
                fetchFn,
              )),
            }
          : await refreshAuthorization(session.authorizationServerUrl, {
              metadata: session.metadata,
              clientInformation: session.clientInformation,
              refreshToken,
              resource: session.resource,
              fetchFn,
            })
        session.accessToken = t.access_token
        session.tokenType = t.token_type
        if (t.refresh_token) session.refreshToken = t.refresh_token
        session.expiresAt =
          typeof t.expires_in === 'number' ? Date.now() + t.expires_in * 1000 : undefined
        return true
      } catch (err) {
        // Only a definitive refusal is final; a transient failure is retried
        // on the next 401.
        if (isDefinitiveRefreshFailure(err, tokenStatus)) session.refreshFailed = true
        return false
      } finally {
        session.refreshing = undefined
      }
    })()
  }
  return session.refreshing
}

/** True when `url` is on the origin the session's token was issued for. */
function isTokenAudience(session: TokenSession, url: string | URL): boolean {
  const origin = session.resource?.origin ?? session.serverOrigin
  try {
    return new URL(String(url)).origin === origin
  } catch {
    return false
  }
}

/**
 * The `fetch` for an MCP transport authenticated by an OAuth session. Sets
 * `Authorization: Bearer <token>` on every request to the token's resource
 * origin — after the user's headers, so the token wins — and on a 401
 * refreshes the token once (single-flight) and retries that request once. A
 * request to any other origin (a legacy SSE `endpoint` elsewhere, a redirect
 * target) and a forgotten / unknown session inject nothing, so the server's
 * 401 surfaces as it would without OAuth.
 */
export function createMcpOAuthFetch(
  oauthSessionId: string,
  baseFetch: FetchLike = (url, init) => fetch(url, init),
): FetchLike {
  return async (url, init) => {
    const session = tokenSessions.get(oauthSessionId)
    if (!session || !isTokenAudience(session, url)) return baseFetch(url, init)
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
