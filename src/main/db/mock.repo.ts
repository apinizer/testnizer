import { randomUUID } from 'crypto'
import { getDb } from './database'

// ─── Row types (raw SQLite shape) ────────────────────────────────

export interface MockServerRow {
  id: string
  project_id: string
  name: string
  description: string
  host: string
  port: number
  base_path: string
  auto_start: number
  cors_enabled: number
  cors_allow_origins: string
  cors_allow_methods: string
  cors_allow_headers: string
  cors_allow_credentials: number
  cors_max_age: number
  auth_config: string
  failure_config: string
  rate_limit_config: string
  echo_enabled: number
  proxy_enabled: number
  proxy_target: string
  proxy_record: number
  created_at: number
  updated_at: number
}

export interface MockEndpointRow {
  id: string
  server_id: string
  method: string
  path: string
  path_mode: string
  description: string
  priority: number
  enabled: number
  sort_order: number
  auth_override: string
  schema_validation: string
  created_at: number
  updated_at: number
}

export interface MockResponseRow {
  id: string
  endpoint_id: string
  name: string
  status_code: number
  headers: string
  body_type: string
  body: string
  delay_ms: number
  condition: string
  script: string
  response_order: number
  enabled: number
}

// ─── Server CRUD ─────────────────────────────────────────────────

export interface CreateMockServerInput {
  projectId: string
  name: string
  description?: string
  host?: '127.0.0.1' | '0.0.0.0'
  port: number
  basePath?: string
  autoStart?: boolean
  corsEnabled?: boolean
  corsAllowOrigins?: string
}

export function createMockServer(input: CreateMockServerInput): MockServerRow {
  const id = randomUUID()
  const now = Date.now()
  const row: MockServerRow = {
    id,
    project_id: input.projectId,
    name: input.name,
    description: input.description ?? '',
    host: input.host ?? '127.0.0.1',
    port: input.port,
    base_path: input.basePath ?? '',
    auto_start: input.autoStart ? 1 : 0,
    cors_enabled: input.corsEnabled ? 1 : 0,
    cors_allow_origins: input.corsAllowOrigins ?? '*',
    cors_allow_methods: 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
    cors_allow_headers: '*',
    cors_allow_credentials: 0,
    cors_max_age: 600,
    auth_config: JSON.stringify({ type: 'none' }),
    failure_config: JSON.stringify({
      enabled: false,
      probability: 0,
      mode: 'status',
      status: 500,
      timeoutMs: 30000,
    }),
    rate_limit_config: JSON.stringify({
      enabled: false,
      requestsPerWindow: 100,
      windowMs: 60000,
      scope: 'ip',
    }),
    echo_enabled: 0,
    proxy_enabled: 0,
    proxy_target: '',
    proxy_record: 0,
    created_at: now,
    updated_at: now,
  }
  getDb()
    .prepare(
      `INSERT INTO mock_servers
        (id, project_id, name, description, host, port, base_path, auto_start,
         cors_enabled, cors_allow_origins, cors_allow_methods, cors_allow_headers,
         cors_allow_credentials, cors_max_age, auth_config, failure_config,
         rate_limit_config, echo_enabled, proxy_enabled, proxy_target, proxy_record,
         created_at, updated_at)
       VALUES (@id, @project_id, @name, @description, @host, @port, @base_path,
         @auto_start, @cors_enabled, @cors_allow_origins, @cors_allow_methods,
         @cors_allow_headers, @cors_allow_credentials, @cors_max_age,
         @auth_config, @failure_config, @rate_limit_config, @echo_enabled,
         @proxy_enabled, @proxy_target, @proxy_record, @created_at, @updated_at)`,
    )
    .run(row)
  return row
}

export function listMockServers(projectId: string): MockServerRow[] {
  return getDb()
    .prepare('SELECT * FROM mock_servers WHERE project_id = ? ORDER BY created_at ASC')
    .all(projectId) as MockServerRow[]
}

