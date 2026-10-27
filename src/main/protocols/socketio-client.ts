import { io, type Socket } from 'socket.io-client'
import type { SioSettings } from '../../shared/realtime'

/**
 * The Socket.IO client the engine drives, the same shape for every protocol
 * version (issue #283). `createSioClient` is the ONE place that knows the
 * difference between the clients:
 *
 *   - `'3'` and `'4'` → socket.io-client 4. A v4 client talks to v3 and v4
 *     servers (same protocol, EIO=4) — https://socket.io/docs/v4/client-installation/.
 *   - `'2'` → socket.io-client 2.5 (npm alias `socket.io-client-v2`, loaded
 *     only when a v2 request connects). A v3/v4 client cannot reach a v2
 *     server (EIO=3) — https://socket.io/docs/v4/migrating-from-2-x-to-3-0/.
 *
 * v2 has no handshake `auth` packet: the auth entries (the editor's bearer
 * token → `token`) go into the handshake QUERY, where v2 servers read them
 * (`socket.handshake.query.token`). A query parameter can end up in server and
 * proxy access logs — the Settings hint says so.
 */
export interface SioClient {
  readonly connected: boolean
  /** After a disconnect: will the client reconnect by itself? */
  readonly willReconnect: boolean
  onceConnect(cb: () => void): void
  /** The handshake failed: transport error, timeout, or the server's middleware refused it. */
  onceConnectError(cb: (message: string) => void): void
  onDisconnect(cb: (reason: string) => void): void
  /** Every received event, with its arguments (a trailing server-ack callback may be among them). */
  onAny(cb: (event: string, args: unknown[]) => void): void
  onReconnectAttempt(cb: (attempt: number) => void): void
  onReconnect(cb: (attempt: number) => void): void
  onReconnectFailed(cb: () => void): void
  emit(event: string, args: unknown[]): void
  /** `cb(err)` with v4's own text when no ack arrived within `timeoutMs`. */
  emitWithAck(
    event: string,
    args: unknown[],
    timeoutMs: number,
    cb: (err: Error | null, response: unknown[]) => void,
  ): void
  disconnect(): void
}

export interface SioClientOptions {
  url: string
  namespace: string
  auth?: Record<string, unknown>
  extraHeaders?: Record<string, string>
  settings: SioSettings
}

/** v4's message when an ack does not arrive in time; v2 reports the same. */
export const SIO_ACK_TIMEOUT_MESSAGE = 'operation has timed out'

/**
 * Connection URL + namespace → what the clients take: the URL without its
 * query and with the namespace appended to the PATH (`http://h/chat`), and the
 * query apart. Appending the namespace to the whole string put it inside the
 * query (`http://h?x=1/chat`) as soon as the URL had Params.
 */
export function sioTarget(
  url: string,
  namespace: string,
): { url: string; search: string; query: Record<string, string> } {
  const noHash = url.split('#')[0]
  const q = noHash.indexOf('?')
  const base = (q < 0 ? noHash : noHash.slice(0, q)).replace(/\/$/, '')
  const search = q < 0 ? '' : noHash.slice(q + 1)
  const ns = namespace || '/'
  return {
    url: base + (ns === '/' ? '' : ns.startsWith('/') ? ns : `/${ns}`),
    search,
    query: Object.fromEntries(new URLSearchParams(search)),
  }
}

/**
 * The target as History and the Console show it (issue #283): exactly what
 * the client connects to — namespace on the path, then the query.
 */
export function sioDisplayTarget(url: string, namespace: string | undefined): string {
  const t = sioTarget(url, namespace ?? '/')
  return t.url + (t.search ? `?${t.search}` : '')
}

function transportsOf(s: SioSettings): Array<'websocket' | 'polling'> {
  if (s.transport === 'websocket') return ['websocket']
  if (s.transport === 'polling') return ['polling']
  return ['websocket', 'polling']
}

/** Options both clients read the same way. */
function commonOptions(s: SioSettings): Record<string, unknown> {
  const reconnect = s.retryCount > 0
  return {
    path: s.path,
    // One Manager per request: two requests to the same server never share
    // a transport (and its headers / TLS options).
    forceNew: true,
    reconnection: reconnect,
    reconnectionAttempts: s.retryCount,
    reconnectionDelay: s.retryDelay,
    reconnectionDelayMax: Math.max(s.retryDelay, 1),
    randomizationFactor: 0,
    timeout: s.handshakeTimeout,
    transports: transportsOf(s),
    rejectUnauthorized: s.strictSSL,
  }
}

export function createSioClient(opts: SioClientOptions): SioClient {
  return opts.settings.version === '2' ? createV2Client(opts) : createV4Client(opts)
}

// ─── v3 / v4: socket.io-client 4 ─────────────────────────────────────────

function createV4Client(opts: SioClientOptions): SioClient {
  const target = sioTarget(opts.url, opts.namespace)
  const socket: Socket = io(target.url + (target.search ? `?${target.search}` : ''), {
    ...commonOptions(opts.settings),
    auth: opts.auth,
    extraHeaders: opts.extraHeaders,
  })
  return {
    get connected() {
      return socket.connected
    },
    get willReconnect() {
      return socket.active
    },
    onceConnect: (cb) => void socket.once('connect', cb),
    onceConnectError: (cb) => void socket.once('connect_error', (err) => cb(err.message)),
    onDisconnect: (cb) => void socket.on('disconnect', (reason) => cb(reason)),
    onAny: (cb) => void socket.onAny((event: string, ...args: unknown[]) => cb(event, args)),
    onReconnectAttempt: (cb) => void socket.io.on('reconnect_attempt', cb),
    onReconnect: (cb) => void socket.io.on('reconnect', cb),
    onReconnectFailed: (cb) => void socket.io.on('reconnect_failed', cb),
    emit: (event, args) => void socket.emit(event, ...args),
    emitWithAck: (event, args, timeoutMs, cb) =>
      void socket
        .timeout(timeoutMs)
        .emit(event, ...args, (err: Error | null, ...response: unknown[]) => cb(err, response)),
    disconnect: () => void socket.disconnect(),
  }
}

