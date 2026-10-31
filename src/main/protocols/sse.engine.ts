import { EventSource, type ErrorEvent, type EventSourceFetchInit } from 'eventsource'
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { applyDefaultUserAgent } from '../lib/user-agent'
import {
  ConnectionError,
  classifyTransportError,
  connectTimeoutError,
  formatConnectionError,
  toConnectionError,
  type ConnectionErrorInfo,
} from '../lib/error-classifier'

// ─── Types ───────────────────────────────────────────────────

export type SseHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface SseConnectOptions {
  url: string
  headers?: Record<string, string>
  lastEventId?: string
  withCredentials?: boolean
  /**
   * HTTP method. Defaults to `'GET'`. When set to anything other than `GET`
   * (or when `body` is provided) the engine uses a manual fetch + streaming
   * reader path, since `eventsource@3` is GET-only.
   */
  method?: SseHttpMethod
  /**
   * Request body. Only honored on the fetch path (non-GET or any method
   * with a body). Passed verbatim — caller is responsible for serializing
   * JSON / form data and setting the matching `Content-Type` header.
   */
  body?: string
  /**
   * Renderer-supplied id so the in-flight handshake can be cancelled via
   * `cancelConnect()`. Cleared once the connection opens or errors out.
   */
  pendingId?: string
}

export interface SseConnectionInfo {
  connectionId: string
  url: string
  readyState: number
  connectedAt: number
}

export interface SseEventPayload {
  connectionId: string
  type: 'open' | 'event' | 'error'
  eventType?: string
  data?: string
  id?: string
  retry?: number
  /** HTTP status code when the SSE handshake failed with a non-2xx response. */
  httpStatus?: number
  /**
   * `error` only: the connection is over for good — nothing reconnects. Set
   * when `eventsource@3` closes the source (HTTP 204 "stop reconnecting", any
   * other non-200, a wrong content type) and when the fetch path's stream
   * ends or breaks (that path never reconnects). Without it the error is
   * transient and the client retries on its own.
   *  - `'ended'`  — the server finished: HTTP 204, or the fetch path's clean end.
   *  - `'failed'` — anything else (non-200, wrong type, broken stream).
   */
  closed?: 'ended' | 'failed'
  /**
   * `error` only, never with `closed` (issue #226): the server ended the
   * response normally and the client is reconnecting, as EventSource does
   * after every response. Not a failure — a finite stream ends this way just
   * before its reconnect gets HTTP 204. A transient network error (a message
   * from the transport) is not marked.
   */
  streamEnded?: true
  /** `error` only (issue #253): the classified failure; `data` is its English text. */
  errorInfo?: ConnectionErrorInfo
  timestamp: number
}

/** `data` of a `streamEnded` error. */
export const SSE_STREAM_ENDED_MESSAGE = 'The server ended the response; reconnecting'

/**
 * Whether an `eventsource@3` error is the server ending the response (issue
 * #226). The library reports a body that finished cleanly through its
 * reconnect path with no message and no status; a broken stream or a refused
 * reconnect carries a message (`flattenError`) or a status. Only meaningful
 * once the connection had opened and while the library is reconnecting.
 */
export function isStreamEndReconnect(
  err: { code?: unknown; message?: unknown },
  readyState: number,
  opened: boolean,
): boolean {
  if (!opened || readyState !== EventSource.CONNECTING) return false
  if (err.code !== undefined && err.code !== null) return false
  return typeof err.message !== 'string' || err.message.trim() === ''
}

// ─── Error message enrichment ───────────────────────────────

/**
 * `eventsource@3` exposes errors as an `ErrorEvent` carrying optional `code`
 * (HTTP status from the failed handshake) and `message` (HTTP status text OR a
 * lower-level text like "TypeError: fetch failed: connect ECONNREFUSED …");
 * the fetch path synthesizes `status`. Both go through the shared classifier
 * (issue #253): what happened + host:port + the next step, and the numeric
 * status when there is one.
 */
export function describeSseError(
  err: {
    status?: unknown
    code?: unknown
    message?: unknown
    data?: unknown
  },
  url?: string,
): { message: string; httpStatus?: number; info: ConnectionErrorInfo } {
  const rawMessage =
    typeof err.message === 'string' && err.message.trim()
      ? err.message.trim()
      : typeof err.data === 'string' && err.data.trim()
        ? err.data.trim()
        : undefined
  const info = classifyTransportError(
    {
      ...(typeof err.status === 'number' ? { status: err.status } : {}),
      ...(err.code !== undefined ? { code: err.code } : {}),
      ...(rawMessage ? { message: rawMessage } : {}),
    },
    { protocol: 'sse', url },
  )
  return {
    message: formatConnectionError(info),
    ...(info.httpStatus !== undefined ? { httpStatus: info.httpStatus } : {}),
    info,
  }
}

