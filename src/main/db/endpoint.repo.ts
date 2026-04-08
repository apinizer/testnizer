import { randomUUID } from 'crypto'
import { getDb } from './database'

export interface EndpointRow {
  id: string
  project_id: string
  folder_id: string | null
  name: string
  description: string | null
  protocol: string
  method: string | null
  path: string
  status: string
  request_schema: string | null
  response_schemas: string | null
  sort_order: number
  created_at: number
  updated_at: number
}

export interface EndpointCaseRow {
  id: string
  endpoint_id: string
  name: string
  params: string | null
  headers: string | null
  body: string | null
  auth: string | null
  assertions: string | null
  is_default: number
  created_at: number
}

export interface SavedRequestRow {
  id: string
  project_id: string | null
  folder_id: string | null
  name: string
  protocol: string
  method: string | null
  url: string
  params: string
  headers: string
  body: string | null
  auth: string | null
  pre_script: string | null
  post_script: string | null
  assertions: string
  metadata: string | null
  sort_order: number
  created_at: number
  updated_at: number
}

// ─── Endpoints ───────────────────────────────────────────────

export function getEndpointsByProject(projectId: string): EndpointRow[] {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order ASC'
  ).all(projectId) as EndpointRow[]
}

export function getEndpointsByFolder(folderId: string): EndpointRow[] {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM endpoints WHERE folder_id = ? ORDER BY sort_order ASC'
  ).all(folderId) as EndpointRow[]
}

export function getEndpointById(id: string): EndpointRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM endpoints WHERE id = ?').get(id) as EndpointRow | undefined
}

export function createEndpoint(data: {
  project_id: string
  folder_id?: string | null
  name: string
  description?: string
  protocol?: string
  method?: string
  path: string
  status?: string
  request_schema?: string
  response_schemas?: string
}): EndpointRow {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) as max_order FROM endpoints WHERE project_id = ?'
  ).get(data.project_id) as { max_order: number }

  db.prepare(`
    INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.project_id,
    data.folder_id ?? null,
    data.name,
    data.description ?? null,
    data.protocol ?? 'http',
    data.method ?? null,
    data.path,
    data.status ?? 'developing',
    data.request_schema ?? null,
    data.response_schemas ?? null,
    maxOrder.max_order + 1,
    now,
    now
  )
  return getEndpointById(id)!
}

export function updateEndpoint(id: string, data: {
  name?: string
  description?: string
  folder_id?: string | null
  protocol?: string
  method?: string
  path?: string
  status?: string
  request_schema?: string
  response_schemas?: string
  sort_order?: number
}): EndpointRow | undefined {
  const db = getDb()
  const now = Date.now()
  const existing = getEndpointById(id)
  if (!existing) return undefined

  db.prepare(`
    UPDATE endpoints SET name = ?, description = ?, folder_id = ?, protocol = ?, method = ?, path = ?, status = ?, request_schema = ?, response_schemas = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(
    data.name ?? existing.name,
    data.description ?? existing.description,
    data.folder_id !== undefined ? data.folder_id : existing.folder_id,
    data.protocol ?? existing.protocol,
    data.method ?? existing.method,
    data.path ?? existing.path,
    data.status ?? existing.status,
    data.request_schema ?? existing.request_schema,
    data.response_schemas ?? existing.response_schemas,
    data.sort_order ?? existing.sort_order,
    now,
    id
  )
  return getEndpointById(id)
}

export function deleteEndpoint(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM endpoints WHERE id = ?').run(id)
  return result.changes > 0
}

// ─── Endpoint Cases ──────────────────────────────────────────

export function getCasesByEndpoint(endpointId: string): EndpointCaseRow[] {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM endpoint_cases WHERE endpoint_id = ? ORDER BY created_at ASC'
  ).all(endpointId) as EndpointCaseRow[]
}

