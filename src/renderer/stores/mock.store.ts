import { create } from 'zustand'
import type {
  MockServer,
  MockEndpoint,
  MockResponse,
  MockServerStatus,
  MockLogEntry,
} from '../types'

// Narrow shape of the window.api.mock bridge we use here.
interface IpcResult<T> {
  success: boolean
  data?: T
  error?: string
}

interface MockApi {
  server: {
    list: (projectId: string) => Promise<IpcResult<MockServer[]>>
    create: (
      input: Partial<MockServer> & { projectId: string; name: string; port: number },
    ) => Promise<IpcResult<MockServer>>
    update: (id: string, patch: Partial<MockServer>) => Promise<IpcResult<MockServer>>
    delete: (id: string) => Promise<IpcResult<boolean>>
    start: (id: string) => Promise<IpcResult<{ status: MockServerStatus; port: number }>>
    stop: (id: string) => Promise<IpcResult<{ status: MockServerStatus }>>
    status: (id: string) => Promise<IpcResult<{ status: MockServerStatus }>>
  }
  endpoint: {
    list: (serverId: string) => Promise<IpcResult<MockEndpoint[]>>
    create: (
      input: Partial<MockEndpoint> & { serverId: string; path: string },
    ) => Promise<IpcResult<MockEndpoint>>
    update: (id: string, patch: Partial<MockEndpoint>) => Promise<IpcResult<MockEndpoint>>
    delete: (id: string) => Promise<IpcResult<boolean>>
  }
  response: {
    list: (endpointId: string) => Promise<IpcResult<MockResponse[]>>
    create: (
      input: Partial<MockResponse> & { endpointId: string },
    ) => Promise<IpcResult<MockResponse>>
    update: (id: string, patch: Partial<MockResponse>) => Promise<IpcResult<MockResponse>>
    delete: (id: string) => Promise<IpcResult<boolean>>
  }
  logs: {
    get: (serverId: string) => Promise<IpcResult<MockLogEntry[]>>
    clear: (serverId: string) => Promise<IpcResult<boolean>>
  }
  importOpenApi: (
    serverId: string,
    source: string,
  ) => Promise<
    IpcResult<{
      ok: boolean
      endpointsCreated: number
      responsesCreated: number
      warnings: string[]
      error?: string
    }>
  >
  importPostman: (
    serverId: string,
    source: string,
  ) => Promise<
    IpcResult<{
      ok: boolean
      endpointsCreated: number
      responsesCreated: number
      warnings: string[]
      error?: string
    }>
  >
  onLog: (cb: (entry: MockLogEntry) => void) => () => void
  onStatus: (
    cb: (info: { serverId: string; status: MockServerStatus; errorMessage: string | null }) => void,
  ) => () => void
}

const api = (window as unknown as { api: { mock: MockApi } }).api.mock

export interface MockState {
  servers: MockServer[]
  endpointsByServer: Record<string, MockEndpoint[]>
  responsesByEndpoint: Record<string, MockResponse[]>
  statusByServer: Record<string, MockServerStatus>
  errorByServer: Record<string, string | null>
  logsByServer: Record<string, MockLogEntry[]>

  // Server CRUD
  loadServers: (projectId: string) => Promise<void>
  createServer: (input: {
    projectId: string
    name: string
    port: number
    basePath?: string
    description?: string
  }) => Promise<MockServer | null>
  updateServer: (id: string, patch: Partial<MockServer>) => Promise<void>
  deleteServer: (id: string) => Promise<void>
  startServer: (id: string) => Promise<string | null> // returns error message, or null on success
  stopServer: (id: string) => Promise<void>

  // Endpoint CRUD
  loadEndpoints: (serverId: string) => Promise<void>
  createEndpoint: (input: {
    serverId: string
    method: string
    path: string
    pathMode: string
  }) => Promise<MockEndpoint | null>
  updateEndpoint: (id: string, patch: Partial<MockEndpoint>) => Promise<void>
  deleteEndpoint: (serverId: string, endpointId: string) => Promise<void>

