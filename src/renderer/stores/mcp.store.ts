import { create } from 'zustand'
import type { KeyValuePair } from '../types'
import { loadTabbedState, attachTabbedPersist } from '../lib/persist-helpers'
import { useWorkspaceStore } from './workspace.store'
import { useEnvironmentStore } from './environment.store'
import { resolveVariables, resolveKeyValuePairs } from '../lib/variable-resolver'
import { makeId } from '../lib/utils'
// Shared dirty-flag helper — an edit flips the active tab's unsaved dot so
// Ctrl+S has something to persist (same as the SSE / WS stores, issue #8).
import { markActiveTabDirty } from '../lib/mark-dirty'

function defaultKv(key = '', value = '', enabled = true): KeyValuePair {
  return { id: makeId(), key, value, enabled }
}

export type McpTransport = 'http' | 'sse' | 'stdio'
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface McpTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

function getMcpApi() {
  return window.api?.mcp
}

interface TabMcpState {
  transport: McpTransport
  url: string
  /**
   * Custom HTTP headers sent on the http / sse handshake and every request
   * after it (issue #137) — e.g. `Authorization: Bearer …` or API-gateway
   * `X-…` headers. Ignored for stdio. `{{var}}` resolves at Connect time.
   */
  customHeaders: KeyValuePair[]
  connectionId: string | null
  connectionState: ConnectionState
  serverName: string | null
  errorMessage: string | null
  tools: McpTool[]
  selectedTool: string | null
  toolArgs: string
  result: unknown
  resultError: string | null
  isInvoking: boolean
  /** Renderer-supplied id so a stalled handshake can be cancelled. */
  _pendingConnectId?: string
}

interface McpStore extends TabMcpState {
  _tabStates: Map<string, TabMcpState>
  _currentTabId: string | null

  setTransport: (t: McpTransport) => void
  setUrl: (url: string) => void
  addHeader: () => void
  updateHeader: (id: string, updates: Partial<KeyValuePair>) => void
  removeHeader: (id: string) => void
  /** Replace the header list outright. Used by snapshot/restore paths. */
  setHeaders: (headers: KeyValuePair[]) => void
  setSelectedTool: (name: string | null) => void
  setToolArgs: (args: string) => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  listTools: () => Promise<void>
  callTool: () => Promise<void>
  switchToTab: (tabId: string) => void
  removeTabState: (tabId: string) => void
}

function emptyState(): TabMcpState {
  return {
    transport: 'http',
    url: '',
    customHeaders: [defaultKv()],
    connectionId: null,
    connectionState: 'disconnected',
    serverName: null,
    errorMessage: null,
    tools: [],
    selectedTool: null,
    toolArgs: '{}',
    result: null,
    resultError: null,
    isInvoking: false,
    _pendingConnectId: undefined,
  }
}

function generateExampleArgs(schema: Record<string, unknown>): Record<string, unknown> {
  const props = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {}
  const result: Record<string, unknown> = {}
  for (const [key, def] of Object.entries(props)) {
    const type = def.type as string | undefined
    if (def.enum && Array.isArray(def.enum)) result[key] = def.enum[0]
    else if (type === 'string') result[key] = ''
    else if (type === 'integer' || type === 'number') result[key] = 0
    else if (type === 'boolean') result[key] = false
    else if (type === 'array') result[key] = []
    else if (type === 'object') result[key] = {}
    else result[key] = null
  }
  return result
}

function extractState(s: McpStore): TabMcpState {
  return {
    transport: s.transport,
    url: s.url,
    customHeaders: s.customHeaders,
    connectionId: s.connectionId,
    connectionState: s.connectionState,
    serverName: s.serverName,
    errorMessage: s.errorMessage,
    tools: s.tools,
    selectedTool: s.selectedTool,
    toolArgs: s.toolArgs,
    result: s.result,
    resultError: s.resultError,
    isInvoking: s.isInvoking,
    _pendingConnectId: s._pendingConnectId,
  }
}

const STORAGE_KEY = 'testnizer-mcp'
const persisted = loadTabbedState<TabMcpState>(STORAGE_KEY, emptyState)

