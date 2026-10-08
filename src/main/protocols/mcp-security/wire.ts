/**
 * MCP Security Scan (issue #142) — the wire layer.
 *
 * Every byte the scan sends goes through `ScanHttp`: a recording fetch (same
 * redaction policy as the OAuth debugger — credential headers redacted by
 * name AND their values collected for a value scrub of everything that leaves
 * the engine), a hard per-request timeout, the scan's cancel signal, and at
 * most `maxConcurrent` requests in flight.
 *
 * The JSON-RPC sessions are deliberately our own, not the SDK `Client`: a
 * scanner must keep reading a server that misbehaves (a JSON-RPC body served
 * as `text/html` still yields the tools to inspect), and it needs the raw
 * status / headers of every exchange as evidence — and it must be able to
 * send what a well-behaved client never would (a contradicting `Mcp-Method`
 * header, a forged `requestState`). Two eras (issue #152): the 2025
 * `initialize` sessions (`StreamableSession`, `LegacySseSession`) and the
 * stateless 2026-07-28 one (`ModernSession`: `server/discover`, a `_meta`
 * envelope on every request, `Mcp-Method` / `Mcp-Name` headers).
 */

import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js'
import {
  REDACTED,
  SECRET_HEADER,
  anySignal,
  createMcpOAuthFetch,
  errorMessage,
  redactBodyText,
  redactHeaders,
} from '../mcp-oauth.engine'
import type { McpSecurityEvidence } from './types'

export const CLIENT_INFO = { name: 'Testnizer Security Scan', version: '1.0.0' }
/** The stateless protocol revision (`server/discover`, per-request `_meta` envelope). */
export const MODERN_PROTOCOL_VERSION = '2026-07-28'
/** `_meta` envelope keys of a 2026-07-28 request. */
export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion'
export const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo'
export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities'
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo'
const PREVIEW_CHARS = 4096
const CLEANUP_TIMEOUT_MS = 5_000
/** Raw SSE text kept for a preview while looking for a response id. */
const SSE_KEEP_CHARS = 64 * 1024
/** Query parameters whose values are credentials in an evidence URL. */
const SECRET_QUERY = /token|secret|key|password|passwd|signature|^sig$|^code$/i

export type Exchange = McpSecurityEvidence

export interface HttpResult {
  /** Undefined when no HTTP response arrived (network error / timeout). */
  status?: number
  /** Raw response headers (empty on a network error). */
  headers: Headers
  /** Body text — for an event stream, the raw SSE text read. */
  text: string
  /** Parsed JSON body, or the JSON-RPC message picked out of an event stream. */
  json?: unknown
  exchange: Exchange
  error?: string
}

function previewOf(text: string): string {
  return text.length > PREVIEW_CHARS
    ? `${text.slice(0, PREVIEW_CHARS)}… (${text.length} chars, truncated)`
    : text
}

/** Evidence URL: secret-looking query values redacted. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw)
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY.test(key)) url.searchParams.set(key, REDACTED)
    }
    return url.href
  } catch {
    return raw
  }
}

/** Credential header names (Authorization, Cookie, X-API-Key, …). */
export function isCredentialHeader(name: string): boolean {
  return name.toLowerCase() !== 'www-authenticate' && SECRET_HEADER.test(name)
}

export function withoutCredentials(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) if (!isCredentialHeader(k)) out[k] = v
  return out
}

// ─── SSE parsing ────────────────────────────────────────────

export interface SseEvent {
  event: string
  data: string
}

/** Split complete `\n\n`-terminated SSE events off `buffer`; the incomplete tail is `rest`. */
export function parseSseEvents(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n?/g, '\n')
  const blocks = normalized.split('\n\n')
  const rest = blocks.pop() ?? ''
  const events: SseEvent[] = []
  for (const block of blocks) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue
      const idx = line.indexOf(':')
      const field = idx === -1 ? line : line.slice(0, idx)
      const value = idx === -1 ? '' : line.slice(idx + 1).replace(/^ /, '')
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
    if (data.length > 0) events.push({ event, data: data.join('\n') })
  }
  return { events, rest }
}

function tryJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return undefined
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** A JSON-RPC response (has `id` and `result` | `error`) — optionally for `id`. */
function isResponseFor(msg: unknown, id: string | number | undefined): boolean {
  if (!isRecord(msg) || !('result' in msg || 'error' in msg)) return false
  return id === undefined || msg.id === id
}

// ─── ScanHttp ───────────────────────────────────────────────

export interface ScanHttpOptions {
  fetchFn: FetchLike
  signal: AbortSignal
  timeoutMs: number
  maxConcurrent: number
  /** OAuth token session (issue #141) put on authenticated requests by `createMcpOAuthFetch`. */
  oauthSessionId?: string
}

export interface SendOptions {
  /** Authenticated: the OAuth fetch wraps the recorder (user headers are the caller's). */
  auth: boolean
  /** For an event stream: stop reading once the response with this id arrived. */
  wantId?: string | number
  /** Status and headers only — the body is cancelled unread (e.g. a GET event stream). */
  discardBody?: boolean
  /**
   * Clean-up request (session DELETE): runs even after Cancel, on its own
   * short timeout instead of the scan's cancel signal.
   */
  detached?: boolean
}

interface RecordedCall {
  exchange: Exchange
  res?: Response
}

export class ScanHttp {
  /** Every exchange the scan made, oldest first (redacted). */
  readonly exchanges: Exchange[] = []
  /** Credential values seen on the wire — scrubbed from everything the engine emits. */
  readonly secrets = new Set<string>()
  requestCount = 0
  private active = 0
  private readonly waiting: Array<() => void> = []

  constructor(private readonly opts: ScanHttpOptions) {}

  get signal(): AbortSignal {
    return this.opts.signal
  }

  get timeoutMs(): number {
    return this.opts.timeoutMs
  }

  noteSecretsOf(headers: Record<string, string>): void {
    for (const [name, value] of Object.entries(headers)) {
      if (isCredentialHeader(name)) this.noteSecret(value)
    }
  }

  noteUrlSecrets(raw: string): void {
    try {
      new URL(raw).searchParams.forEach((v, k) => {
        if (SECRET_QUERY.test(k)) this.noteSecret(v)
      })
    } catch {
      /* not a URL */
    }
  }

  /** Register one credential value to scrub (a header the name rules miss — MCP Auth's API key). */
  noteSecret(value: string): void {
    const v = value.trim()
    if (!v) return
    this.secrets.add(v)
    const afterScheme = /^\w+\s+(\S.*)$/.exec(v)?.[1]
    if (afterScheme) this.secrets.add(afterScheme.trim())
  }

