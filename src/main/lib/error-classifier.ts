/**
 * Shared transport-layer error classifier.
 *
 * Goal: turn the cryptic shapes thrown by axios / `ws` / `eventsource` /
 * `@grpc/grpc-js` / `fetch` into a single human-readable message + structured
 * fields the UI can surface (status badge, hint banner, gRPC code lookup).
 *
 * Each engine catches → calls `classifyTransportError(err)` → attaches the
 * resulting message to its `ApiResponse.error` (or pushes it onto the
 * renderer event payload). UI components render the message verbatim and can
 * additionally highlight `httpStatus` / `code` / `grpcStatus` when present.
 *
 * Issue #253: the realtime engines (WebSocket, Socket.IO, SSE, MCP, MQTT)
 * pass a context (`{url, protocol, transport}`) and get the ONE connection
 * error format — `kind` + `target` (host:port) + a next-step `hint` — that the
 * renderer re-renders in the active locale (`src/shared/connection-error.ts`).
 * They reject with `ConnectionError` (`toConnectionError`), and the IPC
 * handlers return its `info` as `errorInfo` (`connectFailure`).
 */
import {
  CONNECTION_ERROR_TEXT_EN,
  composeConnectionMessage,
  connectionHintEn,
  joinConnectionHint,
  type ConnectionErrorInfo,
  type ConnectionErrorKind,
} from '../../shared/connection-error'
import { isCredentialArgName, isCredentialHeaderName } from '../../shared/credential-headers'

export type { ConnectionErrorInfo, ConnectionErrorKind } from '../../shared/connection-error'

export interface ClassifiedError {
  /** Single-line user-facing message (already includes any prefix/hint). */
  message: string
  /** Optional human-readable hint about the likely fix. */
  hint?: string
  /** HTTP status code when the failure carried one (axios response, fetch handshake). */
  httpStatus?: number
  /** Node.js / libuv error code when the failure was a transport error. */
  code?: string
  /** gRPC status code when the failure was a gRPC-layer error. */
  grpcStatus?: number
}

// ─── HTTP status hints ──────────────────────────────────────

const HTTP_STATUS_HINTS: Record<number, string> = {
  400: 'Bad Request — check headers / query params / body',
  401: 'Unauthorized — check Authorization header / token',
  403: 'Forbidden — credentials lack access to this resource',
  404: 'Not Found — check the URL',
  405: 'Method Not Allowed — server does not expose this method here',
  408: 'Request Timeout',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type — check Content-Type',
  422: 'Unprocessable Entity — request body validation failed',
  429: 'Too Many Requests — rate limited',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}

export function hintForHttpStatus(status: number): string | undefined {
  return HTTP_STATUS_HINTS[status]
}

// ─── gRPC status code hints ─────────────────────────────────

const GRPC_STATUS_HINTS: Record<number, { name: string; hint: string }> = {
  0: { name: 'OK', hint: 'Success' },
  1: { name: 'CANCELLED', hint: 'Operation was cancelled by the caller' },
  2: { name: 'UNKNOWN', hint: 'Unknown server-side error' },
  3: { name: 'INVALID_ARGUMENT', hint: 'Request payload is malformed for this method' },
  4: { name: 'DEADLINE_EXCEEDED', hint: 'Server did not respond before the deadline' },
  5: { name: 'NOT_FOUND', hint: 'The requested resource was not found' },
  6: { name: 'ALREADY_EXISTS', hint: 'The resource already exists' },
  7: { name: 'PERMISSION_DENIED', hint: 'Caller is not authorized for this operation' },
  8: { name: 'RESOURCE_EXHAUSTED', hint: 'Server resource limit hit (rate-limit / quota)' },
  9: { name: 'FAILED_PRECONDITION', hint: 'System is not in a state required for the operation' },
  10: { name: 'ABORTED', hint: 'Operation was aborted (concurrency / transaction)' },
  11: { name: 'OUT_OF_RANGE', hint: 'Operation attempted past the valid range' },
  12: { name: 'UNIMPLEMENTED', hint: 'Method is not implemented on the server' },
  13: { name: 'INTERNAL', hint: 'Internal server error' },
  14: { name: 'UNAVAILABLE', hint: 'Service is unavailable — server may be down or unreachable' },
  15: { name: 'DATA_LOSS', hint: 'Unrecoverable data loss or corruption' },
  16: { name: 'UNAUTHENTICATED', hint: 'Caller is missing valid authentication credentials' },
}

