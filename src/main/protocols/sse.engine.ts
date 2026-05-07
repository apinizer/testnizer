import EventSource from 'eventsource'
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'
import { applyDefaultUserAgent } from '../lib/user-agent'

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
   * reader path, since `eventsource@2` is GET-only.
   */
  method?: SseHttpMethod
  /**
   * Request body. Only honored on the fetch path (non-GET or any method
   * with a body). Passed verbatim — caller is responsible for serializing
   * JSON / form data and setting the matching `Content-Type` header.
   */
  body?: string
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
  timestamp: number
}

// ─── Error message enrichment ───────────────────────────────

/**
 * Best-effort short hint to point users at the likely fix for common HTTP
 * statuses returned during the SSE handshake. Missing entries fall through to
 * the raw `<status> <statusText>` so any code is at least surfaced verbatim.
 */
const HTTP_STATUS_HINTS: Record<number, string> = {
  400: 'Bad Request — check headers / query params',
  401: 'Unauthorized — check Authorization header / token',
  403: 'Forbidden — credentials lack access to this stream',
  404: 'Not Found — check the SSE URL',
  405: 'Method Not Allowed — server does not expose SSE here',
  408: 'Request Timeout',
  429: 'Too Many Requests — rate limited',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}

/**
 * `eventsource@2` exposes errors as an `Event`-like object carrying optional
 * `status` (HTTP code from the response) and `message` (HTTP status text OR a
 * lower-level socket error like "connect ECONNREFUSED 127.0.0.1:9"). We squash
 * both into a single user-facing string and, when present, the numeric status.
 */
export function describeSseError(err: {
  status?: unknown
  message?: unknown
  data?: unknown
}): { message: string; httpStatus?: number } {
  const rawStatus = typeof err.status === 'number' ? err.status : undefined
  const rawMessage =
    typeof err.message === 'string' && err.message.trim()
      ? err.message.trim()
      : typeof err.data === 'string' && err.data.trim()
        ? err.data.trim()
        : ''

  if (rawStatus !== undefined) {
    const hint = HTTP_STATUS_HINTS[rawStatus]
    const tail = hint ?? rawMessage
    return {
      message: tail ? `HTTP ${rawStatus} ${tail}` : `HTTP ${rawStatus}`,
      httpStatus: rawStatus,
    }
  }

  if (rawMessage) {
    if (/ECONNREFUSED/i.test(rawMessage)) {
      return { message: `Connection refused — ${rawMessage}` }
    }
    if (/ENOTFOUND|EAI_AGAIN/i.test(rawMessage)) {
      return { message: `DNS lookup failed — ${rawMessage}` }
    }
    if (/ETIMEDOUT/i.test(rawMessage)) {
      return { message: `Connection timed out — ${rawMessage}` }
    }
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(rawMessage)) {
      return { message: `TLS certificate error — ${rawMessage}` }
    }
    return { message: rawMessage }
  }

  return { message: 'SSE connection error' }
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

