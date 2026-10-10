/**
 * MCP call result → the script/assertion world (issues #160, #161).
 *
 * An MCP call has no HTTP response, yet `pm.response`, `pm.test`, the
 * assertion rows and the Runner verdict (`endpointDidPass`) all speak
 * `NormalizedResponse`. This module is the ONE adapter between the two, used
 * by BOTH paths — the renderer's Send (post-call script + assertions on an MCP
 * tab) and main's Run (`runner.handler.ts`) — so an MCP result reads the same
 * on Send and Run by construction (the script-runtime parity rule).
 *
 * Pure TS: no node / electron / DOM imports — compiled into both bundles.
 *
 * Mapping (fixed contract):
 *  - success                → code 200, statusText 'OK'
 *  - tool result isError    → code 500, statusText 'Tool Error' (so a tool
 *                             error fails a check-less row via `status < 400`)
 *  - responseTime           → timing.durationMs (0 when absent)
 *  - responseSize           → timing.sizeBytes (UTF-8 size of the result JSON when absent)
 *  - headers                → { 'content-type': 'application/json' | 'text/plain' }
 *  - tool body              → JSON of `structuredContent` when present; else the
 *                             text blocks joined with "\n" when there is at
 *                             least one block and every block is text; else
 *                             JSON of the whole result
 *  - resource body          → text contents joined with "\n" when there is at
 *                             least one and all are text; else JSON of `contents`
 *  - prompt body            → JSON of `messages`
 *  - error / cancelled / an `input_required` round → `null` (no response)
 */
import type { NormalizedResponse } from './script/types'

export type McpCapability = 'tool' | 'resource' | 'prompt'

export interface McpCallOutcome {
  capability: McpCapability
  /** Tool / prompt name, or the resource URI. */
  name: string
  /** CallToolResult | ReadResourceResult | GetPromptResult as returned. */
  result?: unknown
  /** Transport / protocol error (no result). */
  error?: string
  cancelled?: boolean
  timing?: { durationMs: number; sizeBytes: number }
}

/** `pm.mcp` — the MCP-native view of the call, next to the HTTP-shaped `pm.response`. */
export interface McpScriptInfo {
  capability: McpCapability
  name: string
  /** Tool results only: the server's `isError`. Always false for resources / prompts. */
  isError: boolean
  /** The raw result object (CallToolResult / ReadResourceResult / GetPromptResult). */
  result: unknown
  /** Tool results only, when the server returned it. */
  structuredContent?: unknown
  /**
   * The result's item list: tool → `content` blocks, resource → `contents`,
   * prompt → `messages`. Absent when the result has none.
   */
  content?: unknown[]
}

const JSON_TYPE = 'application/json'
const TEXT_TYPE = 'text/plain'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

/** A 2026-07-28 `input_required` round (the engine marks it `__mcp.kind`, the SDK `resultType`). */
function isInputRequired(result: unknown): boolean {
  if (!isRecord(result)) return false
  if (result.resultType === 'input_required') return true
  return isRecord(result.__mcp) && result.__mcp.kind === 'input_required'
}

/** The result as the user sees it — without the engine's private `__mcp` marker. */
function publicResult(result: unknown): unknown {
  if (!isRecord(result) || !('__mcp' in result)) return result
  const { __mcp: _marker, ...rest } = result
  return rest
}

function isToolError(o: McpCallOutcome): boolean {
  return o.capability === 'tool' && isRecord(o.result) && o.result.isError === true
}

/** Join `items[*].text` when there is at least one item and every item carries text. */
function joinedText(
  items: unknown,
  isText: (item: Record<string, unknown>) => boolean,
): string | null {
  if (!Array.isArray(items) || items.length === 0) return null
  const texts: string[] = []
  for (const item of items) {
    if (!isRecord(item) || !isText(item) || typeof item.text !== 'string') return null
    texts.push(item.text)
  }
  return texts.join('\n')
}

function bodyOf(o: McpCallOutcome): { body: string; contentType: string } {
  const result = publicResult(o.result)
  const r = isRecord(result) ? result : {}
  if (o.capability === 'tool') {
    if (r.structuredContent !== undefined) {
      return { body: stringify(r.structuredContent), contentType: JSON_TYPE }
    }
    const text = joinedText(r.content, (b) => b.type === 'text')
    if (text !== null) return { body: text, contentType: TEXT_TYPE }
    return { body: stringify(result), contentType: JSON_TYPE }
  }
  if (o.capability === 'resource') {
    const text = joinedText(r.contents, () => true)
    if (text !== null) return { body: text, contentType: TEXT_TYPE }
    return { body: stringify(r.contents ?? []), contentType: JSON_TYPE }
  }
  return { body: stringify(r.messages ?? []), contentType: JSON_TYPE }
}

/** True when the outcome carries a usable result (not an error / cancel / input round). */
function hasResult(o: McpCallOutcome): boolean {
  return !o.error && !o.cancelled && o.result !== undefined && !isInputRequired(o.result)
}

/** The HTTP-shaped response `pm.response` / assertions / the verdict read. `null` = no response. */
export function mcpOutcomeToResponse(o: McpCallOutcome): NormalizedResponse | null {
  if (!hasResult(o)) return null
  const { body, contentType } = bodyOf(o)
  const toolError = isToolError(o)
  return {
    code: toolError ? 500 : 200,
    statusText: toolError ? 'Tool Error' : 'OK',
    headers: { 'content-type': contentType },
    body,
    cookies: [],
    responseTime: o.timing?.durationMs ?? 0,
    responseSize: o.timing?.sizeBytes ?? utf8Length(stringify(publicResult(o.result))),
  }
}

/** `pm.mcp` for a finished call. `null` when there is no result to describe. */
export function mcpScriptInfo(o: McpCallOutcome): McpScriptInfo | null {
  if (!hasResult(o)) return null
  const result = publicResult(o.result)
  const r = isRecord(result) ? result : {}
  const list =
    o.capability === 'tool' ? r.content : o.capability === 'resource' ? r.contents : r.messages
  const info: McpScriptInfo = {
    capability: o.capability,
    name: o.name,
    isError: isToolError(o),
    result,
  }
  if (o.capability === 'tool' && r.structuredContent !== undefined) {
    info.structuredContent = r.structuredContent
  }
  if (Array.isArray(list)) info.content = list
  return info
}