  private async acquire(): Promise<void> {
    if (this.active < this.opts.maxConcurrent) {
      this.active++
      return
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.active++
  }

  private release(): void {
    this.active--
    this.waiting.shift()?.()
  }

  private recorder(calls: RecordedCall[]): FetchLike {
    return async (url, init) => {
      const headers = new Headers(init?.headers)
      headers.forEach((value, name) => {
        if (isCredentialHeader(name)) this.noteSecret(value)
      })
      this.requestCount++
      const call: RecordedCall = {
        exchange: {
          request: {
            method: (init?.method ?? 'GET').toUpperCase(),
            url: redactUrl(String(url)),
            headers: redactHeaders(headers),
          },
        },
      }
      calls.push(call)
      this.exchanges.push(call.exchange)
      try {
        call.res = await this.opts.fetchFn(url, init)
        call.exchange.response = {
          status: call.res.status,
          headers: redactHeaders(call.res.headers),
        }
        return call.res
      } catch (err) {
        call.exchange.error = errorMessage(err)
        throw err
      }
    }
  }

  private fetchFor(auth: boolean, calls: RecordedCall[]): FetchLike {
    const rec = this.recorder(calls)
    return auth && this.opts.oauthSessionId
      ? createMcpOAuthFetch(this.opts.oauthSessionId, rec)
      : rec
  }

  /**
   * A request whose body is read here: JSON (any content type — parsing is
   * lenient on purpose), or an event stream read until the response `wantId`
   * arrives. One slot of the concurrency limit is held throughout.
   */
  async send(url: string, init: RequestInit, opts: SendOptions): Promise<HttpResult> {
    await this.acquire()
    const calls: RecordedCall[] = []
    const signal = opts.detached
      ? AbortSignal.timeout(Math.min(this.opts.timeoutMs, CLEANUP_TIMEOUT_MS))
      : anySignal([this.opts.signal, AbortSignal.timeout(this.opts.timeoutMs)])
    try {
      let res: Response
      try {
        res = await this.fetchFor(opts.auth, calls)(url, { ...init, signal })
      } catch (err) {
        const exchange = calls[calls.length - 1]?.exchange ?? {
          request: { method: init.method ?? 'GET', url: redactUrl(url), headers: {} },
        }
        if (!exchange.error) exchange.error = errorMessage(err)
        return { headers: new Headers(), text: '', exchange, error: exchange.error }
      }
      const exchange = calls[calls.length - 1].exchange
      const contentType = res.headers.get('content-type') ?? ''
      let text = ''
      let json: unknown
      try {
        if (opts.discardBody) {
          await res.body?.cancel().catch(() => {})
          if (exchange.response) exchange.response.bodyPreview = '(body not read)'
          return { status: res.status, headers: res.headers, text, exchange }
        }
        if (contentType.includes('text/event-stream')) {
          ;({ text, json } = await readSseResponse(res, opts.wantId))
        } else {
          text = await res.text()
          json = tryJson(text)
        }
      } catch (err) {
        exchange.error = `Response body not read: ${errorMessage(err)}`
      }
      if (exchange.response) {
        const shown =
          contentType.includes('text/event-stream') && json !== undefined
            ? `(event stream) ${JSON.stringify(json)}`
            : text
        const preview = previewOf(redactBodyText(shown, 'application/json'))
        if (preview) exchange.response.bodyPreview = preview
      }
      return { status: res.status, headers: res.headers, text, json, exchange }
    } finally {
      this.release()
    }
  }

  /**
   * A recording `FetchLike` for the SDK's discovery helpers (RFC 9728 / 8414):
   * timeout + cancel signal + one concurrency slot until the headers arrive.
   * Every exchange is appended to `sink` as well, so a check can show its
   * attempts. The body preview is read from a clone (JSON documents only).
   */
  fetchLike(sink: Exchange[]): FetchLike {
    return async (url, init) => {
      await this.acquire()
      const calls: RecordedCall[] = []
      try {
        const signal = anySignal([
          init?.signal,
          this.opts.signal,
          AbortSignal.timeout(this.opts.timeoutMs),
        ])
        try {
          const res = await this.recorder(calls)(url, { ...init, signal })
          const exchange = calls[calls.length - 1].exchange
          const contentType = res.headers.get('content-type') ?? ''
          if (exchange.response && !contentType.includes('text/event-stream')) {
            const text = await res
              .clone()
              .text()
              .catch(() => '')
            const preview = previewOf(redactBodyText(text, contentType))
            if (preview) exchange.response.bodyPreview = preview
          }
          return res
        } finally {
          const last = calls[calls.length - 1]
          if (last) sink.push(last.exchange)
        }
      } finally {
        this.release()
      }
    }
  }

  /**
   * Open a long-lived response (legacy SSE GET stream). Not counted against the
   * concurrency limit; aborted by `streamSignal` or the scan's cancel signal.
   */
  async openStream(
    url: string,
    init: RequestInit,
    auth: boolean,
    streamSignal: AbortSignal,
  ): Promise<{ res?: Response; exchange: Exchange; error?: string }> {
    const calls: RecordedCall[] = []
    // The connect budget aborts only a fetch still waiting for its headers;
    // once the stream is open the timer is cleared and the stream lives on.
    const connect = new AbortController()
    const timer = setTimeout(
      () => connect.abort(new Error(`No response within ${this.opts.timeoutMs} ms`)),
      this.opts.timeoutMs,
    )
    const signal = anySignal([this.opts.signal, streamSignal, connect.signal])
    try {
      const res = await this.fetchFor(auth, calls)(url, { ...init, signal })
      return { res, exchange: calls[calls.length - 1].exchange }
    } catch (err) {
      const exchange = calls[calls.length - 1]?.exchange ?? {
        request: { method: 'GET', url: redactUrl(url), headers: {} },
      }
      if (!exchange.error) exchange.error = errorMessage(err)
      return { exchange, error: exchange.error }
    } finally {
      clearTimeout(timer)
    }
  }
}

async function readSseResponse(
  res: Response,
  wantId: string | number | undefined,
): Promise<{ text: string; json?: unknown }> {
  if (!res.body) return { text: '' }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let kept = ''
  let found: unknown
  try {
    while (found === undefined) {
      const { value, done } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      if (kept.length < SSE_KEEP_CHARS) kept += chunk
      const parsed = parseSseEvents(buffer + chunk)
      buffer = parsed.rest
      for (const ev of parsed.events) {
        const msg = tryJson(ev.data)
        if (isResponseFor(msg, wantId) || (Array.isArray(msg) && wantId === undefined)) {
          found = msg
          break
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return { text: kept, ...(found !== undefined ? { json: found } : {}) }
}

// ─── JSON-RPC sessions ──────────────────────────────────────

export interface RpcError {
  code: number
  message: string
  data?: unknown
}

export interface RpcOutcome {
  http: HttpResult
  result?: Record<string, unknown>
  rpcError?: RpcError
  /** Why there is no result: network error, HTTP status, no / unparsable response. */
  error?: string
}

export interface RpcRequestOptions {
  /** Extra / overriding request headers (e.g. a deliberately wrong `Mcp-Method`). */
  headers?: Record<string, string>
  /** Modern era: the `clientCapabilities` the `_meta` envelope declares (default `{}`). */
  capabilities?: Record<string, unknown>
}

export interface RpcSession {
  readonly kind: 'http' | 'sse'
  /** Protocol era: 2025 `initialize` sessions, or the stateless 2026-07-28 one. */
  readonly era: 'legacy' | 'modern'
  /** Negotiated version (initialize result / the modern revision). */
  protocolVersion?: string
  /** The response that carried JSON-RPC results: the handshake POST, or the SSE stream. */
  rpcResponse?: HttpResult
  /** The handshake: `initialize` (legacy) or `server/discover` (modern). */
  initialize(): Promise<RpcOutcome>
  request(
    method: string,
    params?: Record<string, unknown>,
    opts?: RpcRequestOptions,
  ): Promise<RpcOutcome>
  /** A raw body to the message endpoint with the session headers (malformed JSON, batches). */
  postRaw(body: string): Promise<HttpResult | undefined>
  close(): Promise<void>
}

function initializeParams(): Record<string, unknown> {
  return { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }
}

function outcomeOf(http: HttpResult, message: unknown): RpcOutcome {
  if (http.status === undefined) return { http, error: http.error ?? 'No response' }
  if (isRecord(message) && isRecord(message.error)) {
    const e = message.error
    return {
      http,
      rpcError: {
        code: typeof e.code === 'number' ? e.code : 0,
        message: typeof e.message === 'string' ? e.message : '',
        ...(e.data !== undefined ? { data: e.data } : {}),
      },
    }
  }
  if (isRecord(message) && isRecord(message.result)) return { http, result: message.result }
  if (http.status < 200 || http.status >= 300) return { http, error: `HTTP ${http.status}` }
  return { http, error: 'No JSON-RPC response in the body' }
}

let rpcSeq = 0
const nextRpcId = (): string => `tz-scan-${++rpcSeq}`

/** Streamable HTTP (2025-03-26+): every message is a POST to the endpoint. */
export class StreamableSession implements RpcSession {
  readonly kind = 'http' as const
  readonly era = 'legacy' as const
  protocolVersion?: string
  rpcResponse?: HttpResult
  private sessionId?: string

  constructor(
    private readonly http: ScanHttp,
    private readonly url: string,
    private readonly headers: Record<string, string>,
    private readonly auth: boolean,
  ) {}

  private wireHeaders(): Record<string, string> {
    return {
      ...this.headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
      ...(this.protocolVersion ? { 'MCP-Protocol-Version': this.protocolVersion } : {}),
    }
  }

  async initialize(): Promise<RpcOutcome> {
    const out = await this.request('initialize', initializeParams())
    this.rpcResponse = out.http
    this.sessionId = out.http.headers.get('mcp-session-id') ?? undefined
    const version = out.result?.protocolVersion
    if (typeof version === 'string') this.protocolVersion = version
    if (out.result) {
      await this.http.send(
        this.url,
        {
          method: 'POST',
          headers: this.wireHeaders(),
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        },
        { auth: this.auth },
      )
    }
    return out
  }

  async request(
    method: string,
    params?: Record<string, unknown>,
    opts?: RpcRequestOptions,
  ): Promise<RpcOutcome> {
    const id = nextRpcId()
    const http = await this.http.send(
      this.url,
      {
        method: 'POST',
        headers: { ...this.wireHeaders(), ...(opts?.headers ?? {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
      },
      { auth: this.auth, wantId: id },
    )
    const message = Array.isArray(http.json)
      ? http.json.find((m) => isResponseFor(m, id))
      : http.json
    return outcomeOf(http, message)
  }

  postRaw(body: string): Promise<HttpResult> {
    return this.http.send(
      this.url,
      { method: 'POST', headers: this.wireHeaders(), body },
      { auth: this.auth },
    )
  }

  /** DELETE the session — also after Cancel, so a cancelled scan leaves nothing open. */
  async close(): Promise<void> {
    if (!this.sessionId) return
    const headers = this.wireHeaders()
    this.sessionId = undefined
    await this.http
      .send(this.url, { method: 'DELETE', headers }, { auth: this.auth, detached: true })
      .catch(() => {})
  }
}

/** Legacy HTTP+SSE (2024-11-05): a GET event stream + POSTs to the `endpoint` it names. */
export class LegacySseSession implements RpcSession {
  readonly kind = 'sse' as const
  readonly era = 'legacy' as const
  protocolVersion?: string
  rpcResponse?: HttpResult
  private endpoint?: string
  private readonly abort = new AbortController()
  private readonly waiters = new Map<string, (msg: unknown) => void>()
  private endpointWaiter?: (url: string) => void
  private streamError?: string

  constructor(
    private readonly http: ScanHttp,
    private readonly url: string,
    private readonly headers: Record<string, string>,
    private readonly auth: boolean,
  ) {}

  private async open(): Promise<HttpResult> {
    const opened = await this.http.openStream(
      this.url,
      { method: 'GET', headers: { ...this.headers, Accept: 'text/event-stream' } },
      this.auth,
      this.abort.signal,
    )
    const res = opened.res
    const result: HttpResult = {
      headers: res?.headers ?? new Headers(),
      text: '',
      exchange: opened.exchange,
      ...(res ? { status: res.status } : {}),
      ...(opened.error ? { error: opened.error } : {}),
    }
    if (!res) return result
    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !contentType.includes('text/event-stream') || !res.body) {
      result.text = await res.text().catch(() => '')
      result.json = tryJson(result.text)
      if (opened.exchange.response) {
        opened.exchange.response.bodyPreview = previewOf(redactBodyText(result.text, contentType))
      }
      return result
    }
    if (opened.exchange.response) opened.exchange.response.bodyPreview = '(event stream)'
    void this.pump(res.body)
    return result
  }

  private async pump(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        const parsed = parseSseEvents(buffer + decoder.decode(value, { stream: true }))
        buffer = parsed.rest
        for (const ev of parsed.events) {
          if (ev.event === 'endpoint') {
            this.endpoint = new URL(ev.data.trim(), this.url).href
            this.endpointWaiter?.(this.endpoint)
          } else {
            const msg = tryJson(ev.data)
            if (isRecord(msg) && (typeof msg.id === 'string' || typeof msg.id === 'number')) {
              this.waiters.get(String(msg.id))?.(msg)
            }
          }
        }
      }
      this.streamError = 'The event stream ended'
    } catch (err) {
      this.streamError = errorMessage(err)
    } finally {
      await reader.cancel().catch(() => {})
      for (const resolve of this.waiters.values()) resolve(undefined)
      this.endpointWaiter?.('')
    }
  }

  private waitFor<T>(register: (resolve: (v: T) => void) => void): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), this.http.timeoutMs)
      const onAbort = (): void => resolve(undefined)
      this.http.signal.addEventListener('abort', onAbort, { once: true })
      register((v) => {
        clearTimeout(timer)
        this.http.signal.removeEventListener('abort', onAbort)
        resolve(v)
      })
    })
  }