export function getMockServer(id: string): MockServerRow | null {
  return (
    (getDb().prepare('SELECT * FROM mock_servers WHERE id = ?').get(id) as
      | MockServerRow
      | undefined) ?? null
  )
}

export interface UpdateMockServerInput {
  name?: string
  description?: string
  host?: '127.0.0.1' | '0.0.0.0'
  port?: number
  basePath?: string
  autoStart?: boolean
  corsEnabled?: boolean
  corsAllowOrigins?: string
  corsAllowMethods?: string
  corsAllowHeaders?: string
  corsAllowCredentials?: boolean
  corsMaxAge?: number
  authConfig?: unknown
  failureConfig?: unknown
  rateLimitConfig?: unknown
  echoEnabled?: boolean
  proxyEnabled?: boolean
  proxyTarget?: string
  proxyRecord?: boolean
}

export function updateMockServer(id: string, patch: UpdateMockServerInput): MockServerRow | null {
  const cur = getMockServer(id)
  if (!cur) return null
  const next: MockServerRow = {
    ...cur,
    name: patch.name ?? cur.name,
    description: patch.description ?? cur.description,
    host: patch.host ?? (cur.host as '127.0.0.1' | '0.0.0.0'),
    port: patch.port ?? cur.port,
    base_path: patch.basePath ?? cur.base_path,
    auto_start: patch.autoStart === undefined ? cur.auto_start : patch.autoStart ? 1 : 0,
    cors_enabled: patch.corsEnabled === undefined ? cur.cors_enabled : patch.corsEnabled ? 1 : 0,
    cors_allow_origins: patch.corsAllowOrigins ?? cur.cors_allow_origins,
    cors_allow_methods: patch.corsAllowMethods ?? cur.cors_allow_methods,
    cors_allow_headers: patch.corsAllowHeaders ?? cur.cors_allow_headers,
    cors_allow_credentials:
      patch.corsAllowCredentials === undefined
        ? cur.cors_allow_credentials
        : patch.corsAllowCredentials
          ? 1
          : 0,
    cors_max_age: patch.corsMaxAge ?? cur.cors_max_age,
    auth_config:
      patch.authConfig !== undefined ? JSON.stringify(patch.authConfig) : cur.auth_config,
    failure_config:
      patch.failureConfig !== undefined ? JSON.stringify(patch.failureConfig) : cur.failure_config,
    rate_limit_config:
      patch.rateLimitConfig !== undefined
        ? JSON.stringify(patch.rateLimitConfig)
        : cur.rate_limit_config,
    echo_enabled: patch.echoEnabled === undefined ? cur.echo_enabled : patch.echoEnabled ? 1 : 0,
    proxy_enabled:
      patch.proxyEnabled === undefined ? cur.proxy_enabled : patch.proxyEnabled ? 1 : 0,
    proxy_target: patch.proxyTarget ?? cur.proxy_target,
    proxy_record: patch.proxyRecord === undefined ? cur.proxy_record : patch.proxyRecord ? 1 : 0,
    updated_at: Date.now(),
  }
  getDb()
    .prepare(
      `UPDATE mock_servers SET
         name=@name, description=@description, host=@host, port=@port,
         base_path=@base_path, auto_start=@auto_start, cors_enabled=@cors_enabled,
         cors_allow_origins=@cors_allow_origins, cors_allow_methods=@cors_allow_methods,
         cors_allow_headers=@cors_allow_headers, cors_allow_credentials=@cors_allow_credentials,
         cors_max_age=@cors_max_age, auth_config=@auth_config, failure_config=@failure_config,
         rate_limit_config=@rate_limit_config, echo_enabled=@echo_enabled,
         proxy_enabled=@proxy_enabled, proxy_target=@proxy_target, proxy_record=@proxy_record,
         updated_at=@updated_at
       WHERE id=@id`,
    )
    .run(next)
  return next
}

export function deleteMockServer(id: string): boolean {
  const r = getDb().prepare('DELETE FROM mock_servers WHERE id = ?').run(id)
  return r.changes > 0
}

// ─── Endpoint CRUD ───────────────────────────────────────────────

