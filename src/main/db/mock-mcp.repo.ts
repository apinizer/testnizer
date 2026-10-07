/**
 * `mock_mcp_servers` CRUD (issue #140). One row per Mock MCP server; tools,
 * resources, prompts and the error mode live in JSON columns so the schema
 * mirrors (database.ts, test helpers, export round-trip test) stay small.
 *
 * Patch semantics follow mock.repo: `undefined` = keep, and for the nullable
 * fields (`protocolPin`) `null` = clear. Every write is validated with the
 * same rules the live server relies on, so a bad config fails at save time
 * with a readable message instead of at request time.
 */

import { randomUUID } from 'crypto'
import { getDb } from './database'
import {
  DEFAULT_ERROR_MODE,
  defaultTools,
  normalizeErrorMode,
  normalizePath,
  normalizePrompts,
  normalizeResources,
  normalizeTools,
  validateMockMcpConfig,
} from '../mock-mcp/config'
import type {
  MockMcpAuthMode,
  MockMcpErrorMode,
  MockMcpPrompt,
  MockMcpResource,
  MockMcpServerConfig,
  MockMcpTool,
} from '../mock-mcp/types'

export interface MockMcpServerRow {
  id: string
  project_id: string
  name: string
  description: string
  host: string
  port: number
  path: string
  legacy_sse: number
  auth_mode: string
  bearer_token: string
  latency_ms: number
  error_mode: string
  protocol_pin: string | null
  tools_json: string
  resources_json: string
  prompts_json: string
  enabled: number
  created_at: number
  updated_at: number
}

/** Column list shared by INSERT/UPDATE here and the project export/import. */
export const MOCK_MCP_SERVER_COLUMNS = [
  'id',
  'project_id',
  'name',
  'description',
  'host',
  'port',
  'path',
  'legacy_sse',
  'auth_mode',
  'bearer_token',
  'latency_ms',
  'error_mode',
  'protocol_pin',
  'tools_json',
  'resources_json',
  'prompts_json',
  'enabled',
  'created_at',
  'updated_at',
] as const

export interface CreateMockMcpServerInput {
  projectId: string
  name: string
  description?: string
  host?: string
  port: number
  path?: string
  legacySse?: boolean
  authMode?: MockMcpAuthMode
  bearerToken?: string
  latencyMs?: number
  errorMode?: MockMcpErrorMode
  protocolPin?: string | null
  /** Omitted → one `echo` tool, so a new server answers something right away. */
  tools?: MockMcpTool[]
  resources?: MockMcpResource[]
  prompts?: MockMcpPrompt[]
  enabled?: boolean
}

export type UpdateMockMcpServerInput = Partial<Omit<CreateMockMcpServerInput, 'projectId'>>

function safeJson(text: string | null | undefined): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