  async initialize(): Promise<RpcOutcome> {
    const stream = await this.open()
    this.rpcResponse = stream
    if (stream.status === undefined || stream.status < 200 || stream.status >= 300) {
      return outcomeOf(stream, stream.json)
    }
    if (!this.endpoint) {
      await this.waitFor<string>((resolve) => {
        this.endpointWaiter = resolve
      })
    }
    if (!this.endpoint) {
      return { http: stream, error: this.streamError ?? 'The stream sent no `endpoint` event' }
    }
    const out = await this.request('initialize', initializeParams())
    const version = out.result?.protocolVersion
    if (typeof version === 'string') this.protocolVersion = version
    if (out.result) {
      await this.http.send(
        this.endpoint,
        {
          method: 'POST',
          headers: { ...this.headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        },
        { auth: this.auth },
      )
    }
    return out
  }

  async request(
    method: string,
    params?: Record<string, unknown>,
    opts?: RpcRequestOptions,
  ): Promise<RpcOutcome> {
    const endpoint = this.endpoint
    if (!endpoint) {
      return {
        http: { headers: new Headers(), text: '', exchange: {}, error: 'No session' },
        error: 'No session',
      }
    }
    const id = nextRpcId()
    const reply = this.waitFor<unknown>((resolve) => this.waiters.set(id, resolve))
    const post = await this.http.send(
      endpoint,
      {
        method: 'POST',
        headers: { ...this.headers, 'Content-Type': 'application/json', ...(opts?.headers ?? {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
      },
      { auth: this.auth },
    )
    if (post.status === undefined || post.status >= 300) {
      this.waiters.get(id)?.(undefined)
      this.waiters.delete(id)
      return outcomeOf(post, post.json)
    }
    const message = await reply
    this.waiters.delete(id)
    if (message !== undefined && post.exchange.response) {
      post.exchange.response.bodyPreview = previewOf(
        redactBodyText(`(via event stream) ${JSON.stringify(message)}`, 'application/json'),
      )
    }
    if (message === undefined) {
      return { http: post, error: this.streamError ?? 'No response on the event stream in time' }
    }
    return outcomeOf(post, message)
  }

  async postRaw(body: string): Promise<HttpResult | undefined> {
    if (!this.endpoint) return undefined
    return this.http.send(
      this.endpoint,
      { method: 'POST', headers: { ...this.headers, 'Content-Type': 'application/json' }, body },
      { auth: this.auth },
    )
  }

  async close(): Promise<void> {
    this.abort.abort()
  }
}

// ─── 2026-07-28 (stateless) ─────────────────────────────────

/** Body field the `Mcp-Name` header mirrors, per method (the SDK's `MCP_NAME_HEADER_SOURCE`). */
const MCP_NAME_SOURCE: Readonly<Record<string, string>> = {
  'tools/call': 'name',
  'prompts/get': 'name',
  'resources/read': 'uri',
  'tasks/get': 'taskId',
  'tasks/update': 'taskId',
  'tasks/cancel': 'taskId',
}

/** HTTP field value per the spec's value encoding: plain ASCII as-is, else `=?base64?…?=`. */
export function encodeMcpHeaderValue(value: string): string {
  const safe =
    value.length > 0 &&
    value === value.trim() &&
    !(value.startsWith('=?base64?') && value.endsWith('?=')) &&
    [...value].every((c) => {
      const code = c.codePointAt(0) ?? 0
      return code === 9 || (code >= 32 && code <= 126)
    })
  return safe ? value : `=?base64?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

/** The per-request `_meta` envelope of a 2026-07-28 request. */
export function modernEnvelope(
  capabilities: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    [META_PROTOCOL_VERSION]: MODERN_PROTOCOL_VERSION,
    [META_CLIENT_INFO]: CLIENT_INFO,
    [META_CLIENT_CAPABILITIES]: capabilities,
  }
}

/** `Mcp-Method` / `Mcp-Name` / `MCP-Protocol-Version` for one 2026-07-28 request. */
export function modernRequestHeaders(
  method: string,
  params?: Record<string, unknown>,
): Record<string, string> {
  const field = Object.hasOwn(MCP_NAME_SOURCE, method) ? MCP_NAME_SOURCE[method] : undefined
  const name = field && params && typeof params[field] === 'string' ? params[field] : undefined
  return {
    'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
    'Mcp-Method': method,
    ...(typeof name === 'string' ? { 'Mcp-Name': encodeMcpHeaderValue(name) } : {}),
  }
}

/**
 * The stateless 2026-07-28 protocol over Streamable HTTP: no `initialize`, no
 * session id — every request is a self-contained POST carrying the `_meta`
 * envelope (protocol version, client info, client capabilities) and the
 * `Mcp-Method` / `Mcp-Name` headers. `initialize()` is the `server/discover`
 * handshake.
 */
export class ModernSession implements RpcSession {
  readonly kind = 'http' as const
  readonly era = 'modern' as const
  protocolVersion = MODERN_PROTOCOL_VERSION
  rpcResponse?: HttpResult
  /** `supportedVersions` of the discover result. */
  supportedVersions: string[] = []

  constructor(
    private readonly http: ScanHttp,
    private readonly url: string,
    private readonly headers: Record<string, string>,
    private readonly auth: boolean,
  ) {}

  private baseHeaders(): Record<string, string> {
    return {
      ...this.headers,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
  }

  async initialize(): Promise<RpcOutcome> {
    const out = await this.request('server/discover')
    this.rpcResponse = out.http
    const versions = out.result?.supportedVersions
    if (Array.isArray(versions)) {
      this.supportedVersions = versions.filter((v): v is string => typeof v === 'string')
    }
    return out
  }

  async request(
    method: string,
    params?: Record<string, unknown>,
    opts?: RpcRequestOptions,
  ): Promise<RpcOutcome> {
    const id = nextRpcId()
    const meta = isRecord(params?._meta) ? params._meta : {}
    const body = {
      jsonrpc: '2.0',
      id,
      method,
      params: { ...(params ?? {}), _meta: { ...modernEnvelope(opts?.capabilities), ...meta } },
    }
    const http = await this.http.send(
      this.url,
      {
        method: 'POST',
        headers: {
          ...this.baseHeaders(),
          ...modernRequestHeaders(method, params),
          ...(opts?.headers ?? {}),
        },
        body: JSON.stringify(body),
      },
      { auth: this.auth, wantId: id },
    )
    const message = Array.isArray(http.json)
      ? http.json.find((m) => isResponseFor(m, id))
      : http.json
    return outcomeOf(http, message)
  }

  postRaw(body: string): Promise<HttpResult> {
    return this.http.send(
      this.url,
      {
        method: 'POST',
        headers: { ...this.baseHeaders(), 'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION },
        body,
      },
      { auth: this.auth },
    )
  }

  /** Stateless: nothing to close. */
  async close(): Promise<void> {}
}