export const useMcpStore = create<McpStore>((set, get) => ({
  ...persisted.current,
  _tabStates: persisted._tabStates,
  _currentTabId: persisted._currentTabId,
  // transient — never restored from disk
  connectionId: null,
  connectionState: 'disconnected',
  errorMessage: null,
  tools: [],
  result: null,
  resultError: null,
  isInvoking: false,

  setTransport: (transport) => {
    set({ transport })
    markActiveTabDirty()
  },
  setUrl: (url) => {
    set({ url })
    markActiveTabDirty()
  },
  addHeader: () => {
    set((state) => ({ customHeaders: [...state.customHeaders, defaultKv()] }))
    markActiveTabDirty()
  },
  updateHeader: (id, updates) => {
    set((state) => ({
      customHeaders: state.customHeaders.map((h) => (h.id === id ? { ...h, ...updates } : h)),
    }))
    markActiveTabDirty()
  },
  removeHeader: (id) => {
    set((state) => ({ customHeaders: state.customHeaders.filter((h) => h.id !== id) }))
    markActiveTabDirty()
  },
  setHeaders: (customHeaders) => {
    set({ customHeaders })
    markActiveTabDirty()
  },
  setSelectedTool: (selectedTool) => {
    const tool = selectedTool ? get().tools.find((t) => t.name === selectedTool) : undefined
    const example = tool?.inputSchema ? generateExampleArgs(tool.inputSchema) : {}
    const toolArgs = JSON.stringify(example, null, 2)
    set({ selectedTool, toolArgs, result: null, resultError: null })
  },
  setToolArgs: (toolArgs) => set({ toolArgs }),

  connect: async () => {
    const { transport, url, customHeaders } = get()
    if (!url.trim()) return
    const pendingConnectId = makeId()
    set({
      connectionState: 'connecting',
      errorMessage: null,
      _pendingConnectId: pendingConnectId,
    })
    const api = getMcpApi()
    if (!api) {
      set({
        connectionState: 'error',
        errorMessage: 'API not available',
        _pendingConnectId: undefined,
      })
      return
    }
    // Resolve `{{var}}` placeholders in the server URL the same way HTTP /
    // SOAP / GraphQL do — otherwise users can't parameterise local stdio /
    // SSE endpoints via environments.
    const vars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedUrl = resolveVariables(url, vars)
    // Custom headers (issue #137): enabled rows with a key, `{{var}}`
    // resolved in both key and value — same rule as the SSE / WS editors.
    // stdio has no HTTP layer, so nothing is sent for it.
    const headers: Record<string, string> = {}
    if (transport !== 'stdio') {
      const rows = resolveKeyValuePairs(
        customHeaders.filter((h) => h.enabled && h.key.trim()),
        vars,
      )
      for (const row of rows) {
        const key = row.key.trim()
        if (key) headers[key] = row.value
      }
    }
    const res = await api.connect({
      transport,
      url: resolvedUrl,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      _pendingId: pendingConnectId,
    })
    if (res.success && res.data) {
      set({
        connectionId: res.data.connectionId,
        connectionState: 'connected',
        serverName: res.data.serverName ?? null,
        errorMessage: null,
        _pendingConnectId: undefined,
      })
      // Auto-list tools on connect
      get().listTools()
    } else {
      set({
        connectionState: 'error',
        errorMessage: res.error ?? 'Connection failed',
        _pendingConnectId: undefined,
      })
    }
    // Console logging is handled by the main-process handler so every
    // protocol routes through the same `console:log` channel — see
    // src/main/ipc/mcp.handler.ts.
  },

  disconnect: async () => {
    const { connectionId, _pendingConnectId, connectionState } = get()
    const api = getMcpApi()
    if (api) {
      if (connectionState === 'connecting' && _pendingConnectId) {
        try {
          await api.cancelConnect(_pendingConnectId)
        } catch {
          // Engine already finished — disconnect catches it.
        }
      }
      if (connectionId) await api.disconnect(connectionId)
    }
    // Keep the tab's configuration — only the live connection is torn down.
    set({
      ...emptyState(),
      transport: get().transport,
      url: get().url,
      customHeaders: get().customHeaders,
    })
  },

  listTools: async () => {
    const { connectionId } = get()
    if (!connectionId) return
    const api = getMcpApi()
    if (!api) return
    const res = await api.listTools(connectionId)
    if (res.success && res.data) {
      set({ tools: res.data })
    }
  },

  callTool: async () => {
    const { connectionId, selectedTool, toolArgs } = get()
    if (!connectionId || !selectedTool) return
    set({ isInvoking: true, result: null, resultError: null })
    const api = getMcpApi()
    if (!api) {
      set({ isInvoking: false })
      return
    }
    // Resolve `{{var}}` in the JSON text before parsing so users can put
    // env / global / dynamic placeholders anywhere in the args body.
    const vars = useEnvironmentStore.getState().getActiveVariables()
    const resolvedArgsText = resolveVariables(toolArgs, vars)
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(resolvedArgsText)
    } catch {
      set({ isInvoking: false, resultError: 'Invalid JSON in arguments' })
      return
    }
    const ws = useWorkspaceStore.getState()
    const res = await api.callTool(connectionId, selectedTool, args, {
      workspaceId: ws.activeWorkspaceId || undefined,
      projectId: ws.activeProjectId || undefined,
    })
    if (res.success) {
      set({ result: res.data, resultError: null, isInvoking: false })
    } else {
      set({ result: null, resultError: res.error ?? 'Tool call failed', isInvoking: false })
    }
  },

  switchToTab: (tabId) => {
    const state = get()
    const tabStates = new Map(state._tabStates)
    if (state._currentTabId) tabStates.set(state._currentTabId, extractState(state))
    const target = tabStates.get(tabId) ?? emptyState()
    set({ ...target, _tabStates: tabStates, _currentTabId: tabId })
  },

  removeTabState: (tabId) => {
    const conn = get()
    if (conn._currentTabId === tabId && conn.connectionId) {
      getMcpApi()
        ?.disconnect(conn.connectionId)
        .catch(() => {})
    }
    const tabStates = new Map(get()._tabStates)
    tabStates.delete(tabId)
    set({ _tabStates: tabStates })
  },
}))

attachTabbedPersist(useMcpStore, STORAGE_KEY, extractState, (s) => ({
  _tabStates: s._tabStates,
  _currentTabId: s._currentTabId,
}))