export function mockMcpRowToConfig(r: MockMcpServerRow): MockMcpServerConfig {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description ?? '',
    host: r.host || '127.0.0.1',
    port: r.port,
    path: normalizePath(r.path),
    legacySse: !!r.legacy_sse,
    authMode: r.auth_mode === 'bearer' ? 'bearer' : 'none',
    bearerToken: r.bearer_token ?? '',
    latencyMs: Math.max(0, r.latency_ms ?? 0),
    errorMode: normalizeErrorMode(safeJson(r.error_mode)),
    protocolPin: r.protocol_pin || null,
    tools: normalizeTools(safeJson(r.tools_json)),
    resources: normalizeResources(safeJson(r.resources_json)),
    prompts: normalizePrompts(safeJson(r.prompts_json)),
    enabled: r.enabled !== 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function configToRow(c: MockMcpServerConfig): MockMcpServerRow {
  return {
    id: c.id,
    project_id: c.projectId,
    name: c.name,
    description: c.description,
    host: c.host,
    port: c.port,
    path: c.path,
    legacy_sse: c.legacySse ? 1 : 0,
    auth_mode: c.authMode,
    bearer_token: c.bearerToken,
    latency_ms: c.latencyMs,
    error_mode: JSON.stringify(c.errorMode),
    protocol_pin: c.protocolPin,
    tools_json: JSON.stringify(c.tools),
    resources_json: JSON.stringify(c.resources),
    prompts_json: JSON.stringify(c.prompts),
    enabled: c.enabled ? 1 : 0,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  }
}

function assertValid(c: MockMcpServerConfig): void {
  const problem = validateMockMcpConfig(c)
  if (problem) throw new Error(problem)
}

const UPSERT_COLUMNS = MOCK_MCP_SERVER_COLUMNS.join(', ')
const UPSERT_VALUES = MOCK_MCP_SERVER_COLUMNS.map((c) => `@${c}`).join(', ')

export function createMockMcpServer(input: CreateMockMcpServerInput): MockMcpServerConfig {
  if (!input || typeof input.projectId !== 'string' || !input.projectId) {
    throw new Error('projectId is required')
  }
  const now = Date.now()
  const cfg: MockMcpServerConfig = {
    id: randomUUID(),
    projectId: input.projectId,
    name: (input.name ?? '').trim(),
    description: input.description ?? '',
    host: input.host?.trim() || '127.0.0.1',
    port: input.port,
    path: normalizePath(input.path),
    legacySse: !!input.legacySse,
    authMode: input.authMode ?? 'none',
    bearerToken: input.bearerToken ?? '',
    latencyMs: input.latencyMs ?? 0,
    errorMode: input.errorMode ? normalizeErrorMode(input.errorMode) : { ...DEFAULT_ERROR_MODE },
    protocolPin: input.protocolPin || null,
    tools: input.tools === undefined ? defaultTools() : normalizeTools(input.tools),
    resources: normalizeResources(input.resources ?? []),
    prompts: normalizePrompts(input.prompts ?? []),
    enabled: input.enabled !== false,
    createdAt: now,
    updatedAt: now,
  }
  assertValid(cfg)
  getDb()
    .prepare(`INSERT INTO mock_mcp_servers (${UPSERT_COLUMNS}) VALUES (${UPSERT_VALUES})`)
    .run(configToRow(cfg))
  return cfg
}

export function listMockMcpServers(projectId: string): MockMcpServerConfig[] {
  const rows = getDb()
    .prepare('SELECT * FROM mock_mcp_servers WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as MockMcpServerRow[]
  return rows.map(mockMcpRowToConfig)
}

export function getMockMcpServer(id: string): MockMcpServerConfig | null {
  const row = getDb().prepare('SELECT * FROM mock_mcp_servers WHERE id = ?').get(id) as
    | MockMcpServerRow
    | undefined
  return row ? mockMcpRowToConfig(row) : null
}

export function updateMockMcpServer(
  id: string,
  patch: UpdateMockMcpServerInput,
): MockMcpServerConfig | null {
  const cur = getMockMcpServer(id)
  if (!cur) return null
  const p = patch ?? {}
  const next: MockMcpServerConfig = {
    ...cur,
    name: p.name !== undefined ? p.name.trim() : cur.name,
    description: p.description ?? cur.description,
    host: p.host !== undefined ? p.host.trim() : cur.host,
    port: p.port ?? cur.port,
    path: p.path !== undefined ? normalizePath(p.path) : cur.path,
    legacySse: p.legacySse ?? cur.legacySse,
    authMode: p.authMode ?? cur.authMode,
    bearerToken: p.bearerToken ?? cur.bearerToken,
    latencyMs: p.latencyMs ?? cur.latencyMs,
    errorMode: p.errorMode !== undefined ? normalizeErrorMode(p.errorMode) : cur.errorMode,
    protocolPin: p.protocolPin !== undefined ? p.protocolPin || null : cur.protocolPin,
    tools: p.tools !== undefined ? normalizeTools(p.tools) : cur.tools,
    resources: p.resources !== undefined ? normalizeResources(p.resources) : cur.resources,
    prompts: p.prompts !== undefined ? normalizePrompts(p.prompts) : cur.prompts,
    enabled: p.enabled ?? cur.enabled,
    updatedAt: Date.now(),
  }
  assertValid(next)
  const setClause = MOCK_MCP_SERVER_COLUMNS.filter((c) => c !== 'id' && c !== 'project_id')
    .map((c) => `${c} = @${c}`)
    .join(', ')
  getDb().prepare(`UPDATE mock_mcp_servers SET ${setClause} WHERE id = @id`).run(configToRow(next))
  return next
}

export function deleteMockMcpServer(id: string): boolean {
  return getDb().prepare('DELETE FROM mock_mcp_servers WHERE id = ?').run(id).changes > 0
}