export function describeGrpcStatus(code: number, details?: string): ClassifiedError {
  const entry = GRPC_STATUS_HINTS[code]
  const name = entry?.name ?? `CODE_${code}`
  const hint = entry?.hint
  const tail = details && details.trim() ? ` — ${details.trim()}` : ''
  return {
    message: `gRPC ${code} ${name}${tail}`,
    hint,
    grpcStatus: code,
  }
}

// ─── Connection error classifier (issue #253) ───────────────

/**
 * Who is asking — fills `target` from the URL and enables protocol rules.
 * `http` / `graphql` / `soap` are sends: their `timeout` hint names the
 * request timeout, not the connect timeout (issue #309).
 */
export interface ConnectionErrorContext {
  url?: string
  protocol?: 'websocket' | 'socketio' | 'sse' | 'mcp' | 'mqtt' | 'http' | 'graphql' | 'soap'
  transport?: 'stdio' | 'http' | 'sse'
}

/** An engine's connect failure: `message` = `formatConnectionError(info)`. */
export class ConnectionError extends Error {
  readonly info: ConnectionErrorInfo
  constructor(info: ConnectionErrorInfo) {
    super(formatConnectionError(info))
    this.info = info
  }
}

/** `message. hint` — the English one-liner every engine / handler / event carries. */
export function formatConnectionError(info: ConnectionErrorInfo): string {
  return joinConnectionHint(info.message, info.hint)
}

export function getConnectionErrorInfo(err: unknown): ConnectionErrorInfo | undefined {
  return err instanceof ConnectionError ? err.info : undefined
}

/**
 * Wrap `err` as a `ConnectionError`. Idempotent; keeps the original's
 * `status` / `code` / `name` / `data` (the MCP OAuth offer and the auto →
 * legacy retry key on `status === 401` / `code === 401` / `UnauthorizedError`).
 * The original is NOT kept as `cause`: its text may hold the raw URL
 * (userinfo / query token), and `util.inspect` would print it.
 */
export function toConnectionError(
  err: unknown,
  ctx?: ConnectionErrorContext,
  /** An engine's own explanation that replaces the classified `detail` (scrubbed too). */
  extra?: { detail?: string },
): ConnectionError {
  if (err instanceof ConnectionError) return err
  let info = classifyTransportError(err, ctx)
  const extraDetail = extra?.detail ? scrubConnectionText(extra.detail, ctx?.url) : ''
  if (extraDetail) {
    const base = { ...info, detail: extraDetail }
    info = {
      ...base,
      message: composeConnectionMessage(base, CONNECTION_ERROR_TEXT_EN[info.kind].what),
    }
  }
  const wrapped = new ConnectionError(info)
  if (err && typeof err === 'object') {
    const o = err as { status?: unknown; code?: unknown; name?: unknown; data?: unknown }
    const target = wrapped as unknown as Record<string, unknown>
    if (o.status !== undefined) target.status = o.status
    if (o.code !== undefined) target.code = o.code
    if (o.data !== undefined) target.data = o.data
    if (typeof o.name === 'string' && o.name && o.name !== 'Error') wrapped.name = o.name
  }
  return wrapped
}

/**
 * An engine's own handshake timer fired: kind `timeout` + host:port, and the
 * engine's sentence (it names the configured value) kept as `detail`.
 */
export function connectTimeoutError(text: string, ctx?: ConnectionErrorContext): ConnectionError {
  return toConnectionError(Object.assign(new Error(text), { code: 'ETIMEDOUT' }), ctx, {
    detail: text,
  })
}

/** IPC failure shape of a `*:connect` handler: `errorInfo` only for a classified connect error. */
export function connectFailure(err: unknown): {
  success: false
  error: string
  errorInfo?: ConnectionErrorInfo
} {
  const info = getConnectionErrorInfo(err)
  const error = err instanceof Error ? err.message : String(err)
  return info ? { success: false, error, errorInfo: info } : { success: false, error }
}

// ─── Facets: what an error (and its wrapped causes) says ────

interface Facets {
  /** Every string code on the chain (libuv / undici / SDK). */
  codes: string[]
  /** Every message on the chain, outermost first. */
  messages: string[]
  /** `address` / `port` of the innermost socket error that has them. */
  address?: string
  port?: number
  hostname?: string
  /** URL socket.io reports for the failed transport (`description.target._url`). */
  transportUrl?: string
  names: string[]
  syscall?: string
  path?: string
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object'
}

/**
 * Walk the error and what it wraps: undici `cause` (`TypeError: fetch failed`),
 * socket.io-client `description` / `description.error`, a happy-eyeballs
 * `AggregateError.errors[0]`. Bounded; cycles are skipped.
 */
