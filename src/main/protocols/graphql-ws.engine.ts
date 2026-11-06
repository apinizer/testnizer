/**
 * GraphQL subscriptions over WebSocket: one socket per subscription, in main.
 *
 * Both wire protocols, chosen by what the server picks when offered both:
 *  - `graphql-transport-ws`: connection_init → connection_ack, subscribe → next*,
 *    error | complete, ping ⇄ pong; the client ends with complete + close 1000.
 *  - `graphql-ws` (subscriptions-transport-ws): connection_init → connection_ack
 *    + ka, start → data*, error | complete; connection_error rejects the init;
 *    the client ends with stop + connection_terminate + close 1000.
 *
 * `gqlWsConnect` resolves once the server acknowledged and the operation went
 * out. Anything earlier that goes wrong rejects with a `ConnectionError`; anything
 * later arrives as an event, the last one being `ended`. A disconnect the user
 * asked for reports nothing back.
 *
 * The engine reads no project, no setting and no Electron API: the handler
 * resolves all of it, so these sockets are testable against a real server alone.
 */
import WebSocket from 'ws'
import { randomUUID } from 'crypto'
import type { SecureContextOptions } from 'tls'
import {
  ConnectionError,
  classifyTransportError,
  connectTimeoutError,
  scrubConnectionText,
  toConnectionError,
  type ConnectionErrorContext,
  type ConnectionErrorKind,
} from '../lib/error-classifier'
import { ProxyTunnel, type ResolvedProxy } from '../lib/proxy-tunnel'
import { CONNECTION_ERROR_TEXT_EN, composeConnectionMessage } from '../../shared/connection-error'
import {
  GRAPHQL_TRANSPORT_WS,
  GRAPHQL_WS_LEGACY,
  gqlWsFailureDetail,
  gqlWsHintKey,
  gqlWsTextEn,
  type GqlWsEvent,
  type GqlWsFailure,
  type GraphqlWsProtocol,
} from '../../shared/graphql-ws'

const HANDSHAKE_TIMEOUT_MS = 15_000
/** graphql-ws servers wait 3 s for connection_init; a client that waits longer than that is fair. */
const ACK_TIMEOUT_MS = 10_000
/** A server that never answers our close frame does not hold the socket longer than this. */
const CLOSE_GRACE_MS = 2_000

export interface GqlWsConnectOptions {
  /** Chosen by the renderer: it filters events by this id before the connect returns. */
  connectionId: string
  /** `ws://` or `wss://` (`toGraphqlWsUrl`). */
  url: string
  headers?: Record<string, string>
  payload: { query: string; variables?: Record<string, unknown>; operationName?: string }
  connectionInit?: Record<string, unknown>
  rejectUnauthorized?: boolean
  /** Certificates and TLS limits for wss:// (`certificateTlsMaterial`, `resolveTlsPayload`). */
  tls?: SecureContextOptions & { minVersion?: string; maxVersion?: string }
  /** Resolved by the handler; absent or `null` = direct. */
  proxy?: ResolvedProxy | null
  handshakeTimeoutMs?: number
  ackTimeoutMs?: number
  /** Events after `gqlWsConnect` resolved, plus any that overtake its promise. */
  onEvent: (event: GqlWsEvent) => void
}

export interface GqlWsConnectionInfo {
  connectionId: string
  url: string
  protocol: GraphqlWsProtocol
  connectedAt: number
}

/** A pre-subscription failure the engine can name precisely. */
export class GqlWsConnectionError extends ConnectionError {
  readonly failure: GqlWsFailure
  constructor(failure: GqlWsFailure, kind: ConnectionErrorKind, ctx: ConnectionErrorContext) {
    const detail = gqlWsFailureDetail(failure, gqlWsTextEn)
    const { target } = classifyTransportError(new Error(detail), ctx)
    const base = { kind, ...(target ? { target } : {}), detail }
    super({
      ...base,
      message: composeConnectionMessage(base, CONNECTION_ERROR_TEXT_EN[kind].what),
      hint: gqlWsTextEn(gqlWsHintKey(failure.reason)),
    })
    this.failure = failure
  }
}

export function gqlWsFailureOf(err: unknown): GqlWsFailure | undefined {
  return err instanceof GqlWsConnectionError ? err.failure : undefined
}

// ─── Connections ─────────────────────────────────────────────────────────────

interface Live {
  ws: WebSocket
  options: GqlWsConnectOptions
  protocol: GraphqlWsProtocol
  operationId: string
  /** Set by us: the close that follows is not the server's. */
  closing: boolean
}

const connections = new Map<string, Live>()
/** Sockets before their ack, with how to give up on them. */
const pending = new Map<string, () => void>()

const encode = (frame: Record<string, unknown>): string => JSON.stringify(frame)

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** A transport `error` holds an array of GraphQL errors, a legacy one a single object. */
function errorText(payload: unknown): string {
  const list = Array.isArray(payload) ? payload : [payload]
  const texts = list
    .map((e) => (isRecord(e) && typeof e.message === 'string' ? e.message : ''))
    .filter(Boolean)
  return texts.length > 0 ? texts.join('; ') : 'The server reported an error'
}

