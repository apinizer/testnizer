/**
 * Defensive reading of the `aichat:send` payload's new parts (issue #180):
 * the conversation history + prompt and the Tools config. IPC input is never
 * trusted — every field is type-checked and anything unexpected is dropped.
 */
import { historyAsText, sanitizeTurns } from '../../shared/ai-chat-turns'
import { normalizeMcpProtocolOption, type McpConnectParams } from '../../shared/mcp-call'
import type { AiChatMessage, AiWireMessage } from '../protocols/ai-chat.engine'
import type { AiToolServerSpec, AiTurnTools } from '../protocols/ai-chat-loop'
import { parseMcpAuth } from '../protocols/mcp-auth'

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

function stringMap(v: unknown): Record<string, string> | undefined {
  if (!isRec(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v)) if (typeof val === 'string') out[k] = val
  return Object.keys(out).length > 0 ? out : undefined
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
}

function parseConnect(raw: unknown): McpConnectParams | null {
  if (!isRec(raw)) return null
  const transport = raw.transport
  if (transport !== 'http' && transport !== 'sse' && transport !== 'stdio') return null
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  const out: McpConnectParams = {
    transport,
    url,
    protocol: normalizeMcpProtocolOption(raw.protocol),
  }
  if (transport === 'stdio') {
    if (typeof raw.command === 'string' && raw.command) {
      out.command = raw.command
      out.args = stringList(raw.args)
    }
    if (!out.command && !url) return null
    const env = stringMap(raw.env)
    if (env) out.env = env
    return out
  }
  if (!url) return null
  const headers = stringMap(raw.headers)
  if (headers) out.headers = headers
  const auth = parseMcpAuth(raw.auth)
  if (auth && (auth.type === 'basic' || auth.type === 'bearer' || auth.type === 'api-key')) {
    out.auth = auth as McpConnectParams['auth']
  }
  return out
}

/** `payload.tools` → the loop's tools config, or undefined when no server survives. */
export function parseToolsPayload(raw: unknown): AiTurnTools | undefined {
  if (!isRec(raw) || !Array.isArray(raw.servers)) return undefined
  const servers: AiToolServerSpec[] = []
  const ids = new Set<string>()
  for (const s of raw.servers) {
    if (!isRec(s) || typeof s.id !== 'string' || !s.id || ids.has(s.id)) continue
    const connect = parseConnect(s.connect)
    if (!connect) continue
    ids.add(s.id)
    const timeout = s.timeoutMs
    servers.push({
      id: s.id,
      name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : connect.url || 'server',
      connect,
      disabledTools: stringList(s.disabledTools),
      ...(s.oauth === true ? { oauth: true } : {}),
      ...(typeof timeout === 'number' && Number.isFinite(timeout) && timeout >= 0
        ? { timeoutMs: timeout }
        : {}),
    })
  }
  if (servers.length === 0) return undefined
  return {
    ...(typeof raw.projectId === 'string' && raw.projectId ? { projectId: raw.projectId } : {}),
    servers,
    autoApprove: raw.autoApprove === true,
    allowedTools: stringList(raw.allowedTools),
  }
}

/**
 * The transcript the first LLM call gets. New payloads send `prompt` (+
 * `system`, `history` turns): earlier turns are replayed as text only
 * (`historyAsText`). Older payloads send a flat `messages` list.
 */
export function initialMessages(payload: Record<string, unknown>): AiWireMessage[] {
  if (typeof payload.prompt === 'string') {
    const out: AiWireMessage[] = []
    if (typeof payload.system === 'string' && payload.system.trim()) {
      out.push({ role: 'system', content: payload.system })
    }
    out.push(...historyAsText(sanitizeTurns(payload.history)))
    out.push({ role: 'user', content: payload.prompt })
    return out
  }
  if (!Array.isArray(payload.messages)) return []
  return payload.messages.filter(
    (m): m is AiChatMessage =>
      isRec(m) &&
      (m.role === 'user' || m.role === 'assistant' || m.role === 'system') &&
      typeof m.content === 'string',
  )
}