/** The connect rejection for a described error: same text, same info. */
function sseFailure(described: { info: ConnectionErrorInfo }): ConnectionError {
  return new ConnectionError(described.info)
}

// ─── Connection manager ─────────────────────────────────────

interface ManagedEventSourceConnection {
  kind: 'eventsource'
  connectionId: string
  eventSource: EventSource
  url: string
  connectedAt: number
  windowId: number
}

interface ManagedFetchConnection {
  kind: 'fetch'
  connectionId: string
  controller: AbortController
  url: string
  connectedAt: number
  windowId: number
}

type ManagedSseConnection = ManagedEventSourceConnection | ManagedFetchConnection

const connections = new Map<string, ManagedSseConnection>()

/**
 * In-flight SSE handshakes keyed by the renderer-supplied pendingId. The
 * value is a teardown closure that cancels the handshake — it calls
 * `eventSource.close()` (EventSource path) or `controller.abort()` (fetch
 * path). After the connection opens or errors, the entry is removed so
 * subsequent `cancelConnect` calls are no-ops.
 */
const pendingConnects = new Map<string, () => void>()

function sendEventToRenderer(windowId: number, event: SseEventPayload): void {
  const win = BrowserWindow.fromId(windowId)
  if (win && !win.isDestroyed()) {
    win.webContents.send('sse:event', event)
  }
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Connects to an SSE endpoint. Dispatches to one of two implementations:
 *   - **EventSource path** (default): plain GET, no body — uses `eventsource@3`
 *     for built-in auto-reconnect + Last-Event-ID semantics. All named SSE
 *     events (e.g. Wikimedia's `recentchange`) are forwarded to the renderer
 *     via a `dispatchEvent` interception, not just the default `message` type.
 *   - **Fetch path**: any non-GET method, or any method with a body —
 *     manual `fetch` + streaming reader. No auto-reconnect (caller handles).
 */
export function connect(options: SseConnectOptions, windowId: number): Promise<SseConnectionInfo> {
  const method = (options.method ?? 'GET').toUpperCase() as SseHttpMethod
  const hasBody = typeof options.body === 'string' && options.body.length > 0
  if (method !== 'GET' || hasBody) {
    return connectStreaming({ ...options, method }, windowId)
  }
  return connectEventSource(options, windowId)
}

function connectEventSource(
  options: SseConnectOptions,
  windowId: number,
): Promise<SseConnectionInfo> {
  return new Promise((resolve, reject) => {
    const connectionId = randomUUID()

    // `eventsource@3` no longer accepts a `headers` field on the init dict.
    // Custom request headers must be merged in via a custom `fetch`
    // implementation that overrides `globalThis.fetch`. We assemble the
    // caller's headers (plus Last-Event-ID + default User-Agent) once here
    // and let the wrapper splice them onto every (re)connect attempt.
    const customHeaders: Record<string, string> = { ...(options.headers ?? {}) }
    if (options.lastEventId) customHeaders['Last-Event-ID'] = options.lastEventId
    applyDefaultUserAgent(customHeaders)

    const wrappedFetch = (url: string | URL, init: EventSourceFetchInit): Promise<Response> => {
      // Build from the library's own init headers first (`Accept`, plus the
      // `Last-Event-ID` it re-derives from the last received event on every
      // reconnect) so those always win, then layer our custom headers on top
      // only where the library has not already set a value. Using `Headers`
      // (case-insensitive) instead of a plain-object spread means the library's
      // `Last-Event-ID` is recognised as a collision even though our key casing
      // differs — a `{ ...customHeaders, ...init.headers }` spread would keep
      // both entries because object keys are case-sensitive.
      const headers = new Headers(init.headers)
      for (const [key, value] of Object.entries(customHeaders)) {
        if (headers.has(key)) continue
        try {
          headers.set(key, value)
        } catch {
          // A user-supplied header value (most often a hand-typed
          // `Last-Event-ID` carrying CR/LF/NUL or a non-Latin1 character) can
          // be rejected by `Headers` as an invalid header value. Skip just that
          // header rather than letting the throw abort the whole connection —
          // previously this surfaced as a connect failure with zero events.
        }
      }
      return fetch(url, { ...init, headers } as RequestInit)
    }

    let eventSource: EventSource
    try {
      eventSource = new EventSource(options.url, {
        withCredentials: options.withCredentials ?? false,
        fetch: wrappedFetch,
      })
    } catch (err) {
      reject(toConnectionError(err, { protocol: 'sse', url: options.url }))
      return
    }

    if (options.pendingId) {
      pendingConnects.set(options.pendingId, () => eventSource.close())
    }

    const managed: ManagedEventSourceConnection = {
      kind: 'eventsource',
      connectionId,
      eventSource,
      url: options.url,
      connectedAt: Date.now(),
      windowId,
    }

    // Connection timeout
    const timeout = setTimeout(() => {
      if (eventSource.readyState === EventSource.CONNECTING) {
        eventSource.close()
        connections.delete(connectionId)
        reject(
          connectTimeoutError('SSE connection timeout (15s)', {
            protocol: 'sse',
            url: options.url,
          }),
        )
      }
    }, 15000)

    eventSource.onopen = () => {
      clearTimeout(timeout)
      if (options.pendingId) pendingConnects.delete(options.pendingId)
      connections.set(connectionId, managed)

      sendEventToRenderer(windowId, {
        connectionId,
        type: 'open',
        timestamp: Date.now(),
      })

      resolve({
        connectionId,
        url: options.url,
        readyState: eventSource.readyState,
        connectedAt: managed.connectedAt,
      })
    }

    // `eventsource@3` dispatches a `MessageEvent` whose `type` is the named
    // SSE `event:` field (or `'message'` when omitted). Intercepting
    // `dispatchEvent` is the only zero-config way to capture *every* event
    // type without enumerating them up-front — Wikimedia's recentchange
    // stream, for example, emits `event: recentchange` lines that the
    // previous `eventsource@2` `onmessage`-only path silently dropped.
    const originalDispatch = eventSource.dispatchEvent.bind(eventSource)
    eventSource.dispatchEvent = (evt: Event): boolean => {
      if (evt instanceof MessageEvent) {
        sendEventToRenderer(windowId, {
          connectionId,
          type: 'event',
          eventType: evt.type || 'message',
          data: typeof evt.data === 'string' ? evt.data : String(evt.data),
          id: evt.lastEventId || undefined,
          timestamp: Date.now(),
        })
      }
      return originalDispatch(evt)
    }

    eventSource.onerror = (err: ErrorEvent) => {
      clearTimeout(timeout)
      if (options.pendingId) pendingConnects.delete(options.pendingId)

      // `eventsource@3` emits `ErrorEvent { code?: number, message?: string }`.
      const described = describeSseError({ code: err.code, message: err.message }, options.url)
      const { message, httpStatus } = described
      // CLOSED here = the library gave up (`failConnection`): a reconnect
      // answered 204 / non-200 / wrong type. CONNECTING = it will retry.
      const closed =
        eventSource.readyState !== EventSource.CLOSED
          ? undefined
          : httpStatus === 204
            ? ('ended' as const)
            : ('failed' as const)
      const streamEnded =
        !closed && isStreamEndReconnect(err, eventSource.readyState, connections.has(connectionId))

      sendEventToRenderer(windowId, {
        connectionId,
        type: 'error',
        data: streamEnded ? SSE_STREAM_ENDED_MESSAGE : message,
        httpStatus,
        ...(closed ? { closed } : {}),
        ...(streamEnded ? { streamEnded: true as const } : { errorInfo: described.info }),
        timestamp: Date.now(),
      })

      // If not yet connected, reject
      if (!connections.has(connectionId)) {
        connections.delete(connectionId)
        reject(sseFailure(described))
      }

      // If the connection is closed, clean up
      if (eventSource.readyState === EventSource.CLOSED) {
        connections.delete(connectionId)
      }
    }
  })
}

// ─── Fetch + streaming reader path (POST/PUT/PATCH/DELETE or GET-with-body) ─

/**
 * Minimal SSE wire-format parser. Splits a raw chunk on event boundaries
 * (blank line) and accumulates `data:`, `event:`, `id:`, `retry:` lines per
 * the WHATWG spec. State is held in the closure so chunks can split anywhere
 * — including mid-line — without dropping events.
 */
interface SseLineEvent {
  data: string
  eventType: string
  id?: string
  retry?: number
}
function createSseParser(onEvent: (e: SseLineEvent) => void): (chunk: string) => void {
  let buffer = ''
  let dataLines: string[] = []
  let eventType = 'message'
  let id: string | undefined
  let retry: number | undefined

  function flushEvent(): void {
    if (dataLines.length === 0) {
      // Reset bookkeeping but don't fire — spec: empty data means dispatch nothing.
      eventType = 'message'
      return
    }
    onEvent({ data: dataLines.join('\n'), eventType, id, retry })
    dataLines = []
    eventType = 'message'
    retry = undefined
  }

  function handleLine(line: string): void {
    if (line === '') {
      flushEvent()
      return
    }
    if (line.startsWith(':')) return // Comment line — ignore.

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    switch (field) {
      case 'data':
        dataLines.push(value)
        break
      case 'event':
        eventType = value
        break
      case 'id':
        if (!value.includes('\x00')) id = value
        break
      case 'retry': {
        const n = Number(value)
        if (Number.isInteger(n)) retry = n
        break
      }
    }
  }

  return (chunk: string): void => {
    buffer += chunk
    // Split on \r\n, \n, or \r per spec.
    let idx: number

    while ((idx = buffer.search(/\r\n|\r|\n/)) !== -1) {
      const line = buffer.slice(0, idx)
      const sep = buffer[idx] === '\r' && buffer[idx + 1] === '\n' ? 2 : 1
      buffer = buffer.slice(idx + sep)
      handleLine(line)
    }
  }
}

function connectStreaming(
  options: SseConnectOptions & { method: SseHttpMethod },
  windowId: number,
): Promise<SseConnectionInfo> {
  return new Promise((resolve, reject) => {
    const connectionId = randomUUID()
    const controller = new AbortController()

    const headers: Record<string, string> = { ...(options.headers ?? {}) }
    if (options.lastEventId) headers['Last-Event-ID'] = options.lastEventId
    // SSE endpoints typically gate on the Accept header — set it unless the
    // caller already supplied one (case-insensitive).
    const hasAccept = Object.keys(headers).some((k) => k.toLowerCase() === 'accept')
    if (!hasAccept) headers['Accept'] = 'text/event-stream'
    applyDefaultUserAgent(headers)

    // 15s handshake timeout, mirroring the EventSource path.
    const timeout = setTimeout(() => {
      controller.abort()
      if (!connections.has(connectionId)) {
        reject(
          connectTimeoutError('SSE connection timeout (15s)', {
            protocol: 'sse',
            url: options.url,
          }),
        )
      }
    }, 15000)

    if (options.pendingId) {
      pendingConnects.set(options.pendingId, () => controller.abort())
    }

    const connectedAt = Date.now()
    const fetchInit: RequestInit = {
      method: options.method,
      headers,
      body: typeof options.body === 'string' && options.body.length > 0 ? options.body : undefined,
      signal: controller.signal,
    }

    fetch(options.url, fetchInit)
      .then(async (response) => {
        if (!response.ok) {
          // Surface as an HTTP-status error using the same enrichment as the
          // EventSource path so the renderer renders identical messaging.
          const described = describeSseError(
            { status: response.status, message: response.statusText },
            options.url,
          )
          clearTimeout(timeout)
          if (options.pendingId) pendingConnects.delete(options.pendingId)
          sendEventToRenderer(windowId, {
            connectionId,
            type: 'error',
            data: described.message,
            httpStatus: described.httpStatus,
            errorInfo: described.info,
            closed: 'failed',
            timestamp: Date.now(),
          })
          reject(sseFailure(described))
          return
        }
        if (response.status === 204) {
          // `response.ok` covers 204, but per the SSE spec it means "no stream,
          // do not reconnect" — report it like the EventSource path does.
          clearTimeout(timeout)
          if (options.pendingId) pendingConnects.delete(options.pendingId)
          const described = describeSseError({ status: 204, message: 'No Content' }, options.url)
          sendEventToRenderer(windowId, {
            connectionId,
            type: 'error',
            data: described.message,
            httpStatus: described.httpStatus,
            errorInfo: described.info,
            closed: 'ended',
            timestamp: Date.now(),
          })
          reject(sseFailure(described))
          return
        }
        if (!response.body) {
          clearTimeout(timeout)
          const msg = 'SSE response has no body stream'
          sendEventToRenderer(windowId, {
            connectionId,
            type: 'error',
            data: msg,
            closed: 'failed',
            timestamp: Date.now(),
          })
          reject(new Error(msg))
          return
        }

        // Handshake succeeded → register, fire `open`, resolve.
        clearTimeout(timeout)
        if (options.pendingId) pendingConnects.delete(options.pendingId)
        const managed: ManagedFetchConnection = {
          kind: 'fetch',
          connectionId,
          controller,
          url: options.url,
          connectedAt,
          windowId,
        }
        connections.set(connectionId, managed)
        sendEventToRenderer(windowId, {
          connectionId,
          type: 'open',
          timestamp: Date.now(),
        })
        resolve({
          connectionId,
          url: options.url,
          readyState: 1, // OPEN
          connectedAt,
        })

        // Pump the stream until exhausted, aborted, or an error fires.
        const reader = response.body.getReader()
        const decoder = new TextDecoder('utf-8')
        const parse = createSseParser((evt) => {
          sendEventToRenderer(windowId, {
            connectionId,
            type: 'event',
            eventType: evt.eventType,
            data: evt.data,
            id: evt.id,
            retry: evt.retry,
            timestamp: Date.now(),
          })
        })

        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            if (value) parse(decoder.decode(value, { stream: true }))
          }
          // Stream closed cleanly — fire a terminal error so the renderer
          // leaves "connected" (this path never reconnects).
          if (connections.has(connectionId)) {
            sendEventToRenderer(windowId, {
              connectionId,
              type: 'error',
              data: 'SSE stream closed',
              closed: 'ended',
              timestamp: Date.now(),
            })
            connections.delete(connectionId)
          }
        } catch (err) {
          // AbortError = explicit disconnect, not an error we report.
          const e = err as { name?: string; message?: string }
          if (e?.name === 'AbortError') {
            connections.delete(connectionId)
            return
          }
          const failure = toConnectionError(err, { protocol: 'sse', url: options.url })
          sendEventToRenderer(windowId, {
            connectionId,
            type: 'error',
            data: failure.message,
            httpStatus: failure.info.httpStatus,
            errorInfo: failure.info,
            closed: 'failed',
            timestamp: Date.now(),
          })
          connections.delete(connectionId)
        }
      })
      .catch((err: unknown) => {
        clearTimeout(timeout)
        if (options.pendingId) pendingConnects.delete(options.pendingId)
        const e = err as { name?: string }
        if (e?.name === 'AbortError' && connections.has(connectionId)) {
          // Already handled by disconnect; nothing to surface.
          return
        }
        // `fetch` wraps low-level transport errors in `cause` (undici
        // `fetch failed`); the classifier unwraps it (issue #253).
        const failure = toConnectionError(err, { protocol: 'sse', url: options.url })
        sendEventToRenderer(windowId, {
          connectionId,
          type: 'error',
          data: failure.message,
          httpStatus: failure.info.httpStatus,
          errorInfo: failure.info,
          closed: 'failed',
          timestamp: Date.now(),
        })
        if (!connections.has(connectionId)) {
          reject(failure)
        } else {
          connections.delete(connectionId)
        }
      })
  })
}

/**
 * Abort an in-flight SSE handshake (before `open` fires). Returns true when
 * a pending connection was found and torn down, false otherwise.
 */
export function cancelConnect(pendingId: string): boolean {
  const teardown = pendingConnects.get(pendingId)
  if (!teardown) return false
  pendingConnects.delete(pendingId)
  try {
    teardown()
  } catch {
    // Best-effort.
  }
  return true
}

export function disconnect(connectionId: string): boolean {
  const managed = connections.get(connectionId)
  if (!managed) {
    return false
  }

  if (managed.kind === 'eventsource') {
    managed.eventSource.close()
  } else {
    managed.controller.abort()
  }
  connections.delete(connectionId)
  return true
}

export function getConnectionInfo(connectionId: string): SseConnectionInfo | null {
  const managed = connections.get(connectionId)
  if (!managed) return null

  const readyState = managed.kind === 'eventsource' ? managed.eventSource.readyState : 1
  return {
    connectionId: managed.connectionId,
    url: managed.url,
    readyState,
    connectedAt: managed.connectedAt,
  }
}

export function disconnectAll(): void {
  for (const [id] of connections) {
    disconnect(id)
  }
}
