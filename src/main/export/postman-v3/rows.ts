/**
 * The rows a Postman v3 export reads (issue #277), normalised to one shape:
 * endpoints (`request_schema` + `request_schema.metadata`), Ctrl+S-saved
 * requests (columns + the `metadata` column, which holds the protocol blocks
 * at its top level) and test-suite items (`request_schema` + their own
 * `assertions` column). The v2.1 writer's adapter drops a saved request's
 * metadata (it only carries HTTP); the v3 writer needs it for every protocol.
 */
import type { Database } from 'better-sqlite3'
import { orderSuiteFolders, orderSuiteItems } from '../../../shared/suite-order'
import { orderTreeRequests } from '../../../shared/tree-order'
import { maskSavedExample } from '../../lib/saved-example-mask'

export type Json = Record<string, unknown>

const isRecord = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v)

export function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string' || !raw) return fallback
  try {
    const v = JSON.parse(raw) as T | null
    return v ?? fallback
  } catch {
    return fallback
  }
}

export interface ExportFolder {
  id: string
  parentId: string | null
  name: string
  auth: unknown
  preScript: string | null
  postScript: string | null
}

export interface ExportRequest {
  id: string
  folderId: string | null
  name: string
  description: string | null
  protocol: string
  method: string
  /** The editor schema: url, method, params, headers, body, auth, scripts, settings, pathVariables. */
  schema: Json
  /** Protocol blocks (`{websocket: …}`, `{grpc: …}`, …). */
  meta: Json
  assertions: unknown[]
  ownerType: 'endpoint' | 'saved_request' | 'test_suite_item'
}

export interface ExportTree {
  name: string
  description: string | null
  folders: ExportFolder[]
  requests: ExportRequest[]
  /**
   * `tree`: APIs-tree order (`src/shared/tree-order.ts`, issue #257 — root
   * folders first, inside a folder requests first). `suite`: a suite runs
   * every level's requests before its folders (`src/shared/suite-order.ts`).
   */
  order: 'tree' | 'suite'
}

const protocolOf = (p: unknown): string => {
  const t = typeof p === 'string' ? p.trim().toLowerCase() : ''
  return t || 'http'
}

function folderOf(r: Json): ExportFolder {
  return {
    id: String(r.id),
    parentId: typeof r.parent_id === 'string' ? r.parent_id : null,
    name: String(r.name ?? 'Folder'),
    auth: parseJson<unknown>(r.auth, null),
    preScript: typeof r.pre_script === 'string' && r.pre_script.trim() ? r.pre_script : null,
    postScript: typeof r.post_script === 'string' && r.post_script.trim() ? r.post_script : null,
  }
}

function endpointOf(r: Json): ExportRequest & { sortOrder: number } {
  const schema = parseJson<Json>(r.request_schema, {})
  const meta = isRecord(schema.metadata) ? schema.metadata : {}
  return {
    id: String(r.id),
    folderId: typeof r.folder_id === 'string' ? r.folder_id : null,
    name: String(r.name ?? ''),
    description: typeof r.description === 'string' && r.description ? r.description : null,
    protocol: protocolOf(r.protocol),
    method: String(schema.method ?? r.method ?? 'GET'),
    schema: { ...schema, url: schema.url ?? r.path ?? '' },
    meta,
    assertions: Array.isArray(schema.assertions) ? schema.assertions : [],
    ownerType: 'endpoint',
    sortOrder: Number(r.sort_order ?? 0),
  }
}

function savedRequestOf(r: Json): ExportRequest & { sortOrder: number } {
  const metaRaw = parseJson<Json>(r.metadata, {})
  const schema: Json = {
    url: r.url ?? '',
    method: r.method ?? 'GET',
    params: parseJson<unknown[]>(r.params, []),
    headers: parseJson<unknown[]>(r.headers, []),
    body: parseJson<unknown>(r.body, undefined),
    auth: parseJson<unknown>(r.auth, undefined),
    preScript: r.pre_script ?? undefined,
    postScript: r.post_script ?? undefined,
    // Settings + path variables ride at the top of `metadata` on this table.
    ...metaRaw,
  }
  return {
    id: String(r.id),
    folderId: typeof r.folder_id === 'string' ? r.folder_id : null,
    name: String(r.name ?? ''),
    description: null,
    protocol: protocolOf(r.protocol),
    method: String(r.method ?? 'GET'),
    schema,
    meta: metaRaw,
    assertions: parseJson<unknown[]>(r.assertions, []),
    ownerType: 'saved_request',
    sortOrder: Number(r.sort_order ?? 0),
  }
}

