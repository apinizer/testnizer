import { create } from 'zustand'
import { useConsoleStore } from './console.store'

export type McpTransport = 'http' | 'sse' | 'stdio'
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface McpTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

interface McpApi {
  connect: (options: unknown) => Promise<{
    success: boolean
    data?: { connectionId: string; serverName?: string }
    error?: string
  }>
  disconnect: (id: string) => Promise<{ success: boolean; error?: string }>
  listTools: (id: string) => Promise<{ success: boolean; data?: McpTool[]; error?: string }>
  callTool: (
    id: string,
    name: string,
    args: unknown,
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>
}

function getMcpApi(): McpApi | undefined {
  return (window as unknown as { api?: { mcp?: McpApi } }).api?.mcp
}

interface TabMcpState {
  transport: McpTransport
  url: string
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
}

interface McpStore extends TabMcpState {
  _tabStates: Map<string, TabMcpState>
  _currentTabId: string | null

  setTransport: (t: McpTransport) => void
  setUrl: (url: string) => void
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
  }
}

export const useMcpStore = create<McpStore>((set, get) => ({
  ...emptyState(),
  _tabStates: new Map(),
  _currentTabId: null,

  setTransport: (transport) => set({ transport }),
  setUrl: (url) => set({ url }),
  setSelectedTool: (selectedTool) => {
    const tool = selectedTool ? get().tools.find((t) => t.name === selectedTool) : undefined
    const example = tool?.inputSchema ? generateExampleArgs(tool.inputSchema) : {}
    const toolArgs = JSON.stringify(example, null, 2)
    set({ selectedTool, toolArgs, result: null, resultError: null })
  },
  setToolArgs: (toolArgs) => set({ toolArgs }),

  connect: async () => {
    const { transport, url } = get()
    if (!url.trim()) return
    set({ connectionState: 'connecting', errorMessage: null })
    const api = getMcpApi()
    if (!api) {
      set({ connectionState: 'error', errorMessage: 'API not available' })
      return
    }
    const res = await api.connect({ transport, url })
    if (res.success && res.data) {
      set({
        connectionId: res.data.connectionId,
        connectionState: 'connected',
        serverName: res.data.serverName ?? null,
        errorMessage: null,
      })
      useConsoleStore.getState().addEntry({
        protocol: 'mcp',
        level: 'success',
        category: 'request',
        url,
        message: `MCP bağlandı: ${res.data.serverName ?? url}`,
      })
      // Auto-list tools on connect
      get().listTools()
    } else {
      const errMsg = res.error ?? 'Connection failed'
      set({ connectionState: 'error', errorMessage: errMsg })
      useConsoleStore.getState().addEntry({
        protocol: 'mcp',
        level: 'error',
        category: 'request',
        url,
        message: `MCP bağlantı hatası: ${errMsg}`,
        details: { error: { message: errMsg } },
      })
    }
  },

  disconnect: async () => {
    const { connectionId, url } = get()
    if (!connectionId) return
    const api = getMcpApi()
    await api?.disconnect(connectionId)
    useConsoleStore.getState().addEntry({
      protocol: 'mcp',
      level: 'info',
      category: 'request',
      url,
      message: `MCP bağlantısı kesildi`,
    })
    set({ ...emptyState(), transport: get().transport, url: get().url })
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
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(toolArgs)
    } catch {
      set({ isInvoking: false, resultError: 'Invalid JSON in arguments' })
      return
    }
    const res = await api.callTool(connectionId, selectedTool, args)
    if (res.success) {
      set({ result: res.data, resultError: null, isInvoking: false })
      useConsoleStore.getState().addEntry({
        protocol: 'mcp',
        level: 'success',
        category: 'response',
        url: get().url,
        message: `MCP tool ${selectedTool} → başarılı`,
        details: { responseBody: JSON.stringify(res.data) },
      })
    } else {
      const errMsg = res.error ?? 'Tool call failed'
      set({ result: null, resultError: errMsg, isInvoking: false })
      useConsoleStore.getState().addEntry({
        protocol: 'mcp',
        level: 'error',
        category: 'response',
        url: get().url,
        message: `MCP tool ${selectedTool} hata: ${errMsg}`,
        details: { error: { message: errMsg } },
      })
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