export interface CreateMockEndpointInput {
  serverId: string
  method?: string
  path: string
  pathMode?: string
  description?: string
  priority?: number
  enabled?: boolean
  sortOrder?: number
  authOverride?: unknown
  schemaValidation?: unknown
}

export function createMockEndpoint(input: CreateMockEndpointInput): MockEndpointRow {
  const id = randomUUID()
  const now = Date.now()
  const row: MockEndpointRow = {
    id,
    server_id: input.serverId,
    method: input.method ?? 'GET',
    path: input.path,
    path_mode: input.pathMode ?? 'exact',
    description: input.description ?? '',
    priority: input.priority ?? 0,
    enabled: input.enabled === false ? 0 : 1,
    sort_order: input.sortOrder ?? 0,
    auth_override: input.authOverride ? JSON.stringify(input.authOverride) : '',
    schema_validation: input.schemaValidation ? JSON.stringify(input.schemaValidation) : '',
    created_at: now,
    updated_at: now,
  }
  getDb()
    .prepare(
      `INSERT INTO mock_endpoints
        (id, server_id, method, path, path_mode, description, priority, enabled,
         sort_order, auth_override, schema_validation, created_at, updated_at)
       VALUES (@id, @server_id, @method, @path, @path_mode, @description, @priority,
         @enabled, @sort_order, @auth_override, @schema_validation, @created_at, @updated_at)`,
    )
    .run(row)
  return row
}

export function listMockEndpoints(serverId: string): MockEndpointRow[] {
  return getDb()
    .prepare('SELECT * FROM mock_endpoints WHERE server_id = ? ORDER BY sort_order, created_at')
    .all(serverId) as MockEndpointRow[]
}

export function getMockEndpoint(id: string): MockEndpointRow | null {
  return (
    (getDb().prepare('SELECT * FROM mock_endpoints WHERE id = ?').get(id) as
      | MockEndpointRow
      | undefined) ?? null
  )
}

export interface UpdateMockEndpointInput {
  method?: string
  path?: string
  pathMode?: string
  description?: string
  priority?: number
  enabled?: boolean
  sortOrder?: number
  /** null = clear override; undefined = keep current; object = set */
  authOverride?: unknown
  schemaValidation?: unknown
}

export function updateMockEndpoint(
  id: string,
  patch: UpdateMockEndpointInput,
): MockEndpointRow | null {
  const cur = getMockEndpoint(id)
  if (!cur) return null
  const next: MockEndpointRow = {
    ...cur,
    method: patch.method ?? cur.method,
    path: patch.path ?? cur.path,
    path_mode: patch.pathMode ?? cur.path_mode,
    description: patch.description ?? cur.description,
    priority: patch.priority ?? cur.priority,
    enabled: patch.enabled === undefined ? cur.enabled : patch.enabled ? 1 : 0,
    sort_order: patch.sortOrder ?? cur.sort_order,
    auth_override:
      patch.authOverride === undefined
        ? cur.auth_override
        : patch.authOverride === null
          ? ''
          : JSON.stringify(patch.authOverride),
    schema_validation:
      patch.schemaValidation === undefined
        ? cur.schema_validation
        : patch.schemaValidation === null
          ? ''
          : JSON.stringify(patch.schemaValidation),
    updated_at: Date.now(),
  }
  getDb()
    .prepare(
      `UPDATE mock_endpoints SET
         method=@method, path=@path, path_mode=@path_mode, description=@description,
         priority=@priority, enabled=@enabled, sort_order=@sort_order,
         auth_override=@auth_override, schema_validation=@schema_validation,
         updated_at=@updated_at
       WHERE id=@id`,
    )
    .run(next)
  return next
}

export function deleteMockEndpoint(id: string): boolean {
  const r = getDb().prepare('DELETE FROM mock_endpoints WHERE id = ?').run(id)
  return r.changes > 0
}

// ─── Response CRUD ───────────────────────────────────────────────

export interface CreateMockResponseInput {
  endpointId: string
  name?: string
  statusCode?: number
  headers?: { name: string; value: string }[]
  bodyType?: string
  body?: string
  delayMs?: number
  condition?: unknown
  script?: string
  order?: number
  enabled?: boolean
}