export function getCaseById(id: string): EndpointCaseRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM endpoint_cases WHERE id = ?').get(id) as EndpointCaseRow | undefined
}

export function createCase(data: {
  endpoint_id: string
  name: string
  params?: string
  headers?: string
  body?: string
  auth?: string
  assertions?: string
  is_default?: boolean
}): EndpointCaseRow {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()

  db.prepare(`
    INSERT INTO endpoint_cases (id, endpoint_id, name, params, headers, body, auth, assertions, is_default, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.endpoint_id,
    data.name,
    data.params ?? null,
    data.headers ?? null,
    data.body ?? null,
    data.auth ?? null,
    data.assertions ?? null,
    data.is_default ? 1 : 0,
    now
  )
  return getCaseById(id)!
}

export function deleteCase(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM endpoint_cases WHERE id = ?').run(id)
  return result.changes > 0
}

// ─── Saved Requests ──────────────────────────────────────────

export function getSavedRequestsByProject(projectId: string): SavedRequestRow[] {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM saved_requests WHERE project_id = ? ORDER BY sort_order ASC'
  ).all(projectId) as SavedRequestRow[]
}

export function getSavedRequestById(id: string): SavedRequestRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM saved_requests WHERE id = ?').get(id) as SavedRequestRow | undefined
}

export function createSavedRequest(data: {
  project_id?: string | null
  folder_id?: string | null
  name: string
  protocol?: string
  method?: string
  url: string
  params?: string
  headers?: string
  body?: string
  auth?: string
  pre_script?: string
  post_script?: string
  assertions?: string
  metadata?: string
}): SavedRequestRow {
  const db = getDb()
  const now = Date.now()
  const id = randomUUID()

  db.prepare(`
    INSERT INTO saved_requests (id, project_id, folder_id, name, protocol, method, url, params, headers, body, auth, pre_script, post_script, assertions, metadata, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    data.project_id ?? null,
    data.folder_id ?? null,
    data.name,
    data.protocol ?? 'http',
    data.method ?? null,
    data.url,
    data.params ?? '[]',
    data.headers ?? '[]',
    data.body ?? null,
    data.auth ?? null,
    data.pre_script ?? null,
    data.post_script ?? null,
    data.assertions ?? '[]',
    data.metadata ?? null,
    0,
    now,
    now
  )
  return getSavedRequestById(id)!
}

export function updateSavedRequest(id: string, data: {
  name?: string
  protocol?: string
  method?: string
  url?: string
  params?: string
  headers?: string
  body?: string
  auth?: string
  pre_script?: string
  post_script?: string
  assertions?: string
  metadata?: string
  folder_id?: string | null
  sort_order?: number
}): SavedRequestRow | undefined {
  const db = getDb()
  const now = Date.now()
  const existing = getSavedRequestById(id)
  if (!existing) return undefined

  db.prepare(`
    UPDATE saved_requests SET name = ?, protocol = ?, method = ?, url = ?, params = ?, headers = ?, body = ?, auth = ?, pre_script = ?, post_script = ?, assertions = ?, metadata = ?, folder_id = ?, sort_order = ?, updated_at = ?
    WHERE id = ?
  `).run(
    data.name ?? existing.name,
    data.protocol ?? existing.protocol,
    data.method ?? existing.method,
    data.url ?? existing.url,
    data.params ?? existing.params,
    data.headers ?? existing.headers,
    data.body ?? existing.body,
    data.auth ?? existing.auth,
    data.pre_script ?? existing.pre_script,
    data.post_script ?? existing.post_script,
    data.assertions ?? existing.assertions,
    data.metadata ?? existing.metadata,
    data.folder_id !== undefined ? data.folder_id : existing.folder_id,
    data.sort_order ?? existing.sort_order,
    now,
    id
  )
  return getSavedRequestById(id)
}

export function deleteSavedRequest(id: string): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM saved_requests WHERE id = ?').run(id)
  return result.changes > 0
}