function collectFacets(err: unknown): Facets {
  const f: Facets = { codes: [], messages: [], names: [] }
  const seen = new Set<unknown>()
  const queue: unknown[] = [err]
  while (queue.length > 0 && seen.size < 12) {
    const cur = queue.shift()
    if (cur === undefined || cur === null || seen.has(cur)) continue
    seen.add(cur)
    if (typeof cur === 'string') {
      if (cur.trim()) f.messages.push(cur.trim())
      continue
    }
    if (!isRecord(cur)) continue
    if (typeof cur.message === 'string' && cur.message.trim()) f.messages.push(cur.message.trim())
    if (typeof cur.code === 'string' && cur.code) f.codes.push(cur.code)
    if (typeof cur.name === 'string') f.names.push(cur.name)
    if (typeof cur.address === 'string' && typeof cur.port === 'number' && !f.address) {
      f.address = cur.address
      f.port = cur.port
    }
    if (typeof cur.hostname === 'string' && !f.hostname) f.hostname = cur.hostname
    if (typeof cur.syscall === 'string' && !f.syscall) f.syscall = cur.syscall
    if (typeof cur.path === 'string' && !f.path) f.path = cur.path
    const target = cur.target
    if (isRecord(target) && typeof target._url === 'string' && !f.transportUrl) {
      f.transportUrl = target._url
    }
    queue.push(cur.cause, cur.description, cur.error)
    if (Array.isArray(cur.errors)) queue.push(cur.errors[0])
  }
  return f
}

// ─── Target (host:port) ─────────────────────────────────────

const DEFAULT_PORTS: Record<string, number> = {
  'ws:': 80,
  'http:': 80,
  'wss:': 443,
  'https:': 443,
  'mqtt:': 1883,
  'tcp:': 1883,
  'mqtts:': 8883,
  'ssl:': 8883,
  'tls:': 8883,
  'wxs:': 443,
}

function hostPort(host: string, port: number | string | undefined): string {
  const bare = host.replace(/^\[|\]$/g, '')
  const h = bare.includes(':') ? `[${bare}]` : bare
  return port === undefined || port === '' ? h : `${h}:${port}`
}

/** URL → `host:port` (scheme default port filled in); never userinfo / path / query. */
function targetOfUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const u = new URL(raw)
    if (!u.hostname) return undefined
    const port = u.port || DEFAULT_PORTS[u.protocol]
    return hostPort(u.hostname, port)
  } catch {
    return undefined
  }
}

const SOCKET_TARGET =
  /\b(?:ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNRESET)\s+(\[?[0-9a-fA-F:.]+\]?):(\d{1,5})\b/

function targetOf(f: Facets, ctx: ConnectionErrorContext | undefined): string | undefined {
  if (ctx?.transport === 'stdio') return undefined
  const fromUrl = targetOfUrl(ctx?.url)
  if (fromUrl) return fromUrl
  if (f.address && f.port !== undefined) return hostPort(f.address, f.port)
  const fromTransport = targetOfUrl(f.transportUrl)
  if (fromTransport) return fromTransport
  for (const m of f.messages) {
    const hit = m.match(SOCKET_TARGET)
    if (hit) return hostPort(hit[1], hit[2])
  }
  if (f.hostname) return hostPort(f.hostname, undefined)
  for (const m of f.messages) {
    const hit = m.match(/\b(?:ENOTFOUND|EAI_AGAIN)\s+([A-Za-z0-9.-]+)/)
    if (hit) return hit[1]
  }
  return undefined
}

// ─── Credential scrub ───────────────────────────────────────

const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"<>()]+/gi

/**
 * Remove credentials from server / SDK text: URL userinfo and URL query /
 * fragment (`?token=…`), plus any literal userinfo or credential-named query value of the
 * connection URL. Bare origins are left untouched.
 */
