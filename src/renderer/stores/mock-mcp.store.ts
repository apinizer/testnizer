/**
 * Mock MCP Servers (issue #140) — renderer store.
 *
 * Mirrors `mock.store.ts` with two deliberate differences:
 *   - the FULL live state is kept per server (`url` / `sseUrl` / bound `port`
 *     matter when the configured port is 0), not just a status string;
 *   - write failures are surfaced (create / update / start return the
 *     backend's readable validation message) instead of being swallowed.
 *
 * Runtime events (`mockMcp:log`, `mockMcp:status`) are routed by the
 * `serverId` they carry — never to "the selected server" — so a log line or a
 * crash of server A can never land on server B's editor.
 */
import { create } from 'zustand'
import type {
  MockMcpBridge,
  MockMcpLogEntry,
  MockMcpServer,
  MockMcpServerCreateInput,
  MockMcpServerDraft,
  MockMcpServerPatch,
  MockMcpServerState,
} from '../types/mock-mcp'

/** Same cap as the main-process ring buffer. */
export const MOCK_MCP_LOG_LIMIT = 500

export function getMockMcpApi(): MockMcpBridge | undefined {
  if (typeof window === 'undefined') return undefined
  const api = (window as unknown as { api?: { mockMcp?: unknown } }).api
  return api?.mockMcp as MockMcpBridge | undefined
}

/** Fallback while nothing is known yet about a server. */
export function stoppedState(serverId: string): MockMcpServerState {
  return { serverId, status: 'stopped', port: null, url: null, sseUrl: null, errorMessage: null }
}

export type CreateResult =
  | { server: MockMcpServer; error?: undefined }
  | { server?: undefined; error: string }

export interface MockMcpStoreState {
  servers: MockMcpServer[]
  /** Project the `servers` list belongs to. */
  projectId: string | null
  stateByServer: Record<string, MockMcpServerState>
  logsByServer: Record<string, MockMcpLogEntry[]>
  /**
   * Unsaved editor drafts, present only while a server has unsaved edits.
   * Kept here (not in component state) because the Workbench unmounts the
   * editor on every tab switch — local state would silently drop the edits.
   */
  drafts: Record<string, MockMcpServerDraft>

  loadServers: (projectId: string) => Promise<void>
  createServer: (input: MockMcpServerCreateInput) => Promise<CreateResult>
  /** Returns the backend's error message, or null on success. */
  updateServer: (id: string, patch: MockMcpServerPatch) => Promise<string | null>
  deleteServer: (id: string) => Promise<string | null>
  startServer: (id: string) => Promise<string | null>
  stopServer: (id: string) => Promise<string | null>
  refreshStatus: (id: string) => Promise<void>
  loadLogs: (id: string) => Promise<void>
  clearLogs: (id: string) => Promise<void>
  setDraft: (id: string, draft: MockMcpServerDraft) => void
  discardDraft: (id: string) => void
}

const UNAVAILABLE = 'Mock MCP bridge unavailable'

function errorOf(r: { success: boolean; error?: string }, fallback: string): string {
  return r.error ?? fallback
}

function omit<T>(obj: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _drop, ...rest } = obj
  return rest
}

/**
 * Bumped by every `loadServers` call: only the LATEST list may land. Switching
 * project A → B quickly used to let A's slower answer arrive last and replace
 * B's servers (and `projectId`) — the section then showed nothing.
 */
let loadSeq = 0