  // Response CRUD
  loadResponses: (endpointId: string) => Promise<void>
  createResponse: (
    input: Partial<MockResponse> & { endpointId: string },
  ) => Promise<MockResponse | null>
  updateResponse: (id: string, patch: Partial<MockResponse>) => Promise<void>
  deleteResponse: (endpointId: string, responseId: string) => Promise<void>

  // Logs
  loadLogs: (serverId: string) => Promise<void>
  clearLogs: (serverId: string) => Promise<void>

  // Import
  importOpenApi: (
    serverId: string,
    source: string,
  ) => Promise<{
    ok: boolean
    endpointsCreated: number
    responsesCreated: number
    warnings: string[]
    error?: string
  } | null>
  importPostman: (
    serverId: string,
    source: string,
  ) => Promise<{
    ok: boolean
    endpointsCreated: number
    responsesCreated: number
    warnings: string[]
    error?: string
  } | null>
}

export const useMockStore = create<MockState>((set) => ({
  servers: [],
  endpointsByServer: {},
  responsesByEndpoint: {},
  statusByServer: {},
  errorByServer: {},
  logsByServer: {},

  loadServers: async (projectId) => {
    const r = await api.server.list(projectId)
    if (r.success && r.data) set({ servers: r.data })
  },

  createServer: async (input) => {
    const r = await api.server.create({
      projectId: input.projectId,
      name: input.name,
      port: input.port,
      basePath: input.basePath,
      description: input.description,
    } as Partial<MockServer> & { projectId: string; name: string; port: number })
    if (!r.success || !r.data) return null
    set((s) => ({ servers: [...s.servers, r.data!] }))
    return r.data
  },

  updateServer: async (id, patch) => {
    const r = await api.server.update(id, patch)
    if (r.success && r.data) {
      set((s) => ({ servers: s.servers.map((sv) => (sv.id === id ? r.data! : sv)) }))
    }
  },

  deleteServer: async (id) => {
    const r = await api.server.delete(id)
    if (r.success) {
      set((s) => ({
        servers: s.servers.filter((sv) => sv.id !== id),
        statusByServer: omit(s.statusByServer, id),
        endpointsByServer: omit(s.endpointsByServer, id),
        logsByServer: omit(s.logsByServer, id),
      }))
    }
  },

  startServer: async (id) => {
    set((s) => ({ statusByServer: { ...s.statusByServer, [id]: 'starting' } }))
    const r = await api.server.start(id)
    if (!r.success) {
      set((s) => ({
        statusByServer: { ...s.statusByServer, [id]: 'error' },
        errorByServer: { ...s.errorByServer, [id]: r.error ?? 'Unknown error' },
      }))
      return r.error ?? 'Unknown error'
    }
    set((s) => ({
      statusByServer: { ...s.statusByServer, [id]: 'running' },
      errorByServer: { ...s.errorByServer, [id]: null },
    }))
    return null
  },

  stopServer: async (id) => {
    await api.server.stop(id)
    set((s) => ({ statusByServer: { ...s.statusByServer, [id]: 'stopped' } }))
  },

  loadEndpoints: async (serverId) => {
    const r = await api.endpoint.list(serverId)
    if (r.success && r.data) {
      set((s) => ({ endpointsByServer: { ...s.endpointsByServer, [serverId]: r.data! } }))
    }
  },

  createEndpoint: async (input) => {
    const r = await api.endpoint.create(
      input as Partial<MockEndpoint> & { serverId: string; path: string },
    )
    if (!r.success || !r.data) return null
    const ep = r.data
    set((s) => ({
      endpointsByServer: {
        ...s.endpointsByServer,
        [ep.serverId]: [...(s.endpointsByServer[ep.serverId] ?? []), ep],
      },
    }))
    return ep
  },

  updateEndpoint: async (id, patch) => {
    const r = await api.endpoint.update(id, patch)
    if (r.success && r.data) {
      const ep = r.data
      set((s) => ({
        endpointsByServer: {
          ...s.endpointsByServer,
          [ep.serverId]: (s.endpointsByServer[ep.serverId] ?? []).map((e) =>
            e.id === id ? ep : e,
          ),
        },
      }))
    }
  },

  deleteEndpoint: async (serverId, endpointId) => {
    const r = await api.endpoint.delete(endpointId)
    if (r.success) {
      set((s) => ({
        endpointsByServer: {
          ...s.endpointsByServer,
          [serverId]: (s.endpointsByServer[serverId] ?? []).filter((e) => e.id !== endpointId),
        },
        responsesByEndpoint: omit(s.responsesByEndpoint, endpointId),
      }))
    }
  },

  loadResponses: async (endpointId) => {
    const r = await api.response.list(endpointId)
    if (r.success && r.data) {
      set((s) => ({ responsesByEndpoint: { ...s.responsesByEndpoint, [endpointId]: r.data! } }))
    }
  },

  createResponse: async (input) => {
    const r = await api.response.create(input)
    if (!r.success || !r.data) return null
    const resp = r.data
    set((s) => ({
      responsesByEndpoint: {
        ...s.responsesByEndpoint,
        [resp.endpointId]: [...(s.responsesByEndpoint[resp.endpointId] ?? []), resp],
      },
    }))
    return resp
  },

  updateResponse: async (id, patch) => {
    const r = await api.response.update(id, patch)
    if (r.success && r.data) {
      const resp = r.data
      set((s) => ({
        responsesByEndpoint: {
          ...s.responsesByEndpoint,
          [resp.endpointId]: (s.responsesByEndpoint[resp.endpointId] ?? []).map((rr) =>
            rr.id === id ? resp : rr,
          ),
        },
      }))
    }
  },

  deleteResponse: async (endpointId, responseId) => {
    const r = await api.response.delete(responseId)
    if (r.success) {
      set((s) => ({
        responsesByEndpoint: {
          ...s.responsesByEndpoint,
          [endpointId]: (s.responsesByEndpoint[endpointId] ?? []).filter(
            (r) => r.id !== responseId,
          ),
        },
      }))
    }
  },

  loadLogs: async (serverId) => {
    const r = await api.logs.get(serverId)
    if (r.success && r.data) {
      set((s) => ({ logsByServer: { ...s.logsByServer, [serverId]: r.data! } }))
    }
  },

  clearLogs: async (serverId) => {
    await api.logs.clear(serverId)
    set((s) => ({ logsByServer: { ...s.logsByServer, [serverId]: [] } }))
  },

  importOpenApi: async (serverId, source) => {
    const r = await api.importOpenApi(serverId, source)
    if (!r.success || !r.data) return null
    // Refresh endpoints list after import
    const ep = await api.endpoint.list(serverId)
    if (ep.success && ep.data) {
      set((s) => ({ endpointsByServer: { ...s.endpointsByServer, [serverId]: ep.data! } }))
    }
    return r.data
  },

  importPostman: async (serverId, source) => {
    const r = await api.importPostman(serverId, source)
    if (!r.success || !r.data) return null
    const ep = await api.endpoint.list(serverId)
    if (ep.success && ep.data) {
      set((s) => ({ endpointsByServer: { ...s.endpointsByServer, [serverId]: ep.data! } }))
    }
    return r.data
  },
}))

// Subscribe to runtime events from the main process exactly once.
api.onLog((entry) => {
  useMockStore.setState((s) => {
    const cur = s.logsByServer[entry.serverId] ?? []
    const next = [...cur, entry]
    if (next.length > 500) next.splice(0, next.length - 500)
    return { logsByServer: { ...s.logsByServer, [entry.serverId]: next } }
  })
})

api.onStatus(({ serverId, status, errorMessage }) => {
  useMockStore.setState((s) => ({
    statusByServer: { ...s.statusByServer, [serverId]: status },
    errorByServer: {
      ...s.errorByServer,
      [serverId]: errorMessage ?? s.errorByServer[serverId] ?? null,
    },
  }))
})

function omit<T extends Record<string, unknown>>(obj: T, key: string): T {
  const { [key]: _, ...rest } = obj
  return rest as T
}
