/**
 * IPC handlers for the mock-server feature.
 * Pattern: handlers always return `{ success, data?, error? }`.
 */

import { ipcMain, BrowserWindow } from 'electron'
import {
  createMockServer,
  listMockServers,
  getMockServer,
  updateMockServer,
  deleteMockServer,
  createMockEndpoint,
  listMockEndpoints,
  getMockEndpoint,
  updateMockEndpoint,
  deleteMockEndpoint,
  createMockResponse,
  listMockResponses,
  getMockResponse,
  updateMockResponse,
  deleteMockResponse,
  getMockServerSnapshot,
  type MockServerRow,
  type MockEndpointRow,
  type MockResponseRow,
  type CreateMockServerInput,
  type UpdateMockServerInput,
  type CreateMockEndpointInput,
  type UpdateMockEndpointInput,
  type CreateMockResponseInput,
  type UpdateMockResponseInput,
} from '../db/mock.repo'
import { mockServerManager, type MockServerDef } from '../mock/server'
import { importOpenApi, importPostman, type ImportResult } from '../mock/importers'
import type {
  AuthConfig,
  CorsConfig,
  FailureConfig,
  MockBodyType,
  MockMethod,
  MockPathMode,
  RateLimitConfig,
  SchemaValidation,
} from '../mock/types'

type Result<T> = { success: true; data: T } | { success: false; error: string }

function ok<T>(data: T): Result<T> {
  return { success: true, data }
}
function fail(error: unknown): Result<never> {
  return { success: false, error: error instanceof Error ? error.message : String(error) }
}

function buildServerDef(serverId: string): MockServerDef | null {
  const snap = getMockServerSnapshot(serverId)
  if (!snap) return null

  const cors: CorsConfig = {
    enabled: !!snap.server.cors_enabled,
    allowOrigins: snap.server.cors_allow_origins,
    allowMethods: snap.server.cors_allow_methods,
    allowHeaders: snap.server.cors_allow_headers,
    allowCredentials: !!snap.server.cors_allow_credentials,
    maxAge: snap.server.cors_max_age,
  }
  const auth = safeJsonParse<AuthConfig>(snap.server.auth_config, { type: 'none' })
  const failure = safeJsonParse<FailureConfig>(snap.server.failure_config, {
    enabled: false,
    probability: 0,
    mode: 'status',
    status: 500,
    timeoutMs: 30000,
  })
  const rateLimit = safeJsonParse<RateLimitConfig>(snap.server.rate_limit_config, {
    enabled: false,
    requestsPerWindow: 100,
    windowMs: 60000,
    scope: 'ip',
  })

  return {
    id: snap.server.id,
    name: snap.server.name,
    host: snap.server.host as '127.0.0.1' | '0.0.0.0',
    port: snap.server.port,
    basePath: snap.server.base_path,
    cors,
    auth,
    failure,
    rateLimit,
    echoEnabled: !!snap.server.echo_enabled,
    proxyEnabled: !!snap.server.proxy_enabled,
    proxyTarget: snap.server.proxy_target,
    proxyRecord: !!snap.server.proxy_record,
    projectId: snap.server.project_id,
    // Look up workspace from the project — mock_servers doesn't store it
    // directly and the env-var loader needs both scopes.
    workspaceId: (() => {
      try {
        const proj = require('../db/project.repo').getProjectById(snap.server.project_id) as
          | { workspace_id: string }
          | undefined
        return proj?.workspace_id
      } catch {
        return undefined
      }
    })(),
    endpoints: snap.endpoints.map(({ endpoint, responses }) => ({
      id: endpoint.id,
      method: endpoint.method as MockMethod,
      path: endpoint.path,
      pathMode: endpoint.path_mode as MockPathMode,
      description: endpoint.description,
      priority: endpoint.priority,
      enabled: !!endpoint.enabled,
      authOverride: endpoint.auth_override
        ? safeJsonParse<AuthConfig | null>(endpoint.auth_override, null)
        : null,
      schemaValidation: endpoint.schema_validation
        ? safeJsonParse<SchemaValidation | null>(endpoint.schema_validation, null)
        : null,
      responses: responses.map((r) => ({
        id: r.id,
        name: r.name,
        statusCode: r.status_code,
        headers: safeJsonParse(r.headers, []) as { name: string; value: string }[],
        bodyType: r.body_type as MockBodyType,
        body: r.body,
        delayMs: r.delay_ms,
        condition: safeJsonParse(r.condition, { type: 'always' }),
        script: r.script ?? '',
        order: r.response_order,
        enabled: !!r.enabled,
      })),
    })),
  }
}

function safeJsonParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function registerMockHandlers(): void {
  // ── Server CRUD ──────────────────────────────────────────────
  ipcMain.handle('mock:server:list', async (_e, projectId: string) => {
    try {
      return ok(listMockServers(projectId).map(serverRowToView))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mock:server:get', async (_e, id: string) => {
    try {
      const row = getMockServer(id)
      return ok(row ? serverRowToView(row) : null)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mock:server:create', async (_e, input: CreateMockServerInput) => {
    try {
      return ok(serverRowToView(createMockServer(input)))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mock:server:update', async (_e, id: string, patch: UpdateMockServerInput) => {
    try {
      const row = updateMockServer(id, patch)
      if (!row) return fail('Server not found')
      // Hot-reload running server if any
      if (mockServerManager.status(id) === 'running') {
        const def = buildServerDef(id)
        if (def) await mockServerManager.update(def)
      }
      return ok(serverRowToView(row))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mock:server:delete', async (_e, id: string) => {
    try {
      await mockServerManager.stop(id)
      return ok(deleteMockServer(id))
    } catch (e) {
      return fail(e)
    }
  })

  // ── Server lifecycle ─────────────────────────────────────────
  ipcMain.handle('mock:server:start', async (_e, id: string) => {
    try {
      const def = buildServerDef(id)
      if (!def) return fail('Server not found')
      const r = await mockServerManager.start(def)
      if (!r.ok) return fail(r.error)
      return ok({ status: mockServerManager.status(id), port: def.port })
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mock:server:stop', async (_e, id: string) => {
    try {
      await mockServerManager.stop(id)
      return ok({ status: 'stopped' as const })
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mock:server:status', async (_e, id: string) => {
    return ok({ status: mockServerManager.status(id) })
  })

  // ── Endpoint CRUD ────────────────────────────────────────────
  ipcMain.handle('mock:endpoint:list', async (_e, serverId: string) => {
    try {
      return ok(listMockEndpoints(serverId).map(endpointRowToView))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mock:endpoint:get', async (_e, id: string) => {
    try {
      const row = getMockEndpoint(id)
      return ok(row ? endpointRowToView(row) : null)
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mock:endpoint:create', async (_e, input: CreateMockEndpointInput) => {
    try {
      const row = createMockEndpoint(input)
      await reloadIfRunning(input.serverId)
      return ok(endpointRowToView(row))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mock:endpoint:update', async (_e, id: string, patch: UpdateMockEndpointInput) => {
    try {
      const row = updateMockEndpoint(id, patch)
      if (!row) return fail('Endpoint not found')
      await reloadIfRunning(row.server_id)
      return ok(endpointRowToView(row))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mock:endpoint:delete', async (_e, id: string) => {
    try {
      const row = getMockEndpoint(id)
      const result = deleteMockEndpoint(id)
      if (row) await reloadIfRunning(row.server_id)
      return ok(result)
    } catch (e) {
      return fail(e)
    }
  })

  // ── Response CRUD ────────────────────────────────────────────
  ipcMain.handle('mock:response:list', async (_e, endpointId: string) => {
    try {
      return ok(listMockResponses(endpointId).map(responseRowToView))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mock:response:create', async (_e, input: CreateMockResponseInput) => {
    try {
      const row = createMockResponse(input)
      await reloadServerForEndpoint(input.endpointId)
      return ok(responseRowToView(row))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mock:response:update', async (_e, id: string, patch: UpdateMockResponseInput) => {
    try {
      const row = updateMockResponse(id, patch)
      if (!row) return fail('Response not found')
      await reloadServerForEndpoint(row.endpoint_id)
      return ok(responseRowToView(row))
    } catch (e) {
      return fail(e)
    }
  })

  ipcMain.handle('mock:response:delete', async (_e, id: string) => {
    try {
      const target = getMockResponse(id)
      const result = deleteMockResponse(id)
      if (target) await reloadServerForEndpoint(target.endpoint_id)
      return ok(result)
    } catch (e) {
      return fail(e)
    }
  })

  // ── Logs ─────────────────────────────────────────────────────
  ipcMain.handle('mock:logs:get', async (_e, serverId: string) => {
    return ok(mockServerManager.getLogs(serverId))
  })

  ipcMain.handle('mock:logs:clear', async (_e, serverId: string) => {
    mockServerManager.clearLogs(serverId)
    return ok(true)
  })

  // ── Importers ────────────────────────────────────────────────
  ipcMain.handle(
    'mock:import:openapi',
    async (
      _e,
      serverId: string,
      source: string,
    ): Promise<{ success: boolean; data?: ImportResult; error?: string }> => {
      try {
        const r = await importOpenApi(serverId, source)
        await reloadIfRunning(serverId)
        return ok(r)
      } catch (e) {
        return fail(e)
      }
    },
  )

  ipcMain.handle(
    'mock:import:postman',
    async (
      _e,
      serverId: string,
      source: string,
    ): Promise<{ success: boolean; data?: ImportResult; error?: string }> => {
      try {
        const r = importPostman(serverId, source)
        await reloadIfRunning(serverId)
        return ok(r)
      } catch (e) {
        return fail(e)
      }
    },
  )

  // ── Streaming events ─────────────────────────────────────────
  mockServerManager.on('log', (entry) => broadcast('mock:log', entry))
  mockServerManager.on('status', (info) => broadcast('mock:status', info))
}

// ─── Helpers ─────────────────────────────────────────────────────

async function reloadIfRunning(serverId: string): Promise<void> {
  if (mockServerManager.status(serverId) !== 'running') return
  const def = buildServerDef(serverId)
  if (def) await mockServerManager.update(def)
}

async function reloadServerForEndpoint(endpointId: string): Promise<void> {
  const ep = getMockEndpoint(endpointId)
  if (!ep) return
  await reloadIfRunning(ep.server_id)
}

function serverRowToView(r: MockServerRow): {
  id: string
  projectId: string
  name: string
  description: string
  host: string
  port: number
  basePath: string
  autoStart: boolean
  corsEnabled: boolean
  corsAllowOrigins: string
  corsAllowMethods: string
  corsAllowHeaders: string
  corsAllowCredentials: boolean
  corsMaxAge: number
  authConfig: unknown
  failureConfig: unknown
  rateLimitConfig: unknown
  echoEnabled: boolean
  proxyEnabled: boolean
  proxyTarget: string
  proxyRecord: boolean
  createdAt: number
  updatedAt: number
} {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description,
    host: r.host,
    port: r.port,
    basePath: r.base_path,
    autoStart: !!r.auto_start,
    corsEnabled: !!r.cors_enabled,
    corsAllowOrigins: r.cors_allow_origins,
    corsAllowMethods: r.cors_allow_methods,
    corsAllowHeaders: r.cors_allow_headers,
    corsAllowCredentials: !!r.cors_allow_credentials,
    corsMaxAge: r.cors_max_age,
    authConfig: safeJsonParse(r.auth_config, { type: 'none' }),
    failureConfig: safeJsonParse(r.failure_config, {
      enabled: false,
      probability: 0,
      mode: 'status',
      status: 500,
      timeoutMs: 30000,
    }),
    rateLimitConfig: safeJsonParse(r.rate_limit_config, {
      enabled: false,
      requestsPerWindow: 100,
      windowMs: 60000,
      scope: 'ip',
    }),
    echoEnabled: !!r.echo_enabled,
    proxyEnabled: !!r.proxy_enabled,
    proxyTarget: r.proxy_target,
    proxyRecord: !!r.proxy_record,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function endpointRowToView(r: MockEndpointRow): {
  id: string
  serverId: string
  method: string
  path: string
  pathMode: string
  description: string
  priority: number
  enabled: boolean
  sortOrder: number
  authOverride: unknown
  schemaValidation: unknown
  createdAt: number
  updatedAt: number
} {
  return {
    id: r.id,
    serverId: r.server_id,
    method: r.method,
    path: r.path,
    pathMode: r.path_mode,
    description: r.description,
    priority: r.priority,
    enabled: !!r.enabled,
    sortOrder: r.sort_order,
    authOverride: r.auth_override ? safeJsonParse(r.auth_override, null) : null,
    schemaValidation: r.schema_validation ? safeJsonParse(r.schema_validation, null) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function responseRowToView(r: MockResponseRow): {
  id: string
  endpointId: string
  name: string
  statusCode: number
  headers: { name: string; value: string }[]
  bodyType: string
  body: string
  delayMs: number
  condition: unknown
  script: string
  order: number
  enabled: boolean
} {
  return {
    id: r.id,
    endpointId: r.endpoint_id,
    name: r.name,
    statusCode: r.status_code,
    headers: safeJsonParse(r.headers, []),
    bodyType: r.body_type,
    body: r.body,
    delayMs: r.delay_ms,
    condition: safeJsonParse(r.condition, { type: 'always' }),
    script: r.script ?? '',
    order: r.response_order,
    enabled: !!r.enabled,
  }
}
