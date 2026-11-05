/**
 * The proxy setting → a CONNECT tunnel, for every connection that is not a plain
 * HTTP Send: GraphQL subscriptions, WebSocket, Socket.IO, MQTT and SSE.
 *
 *  - `resolveConnectionProxy`: `custom` with a host is that proxy, its `bypass` list
 *    applies and a SOCKS type is refused, as in HTTP Send. Anything else goes out
 *    directly: unlike HTTP Send, the environment is not read (see the function).
 *  - `ProxyTunnel`: its `agent` goes to `ws`, engine.io and mqtt.js; `openStream`
 *    is the same tunnel for mqtt.js over TCP, which takes no agent.
 *  - `openFetchTunnel`: the same for SSE, whose client takes a `fetch`.
 *
 * A socket waiting for the proxy's answer belongs to neither `ws` nor the HTTP
 * request: `ws.terminate()` cannot reach it. Whoever ends a connection also calls
 * `abort()`. It ends only what is still waiting, so it is safe on a live tunnel.
 *
 * Credentials go in a header, never in the proxy's URL, so `origin` can be logged
 * and named in an error.
 */
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { Duplex } from 'node:stream'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { ProxyAgent } from 'undici'
import type { ConnectionErrorContext } from './error-classifier'
import { SOCKS_PROXY_UNSUPPORTED, isProxyBypassed, isSocksProxy } from '../../shared/proxy-bypass'
import type { ProxySetting } from '../../shared/request-settings'

export interface ResolvedProxy {
  /** `http://host:port`, without credentials. */
  origin: string
  auth?: { username: string; password: string }
}

function parsedProxyUrl(address: string): URL {
  try {
    return new URL(address)
  } catch {
    throw new Error('The proxy address is not a valid URL')
  }
}

/**
 * The proxy for a connection to `targetUrl`; `null` when it goes out directly. Only
 * a custom proxy counts, and its bypass list applies. Environment variables are deliberately not read, unlike HTTP Send:
 * these connections have always ignored them, and an internal host missing from
 * `NO_PROXY` would stop working on upgrade.
 * Throws on an address that is no URL, like HTTP Send: going out directly instead
 * would quietly skip a proxy someone relies on.
 */
export function resolveConnectionProxy(
  setting: ProxySetting | null | undefined,
  targetUrl: string,
): ResolvedProxy | null {
  if (setting?.mode !== 'custom' || !setting.host) return null
  if (isProxyBypassed(setting.bypass, targetUrl)) return null
  if (isSocksProxy(setting)) throw new Error(SOCKS_PROXY_UNSUPPORTED)
  const host = setting.host.includes(':') ? `[${setting.host}]` : setting.host
  const { username = '', password = '' } = setting.auth ?? {}
  return {
    origin: parsedProxyUrl(`http://${host}:${setting.port ?? 8080}`).origin,
    ...(username || password ? { auth: { username, password } } : {}),
  }
}

function proxyAuthorization(proxy: ResolvedProxy): string | undefined {
  if (!proxy.auth) return undefined
  const { username, password } = proxy.auth
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf-8').toString('base64')}`
}

/** A connection's context for an error the proxy caused. */
function proxyContext(
  proxy: ResolvedProxy,
  ctx: ConnectionErrorContext,
  status: number | undefined,
): ConnectionErrorContext {
  return {
    ...ctx,
    url: proxy.origin,
    viaProxy: true,
    ...(status !== undefined ? { proxyStatus: status } : {}),
  }
}

// ─── Agent and stream ────────────────────────────────────────────────────────

interface TunnelState {
  /** How to give up on each CONNECT still unanswered. */
  waiting: Set<() => void>
  /** The last CONNECT: `up` = the proxy said 200, what follows is the server's. */
  outcome: 'none' | 'up' | 'failed'
  status?: number
}

function noteAnswer(state: TunnelState, statusCode: number): void {
  state.outcome = statusCode === 200 ? 'up' : 'failed'
  state.status = statusCode === 200 ? undefined : statusCode
}

