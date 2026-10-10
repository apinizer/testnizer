/**
 * AI Chat Tools tab actions (issue #180): the MCP servers offered as tools,
 * per-tool on/off, "Load tools", "Run tools without asking", and the user's
 * answers to approval / stdio-trust cards. Config edits mark the tab dirty
 * (saved with Ctrl+S through the 'ai' snapshot) — except "Run tools without
 * asking", which is never saved with the request.
 */
import { useAiChatStore, liveTabKey, patchAiTab } from './ai-chat.store'
import { activeProjectIdForAi } from './ai-chat-conversations'
import { useEnvironmentStore } from './environment.store'
import { markActiveTabDirty } from '../lib/mark-dirty'
import {
  newAdhocServer,
  newSavedServer,
  type AiToolCatalogEntry,
  type AiToolServerConfig,
} from '../lib/ai-chat-tools-config'
import { buildToolServer } from '../lib/ai-tool-servers'
import {
  aiToolAllowKey,
  type AiApprovalDecision,
  type AiStdioTrustDecision,
  type AiToolCallPart,
} from '../../shared/ai-chat-types'

function setServers(fn: (list: AiToolServerConfig[]) => AiToolServerConfig[]): void {
  useAiChatStore.setState((s) => ({ toolServers: fn(s.toolServers ?? []) }))
  markActiveTabDirty()
}

export function addSavedToolServer(ref: {
  requestId: string
  requestKind: 'endpoint' | 'request'
  name: string
}): void {
  setServers((list) =>
    list.some((s) => s.source === 'saved' && s.requestId === ref.requestId)
      ? list
      : [...list, newSavedServer(ref)],
  )
}

export function addAdhocToolServer(): void {
  setServers((list) => [...list, newAdhocServer()])
}

/**
 * Edit a server. A change to WHAT an ad-hoc server is — its URL / command
 * line, transport or stdio env — makes it another server: this
 * conversation's "Allow this tool" grants for it and its loaded catalog
 * (incl. a trust card) are dropped (issue #180), so the next call asks again.
 */
export function updateToolServer(id: string, patch: Partial<AiToolServerConfig>): void {
  const before = (useAiChatStore.getState().toolServers ?? []).find((s) => s.id === id)
  setServers((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  if (!before || before.source !== 'adhoc') return
  const changed =
    ('url' in patch && patch.url !== before.url) ||
    ('transport' in patch && patch.transport !== before.transport) ||
    ('envVars' in patch && JSON.stringify(patch.envVars) !== JSON.stringify(before.envVars))
  if (!changed) return
  const prefix = aiToolAllowKey(id, '')
  useAiChatStore.setState((s) => {
    const catalog = { ...s.toolCatalog }
    delete catalog[id]
    return {
      allowedTools: (s.allowedTools ?? []).filter((k) => !k.startsWith(prefix)),
      toolCatalog: catalog,
    }
  })
}

export function removeToolServer(id: string): void {
  setServers((list) => list.filter((s) => s.id !== id))
  useAiChatStore.setState((s) => {
    const catalog = { ...s.toolCatalog }
    delete catalog[id]
    return { toolCatalog: catalog }
  })
}

export function toggleTool(serverId: string, tool: string, on: boolean): void {
  setServers((list) =>
    list.map((s) => {
      if (s.id !== serverId) return s
      const off = new Set(s.disabledTools)
      if (on) off.delete(tool)
      else off.add(tool)
      return { ...s, disabledTools: [...off] }
    }),
  )
}

/** Per tab, this machine only — not a request edit (never saved), so no dirty dot. */
export function setAutoApproveTools(on: boolean): void {
  useAiChatStore.setState({ autoApproveTools: on })
}

/**
 * "Load tools": one detached connect → tools/list → disconnect in main. An
 * untrusted stdio server is not spawned; the catalog entry then carries the
 * trust card (command line + env) and main's one-time `trustToken` for
 * exactly what the card shows.
 */
export async function loadServerTools(serverId: string): Promise<void> {
  const s = useAiChatStore.getState()
  const tabKey = liveTabKey(s)
  const server = (s.toolServers ?? []).find((x) => x.id === serverId)
  if (!server) return
  const setEntry = catalogWriter(tabKey, serverId)
  setEntry({ loading: true })
  const vars = useEnvironmentStore.getState().getActiveVariables()
  const built = await buildToolServer(server, vars)
  if (typeof built === 'string') {
    setEntry({ error: built })
    return
  }
  const projectId = activeProjectIdForAi()
  try {
    const res = await window.api.aiChat.listServerTools(built, {
      ...(projectId ? { projectId } : {}),
    })
    applyToolsResult(setEntry, res)
  } catch (e) {
    setEntry({ error: (e as Error).message })
  }
}

/**
 * The Tools-tab trust card's "Trust and connect" (issue #180): redeems the
 * card's token — main trusts and connects the subject the card SHOWED, not a
 * config rebuilt now (an edit or an environment switch since then would
 * otherwise trust a command the user never saw).
 */
export async function trustServerTools(serverId: string, trustToken: string): Promise<void> {
  const tabKey = liveTabKey(useAiChatStore.getState())
  const setEntry = catalogWriter(tabKey, serverId)
  setEntry({ loading: true })
  try {
    applyToolsResult(setEntry, await window.api.aiChat.trustServerTools(trustToken))
  } catch (e) {
    setEntry({ error: (e as Error).message })
  }
}

type CatalogWrite = (entry: AiToolCatalogEntry) => void

function catalogWriter(tabKey: string, serverId: string): CatalogWrite {
  return (entry) =>
    patchAiTab(tabKey, (st) => ({ toolCatalog: { ...st.toolCatalog, [serverId]: entry } }))
}

function applyToolsResult(
  setEntry: CatalogWrite,
  res: Awaited<ReturnType<Window['api']['aiChat']['listServerTools']>> | undefined,
): void {
  if (!res?.success || !res.data) {
    setEntry({ error: res?.error ?? 'Could not list tools' })
    return
  }
  if (res.data.untrusted) setEntry({ untrusted: res.data.untrusted })
  else setEntry({ tools: res.data.tools ?? [] })
}

/** The user's answer to an approval card. */
export async function answerToolApproval(
  part: AiToolCallPart,
  decision: AiApprovalDecision,
): Promise<void> {
  const s = useAiChatStore.getState()
  const messageId = s.pendingMessageId
  if (!messageId) return
  if (decision === 'conversation') {
    const key = aiToolAllowKey(part.serverId, part.tool)
    if (!s.allowedTools.includes(key)) {
      useAiChatStore.setState({ allowedTools: [...s.allowedTools, key] })
    }
  }
  await window.api.aiChat.approveTool(messageId, part.id, decision)
}

/** The user's answer to an untrusted stdio server card during a Send. */
export async function answerStdioTrust(
  serverId: string,
  decision: AiStdioTrustDecision,
): Promise<void> {
  const messageId = useAiChatStore.getState().pendingMessageId
  if (!messageId) return
  await window.api.aiChat.resolveStdioTrust(messageId, serverId, decision)
}