export function createMockResponse(input: CreateMockResponseInput): MockResponseRow {
  const id = randomUUID()
  const row: MockResponseRow = {
    id,
    endpoint_id: input.endpointId,
    name: input.name ?? '',
    status_code: input.statusCode ?? 200,
    headers: JSON.stringify(input.headers ?? []),
    body_type: input.bodyType ?? 'json',
    body: input.body ?? '',
    delay_ms: input.delayMs ?? 0,
    condition: JSON.stringify(input.condition ?? { type: 'always' }),
    script: input.script ?? '',
    response_order: input.order ?? 0,
    enabled: input.enabled === false ? 0 : 1,
  }
  getDb()
    .prepare(
      `INSERT INTO mock_responses
        (id, endpoint_id, name, status_code, headers, body_type, body, delay_ms,
         condition, script, response_order, enabled)
       VALUES (@id, @endpoint_id, @name, @status_code, @headers, @body_type, @body,
         @delay_ms, @condition, @script, @response_order, @enabled)`,
    )
    .run(row)
  return row
}

export function listMockResponses(endpointId: string): MockResponseRow[] {
  return getDb()
    .prepare('SELECT * FROM mock_responses WHERE endpoint_id = ? ORDER BY response_order, id')
    .all(endpointId) as MockResponseRow[]
}

export function getMockResponse(id: string): MockResponseRow | null {
  return (
    (getDb().prepare('SELECT * FROM mock_responses WHERE id = ?').get(id) as
      | MockResponseRow
      | undefined) ?? null
  )
}

export interface UpdateMockResponseInput {
  name?: string
  statusCode?: number
  headers?: { name: string; value: string }[]
  bodyType?: string
  body?: string
  delayMs?: number
  condition?: unknown
  script?: string
  order?: number
  enabled?: boolean
}

export function updateMockResponse(
  id: string,
  patch: UpdateMockResponseInput,
): MockResponseRow | null {
  const cur = getMockResponse(id)
  if (!cur) return null
  const next: MockResponseRow = {
    ...cur,
    name: patch.name ?? cur.name,
    status_code: patch.statusCode ?? cur.status_code,
    headers: patch.headers ? JSON.stringify(patch.headers) : cur.headers,
    body_type: patch.bodyType ?? cur.body_type,
    body: patch.body ?? cur.body,
    delay_ms: patch.delayMs ?? cur.delay_ms,
    condition: patch.condition ? JSON.stringify(patch.condition) : cur.condition,
    script: patch.script ?? cur.script,
    response_order: patch.order ?? cur.response_order,
    enabled: patch.enabled === undefined ? cur.enabled : patch.enabled ? 1 : 0,
  }
  getDb()
    .prepare(
      `UPDATE mock_responses SET
         name=@name, status_code=@status_code, headers=@headers, body_type=@body_type,
         body=@body, delay_ms=@delay_ms, condition=@condition, script=@script,
         response_order=@response_order, enabled=@enabled
       WHERE id=@id`,
    )
    .run(next)
  return next
}

export function deleteMockResponse(id: string): boolean {
  const r = getDb().prepare('DELETE FROM mock_responses WHERE id = ?').run(id)
  return r.changes > 0
}

// ─── Aggregate fetch (for the engine) ────────────────────────────

export interface MockServerSnapshot {
  server: MockServerRow
  endpoints: { endpoint: MockEndpointRow; responses: MockResponseRow[] }[]
}

/** Fetch a server with all its endpoints and their responses, ready to be loaded into the engine. */
export function getMockServerSnapshot(serverId: string): MockServerSnapshot | null {
  const server = getMockServer(serverId)
  if (!server) return null
  const endpoints = listMockEndpoints(serverId)
  const out: MockServerSnapshot = {
    server,
    endpoints: endpoints.map((endpoint) => ({
      endpoint,
      responses: listMockResponses(endpoint.id),
    })),
  }
  return out
}