export const useMockMcpStore = create<MockMcpStoreState>((set, get) => ({
  servers: [],
  projectId: null,
  stateByServer: {},
  logsByServer: {},
  drafts: {},

  loadServers: async (projectId) => {
    ensureMockMcpEventSubscriptions()
    const api = getMockMcpApi()
    if (!api) return
    const seq = ++loadSeq
    const r = await api.server.list(projectId)
    if (seq !== loadSeq) return // a newer load superseded this one
    if (!r.success || !r.data) return
    const servers = r.data
    set({ servers, projectId })
    // Hydrate live state: a server started before this view mounted (or
    // before a reload) would otherwise show "stopped" until its next event.
    await Promise.all(servers.map((s) => get().refreshStatus(s.id)))
  },

  createServer: async (input) => {
    const api = getMockMcpApi()
    if (!api) return { error: UNAVAILABLE }
    const r = await api.server.create(input)
    if (!r.success || !r.data) return { error: errorOf(r, 'Create failed') }
    const server = r.data
    set((s) => ({ servers: [...s.servers, server] }))
    return { server }
  },

  updateServer: async (id, patch) => {
    const api = getMockMcpApi()
    if (!api) return UNAVAILABLE
    const r = await api.server.update(id, patch)
    if (!r.success || !r.data) return errorOf(r, 'Save failed')
    const updated = r.data
    set((s) => ({ servers: s.servers.map((x) => (x.id === id ? updated : x)) }))
    return null
  },

  deleteServer: async (id) => {
    const api = getMockMcpApi()
    if (!api) return UNAVAILABLE
    const r = await api.server.delete(id)
    if (!r.success) return errorOf(r, 'Delete failed')
    set((s) => ({
      servers: s.servers.filter((x) => x.id !== id),
      stateByServer: omit(s.stateByServer, id),
      logsByServer: omit(s.logsByServer, id),
      drafts: omit(s.drafts, id),
    }))
    return null
  },

  startServer: async (id) => {
    const api = getMockMcpApi()
    if (!api) return UNAVAILABLE
    setState(id, { ...currentState(id), status: 'starting', errorMessage: null })
    const r = await api.server.start(id)
    if (!r.success || !r.data) {
      const error = errorOf(r, 'Start failed')
      setState(id, { ...stoppedState(id), status: 'error', errorMessage: error })
      return error
    }
    setState(id, r.data)
    return null
  },

  stopServer: async (id) => {
    const api = getMockMcpApi()
    if (!api) return UNAVAILABLE
    const r = await api.server.stop(id)
    if (!r.success) return errorOf(r, 'Stop failed')
    setState(id, r.data ?? stoppedState(id))
    return null
  },

  refreshStatus: async (id) => {
    const api = getMockMcpApi()
    if (!api) return
    const r = await api.server.status(id)
    if (r.success && r.data) setState(id, r.data)
  },

  loadLogs: async (id) => {
    const api = getMockMcpApi()
    if (!api) return
    const r = await api.logs.get(id)
    if (r.success && r.data) {
      const snapshot = r.data
      set((s) => {
        // Keep events that arrived after the snapshot was taken.
        const ids = new Set(snapshot.map((e) => e.id))
        const lastTs = snapshot.length > 0 ? snapshot[snapshot.length - 1].ts : 0
        const later = (s.logsByServer[id] ?? []).filter((e) => !ids.has(e.id) && e.ts >= lastTs)
        const logs = [...snapshot, ...later].slice(-MOCK_MCP_LOG_LIMIT)
        return { logsByServer: { ...s.logsByServer, [id]: logs } }
      })
    }
  },

  clearLogs: async (id) => {
    const api = getMockMcpApi()
    if (!api) return
    const r = await api.logs.clear(id)
    if (r.success) set((s) => ({ logsByServer: { ...s.logsByServer, [id]: [] } }))
  },

  setDraft: (id, draft) => set((s) => ({ drafts: { ...s.drafts, [id]: draft } })),
  discardDraft: (id) => set((s) => ({ drafts: omit(s.drafts, id) })),
}))

function currentState(id: string): MockMcpServerState {
  return useMockMcpStore.getState().stateByServer[id] ?? stoppedState(id)
}

function setState(id: string, state: MockMcpServerState): void {
  useMockMcpStore.setState((s) => ({ stateByServer: { ...s.stateByServer, [id]: state } }))
}

// ─── Runtime events (routed by serverId) ───────────────────────────────────

/** `mockMcp:log` — append to the owning server's log, capped like the main ring buffer. */
export function handleMockMcpLog(entry: MockMcpLogEntry): void {
  if (!entry || typeof entry.serverId !== 'string') return
  useMockMcpStore.setState((s) => {
    const next = [...(s.logsByServer[entry.serverId] ?? []), entry]
    if (next.length > MOCK_MCP_LOG_LIMIT) next.splice(0, next.length - MOCK_MCP_LOG_LIMIT)
    return { logsByServer: { ...s.logsByServer, [entry.serverId]: next } }
  })
}

/** `mockMcp:status` — replace the owning server's live state. */
export function handleMockMcpStatus(state: MockMcpServerState): void {
  if (!state || typeof state.serverId !== 'string') return
  setState(state.serverId, state)
}

let subscribedApi: MockMcpBridge | null = null
let unsubscribers: Array<() => void> = []

/**
 * Subscribe ONCE to the bridge's event streams. Idempotent per bridge object:
 * called at module load and again from `loadServers`, so a bridge installed
 * after this module loaded (tests, HMR) is still picked up.
 */
export function ensureMockMcpEventSubscriptions(): void {
  const api = getMockMcpApi()
  if (!api || api === subscribedApi) return
  for (const unsub of unsubscribers) {
    try {
      unsub()
    } catch {
      /* the old bridge is gone */
    }
  }
  unsubscribers = []
  subscribedApi = api
  if (api.onLog) unsubscribers.push(api.onLog(handleMockMcpLog))
  if (api.onStatus) unsubscribers.push(api.onStatus(handleMockMcpStatus))
}

ensureMockMcpEventSubscriptions()