export function scrubConnectionText(text: string, ctxUrl: string | undefined): string {
  let out = text.replace(URL_IN_TEXT, (m) =>
    m.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, '$1').replace(/[?#].*$/, ''),
  )
  if (ctxUrl) {
    try {
      const u = new URL(ctxUrl)
      const queryCredentials = [...u.searchParams.entries()]
        // Query names are ARGUMENTS: the shared argument rule (whole words —
        // `sig`, `api_key`, `access_token`) is the one History / Console use
        // for query fields. The broader header rule stays as a superset so no
        // value this scrub already removed can start leaking.
        .filter(([name]) => isCredentialArgName(name) || isCredentialHeaderName(name))
        .map(([, value]) => value)
      const secrets = [u.username, u.password, ...queryCredentials]
        .flatMap((v) => {
          if (!v) return []
          let decoded = v
          try {
            decoded = decodeURIComponent(v)
          } catch {
            /* keep raw */
          }
          return decoded === v ? [v] : [v, decoded]
        })
        .filter((v) => v.length >= 3)
      for (const s of secrets) out = out.split(s).join('••••••')
    } catch {
      /* not a URL — nothing more to remove */
    }
  }
  return out.trim()
}

// ─── Kind rules ─────────────────────────────────────────────

const SELF_SIGNED =
  /DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT/i

interface KindHit {
  kind: ConnectionErrorKind
  detail?: string
}

/** Transport kinds from codes first, then from the message text. */
function transportKind(f: Facets): KindHit | undefined {
  const codes = f.codes.join(' ')
  const text = f.messages.join(' | ')
  const all = `${codes} ${text}`
  if (/\bbad port\b/i.test(text)) return { kind: 'bad-port' }
  if (/ECONNREFUSED/i.test(all)) return { kind: 'refused' }
  if (/ENOTFOUND|EAI_AGAIN|EAI_NONAME/i.test(all)) return { kind: 'dns' }
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|timeout of \d+ms exceeded/i.test(all)) {
    return { kind: 'timeout' }
  }
  if (/EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ENETDOWN/i.test(all)) return { kind: 'unreachable' }
  if (/ECONNRESET|EPIPE|socket hang up|UND_ERR_SOCKET/i.test(all)) return { kind: 'reset' }
  if (/CERT_HAS_EXPIRED|certificate has expired/i.test(all)) return { kind: 'tls-expired' }
  if (SELF_SIGNED.test(codes) || /self[- ]signed certificate/i.test(text)) {
    return { kind: 'tls-untrusted' }
  }
  if (/ERR_TLS_CERT_ALTNAME_INVALID|does not match certificate's altnames/i.test(all)) {
    return { kind: 'tls-hostname' }
  }
  if (/CERT|TLS|SSL/i.test(codes) || /\b(?:SSL|TLS)\b|certificate/i.test(text)) {
    return { kind: 'tls', detail: f.messages[f.messages.length - 1] }
  }
  if (/ERR_INVALID_URL|\bInvalid URL\b/i.test(all)) return { kind: 'invalid-url' }
  if (f.names.includes('AbortError') || /ABORT_ERR|\baborted\b/i.test(all)) {
    return { kind: 'aborted' }
  }
  return undefined
}

function statusKind(status: number): ConnectionErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 404) return 'not-found'
  return 'http-status'
}

const isHttpStatus = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 100 && n <= 599

/** HTTP status of a failed handshake, in any shape the libraries use. */
function httpStatusOf(
  err: unknown,
  f: Facets,
  ctx: ConnectionErrorContext | undefined,
): number | undefined {
  if (isRecord(err)) {
    const response = err.response
    if (isRecord(response) && isHttpStatus(response.status)) return response.status
    if (isHttpStatus(err.status)) return err.status
    // eventsource ErrorEvent / MCP v1 SseError: the status as a numeric `code`.
    // MQTT's numeric code is a CONNACK reason, never an HTTP status.
    if (ctx?.protocol !== 'mqtt' && isHttpStatus(err.code)) return err.code
  }
  for (const m of f.messages) {
    const hit =
      m.match(/Unexpected server response:\s*(\d{3})/i) ??
      m.match(/Non-200 status code \((\d{3})\)/i) ??
      m.match(/\(HTTP (\d{3})\)/)
    if (hit) return Number(hit[1])
  }
  return undefined
}

/** Server / SDK text worth keeping next to an `http-status` (not the bare status line). */
function statusDetail(err: unknown, f: Facets, status: number): string | undefined {
  if (isRecord(err) && isRecord(err.response) && typeof err.response.statusText === 'string') {
    return err.response.statusText.trim() || undefined
  }
  const m = f.messages[0]
  if (!m) return undefined
  if (/^Unexpected server response:\s*\d{3}$/i.test(m)) return undefined
  if (new RegExp(`^(?:HTTP\\s*)?${status}$`).test(m.trim())) return undefined
  return m
}