/** A project's APIs tree: folders + endpoints + saved requests (shared sort order per folder). */
export function loadProjectTree(db: Database, projectId: string): ExportTree {
  const project = db
    .prepare('SELECT name, description FROM projects WHERE id = ?')
    .get(projectId) as { name: string; description: string | null } | undefined
  if (!project) throw new Error('Project not found')
  const folders = (
    db
      .prepare('SELECT * FROM folders WHERE project_id = ? ORDER BY sort_order ASC')
      .all(projectId) as Json[]
  ).map(folderOf)
  const eps = (
    db
      .prepare('SELECT * FROM endpoints WHERE project_id = ? ORDER BY sort_order ASC')
      .all(projectId) as Json[]
  ).map(endpointOf)
  const saved = (
    db
      .prepare('SELECT * FROM saved_requests WHERE project_id = ? ORDER BY sort_order ASC')
      .all(projectId) as Json[]
  ).map(savedRequestOf)
  // Endpoints, then saved requests (each by sort_order) — the tree's order.
  const requests = orderTreeRequests([...eps, ...saved], (r) => r.ownerType === 'saved_request')
  return {
    name: project.name,
    description: project.description,
    folders,
    requests,
    order: 'tree',
  }
}

/** A test suite in execution order (`src/shared/suite-order.ts`). */
export function loadSuiteTree(db: Database, suiteId: string): ExportTree & { projectId: string } {
  const suite = db
    .prepare('SELECT name, description, project_id FROM test_suites WHERE id = ?')
    .get(suiteId) as { name: string; description: string | null; project_id: string } | undefined
  if (!suite) throw new Error('Test suite not found')
  const folderRows = orderSuiteFolders(
    db
      .prepare(
        'SELECT * FROM test_suite_folders WHERE suite_id = ? ORDER BY sort_order ASC, created_at ASC',
      )
      .all(suiteId) as Array<
      Json & { id: string; parent_id: string | null; sort_order: number; created_at: number }
    >,
  )
  const items = orderSuiteItems(
    db
      .prepare(
        'SELECT * FROM test_suite_items WHERE suite_id = ? ORDER BY sort_order ASC, created_at ASC',
      )
      .all(suiteId) as Array<
      Json & { id: string; folder_id: string | null; sort_order: number; created_at: number }
    >,
    folderRows,
  )
  const requests: ExportRequest[] = items.map((it) => {
    const schema = parseJson<Json>(it.request_schema, {})
    const meta = isRecord(schema.metadata) ? schema.metadata : {}
    const fromColumn = parseJson<unknown[]>(it.assertions, [])
    return {
      id: String(it.id),
      folderId: typeof it.folder_id === 'string' ? it.folder_id : null,
      name: String(it.name ?? ''),
      description: null,
      protocol: protocolOf(it.protocol),
      method: String(it.method ?? schema.method ?? 'GET'),
      schema: {
        ...schema,
        url: it.url ?? schema.url ?? '',
        method: it.method ?? schema.method ?? 'GET',
      },
      meta,
      assertions:
        fromColumn.length > 0
          ? fromColumn
          : Array.isArray(schema.assertions)
            ? schema.assertions
            : [],
      ownerType: 'test_suite_item',
    }
  })
  return {
    name: suite.name,
    description: suite.description,
    folders: folderRows.map(folderOf),
    requests,
    order: 'suite',
    projectId: suite.project_id,
  }
}

export interface ExampleRow {
  name: string
  method: string | null
  url: string | null
  statusCode: number | null
  response: Json
  configured: Json | null
}

/** Saved examples of one request, oldest first (the order the tree shows). */
export function loadExamples(db: Database, ownerType: string, ownerId: string): ExampleRow[] {
  const rows = db
    .prepare(
      'SELECT name, method, url, status_code, response_json, request_json FROM saved_responses WHERE owner_type = ? AND owner_id = ? ORDER BY created_at ASC',
    )
    .all(ownerType, ownerId) as Array<{
    name: string
    method: string | null
    url: string | null
    status_code: number | null
    response_json: string | null
    request_json: string | null
  }>
  return rows.map((raw) => {
    // The one example mask (peer review of issue #298): a row written before
    // examples were masked on write still carries the wire credential.
    const r = maskSavedExample(raw)
    const req = parseJson<Json>(r.request_json, {})
    return {
      name: r.name,
      method: r.method,
      url: r.url,
      statusCode: r.status_code,
      response: parseJson<Json>(r.response_json, {}),
      configured: isRecord(req.configured) ? req.configured : null,
    }
  })
}