// ─── v2: socket.io-client 2.5 ────────────────────────────────────────────

/** The part of socket.io-client 2.x this module uses (the package ships no types). */
interface V2Emitter {
  on(event: string, fn: (...args: unknown[]) => void): unknown
  once(event: string, fn: (...args: unknown[]) => void): unknown
}
interface V2Manager extends V2Emitter {
  reconnection(): boolean
  reconnectionDelay(v: number): unknown
  reconnectionDelayMax(v: number): unknown
  randomizationFactor(v: number): unknown
  skipReconnect?: boolean
}
interface V2Packet {
  data?: unknown[]
}
interface V2Socket extends V2Emitter {
  connected: boolean
  io: V2Manager
  /** Manager subscriptions; dropped when the socket is destroyed (kick / client disconnect). */
  subs?: unknown[] | null
  onevent: (this: V2Socket, packet: V2Packet) => void
  emit(event: string, ...args: unknown[]): unknown
  disconnect(): unknown
}
type V2Lookup = (uri: string, opts: Record<string, unknown>) => V2Socket

/** A v2 error payload: an `Error`, a string (`'timeout'`, a middleware's message) or an object. */
function v2ErrorMessage(data: unknown): string {
  if (typeof data === 'string' && data) return data
  if (data instanceof Error && data.message) return data.message
  if (data && typeof data === 'object') {
    const msg = (data as { message?: unknown }).message
    if (typeof msg === 'string' && msg) return msg
    try {
      return JSON.stringify(data)
    } catch {
      /* fall through */
    }
  }
  return 'Connection failed'
}

/** Auth entries → handshake query values (v2 has no auth packet). */
function authAsQuery(auth: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(auth ?? {})) {
    if (v === undefined || v === null) continue
    out[k] = typeof v === 'string' ? v : JSON.stringify(v)
  }
  return out
}

function createV2Client(opts: SioClientOptions): SioClient {
  // Loaded on the first v2 connect only: a CommonJS package, external to the
  // main bundle like every other dependency.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lookup = require('socket.io-client-v2') as V2Lookup
  const s = opts.settings
  const target = sioTarget(opts.url, opts.namespace)
  const headers = opts.extraHeaders ?? {}
  const socket = lookup(target.url, {
    ...commonOptions(s),
    // One query object: a `?…` on the URL would REPLACE this option inside
    // engine.io-client 3 and drop the token.
    query: { ...target.query, ...authAsQuery(opts.auth) },
    // Node's built-in WebSocket (Node ≥ 22) would otherwise be picked; it
    // takes neither the headers nor `rejectUnauthorized`.
    forceNode: true,
    transportOptions: {
      polling: { extraHeaders: headers },
      websocket: { extraHeaders: headers },
    },
  })
  // The 2.x Manager reads these with `||`: 0 became 1000 ms / a 0.5 jitter.
  socket.io.reconnectionDelay(s.retryDelay)
  socket.io.reconnectionDelayMax(Math.max(s.retryDelay, 1))
  socket.io.randomizationFactor(0)

  return {
    get connected() {
      return socket.connected
    },
    get willReconnect() {
      return !!socket.subs && socket.io.reconnection() && !socket.io.skipReconnect
    },
    onceConnect: (cb) => void socket.once('connect', () => cb()),
    onceConnectError: (cb) => {
      // A refused handshake arrives as `error` (the middleware's message), a
      // transport failure / timeout as `connect_error`.
      let fired = false
      const fire = (data: unknown): void => {
        if (fired || socket.connected) return
        fired = true
        cb(v2ErrorMessage(data))
      }
      socket.once('connect_error', fire)
      socket.once('error', fire)
    },
    onDisconnect: (cb) => void socket.on('disconnect', (reason) => cb(String(reason))),
    onAny: (cb) => {
      // 2.x has no `onAny`: every received event passes `onevent`.
      const original = socket.onevent
      socket.onevent = function (packet) {
        const data = Array.isArray(packet.data) ? packet.data : []
        cb(String(data[0]), data.slice(1))
        original.call(this, packet)
      }
    },
    onReconnectAttempt: (cb) => void socket.io.on('reconnect_attempt', (n) => cb(Number(n))),
    onReconnect: (cb) => void socket.io.on('reconnect', (n) => cb(Number(n))),
    onReconnectFailed: (cb) => void socket.io.on('reconnect_failed', () => cb()),
    emit: (event, args) => void socket.emit(event, ...args),
    emitWithAck: (event, args, timeoutMs, cb) => {
      // 2.x has no `.timeout()`.
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        cb(new Error(SIO_ACK_TIMEOUT_MESSAGE), [])
      }, timeoutMs)
      socket.emit(event, ...args, (...response: unknown[]) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cb(null, response)
      })
    },
    disconnect: () => void socket.disconnect(),
  }
}