/** MQTT.js CONNACK refusal: 4 / 5 (3.1.1) and 134 / 135 (v5) are auth failures. */
function mqttKind(err: unknown, f: Facets): KindHit | undefined {
  const code = isRecord(err) ? err.code : undefined
  const text = f.messages[0] ?? ''
  const detail = text.replace(/^Connection refused:\s*/i, '') || undefined
  // The broker's reason stays as detail: "Bad username or password" and
  // "Not authorized" ask for different fixes.
  if (typeof code === 'number') {
    if (code === 4 || code === 5 || code === 134 || code === 135) {
      return { kind: 'unauthorized', detail }
    }
    if (code > 0) return { kind: 'rejected', detail }
  }
  if (/bad user ?name or password|not authori[sz]ed/i.test(text)) {
    return { kind: 'unauthorized', detail }
  }
  return undefined
}

/** socket.io-client: a middleware `next(new Error(…))` arrives with `.data` and no transport `type`. */
function isSocketIoRejection(err: unknown): boolean {
  if (!isRecord(err) || !('data' in err)) return false
  return err.type !== 'TransportError' && err.description === undefined
}

function spawnCommand(f: Facets): string | undefined {
  for (const m of f.messages) {
    const hit = m.match(/^spawn\s+(.+?)\s+(?:ENOENT|EACCES|EPERM|ENOTDIR)\b/)
    if (hit) return hit[1]
  }
  if (f.syscall?.startsWith('spawn')) return f.path ?? f.syscall.replace(/^spawn\s*/, '')
  return undefined
}

function classifyKind(
  err: unknown,
  f: Facets,
  ctx: ConnectionErrorContext | undefined,
): KindHit & { httpStatus?: number } {
  if (ctx?.protocol === 'mqtt') {
    const hit = mqttKind(err, f)
    if (hit) return hit
    // MQTT.js: TCP accepted but no CONNACK within `connectTimeout`.
    if (/^connack timeout$/i.test(f.messages[0] ?? '')) return { kind: 'timeout' }
  }
  const command = spawnCommand(f)
  if (command) return { kind: 'spawn-failed', detail: command }

  const status = httpStatusOf(err, f, ctx)
  if (status !== undefined) {
    const kind = statusKind(status)
    return {
      kind,
      httpStatus: status,
      ...(kind === 'http-status' ? { detail: statusDetail(err, f, status) } : {}),
    }
  }
  if (ctx?.protocol === 'socketio' && isSocketIoRejection(err)) {
    return { kind: 'rejected', detail: f.messages[0] }
  }
  const transport = transportKind(f)
  if (transport) return transport
  const text = f.messages.join(' | ')
  if (/\bconnection closed\b/i.test(text)) return { kind: 'closed' }
  if (/\bconnection refused\b/i.test(text)) return { kind: 'refused' }
  // socket.io-client transport errors whose cause carried no code (XHR status 0, …).
  if (
    /^(?:xhr poll error|xhr post error|websocket error|transport error)$/i.test(f.messages[0] ?? '')
  ) {
    return { kind: 'unreachable' }
  }
  if (ctx?.protocol === 'socketio' && /^timeout$/i.test(f.messages[0] ?? '')) {
    return { kind: 'timeout' }
  }
  return { kind: 'unknown', detail: f.messages[0] ?? f.codes[0] }
}

/**
 * Classify any engine / library error. Accepts axios errors, plain `Error`s,
 * strings, `eventsource@3` `ErrorEvent`s, socket.io-client `connect_error`s,
 * MCP SDK errors and MQTT.js CONNACK errors. `message` is the English
 * one-liner without the hint; `formatConnectionError` adds it.
 */
export function classifyTransportError(
  err: unknown,
  ctx?: ConnectionErrorContext,
): ConnectionErrorInfo {
  if (err instanceof ConnectionError) return err.info
  if (err === null || err === undefined) {
    return { kind: 'unknown', detail: 'Unknown error', message: 'Unknown error' }
  }
  const f = collectFacets(err)
  const hit = classifyKind(err, f, ctx)
  const target = targetOf(f, ctx)
  const detail = hit.detail ? scrubConnectionText(hit.detail, ctx?.url) || undefined : undefined
  const text = CONNECTION_ERROR_TEXT_EN[hit.kind]
  const hint = connectionHintEn(hit.kind, ctx?.protocol)
  const code = f.codes[0]
  const base = {
    kind: hit.kind,
    ...(target ? { target } : {}),
    ...(hit.httpStatus !== undefined ? { httpStatus: hit.httpStatus } : {}),
    ...(detail ? { detail } : {}),
  }
  return {
    ...base,
    ...(code ? { code } : {}),
    message: composeConnectionMessage(base, text.what),
    ...(hint ? { hint } : {}),
  }
}
