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
import { prepareToolArgs } from './mcp-args-form'
import { kvRowsToRecord } from './mcp-store-helpers'
import { resolveVariables } from './variable-resolver'
import { resolveMcpAuth } from '../stores/mcp-auth.slice'

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

const CREDENTIAL_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'x-access-token',
])

/** Header names whose value is a credential (exact list + token / secret / password / key shapes). */
export function isCredentialHeader(name: string): boolean {
  const n = name.trim().toLowerCase()
  return (
    CREDENTIAL_HEADERS.has(n) || /(token|secret|password|passwd|api[-_]?key|session|cookie)/.test(n)
  )
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
  let url = opts.url
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
  if (capability === 'resources') {
    const uri = resolveVariables(s.resourceUriDraft.trim(), vars)
    return uri ? { kind: 'resource', uri } : null
  }
  if (capability === 'prompts') {
    if (!s.selectedPrompt) return null
    const args: Record<string, string> = {}
    for (const [k, v] of Object.entries(s.promptArgs)) {
      if (v !== '') args[k] = resolveVariables(v, vars)
    }
    return { kind: 'prompt', name: s.selectedPrompt, args }
  }
  if (!s.selectedTool) return null
  const schema = s.tools.find((t) => t.name === s.selectedTool)?.inputSchema
  const prepared = prepareToolArgs(s.toolArgs, vars, schema)
  if (prepared.error) return null
  return { kind: 'tool', name: s.selectedTool, args: prepared.args }
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