function emit(options: GqlWsConnectOptions, event: DistributiveOmit<GqlWsEvent>): void {
  options.onEvent({
    connectionId: options.connectionId,
    timestamp: Date.now(),
    ...event,
  } as GqlWsEvent)
}

type DistributiveOmit<T> = T extends unknown ? Omit<T, 'connectionId' | 'timestamp'> : never

/** Open one socket offering `protocols`; settles at the ack. */
function attempt(
  options: GqlWsConnectOptions,
  protocols: string[],
  mayFallBack: boolean,
): Promise<GqlWsConnectionInfo> {
  const ctx: ConnectionErrorContext = { protocol: 'websocket', url: options.url }
  const handshakeMs = options.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS
  const ackMs = options.ackTimeoutMs ?? ACK_TIMEOUT_MS
  return new Promise((resolve, reject) => {
    // Per attempt: the one retry below opens a tunnel of its own.
    const tunnel = options.proxy
      ? new ProxyTunnel(options.proxy, { rejectUnauthorized: options.rejectUnauthorized })
      : null
    const failureCtx = (): ConnectionErrorContext => tunnel?.errorContext(ctx) ?? ctx
    let ws: WebSocket
    try {
      ws = new WebSocket(options.url, protocols, {
        headers: options.headers ?? {},
        rejectUnauthorized: options.rejectUnauthorized !== false,
        ...(options.tls ?? {}),
        ...(tunnel ? { agent: tunnel.agent } : {}),
      })
    } catch (err) {
      reject(toConnectionError(err, ctx))
      return
    }

    let timer: NodeJS.Timeout | undefined
    let settled = false
    const done = (): boolean => {
      if (settled) return false
      settled = true
      clearTimeout(timer)
      pending.delete(options.connectionId)
      return true
    }
    const fail = (err: Error): void => {
      if (!done()) return
      ws.removeAllListeners('message')
      ws.terminate()
      tunnel?.abort()
      reject(err)
    }

    pending.set(options.connectionId, () =>
      fail(toConnectionError(Object.assign(new Error('aborted'), { name: 'AbortError' }), ctx)),
    )
    timer = setTimeout(() => {
      fail(
        connectTimeoutError(
          `WebSocket connection timeout (${Math.round(handshakeMs / 100) / 10}s)`,
          failureCtx(),
        ),
      )
    }, handshakeMs)

    ws.on('error', (err: Error) => {
      if (/Server sent (no|an invalid) subprotocol/.test(err.message)) {
        fail(new GqlWsConnectionError({ reason: 'noSubprotocol' }, 'rejected', ctx))
        return
      }
      // After the ack the close that follows ends the subscription.
      fail(toConnectionError(err, failureCtx()))
    })

    ws.on('open', () => {
      if (settled) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        fail(
          new GqlWsConnectionError(
            { reason: 'noAck', ackTimeoutSeconds: Math.round(ackMs / 100) / 10 },
            'timeout',
            ctx,
          ),
        )
      }, ackMs)
      ws.send(
        encode({
          type: 'connection_init',
          ...(options.connectionInit ? { payload: options.connectionInit } : {}),
        }),
      )
    })

    ws.on('close', (code: number, reason: Buffer) => {
      if (settled) return
      // subscriptions-transport-ws on a plain `ws` server: the default picks the
      // first subprotocol offered, then this server closes 1002 on anything but
      // graphql-ws. Ask again with the one it wants.
      if (code === 1002 && mayFallBack && ws.protocol === GRAPHQL_TRANSPORT_WS) {
        done()
        attempt(options, [GRAPHQL_WS_LEGACY], false).then(resolve, reject)
        return
      }
      fail(
        new GqlWsConnectionError(
          {
            reason: 'closed',
            closeCode: code,
            serverText: scrubConnectionText(reason.toString(), options.url),
          },
          'closed',
          ctx,
        ),
      )
    })

    ws.on('message', (raw: WebSocket.RawData) => {
      const frame = parseFrame(raw)
      if (!frame) return
      if (frame.type === 'ping') {
        ws.send(encode({ type: 'pong', ...(frame.payload ? { payload: frame.payload } : {}) }))
      } else if (frame.type === 'connection_error') {
        const serverText = scrubConnectionText(errorText(frame.payload), options.url)
        fail(new GqlWsConnectionError({ reason: 'initRejected', serverText }, 'rejected', ctx))
      } else if (frame.type === 'connection_ack' && done()) {
        ws.removeAllListeners('message')
        ws.removeAllListeners('close')
        ws.removeAllListeners('error')
        resolve(startOperation(ws, options))
      }
    })
  })
}

