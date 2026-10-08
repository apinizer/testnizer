/**
 * Small JSON-RPC / protocol helpers shared by the Mock MCP HTTP layers
 * (`server.ts`, `handler.ts`, `legacy-sse.ts`): log-text shaping, picking the
 * requests / cancellations out of a POST body, era classification of an
 * inbound request (the SDK's own `classifyInboundRequest`, so the log and
 * the pin gate agree with `createMcpHandler`'s routing), outcome extraction
 * from a response message, and the 2025-era protocol-pin check.
 */

import {
  classifyInboundRequest,
  isInitializeRequest,
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  ProtocolErrorCode,
  type JSONRPCErrorResponse,
} from '@modelcontextprotocol/server'
import type { MockMcpEra } from './types'

export const MAX_LOG_TEXT = 8 * 1024

export function truncate(text: string): string {
  return text.length > MAX_LOG_TEXT ? `${text.slice(0, MAX_LOG_TEXT)}… (truncated)` : text
}

export function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return String(v)
  }
}

export function messagesOf(body: unknown): unknown[] {
  if (body === undefined) return []
  return Array.isArray(body) ? body : [body]
}

/** One JSON-RPC request carried by a POST, as the log needs it. */
export interface JsonRpcCall {
  id: string | number
  method: string
  toolName?: string
  /** The request as JSON text, truncated. */
  text: string
}

export function callsOf(body: unknown): JsonRpcCall[] {
  const out: JsonRpcCall[] = []
  for (const m of messagesOf(body)) {
    if (!isJSONRPCRequest(m)) continue
    const toolName =
      m.method === 'tools/call' && typeof m.params?.name === 'string' ? m.params.name : undefined
    out.push({
      id: m.id,
      method: m.method,
      ...(toolName ? { toolName } : {}),
      text: truncate(safeStringify(m)),
    })
  }
  return out
}

/** First JSON-RPC request in the body, for HTTP-level log lines. */
export function firstRequest(body: unknown): { method: string; toolName?: string } | null {
  const [first] = callsOf(body)
  return first
    ? { method: first.method, ...(first.toolName ? { toolName: first.toolName } : {}) }
    : null
}

/** Request ids named by `notifications/cancelled` messages in the body. */
export function cancelledIdsOf(body: unknown): (string | number)[] {
  const out: (string | number)[] = []
  for (const m of messagesOf(body)) {
    if (!isJSONRPCNotification(m) || m.method !== 'notifications/cancelled') continue
    const id = m.params?.requestId
    if (typeof id === 'string' || typeof id === 'number') out.push(id)
  }
  return out
}

export interface InboundEra {
  era: MockMcpEra
  /** `true` when the SDK routes it to the 2026-07-28 path (not a ladder rejection). */
  modernRoute: boolean
  /** The protocol version the request named (initialize body, envelope, or header). */
  requestedVersion?: string
}

function headerValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/**
 * Era of an inbound request, decided by the SDK's own classifier (the exact
 * code path `createMcpHandler` / `isLegacyRequest` run). A POST without a
 * JSON body is legacy (the stateless leg answers it); ladder rejections
 * belong to the modern path.
 */
export function classifyEra(
  httpMethod: string,
  headers: Record<string, string | string[] | undefined>,
  body: unknown,
): InboundEra {
  const protocolVersionHeader = headerValue(headers['mcp-protocol-version'])
  if (httpMethod === 'POST' && body === undefined) {
    return { era: 'legacy', modernRoute: false }
  }
  const mcpMethodHeader = headerValue(headers['mcp-method'])
  const mcpNameHeader = headerValue(headers['mcp-name'])
  const outcome = classifyInboundRequest({
    httpMethod,
    ...(protocolVersionHeader !== undefined ? { protocolVersionHeader } : {}),
    ...(mcpMethodHeader !== undefined ? { mcpMethodHeader } : {}),
    ...(mcpNameHeader !== undefined ? { mcpNameHeader } : {}),
    ...(body !== undefined ? { body } : {}),
  })
  if (outcome.kind === 'legacy') {
    const requestedVersion = outcome.requestedVersion ?? protocolVersionHeader
    return { era: 'legacy', modernRoute: false, ...(requestedVersion ? { requestedVersion } : {}) }
  }
  const requestedVersion =
    (outcome.kind === 'modern' ? outcome.classification.revision : undefined) ??
    protocolVersionHeader
  return {
    era: 'modern',
    modernRoute: outcome.kind === 'modern',
    ...(requestedVersion ? { requestedVersion } : {}),
  }
}

export interface ResponseOutcome {
  id: string | number
  ok: boolean
  errorCode?: number
  inputRequired?: boolean
  text: string
}

/** A JSON-RPC response message → its log outcome, or null for anything else. */
export function outcomeOf(m: unknown): ResponseOutcome | null {
  if (isJSONRPCResultResponse(m)) {
    const result = m.result as Record<string, unknown>
    return {
      id: m.id,
      ok: true,
      ...(result.resultType === 'input_required' ? { inputRequired: true } : {}),
      text: safeStringify(m),
    }
  }
  if (isJSONRPCErrorResponse(m) && (typeof m.id === 'string' || typeof m.id === 'number')) {
    return { id: m.id, ok: false, errorCode: m.error.code, text: safeStringify(m) }
  }
  return null
}

/** Messages in a response body: a JSON value / batch, or the `data:` lines of an SSE stream. */
export function parseResponseMessages(text: string, contentType: string): unknown[] {
  if (!text) return []
  if (contentType.includes('text/event-stream')) {
    const out: unknown[] = []
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data) continue
      try {
        out.push(JSON.parse(data) as unknown)
      } catch {
        /* keep-alive or partial frame */
      }
    }
    return out
  }
  try {
    return messagesOf(JSON.parse(text) as unknown)
  } catch {
    return []
  }
}

/**
 * The 2025-era protocol pin: an `initialize` asking for any other version is
 * answered with Invalid Params (the pre-v2 behaviour the mock always had —
 * 2025 clients surface it as a JSON-RPC error, not a counter-offer).
 */
export function initializePinError(message: unknown, pin: string): JSONRPCErrorResponse | null {
  if (!isJSONRPCRequest(message) || !isInitializeRequest(message)) return null
  const requested = message.params.protocolVersion
  if (requested === pin) return null
  return {
    jsonrpc: '2.0',
    id: message.id,
    error: {
      code: ProtocolErrorCode.InvalidParams,
      message: `Unsupported protocol version: ${requested} (supported versions: ${pin})`,
      data: { supported: [pin], requested },
    },
  }
}
