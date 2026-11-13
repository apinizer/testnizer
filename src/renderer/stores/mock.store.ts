import { create } from 'zustand'
import type {
  MockServer,
  MockEndpoint,
  MockResponse,
  MockServerStatus,
  MockLogEntry,
} from '../types'
import type { MockServerKind } from '../../shared/mock-kind'
import { collapseStreamLogs, mergeStreamLog } from '../lib/mock-log-streams'
import { ensureScriptsAllowed } from '../lib/script-trust-gate'
import { describeListenError, mockIpcErrorText } from '../lib/listen-error-text'
import { t } from '../lib/i18n'

const api = window.api.mock

/** A failed IPC call as an import result, so its reason reaches the user. */
function importFailure(error: string | undefined) {
  return {
    ok: false,
    endpointsCreated: 0,
    responsesCreated: 0,
    warnings: [] as string[],
    ...(error ? { error } : {}),
  }
}

export interface MockState {
  servers: MockServer[]
  /** Project whose list `servers` holds; null until the first load lands (issue #226). */
  projectId: string | null
  endpointsByServer: Record<string, MockEndpoint[]>
  responsesByEndpoint: Record<string, MockResponse[]>
  statusByServer: Record<string, MockServerStatus>
  errorByServer: Record<string, string | null>
  /** One entry per request, and ONE per SSE / AI stream (`mock-log-streams.ts`, issue #226). */
  logsByServer: Record<string, MockLogEntry[]>

  // Server CRUD
  loadServers: (projectId: string) => Promise<void>
  createServer: (input: {
    projectId: string
    name: string
    port: number
    basePath?: string
    description?: string
    /** Absent = `http`; changeable later via `updateServer` (issue #222). */
    kind?: MockServerKind
  }) => Promise<MockServer | null>
  /**
   * `null` = saved. Otherwise the reason, and the stored server is unchanged —
   * e.g. a running server's new port is busy (tester finding 11).
   */
  updateServer: (id: string, patch: Partial<MockServer>) => Promise<string | null>
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
  /**
   * Returns the main process's error message (e.g. a rejected stream setting,
   * issue #221), or null on success — callers that show it must not swallow it.
   */
  updateResponse: (id: string, patch: Partial<MockResponse>) => Promise<string | null>
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
  }>
  importPostman: (
    serverId: string,
    source: string,
  ) => Promise<{
    ok: boolean
    endpointsCreated: number
    responsesCreated: number
    warnings: string[]
    error?: string
  }>
}

/**
 * Bumped by every `loadServers` call: only the LATEST list may land — the
 * same guard the Mock MCP store has. Without it, opening project B while A's
 * list was still loading let A's answer arrive last and replace B's HTTP
 * servers (issue #190 follow-up: the panel then showed the wrong project's
 * servers, or none).
 */
let loadSeq = 0

export const useMockStore = create<MockState>((set, get) => ({
  servers: [],
  projectId: null,
  endpointsByServer: {},
  responsesByEndpoint: {},
  statusByServer: {},
  errorByServer: {},
  logsByServer: {},

  loadServers: async (projectId) => {
    const seq = ++loadSeq
    const r = await api.server.list(projectId)
    if (seq !== loadSeq) return // a newer load superseded this one
    if (r.success && r.data) set({ servers: r.data, projectId })
  },

  createServer: async (input) => {
    const r = await api.server.create({
      projectId: input.projectId,
      name: input.name,
      port: input.port,
      basePath: input.basePath,
      description: input.description,
      ...(input.kind ? { kind: input.kind } : {}),
    } as Partial<MockServer> & { projectId: string; name: string; port: number })
    if (!r.success || !r.data) return null
    set((s) => ({ servers: [...s.servers, r.data!] }))
    return r.data
  },

  updateServer: async (id, patch) => {
    const r = await api.server.update(id, patch)
    if (!r.success || !r.data) return mockIpcErrorText(r, t('common.unknownError'))
    const updated = r.data
    set((s) => ({ servers: s.servers.map((sv) => (sv.id === id ? updated : sv)) }))
    return null
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
    // Asked once here so Allow does not wait for the first request. The answer
    // does not stop the server: with "Not now" a scripted response answers with
    // the reason, and the mock server reads the state on every request.
    const owner = get().servers.find((srv) => srv.id === id)?.projectId ?? get().projectId
    set((s) => ({ statusByServer: { ...s.statusByServer, [id]: 'starting' } }))
    await ensureScriptsAllowed(owner)
    const r = await api.server.start(id)
    if (!r.success) {
      // A busy port arrives structured: worded in the user's language.
      const error = mockIpcErrorText(r, t('common.unknownError'))
      set((s) => ({
        statusByServer: { ...s.statusByServer, [id]: 'error' },
        errorByServer: { ...s.errorByServer, [id]: error },
      }))
      return error
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
    if (!r.success || !r.data) return r.error ?? t('mock.error.updateFailed')
    const resp = r.data
    set((s) => ({
      responsesByEndpoint: {
        ...s.responsesByEndpoint,
        [resp.endpointId]: (s.responsesByEndpoint[resp.endpointId] ?? []).map((rr) =>
          rr.id === id ? resp : rr,
        ),
      },
    }))
    return null
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
      set((s) => ({
        logsByServer: { ...s.logsByServer, [serverId]: collapseStreamLogs(r.data!) },
      }))
    }
  },

  clearLogs: async (serverId) => {
    await api.logs.clear(serverId)
    set((s) => ({ logsByServer: { ...s.logsByServer, [serverId]: [] } }))
  },

  importOpenApi: async (serverId, source) => {
    const r = await api.importOpenApi(serverId, source)
    if (!r.success || !r.data) return importFailure(r.error)
    // Refresh endpoints list after import
    const ep = await api.endpoint.list(serverId)
    if (ep.success && ep.data) {
      set((s) => ({ endpointsByServer: { ...s.endpointsByServer, [serverId]: ep.data! } }))
    }
    return r.data
  },

  importPostman: async (serverId, source) => {
    const r = await api.importPostman(serverId, source)
    if (!r.success || !r.data) return importFailure(r.error)
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
    // A stream's "closed" entry replaces its "open" row (issue #226).
    const next = mergeStreamLog(cur, entry)
    if (next.length > 500) next.splice(0, next.length - 500)
    return { logsByServer: { ...s.logsByServer, [entry.serverId]: next } }
  })
})

api.onStatus(({ serverId, status, errorMessage, errorInfo }) => {
  const error = errorMessage === null ? null : describeListenError(errorInfo, errorMessage)
  useMockStore.setState((s) => ({
    statusByServer: { ...s.statusByServer, [serverId]: status },
    errorByServer: {
      ...s.errorByServer,
      [serverId]: error ?? s.errorByServer[serverId] ?? null,
    },
  }))
})

function omit<T extends Record<string, unknown>>(obj: T, key: string): T {
  const { [key]: _, ...rest } = obj
  return rest as T
}