class TrackingProxyAgent extends HttpsProxyAgent<string> {
  constructor(
    origin: string,
    options: ConstructorParameters<typeof HttpsProxyAgent<string>>[1],
    private readonly state: TunnelState,
  ) {
    super(origin, options)
    this.on('proxyConnect', ({ statusCode }: { statusCode: number }) => {
      noteAnswer(state, statusCode)
    })
  }

  async connect(
    req: http.ClientRequest,
    opts: Parameters<HttpsProxyAgent<string>['connect']>[1],
  ): Promise<net.Socket> {
    const controller = new AbortController()
    const giveUp = (): void => controller.abort()
    // `super.connect` reads this synchronously, before its first await.
    this.connectOpts.signal = controller.signal
    this.state.waiting.add(giveUp)
    try {
      return await super.connect(req, opts)
    } catch (err) {
      this.state.outcome = 'failed'
      throw err
    } finally {
      this.state.waiting.delete(giveUp)
    }
  }
}

/** A socket the caller has now and the tunnel fills later (mqtt.js needs one at once). */
class TunnelStream extends Duplex {
  private inner?: Duplex
  private wantsData = false
  private waitingWrite?: () => void
  /** Run once when the stream is destroyed. */
  onDestroyed?: () => void

  constructor() {
    super({ autoDestroy: false })
  }

  attach(inner: Duplex): void {
    if (this.destroyed) {
      inner.destroy()
      return
    }
    this.inner = inner
    if (!this.wantsData) inner.pause()
    inner.on('data', (chunk: Buffer) => {
      this.wantsData = this.push(chunk)
      if (!this.wantsData) inner.pause()
    })
    inner.on('end', () => this.push(null))
    inner.on('error', (err) => this.destroy(err))
    inner.on('close', () => this.destroy())
    this.waitingWrite?.()
    this.waitingWrite = undefined
  }

  override _write(chunk: Buffer, encoding: BufferEncoding, cb: (e?: Error | null) => void): void {
    if (this.inner) {
      this.inner.write(chunk, encoding, cb)
      return
    }
    // One at a time: the stream holds the rest until `cb`.
    this.waitingWrite = () => this.inner?.write(chunk, encoding, cb)
  }

  override _read(): void {
    this.wantsData = true
    this.inner?.resume()
  }

  override _final(cb: (e?: Error | null) => void): void {
    this.inner?.end()
    cb()
  }

  override _destroy(err: Error | null, cb: (e?: Error | null) => void): void {
    this.onDestroyed?.()
    this.inner?.destroy()
    cb(err)
  }
}

export class ProxyTunnel {
  /** For `ws`, engine.io and mqtt.js over WebSocket. Reusable: each socket opens its own tunnel. */
  readonly agent: HttpsProxyAgent<string>
  private readonly state: TunnelState = { waiting: new Set(), outcome: 'none' }
  private readonly authorization?: string

  constructor(
    private readonly proxy: ResolvedProxy,
    private readonly options: { rejectUnauthorized?: boolean } = {},
  ) {
    this.authorization = proxyAuthorization(proxy)
    this.agent = new TrackingProxyAgent(
      proxy.origin,
      {
        // Only for TLS to an `https://` proxy. The same value the request carries,
        // since `http.Agent` lays its options over the request's. Certificates
        // stay on the request: they are for the server.
        rejectUnauthorized: options.rejectUnauthorized !== false,
        ...(this.authorization ? { headers: { 'Proxy-Authorization': this.authorization } } : {}),
      },
      this.state,
    )
  }

  /** Give up on every CONNECT still unanswered. A tunnel already up is left alone. */
  abort(): void {
    for (const giveUp of [...this.state.waiting]) giveUp()
  }

  /** The context to classify a failure with: the proxy's when the proxy is what failed. */
  errorContext(ctx: ConnectionErrorContext): ConnectionErrorContext {
    if (this.state.waiting.size === 0 && this.state.outcome === 'up') return ctx
    return proxyContext(this.proxy, ctx, this.state.status)
  }

