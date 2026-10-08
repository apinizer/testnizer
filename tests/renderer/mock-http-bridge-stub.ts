/**
 * In-memory `window.api.mock` bridge for the HTTP-mock renderer tests
 * (issue #140) — the HTTP twin of `mock-mcp-bridge-stub.ts`.
 *
 * `mock.store.ts` captures `window.api.mock` and subscribes to its events at
 * MODULE LOAD, so the bridge is installed as a side effect of importing this
 * file: import it BEFORE anything that pulls in the store. The bridge object
 * is created once and never replaced; `reset()` swaps its data and clears the
 * mocks between tests. Every call is appended to `calls` ("server.create",
 * "endpoint.create", …) so tests can assert the IPC order.
 */
import { vi } from 'vitest'
import type { MockEndpoint, MockResponse, MockServer } from '../../src/renderer/types'

export function httpServer(over: Partial<MockServer> = {}): MockServer {
  return {
    id: 'h-1',
    projectId: 'p-1',
    name: 'Mock Server',
    description: '',
    host: '127.0.0.1',
    port: 3001,
    basePath: '',
    autoStart: false,
    corsEnabled: false,
    corsAllowOrigins: '*',
    corsAllowMethods: 'GET,POST',
    corsAllowHeaders: '*',
    corsAllowCredentials: false,
    corsMaxAge: 600,
    authConfig: { type: 'none' },
    failureConfig: { enabled: false, probability: 0, mode: 'status', status: 500 },
    rateLimitConfig: { enabled: false, requestsPerWindow: 100, windowMs: 60000, scope: 'ip' },
    echoEnabled: false,
    proxyEnabled: false,
    proxyTarget: '',
    proxyRecord: false,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

const ok = <T>(data: T) => Promise.resolve({ success: true as const, data })
const fail = (error: string) => Promise.resolve({ success: false as const, error })

const state = {
  servers: [] as MockServer[],
  endpoints: [] as MockEndpoint[],
  responses: [] as MockResponse[],
  /** When set, `endpoint.create` fails with this message (rollback tests). */
  failEndpointCreate: null as string | null,
}

export const calls: string[] = []
let seq = 0

function track<A extends unknown[], R>(name: string, impl: (...args: A) => R) {
  return vi.fn((...args: A) => {
    calls.push(name)
    return impl(...args)
  })
}

export const httpBridge = {
  server: {
    list: track('server.list', (projectId: string) =>
      ok(state.servers.filter((s) => s.projectId === projectId)),
    ),
    get: track('server.get', (id: string) => ok(state.servers.find((s) => s.id === id))),
    create: track(
      'server.create',
      (input: { projectId: string; name: string; port: number; description?: string }) => {
        seq += 1
        const created = httpServer({ ...input, id: `h-new-${seq}` })
        state.servers.push(created)
        return ok(created)
      },
    ),
    update: track('server.update', (id: string, patch: Partial<MockServer>) => {
      const cur = state.servers.find((s) => s.id === id)
      if (!cur) return fail('Server not found')
      const next = { ...cur, ...patch }
      state.servers = state.servers.map((s) => (s.id === id ? next : s))
      return ok(next)
    }),
    delete: track('server.delete', (id: string) => {
      state.servers = state.servers.filter((s) => s.id !== id)
      return ok(true)
    }),
    start: track('server.start', () => ok({ status: 'running' as const, port: 3001 })),
    stop: track('server.stop', () => ok({ status: 'stopped' as const })),
    status: track('server.status', () => ok({ status: 'stopped' as const })),
  },
  endpoint: {
    list: track('endpoint.list', (serverId: string) =>
      ok(state.endpoints.filter((e) => e.serverId === serverId)),
    ),
    get: track('endpoint.get', (id: string) => ok(state.endpoints.find((e) => e.id === id))),
    create: track('endpoint.create', (input: Partial<MockEndpoint> & { serverId: string }) => {
      if (state.failEndpointCreate) return fail(state.failEndpointCreate)
      seq += 1
      const ep = {
        method: 'GET',
        path: '/',
        pathMode: 'exact',
        description: '',
        priority: 0,
        enabled: true,
        sortOrder: 0,
        authOverride: null,
        schemaValidation: null,
        createdAt: 1,
        updatedAt: 1,
        ...input,
        id: `ep-${seq}`,
      } as MockEndpoint
      state.endpoints.push(ep)
      return ok(ep)
    }),
    update: track('endpoint.update', () => fail('not used')),
    delete: track('endpoint.delete', () => ok(true)),
  },
  response: {
    list: track('response.list', (endpointId: string) =>
      ok(state.responses.filter((r) => r.endpointId === endpointId)),
    ),
    create: track('response.create', (input: Partial<MockResponse> & { endpointId: string }) => {
      seq += 1
      const r = { ...input, id: `r-${seq}` } as MockResponse
      state.responses.push(r)
      return ok(r)
    }),
    update: track('response.update', () => fail('not used')),
    delete: track('response.delete', () => ok(true)),
  },
  logs: {
    get: vi.fn(() => ok([])),
    clear: vi.fn(() => ok(true)),
  },
  importOpenApi: vi.fn(() => ok(null)),
  importPostman: vi.fn(() => ok(null)),
  onLog: vi.fn(() => () => {}),
  onStatus: vi.fn(() => () => {}),
}

/** Replace the bridge's data and clear every recorded call. */
export function resetHttpBridge(
  servers: MockServer[] = [],
  opts: { failEndpointCreate?: string } = {},
): void {
  state.servers = [...servers]
  state.endpoints = []
  state.responses = []
  state.failEndpointCreate = opts.failEndpointCreate ?? null
  calls.length = 0
  for (const group of [httpBridge.server, httpBridge.endpoint, httpBridge.response]) {
    for (const fn of Object.values(group)) fn.mockClear()
  }
}

export function bridgeEndpoints(): MockEndpoint[] {
  return state.endpoints
}

export function bridgeResponses(): MockResponse[] {
  return state.responses
}

const w = window as unknown as { api?: Record<string, unknown> }
w.api = { ...(w.api ?? {}), mock: httpBridge }