function sendEventToRenderer(windowId: number, event: SseEventPayload): void {
  const win = BrowserWindow.fromId(windowId)
  if (win && !win.isDestroyed()) {
    win.webContents.send('sse:event', event)
  }
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Connects to an SSE endpoint. Dispatches to one of two implementations:
 *   - **EventSource path** (default): plain GET, no body — uses `eventsource@2`
 *     for built-in auto-reconnect + Last-Event-ID semantics.
 *   - **Fetch path**: any non-GET method, or any method with a body —
 *     manual `fetch` + streaming reader. No auto-reconnect (caller handles).
 */
export function connect(
  options: SseConnectOptions,
  windowId: number
): Promise<SseConnectionInfo> {
  const method = (options.method ?? 'GET').toUpperCase() as SseHttpMethod
  const hasBody = typeof options.body === 'string' && options.body.length > 0
  if (method !== 'GET' || hasBody) {
    return connectStreaming({ ...options, method }, windowId)
  }
  return connectEventSource(options, windowId)
}

function connectEventSource(
  options: SseConnectOptions,
  windowId: number
): Promise<SseConnectionInfo> {
  return new Promise((resolve, reject) => {
    const connectionId = randomUUID()

    const initDict: EventSource.EventSourceInitDict = {
      headers: { ...(options.headers ?? {}) },
      withCredentials: options.withCredentials ?? false
    }

    // Include Last-Event-ID header if provided
    if (options.lastEventId) {
      const headers = initDict.headers as Record<string, string>
      headers['Last-Event-ID'] = options.lastEventId
    }

    // Inject default User-Agent unless the caller supplied one (any case).
    applyDefaultUserAgent(initDict.headers as Record<string, string>)

    let eventSource: EventSource
    try {
      eventSource = new EventSource(options.url, initDict)
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }

    const managed: ManagedEventSourceConnection = {
      kind: 'eventsource',
      connectionId,
      eventSource,
      url: options.url,
      connectedAt: Date.now(),
      windowId
    }

    // Connection timeout
    const timeout = setTimeout(() => {
      if (eventSource.readyState === EventSource.CONNECTING) {
        eventSource.close()
        connections.delete(connectionId)
        reject(new Error('SSE connection timeout (15s)'))
      }
    }, 15000)

    eventSource.onopen = () => {
      clearTimeout(timeout)
      connections.set(connectionId, managed)

      sendEventToRenderer(windowId, {
        connectionId,
        type: 'open',
        timestamp: Date.now()
      })

      resolve({
        connectionId,
        url: options.url,
        readyState: eventSource.readyState,
        connectedAt: managed.connectedAt
      })
    }

    eventSource.onmessage = (event: MessageEvent) => {
      sendEventToRenderer(windowId, {
        connectionId,
        type: 'event',
        eventType: 'message',
        data: typeof event.data === 'string' ? event.data : String(event.data),
        id: event.lastEventId || undefined,
        timestamp: Date.now()
      })
    }

    eventSource.onerror = (err: MessageEvent) => {
      clearTimeout(timeout)

      // `eventsource@2` types `onerror` as `MessageEvent`, but at runtime it
      // actually emits a plain `Event` augmented with `{status, message}`
      // for HTTP failures, or `{message}` for transport errors. Cast and
      // read defensively.
      const raw = err as unknown as { status?: unknown; message?: unknown; data?: unknown }
      const { message, httpStatus } = describeSseError(raw)

      sendEventToRenderer(windowId, {
        connectionId,
        type: 'error',
        data: message,
        httpStatus,
        timestamp: Date.now()
      })

      // If not yet connected, reject
      if (!connections.has(connectionId)) {
        connections.delete(connectionId)
        reject(new Error(message))
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
        if (!value.includes(' ')) id = value
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
    // eslint-disable-next-line no-cond-assign
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
  windowId: number
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
        reject(new Error('SSE connection timeout (15s)'))
      }
    }, 15000)

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
          const { message, httpStatus } = describeSseError({
            status: response.status,
            message: response.statusText,
          })
          clearTimeout(timeout)
          sendEventToRenderer(windowId, {
            connectionId,
            type: 'error',
            data: message,
            httpStatus,
            timestamp: Date.now(),
          })
          reject(new Error(message))
          return
        }
        if (!response.body) {
          clearTimeout(timeout)
          const msg = 'SSE response has no body stream'
          sendEventToRenderer(windowId, {
            connectionId,
            type: 'error',
            data: msg,
            timestamp: Date.now(),
          })
          reject(new Error(msg))
          return
        }

        // Handshake succeeded → register, fire `open`, resolve.
        clearTimeout(timeout)
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
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            if (value) parse(decoder.decode(value, { stream: true }))
          }
          // Stream closed cleanly — fire a synthetic error so the renderer
          // can transition out of "connected" if it cares to.
          if (connections.has(connectionId)) {
            sendEventToRenderer(windowId, {
              connectionId,
              type: 'error',
              data: 'SSE stream closed',
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
          const { message, httpStatus } = describeSseError({ message: e?.message })
          sendEventToRenderer(windowId, {
            connectionId,
            type: 'error',
            data: message,
            httpStatus,
            timestamp: Date.now(),
          })
          connections.delete(connectionId)
        }
      })
      .catch((err: unknown) => {
        clearTimeout(timeout)
        const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } }
        if (e?.name === 'AbortError' && connections.has(connectionId)) {
          // Already handled by disconnect; nothing to surface.
          return
        }
        // `fetch` wraps low-level transport errors in `cause`. ECONNREFUSED
        // surfaces as `cause.code === 'ECONNREFUSED'` on Node 18+.
        const raw = e?.cause?.message || e?.message || ''
        const { message, httpStatus } = describeSseError({ message: raw })
        sendEventToRenderer(windowId, {
          connectionId,
          type: 'error',
          data: message,
          httpStatus,
          timestamp: Date.now(),
        })
        if (!connections.has(connectionId)) {
          reject(new Error(message))
        } else {
          connections.delete(connectionId)
        }
      })
  })
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
    connectedAt: managed.connectedAt
  }
}

export function disconnectAll(): void {
  for (const [id] of connections) {
    disconnect(id)
  }
}
