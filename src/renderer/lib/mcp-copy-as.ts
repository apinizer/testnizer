/**
 * "Copy as JSON-RPC / cURL" for an MCP call (issue #174). Pure.
 *
 * The JSON-RPC request is what the tab would send — `{{var}}` resolved,
 * schema-typed args (same `prepareToolArgs` as Invoke). The cURL command is
 * for the Streamable HTTP transport only: a single POST with the tab's
 * headers; credential headers and the Authorization tab are masked as
 * `<redacted>` so a pasted command never leaks a secret. (A 2025-era server
 * also wants the `Mcp-Session-Id` of an initialized session — not ours to
 * copy; a 2026-07-28 server answers the bare request.)
 */
import type { McpCapabilityTab, McpConnectAuth, McpTool } from '../types/mcp'
import type { KeyValuePair } from '../types'
import { sendPromptCall, sendResourceUri, sendToolCall } from './mcp-send-request'
import { kvRowsToRecord } from './mcp-store-helpers'
import { resolveVariables } from './variable-resolver'
import { resolveMcpAuth } from '../stores/mcp-auth.slice'
import { isCredentialHeaderName } from '../../shared/credential-headers'
import { mcpSafeUrl } from '../../shared/mcp-call'

export type McpCopyTarget =
  | { kind: 'tool'; name: string; args: unknown }
  | { kind: 'resource'; uri: string }
  | { kind: 'prompt'; name: string; args: Record<string, string> }

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params: Record<string, unknown>
}

export function buildJsonRpc(target: McpCopyTarget, id = 1): JsonRpcRequest {
  if (target.kind === 'tool') {
    return {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: target.name, arguments: target.args },
    }
  }
  if (target.kind === 'resource') {
    return { jsonrpc: '2.0', id, method: 'resources/read', params: { uri: target.uri } }
  }
  return {
    jsonrpc: '2.0',
    id,
    method: 'prompts/get',
    params: { name: target.name, arguments: target.args },
  }
}

export const REDACTED = '<redacted>'

/**
 * Header names whose value is a credential — the ONE broad rule every MCP
 * diagnostic uses (`src/shared/credential-headers.ts`: gateway names like
 * `Ocp-Apim-Subscription-Key` included). Its own narrower list leaked those.
 */
export function isCredentialHeader(name: string): boolean {
  return isCredentialHeaderName(name.trim())
}

/** POSIX single-quote a word for the shell. */
const sq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

export function buildCurl(opts: {
  url: string
  headers: Record<string, string>
  auth?: McpConnectAuth
  protocolVersion?: string | null
  body: unknown
}): string {
  // No `user:pass@`, credential query values masked — the History rule.
  let url = mcpSafeUrl(opts.url)
  const headers: Array<[string, string]> = [
    ['Content-Type', 'application/json'],
    ['Accept', 'application/json, text/event-stream'],
  ]
  if (opts.protocolVersion) headers.push(['MCP-Protocol-Version', opts.protocolVersion])
  const auth = opts.auth
  // A custom header of the same name wins over the Authorization tab (main's rule).
  const has = (name: string): boolean =>
    Object.keys(opts.headers).some((k) => k.toLowerCase() === name.toLowerCase())
  if (auth?.type === 'bearer' || auth?.type === 'basic' || auth?.type === 'oauth2') {
    if (!has('Authorization')) headers.push(['Authorization', REDACTED])
  } else if (auth?.type === 'api-key' && auth.apiKey) {
    if (auth.apiKey.in === 'query') {
      url += `${url.includes('?') ? '&' : '?'}${encodeURIComponent(auth.apiKey.key)}=${REDACTED}`
    } else if (!has(auth.apiKey.key)) {
      headers.push([auth.apiKey.key, REDACTED])
    }
  }
  for (const [k, v] of Object.entries(opts.headers)) {
    headers.push([k, isCredentialHeader(k) ? REDACTED : v])
  }
  const lines = [`curl -X POST ${sq(url)}`]
  for (const [k, v] of headers) lines.push(`  -H ${sq(`${k}: ${v}`)}`)
  lines.push(`  --data-raw ${sq(JSON.stringify(opts.body))}`)
  return lines.join(' \\\n')
}

/** The slice of a tab the copy needs. */
export interface McpCopyState {
  transport: 'http' | 'sse' | 'stdio'
  url: string
  customHeaders: KeyValuePair[]
  auth: McpConnectAuth
  protocolVersion: string | null
  tools: McpTool[]
  selectedTool: string | null
  toolArgs: string
  resourceUriDraft: string
  selectedPrompt: string | null
  promptArgs: Record<string, string>
}

/** The tab's current call as a copy target, `{{var}}` resolved; null when there is none / bad JSON. */
export function copyTargetOf(
  s: McpCopyState,
  capability: McpCapabilityTab,
  vars: Record<string, string>,
): McpCopyTarget | null {
  // The same Send entry Invoke / Read / Get use (`mcp-send-request.ts`, shared with Run).
  if (capability === 'resources') {
    // A copy may still hold an unfilled `{id}` — the user sees it in the command.
    const { uri } = sendResourceUri(s.resourceUriDraft, vars)
    return uri ? { kind: 'resource', uri } : null
  }
  if (capability === 'prompts') {
    if (!s.selectedPrompt) return null
    const { args } = sendPromptCall(s.selectedPrompt, s.promptArgs, vars)
    return { kind: 'prompt', name: s.selectedPrompt, args }
  }
  if (!s.selectedTool) return null
  const schema = s.tools.find((t) => t.name === s.selectedTool)?.inputSchema
  const prepared = sendToolCall(s.selectedTool, s.toolArgs, vars, schema)
  if (prepared.error) return null
  return { kind: 'tool', name: s.selectedTool, args: prepared.call.args }
}

/** cURL for the tab's call (Streamable HTTP only). */
export function curlOf(
  s: McpCopyState,
  target: McpCopyTarget,
  vars: Record<string, string>,
): string {
  return buildCurl({
    url: resolveVariables(s.url, vars).trim(),
    headers: kvRowsToRecord(s.customHeaders, vars),
    auth: s.auth.type === 'oauth2' ? s.auth : resolveMcpAuth(s.auth, vars),
    protocolVersion: s.protocolVersion,
    body: buildJsonRpc(target),
  })
}
