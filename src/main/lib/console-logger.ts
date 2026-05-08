/**
 * Main-process console logger.
 *
 * Each protocol handler calls into these helpers to push a structured log
 * entry over IPC to the renderer. The renderer's `useConsoleStore` listens
 * on the `console:log` channel and accumulates entries for the
 * Postman-style ConsolePanel + per-tab ConsoleTab view.
 *
 * Helpers stay deliberately small and side-effect-free aside from sending
 * the IPC event; they never throw — a logging failure must not break a
 * request.
 */

import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'

const CHANNEL = 'console:log'

// Cap individual payloads so the IPC channel never carries multi-MB blobs
// of inline media. The full body is still available via the request's
// dedicated response store; this is just the inline preview.
const MAX_PAYLOAD_BYTES = 256 * 1024 // 256 KiB

export type ConsoleProtocol =
  | 'http'
  | 'soap'
  | 'grpc'
  | 'websocket'
  | 'graphql'
  | 'sse'
  | 'mcp'
  | 'socketio'
  | 'ai'

export type ConsoleLevel = 'info' | 'success' | 'warning' | 'error'
export type ConsoleCategory = 'request' | 'response' | 'event' | 'connection' | 'system'

export interface ConsoleLogEntryWire {
  id: string
  timestamp: number
  protocol: ConsoleProtocol
  level: ConsoleLevel
  category: ConsoleCategory
  tabId?: string
  method?: string
  url?: string
  status?: number
  statusText?: string
  durationMs?: number
  sizeBytes?: number
  message?: string
  details?: {
    requestHeaders?: Record<string, string>
    requestBody?: string
    responseHeaders?: Record<string, string>
    responseBody?: string
    error?: { message: string; stack?: string }
    direction?: 'in' | 'out'
    eventName?: string
    meta?: Record<string, string | number | boolean>
  }
}

function clip(text: string | undefined): string | undefined {
  if (text == null) return undefined
  if (typeof text !== 'string') return undefined
  if (text.length <= MAX_PAYLOAD_BYTES) return text
  return (
    text.slice(0, MAX_PAYLOAD_BYTES) +
    `\n…[truncated, ${text.length - MAX_PAYLOAD_BYTES} more chars]`
  )
}

function levelFromStatus(status?: number, hasError?: boolean): ConsoleLevel {
  if (hasError) return 'error'
  if (status == null) return 'info'
  if (status >= 400) return 'error'
  if (status >= 300) return 'warning'
  if (status >= 200) return 'success'
  return 'info'
}

/**
 * Broadcast an entry to every visible BrowserWindow.
 *
 * Wrapped in try/catch so a window in the middle of being destroyed never
 * propagates an exception out to a request handler.
 */
export function emitConsoleEntry(entry: ConsoleLogEntryWire): void {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(CHANNEL, entry)
      }
    }
  } catch {
    // best-effort
  }
}

// ─── Public helpers ─────────────────────────────────────────────────

export interface LogRequestArgs {
  protocol: ConsoleProtocol
  method?: string
  url?: string
  headers?: Record<string, string>
  body?: string
  tabId?: string
  message?: string
  meta?: Record<string, string | number | boolean>
}

export function logRequest(args: LogRequestArgs): void {
  emitConsoleEntry({
    id: randomUUID(),
    timestamp: Date.now(),
    protocol: args.protocol,
    level: 'info',
    category: 'request',
    tabId: args.tabId,
    method: args.method,
    url: args.url,
    message: args.message ?? [args.method, args.url].filter(Boolean).join(' '),
    details: {
      requestHeaders: args.headers,
      requestBody: clip(args.body),
      meta: args.meta,
    },
  })
}

export interface LogResponseArgs {
  protocol: ConsoleProtocol
  method?: string
  url?: string
  status?: number
  statusText?: string
  durationMs?: number
  sizeBytes?: number
  requestHeaders?: Record<string, string>
  requestBody?: string
  responseHeaders?: Record<string, string>
  responseBody?: string
  error?: { message: string; stack?: string }
  tabId?: string
  message?: string
  meta?: Record<string, string | number | boolean>
}

export function logResponse(args: LogResponseArgs): void {
  emitConsoleEntry({
    id: randomUUID(),
    timestamp: Date.now(),
    protocol: args.protocol,
    level: levelFromStatus(args.status, !!args.error),
    category: 'response',
    tabId: args.tabId,
    method: args.method,
    url: args.url,
    status: args.status,
    statusText: args.statusText,
    durationMs: args.durationMs,
    sizeBytes: args.sizeBytes,
    message:
      args.message ??
      (args.error
        ? `${args.method ?? ''} ${args.url ?? ''} → ${args.error.message}`.trim()
        : `${args.method ?? ''} ${args.url ?? ''} → ${args.status ?? '—'}`.trim()),
    details: {
      requestHeaders: args.requestHeaders,
      requestBody: clip(args.requestBody),
      responseHeaders: args.responseHeaders,
      responseBody: clip(args.responseBody),
      error: args.error,
      meta: args.meta,
    },
  })
}

export interface LogEventArgs {
  protocol: ConsoleProtocol
  category?: ConsoleCategory
  level?: ConsoleLevel
  message: string
  url?: string
  direction?: 'in' | 'out'
  eventName?: string
  body?: string
  /** Time since the connection opened (or since the previous event), in ms. */
  durationMs?: number
  /** Payload size in bytes (raw frame for binary, UTF-8 byte length for text). */
  sizeBytes?: number
  status?: number
  statusText?: string
  tabId?: string
  meta?: Record<string, string | number | boolean>
  error?: { message: string; stack?: string }
}

export function logEvent(args: LogEventArgs): void {
  emitConsoleEntry({
    id: randomUUID(),
    timestamp: Date.now(),
    protocol: args.protocol,
    level: args.level ?? (args.error ? 'error' : 'info'),
    category: args.category ?? 'event',
    tabId: args.tabId,
    url: args.url,
    status: args.status,
    statusText: args.statusText,
    durationMs: args.durationMs,
    sizeBytes: args.sizeBytes,
    message: args.message,
    details: {
      direction: args.direction,
      eventName: args.eventName,
      responseBody: args.direction === 'in' ? clip(args.body) : undefined,
      requestBody: args.direction === 'out' ? clip(args.body) : undefined,
      error: args.error,
      meta: args.meta,
    },
  })
}

export const __testing = { clip, levelFromStatus, CHANNEL, MAX_PAYLOAD_BYTES }