  /**
   * A TCP connection to `host:port` through the proxy, usable at once: what is
   * written waits for the tunnel. With `tlsOptions`, TLS runs inside the tunnel.
   * Destroying the stream ends it at any stage.
   */
  openStream(host: string, port: number, tlsOptions?: tls.ConnectionOptions): Duplex {
    const stream = new TunnelStream()
    const target = `${net.isIPv6(host) ? `[${host}]` : host}:${port}`
    const secureProxy = this.proxy.origin.startsWith('https:')
    const { hostname, port: proxyPort } = new URL(this.proxy.origin)
    const req = (secureProxy ? https : http).request({
      host: hostname.replace(/^\[|\]$/g, ''),
      ...(proxyPort ? { port: Number(proxyPort) } : {}),
      method: 'CONNECT',
      path: target,
      agent: false,
      headers: {
        Host: target,
        ...(this.authorization ? { 'Proxy-Authorization': this.authorization } : {}),
      },
      ...(secureProxy ? { rejectUnauthorized: this.options.rejectUnauthorized !== false } : {}),
    })
    const giveUp = (): void => void req.destroy()
    this.state.waiting.add(giveUp)
    stream.onDestroyed = (): void => {
      this.state.waiting.delete(giveUp)
      if (!req.socket?.destroyed) req.destroy()
    }
    req.on('connect', (res, socket, head) => {
      this.state.waiting.delete(giveUp)
      const status = res.statusCode ?? 0
      noteAnswer(this.state, status)
      if (status !== 200) {
        socket.destroy()
        // mqtt.js reports only a stream error that has a code.
        stream.destroy(
          Object.assign(new Error(`The proxy answered ${status} to CONNECT`), {
            code: 'EPROXYCONNECT',
          }),
        )
        return
      }
      if (head.length > 0) socket.unshift(head)
      stream.attach(tlsOptions ? tls.connect({ ...tlsOptions, socket }) : socket)
    })
    req.on('error', (err) => {
      this.state.waiting.delete(giveUp)
      this.state.outcome = 'failed'
      stream.destroy(err)
    })
    req.end()
    return stream
  }
}

// ─── fetch ───────────────────────────────────────────────────────────────────

export interface FetchTunnel {
  fetch: typeof fetch
  /** Ends every socket of this tunnel, also one still waiting for the proxy. */
  close(): void
  errorContext(ctx: ConnectionErrorContext): ConnectionErrorContext
}

const TLS_ERROR = /CERT|SSL|TLS|self[- ]signed/i

function textsOf(err: unknown): string {
  const out: string[] = []
  let cur: unknown = err
  for (let depth = 0; cur && depth < 5; depth += 1) {
    const e = cur as { code?: unknown; message?: unknown; cause?: unknown }
    if (typeof e.code === 'string') out.push(e.code)
    if (typeof e.message === 'string') out.push(e.message)
    cur = e.cause
  }
  return out.join(' ')
}

/**
 * `fetch` through the proxy: undici's own `fetch` with its own `ProxyAgent`, loaded
 * only when a connection needs it. Node's built-in `fetch` is a different copy of
 * undici, and a dispatcher of one copy is not guaranteed to fit the other.
 */
export function openFetchTunnel(proxy: ResolvedProxy): FetchTunnel {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const undici = require('undici') as typeof import('undici')
  const authorization = proxyAuthorization(proxy)
  const dispatcher: ProxyAgent = new undici.ProxyAgent({
    uri: proxy.origin,
    ...(authorization ? { token: authorization } : {}),
  })
  let answered = false
  let inFlight = 0
  let failed = false
  let status: number | undefined

  return {
    fetch: (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      inFlight += 1
      try {
        const res = await undici.fetch(input as never, { ...init, dispatcher } as never)
        answered = true
        failed = false
        status = undefined
        return res as unknown as Response
      } catch (err) {
        const text = textsOf(err)
        const refused = text.match(/Proxy response \((\d{3})\)/)
        if (refused) status = Number(refused[1])
        // Behind a working tunnel a TCP failure cannot reach us as such: the proxy
        // is the only peer we dial. A certificate error is the server's.
        if (refused || (!answered && !TLS_ERROR.test(text))) failed = true
        throw err
      } finally {
        inFlight -= 1
      }
    }) as typeof fetch,
    close: () => void dispatcher.destroy().catch(() => {}),
    errorContext: (ctx) =>
      failed || (!answered && inFlight > 0) ? proxyContext(proxy, ctx, status) : ctx,
  }
}
