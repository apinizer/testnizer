/**
 * In-memory `window.api.mockMcp` bridge for the Mock MCP renderer tests
 * (issue #140). Every method is a `vi.fn` so tests can assert the exact IPC
 * calls; `emitLog` / `emitStatus` drive the main → renderer event streams.
 */
import { vi } from 'vitest'
import type {
  MockMcpBridge,
  MockMcpLogEntry,
  MockMcpServer,
  MockMcpServerState,
} from '../../src/renderer/types/mock-mcp'

export function sampleServer(over: Partial<MockMcpServer> = {}): MockMcpServer {
  return {
    id: 'srv-1',
    projectId: 'p-1',
    name: 'Echo MCP',
    description: '',
    host: '127.0.0.1',
    port: 3100,
    path: '/mcp',
    legacySse: false,
    authMode: 'none',
    bearerToken: '',
    latencyMs: 0,
    errorMode: { kind: 'none' },
    protocolPin: null,
    tools: [
      {
        name: 'echo',
        description: 'Echoes',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        response: { kind: 'template', body: '{{args.text}}' },
      },
    ],
    resources: [],
    prompts: [],
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

export function runningState(serverId: string, port = 3100): MockMcpServerState {
  return {
    serverId,
    status: 'running',
    port,
    url: `http://127.0.0.1:${port}/mcp`,
    sseUrl: null,
    errorMessage: null,
  }
}

export function stopped(serverId: string): MockMcpServerState {
  return { serverId, status: 'stopped', port: null, url: null, sseUrl: null, errorMessage: null }
}

export function logEntry(serverId: string, id: string, over: Partial<MockMcpLogEntry> = {}) {
  return {
    id,
    serverId,
    ts: Date.now(),
    method: 'tools/call',
    toolName: 'echo',
    durationMs: 3,
    ok: true,
    request: '{"jsonrpc":"2.0"}',
    response: '{"jsonrpc":"2.0"}',
    ...over,
  } satisfies MockMcpLogEntry
}

export interface BridgeStub {
  bridge: MockMcpBridge
  emitLog: (e: MockMcpLogEntry) => void
  emitStatus: (s: MockMcpServerState) => void
}

export function installBridge(servers: MockMcpServer[] = [sampleServer()]): BridgeStub {
  const logListeners: Array<(e: MockMcpLogEntry) => void> = []
  const statusListeners: Array<(s: MockMcpServerState) => void> = []
  const state = { servers: [...servers] }
  const ok = <T>(data: T) => Promise.resolve({ success: true as const, data })

  const bridge = {
    server: {
      list: vi.fn((projectId: string) =>
        ok(state.servers.filter((s) => s.projectId === projectId)),
      ),
      get: vi.fn((id: string) => ok(state.servers.find((s) => s.id === id) ?? null)),
      create: vi.fn((input: { projectId: string; name: string; port: number }) => {
        const created = sampleServer({ ...input, id: `srv-new-${state.servers.length + 1}` })
        state.servers.push(created)
        return ok(created)
      }),
      update: vi.fn((id: string, patch: Partial<MockMcpServer>) => {
        const cur = state.servers.find((s) => s.id === id)
        if (!cur) return Promise.resolve({ success: false as const, error: 'not found' })
        const next = { ...cur, ...patch, updatedAt: cur.updatedAt + 1 }
        state.servers = state.servers.map((s) => (s.id === id ? next : s))
        return ok(next)
      }),
      delete: vi.fn(() => ok(true)),
      start: vi.fn((id: string) => ok(runningState(id))),
      stop: vi.fn((id: string) => ok(stopped(id))),
      status: vi.fn((id: string) => ok(stopped(id))),
    },
    logs: {
      get: vi.fn(() => ok([] as MockMcpLogEntry[])),
      clear: vi.fn(() => ok(true)),
    },
    onLog: vi.fn((cb: (e: MockMcpLogEntry) => void) => {
      logListeners.push(cb)
      return () => logListeners.splice(logListeners.indexOf(cb), 1)
    }),
    onStatus: vi.fn((cb: (s: MockMcpServerState) => void) => {
      statusListeners.push(cb)
      return () => statusListeners.splice(statusListeners.indexOf(cb), 1)
    }),
  } as unknown as MockMcpBridge

  const w = window as unknown as { api?: Record<string, unknown> }
  w.api = { ...(w.api ?? {}), mockMcp: bridge }
  return {
    bridge,
    emitLog: (e) => logListeners.forEach((cb) => cb(e)),
    emitStatus: (s) => statusListeners.forEach((cb) => cb(s)),
  }
}
