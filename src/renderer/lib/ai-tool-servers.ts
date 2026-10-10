/**
 * AI Chat Send → the MCP servers offered as tools (issue #180). Every
 * connection is built by the SHARED MCP call source (`buildMcpConnect` in
 * `src/shared/mcp-call.ts`) — the same builder MCP Send and Run use — with
 * `{{var}}` resolved against the active environment, exactly like the MCP
 * tab. A picked saved MCP request is read from its row at Send time (its
 * headers, auth, env and timeout are the request's own).
 */
import { buildMcpConnect, type McpKvRow } from '../../shared/mcp-call'
import { readRequestSettings, resolveMcpTimeout } from '../../shared/request-settings'
import { resolveVariables } from './variable-resolver'
import type { AiToolServerConfig } from './ai-chat-tools-config'
import { serverLabel } from './ai-chat-tools-config'

export interface AiToolServerPayload {
  id: string
  name: string
  connect: ReturnType<typeof buildMcpConnect>
  disabledTools: string[]
  oauth?: boolean
  timeoutMs?: number
}

export interface AiToolsBuild {
  servers: AiToolServerPayload[]
  /** Servers that could not be prepared (row deleted, not an MCP request, no URL). */
  problems: Array<{ serverId: string; server: string; message: string }>
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

const parseJson = (text: unknown): unknown => {
  if (typeof text !== 'string' || !text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const rows = (v: unknown): McpKvRow[] =>
  Array.isArray(v)
    ? v.filter(isRec).map((r) => ({
        key: typeof r.key === 'string' ? r.key : '',
        value: typeof r.value === 'string' ? r.value : '',
        enabled: r.enabled !== false,
      }))
    : []

/** A saved MCP request row → its `metadata.mcp` block, settings bag and display name. */
async function loadSavedMcp(
  s: AiToolServerConfig,
): Promise<
  { mcp: Record<string, unknown>; settings: unknown; name: string; fallbackUrl: string } | string
> {
  if (s.missing) return 'The saved MCP request is not in this project (not copied with it)'
  if (!s.requestId) return 'No MCP request selected'
  if (s.requestKind === 'endpoint') {
    const res = (await window.api?.endpoint?.get(s.requestId)) as
      | { success: boolean; data?: Record<string, unknown> }
      | undefined
    if (!res?.success || !res.data) return 'The saved MCP request no longer exists'
    const schema = parseJson(res.data.request_schema)
    const meta = isRec(schema) && isRec(schema.metadata) ? schema.metadata : {}
    if (!isRec(meta.mcp)) return 'The saved request is not an MCP request'
    return {
      mcp: meta.mcp,
      settings: schema,
      name: String(res.data.name ?? ''),
      fallbackUrl: String(res.data.path ?? ''),
    }
  }
  const res = (await window.api?.savedRequest?.get(s.requestId)) as
    | { success: boolean; data?: Record<string, unknown> }
    | undefined
  if (!res?.success || !res.data) return 'The saved MCP request no longer exists'
  const meta = parseJson(res.data.metadata)
  if (!isRec(meta) || !isRec(meta.mcp)) return 'The saved request is not an MCP request'
  return {
    mcp: meta.mcp,
    settings: meta,
    name: String(res.data.name ?? ''),
    fallbackUrl: String(res.data.url ?? ''),
  }
}

/** One server config → the payload main gets, or a problem message. */
export async function buildToolServer(
  s: AiToolServerConfig,
  vars: Record<string, string>,
): Promise<AiToolServerPayload | string> {
  const resolve = (text: string): string => resolveVariables(text, vars)
  if (s.source === 'saved') {
    const loaded = await loadSavedMcp(s)
    if (typeof loaded === 'string') return loaded
    const m = loaded.mcp
    const transport = m.transport === 'sse' || m.transport === 'stdio' ? m.transport : 'http'
    const connect = buildMcpConnect(
      {
        transport,
        url: typeof m.url === 'string' ? m.url : loaded.fallbackUrl,
        customHeaders: rows(m.customHeaders),
        envVars: rows(m.envVars),
        auth: m.auth,
        protocol: m.protocol,
      },
      resolve,
    )
    if (!connect.url && !connect.command) return 'No server URL configured for the MCP request'
    const oauth = isRec(m.auth) && m.auth.type === 'oauth2'
    return {
      id: s.id,
      name: loaded.name.trim() || serverLabel(s),
      connect,
      disabledTools: [...s.disabledTools],
      ...(oauth ? { oauth: true } : {}),
      timeoutMs: resolveMcpTimeout(readRequestSettings(loaded.settings).timeout),
    }
  }
  const connect = buildMcpConnect(
    {
      transport: s.transport ?? 'http',
      url: s.url ?? '',
      customHeaders: rows(s.headers),
      envVars: rows(s.envVars),
      auth: undefined,
      protocol: 'auto',
    },
    resolve,
  )
  if (!connect.url && !connect.command) return 'No server URL or command'
  return {
    id: s.id,
    name: serverLabel(s),
    connect,
    disabledTools: [...s.disabledTools],
    timeoutMs: resolveMcpTimeout(undefined),
  }
}

/** The ENABLED servers of a tab → payload servers + problems (shown on the turn). */
export async function buildToolServers(
  servers: readonly AiToolServerConfig[],
  vars: Record<string, string>,
): Promise<AiToolsBuild> {
  const out: AiToolsBuild = { servers: [], problems: [] }
  for (const s of servers) {
    if (!s.enabled) continue
    const built = await buildToolServer(s, vars)
    if (typeof built === 'string') {
      out.problems.push({ serverId: s.id, server: serverLabel(s), message: built })
    } else {
      out.servers.push(built)
    }
  }
  return out
}