function parseFrame(raw: WebSocket.RawData): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw.toString())
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** The socket is acknowledged: start the operation and read until it ends. */
function startOperation(ws: WebSocket, options: GqlWsConnectOptions): GqlWsConnectionInfo {
  const protocol: GraphqlWsProtocol =
    ws.protocol === GRAPHQL_WS_LEGACY ? GRAPHQL_WS_LEGACY : GRAPHQL_TRANSPORT_WS
  const live: Live = { ws, options, protocol, operationId: randomUUID(), closing: false }
  connections.set(options.connectionId, live)

  ws.on('message', (raw: WebSocket.RawData) => onFrame(live, raw))
  ws.on('close', (code: number, reason: Buffer) => {
    if (connections.get(options.connectionId) !== live) return
    connections.delete(options.connectionId)
    if (live.closing) return
    emit(options, { type: 'ended', reason: 'close', code, closeReason: reason.toString() })
  })
  // A socket error is always followed by its close, which reports the end.
  ws.on('error', () => {})

  ws.send(
    encode({
      id: live.operationId,
      type: protocol === GRAPHQL_WS_LEGACY ? 'start' : 'subscribe',
      payload: options.payload,
    }),
  )
  return { connectionId: options.connectionId, url: options.url, protocol, connectedAt: Date.now() }
}

function onFrame(live: Live, raw: WebSocket.RawData): void {
  const { options, ws, operationId } = live
  const frame = parseFrame(raw)
  if (!frame) {
    emit(options, {
      type: 'error',
      fatal: false,
      message: 'The server sent a message that is not a JSON object',
      data: raw.toString().slice(0, 2000),
    })
    return
  }
  switch (frame.type) {
    case 'ping':
      ws.send(encode({ type: 'pong', ...(frame.payload ? { payload: frame.payload } : {}) }))
      return
    case 'pong':
    case 'ka':
    case 'connection_ack':
      return
    case 'connection_error':
      // After the ack this reports a frame the server could not parse; it stays connected.
      emit(options, { type: 'error', fatal: false, message: errorText(frame.payload) })
      return
    default:
      break
  }
  // A frame for an operation that already ended may cross ours: protocol says ignore.
  if (frame.id !== operationId) return
  switch (frame.type) {
    case 'next':
    case 'data':
      emit(options, { type: 'data', data: JSON.stringify(frame.payload ?? null) })
      return
    case 'error':
      emit(options, {
        type: 'error',
        fatal: true,
        message: errorText(frame.payload),
        data: JSON.stringify(frame.payload ?? null),
      })
      finish(live, 'error')
      return
    case 'complete':
      finish(live, 'complete')
      return
    default:
      emit(options, {
        type: 'error',
        fatal: false,
        message: `The server sent an unknown message type: ${String(frame.type)}`,
      })
  }
}

/** The server ended the operation: the socket has no other use. */
function finish(live: Live, reason: 'complete' | 'error'): void {
  connections.delete(live.options.connectionId)
  live.closing = true
  emit(live.options, { type: 'ended', reason })
  closeSocket(live.ws)
}

function closeSocket(ws: WebSocket): void {
  try {
    ws.close(1000, 'Normal Closure')
  } catch {
    ws.terminate()
    return
  }
  const timer = setTimeout(() => ws.terminate(), CLOSE_GRACE_MS)
  timer.unref?.()
  ws.once('close', () => clearTimeout(timer))
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function gqlWsConnect(options: GqlWsConnectOptions): Promise<GqlWsConnectionInfo> {
  if (connections.has(options.connectionId) || pending.has(options.connectionId)) {
    return Promise.reject(new Error(`Connection ${options.connectionId} is already in use`))
  }
  return attempt(options, [GRAPHQL_TRANSPORT_WS, GRAPHQL_WS_LEGACY], true)
}

/** Give up on a connect still waiting for its ack. `false` when there is none. */
export function gqlWsCancelConnect(connectionId: string): boolean {
  const abort = pending.get(connectionId)
  if (abort) {
    abort()
    return true
  }
  return false
}

/** Unsubscribe: tell the server, then close. `false` for an unknown id. */
export function gqlWsDisconnect(connectionId: string): boolean {
  const live = connections.get(connectionId)
  if (!live) return false
  connections.delete(connectionId)
  live.closing = true
  if (live.ws.readyState === WebSocket.OPEN) {
    try {
      if (live.protocol === GRAPHQL_WS_LEGACY) {
        live.ws.send(encode({ id: live.operationId, type: 'stop' }))
        live.ws.send(encode({ type: 'connection_terminate' }))
      } else {
        live.ws.send(encode({ id: live.operationId, type: 'complete' }))
      }
    } catch {
      /* the socket is on its way out: the close below still runs */
    }
  }
  closeSocket(live.ws)
  return true
}

/** App quit. */
export function gqlWsDisconnectAll(): void {
  for (const abort of [...pending.values()]) abort()
  for (const id of [...connections.keys()]) gqlWsDisconnect(id)
}
