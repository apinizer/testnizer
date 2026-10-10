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
import { createScrubber, maskConsoleEntry, type ConsoleEntryLike } from './sensitive-scrub'

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

/**
 * Masking reads a bounded window of a huge body — `MAX_PAYLOAD_BYTES` plus
 * this slack — never the whole multi-MB payload (one Console entry per frame).
 */
const MASK_WINDOW_SLACK = 64 * 1024
/**
 * When the window cut a body, its last characters may hold the cut-off (so
 * unrecognisable) start of a secret; that tail is always dropped. Longer than
 * any realistic secret / credential field.
 */
const MASK_WINDOW_TAIL = 16 * 1024
const MASK_WINDOW = MAX_PAYLOAD_BYTES + MASK_WINDOW_SLACK

/** A masked body, clipped; `cutFrom` = original length when the window cut it. */
function clipBody(text: string | undefined, cutFrom?: number): string | undefined {
  if (typeof text !== 'string' || cutFrom === undefined) return clip(text)
  const keep = Math.max(0, Math.min(MAX_PAYLOAD_BYTES, text.length - MASK_WINDOW_TAIL))
  return text.slice(0, keep) + `\n…[truncated, ${cutFrom - keep} more chars]`
}

/**
 * Mask, THEN clip (issue #196): clipping first could cut a secret or a
 * `"password":"…"` field in half, and the cut fragment no longer matches the
 * value scrub or the name rule. The mask sees a bounded window of each body
 * (`MASK_WINDOW`), so a huge payload costs no more than a 320 KiB one.
 */
function maskThenClip<T extends ConsoleEntryLike>(entry: T, mask: (e: T) => T): T {
  const d = entry.details
  if (!d) return mask(entry)
  const reqCut =
    typeof d.requestBody === 'string' && d.requestBody.length > MASK_WINDOW
      ? d.requestBody.length
      : undefined
  const resCut =
    typeof d.responseBody === 'string' && d.responseBody.length > MASK_WINDOW
      ? d.responseBody.length
      : undefined
  const windowed: T =
    reqCut === undefined && resCut === undefined
      ? entry
      : {
          ...entry,
          details: {
            ...d,
            requestBody:
              reqCut === undefined ? d.requestBody : d.requestBody?.slice(0, MASK_WINDOW),
            responseBody:
              resCut === undefined ? d.responseBody : d.responseBody?.slice(0, MASK_WINDOW),
          },
        }
  const masked = mask(windowed)
  const md = masked.details
  if (!md) return masked
  const req = clipBody(md.requestBody, reqCut)
  const res = clipBody(md.responseBody, resCut)
  if (req === md.requestBody && res === md.responseBody) return masked
  return { ...masked, details: { ...md, requestBody: req, responseBody: res } }
}

const unmasked = <T>(e: T): T => e

function levelFromStatus(status?: number, hasError?: boolean): ConsoleLevel {
  if (hasError) return 'error'
  if (status == null) return 'info'
  if (status >= 400) return 'error'
  if (status >= 300) return 'warning'
  if (status >= 200) return 'success'
  return 'info'
}

// ─── Masking (issue #196) ───────────────────────────────────────────

/**
 * Where the Console reads the secret values it scrubs from — registered once
 * at startup (`ipc/console.handler.ts`) as "every variable marked secret".
 * This module never imports the database itself: its tests and some
 * handlers' tests run without one, and then only the name rule applies.
 */
let secretSource: (() => unknown[]) | null = null

export function setConsoleSecretSource(source: (() => unknown[]) | null): void {
  secretSource = source
}

/**
 * Per-session "Show secrets" (issue #196). OFF by default, held only in this
 * process's memory — never persisted, so every app start masks again. While
 * ON, NEW entries leave main unmasked; entries emitted earlier stay masked
 * (they were masked before they left main, and main keeps no raw copy).
 */
let showSecrets = false

export function setConsoleShowSecrets(on: boolean): void {
  showSecrets = on === true
}

export function getConsoleShowSecrets(): boolean {
  return showSecrets
}

/** Extra secret values one entry carries (e.g. the request's own auth). */
export interface ConsoleSecretHints {
  secrets?: unknown[]
}

function maskForConsole(
  entry: ConsoleLogEntryWire,
  hints?: ConsoleSecretHints,
): ConsoleLogEntryWire {
  if (showSecrets) return entry
  let known: unknown[] = []
  try {
    known = secretSource ? secretSource() : []
  } catch {
    known = []
  }
  return maskConsoleEntry(entry, createScrubber([...known, ...(hints?.secrets ?? [])]))
}

/**
 * Mask an entry the RENDERER built — script `console.*` output from Send,
 * which never passes through main (`console:maskEntry`, issue #196). Same
 * helper and same session toggle as every entry main emits.
 */
export function maskRendererConsoleEntry<T extends ConsoleEntryLike>(entry: T): T {
  if (showSecrets) return maskThenClip(entry, unmasked)
  let known: unknown[] = []
  try {
    known = secretSource ? secretSource() : []
  } catch {
    known = []
  }
  const scrub = createScrubber(known)
  return maskThenClip(entry, (e) => maskConsoleEntry(e, scrub))
}

/**
 * Broadcast an entry to every visible BrowserWindow — masked unless the user
 * turned "Show secrets" on for this session (issue #196). Every Console entry
 * main produces goes through here, so nothing reaches the renderer raw.
 *
 * Wrapped in try/catch so a window in the middle of being destroyed never
 * propagates an exception out to a request handler.
 */
export function emitConsoleEntry(entry: ConsoleLogEntryWire, hints?: ConsoleSecretHints): void {
  try {
    // Mask the FULL payload, then clip (issue #196).
    const out = maskThenClip(entry, (e) => maskForConsole(e, hints))
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(CHANNEL, out)
      }
    }
  } catch {
    // best-effort
  }
}

// ─── Public helpers ─────────────────────────────────────────────────

export interface LogRequestResponseArgs {
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
  /** Secret values this cycle carried (its resolved auth) — scrubbed from the entry. */
  secrets?: unknown[]
}

/**
 * Single-entry logger for request/response protocol cycles (HTTP, SOAP,
 * GraphQL, gRPC unary, MCP call, AI chat, Socket.IO connect). Emits one
 * collapsible row that carries both the request side (headers + body
 * via `args.requestHeaders` / `requestBody`) and the response side
 * (`responseHeaders` / `responseBody` / `status` / `durationMs`).
 *
 * Renamed from `logResponse` for accuracy: the row represents the WHOLE
 * cycle, not just the response leg. The old name is re-exported below
 * for backwards-compat with existing call sites and tests.
 */
export function logRequestResponse(args: LogRequestResponseArgs): void {
  emitConsoleEntry(
    {
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
        // Unclipped here: `emitConsoleEntry` masks first, then clips.
        requestBody: args.requestBody,
        responseHeaders: args.responseHeaders,
        responseBody: args.responseBody,
        error: args.error,
        meta: args.meta,
      },
    },
    { secrets: args.secrets },
  )
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
  /** Secret values this event may carry — scrubbed from the entry. */
  secrets?: unknown[]
}

export function logEvent(args: LogEventArgs): void {
  emitConsoleEntry(
    {
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
        responseBody: args.direction === 'in' ? args.body : undefined,
        requestBody: args.direction === 'out' ? args.body : undefined,
        error: args.error,
        meta: args.meta,
      },
    },
    { secrets: args.secrets },
  )
}

export const __testing = {
  clip,
  levelFromStatus,
  CHANNEL,
  MAX_PAYLOAD_BYTES,
  MASK_WINDOW,
  MASK_WINDOW_TAIL,
}
