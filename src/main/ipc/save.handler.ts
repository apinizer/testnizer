import { ipcMain, dialog, BrowserWindow } from 'electron'
import {
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { getDb } from '../db/database'
import { addSaveHistory } from '../db/branch.repo'
import { encryptSecret, decryptSecret } from '../lib/secure-storage'
import { assertTmpSubpath, assertImportFilePath, GIT_TMP_PREFIXES } from '../lib/path-safety'
import { importPostman, importInsomnia } from './import-export.handler'
import { snapshotEndpointForSuite, ensureUniqueSuiteName } from './test-suite.handler'

// ─── Multi-format detection for test suite import ────────────────
export type TestSuiteImportFormat = 'testnizer' | 'postman' | 'insomnia' | 'unknown'

/**
 * Detect the import format from a parsed JSON document. We look at top-level
 * shape rather than file extension since users may rename files.
 */
export function detectTestSuiteImportFormat(parsed: unknown): TestSuiteImportFormat {
  if (!parsed || typeof parsed !== 'object') return 'unknown'
  const doc = parsed as Record<string, unknown>

  // Testnizer native: { kind: 'testSuite', version, suite, ... }
  if (doc.kind === 'testSuite' && typeof doc.version === 'string') return 'testnizer'

  // Postman v2.x: { info: { schema: '...postman.com...', name }, item: [...] }
  if (doc.info && typeof doc.info === 'object' && Array.isArray(doc.item)) {
    const info = doc.info as Record<string, unknown>
    const schema = typeof info.schema === 'string' ? info.schema : ''
    const postmanId = typeof info._postman_id === 'string' ? info._postman_id : ''
    if (postmanId || /postman|getpostman/i.test(schema) || typeof info.name === 'string') {
      return 'postman'
    }
  }

  // Insomnia v4: { _type: 'export', __export_format: 4, resources: [...] }
  if (doc._type === 'export' && Array.isArray(doc.resources)) return 'insomnia'

  // Insomnia v5: { type: 'collection.insomnia.rest/...', collection: [...] }.
  // Insomnia 8+ also exports `spec.insomnia.rest` and `proxy.insomnia.rest`
  // documents with the same shape — accept any `*.insomnia.rest` type so
  // proxy-spec exports route to the same importer.
  if (
    typeof doc.type === 'string' &&
    /\binsomnia\.rest\b/.test(doc.type) &&
    Array.isArray(doc.collection)
  ) {
    return 'insomnia'
  }

  return 'unknown'
}

// ─── Full Project Export Format ──────────────────────────────────
interface ProjectExport {
  version: string
  exportedAt: number
  kind?: 'project'
  project: Record<string, unknown>
  folders: Record<string, unknown>[]
  endpoints: Record<string, unknown>[]
  endpointCases: Record<string, unknown>[]
  savedRequests: Record<string, unknown>[]
  environments: Record<string, unknown>[]
  environmentVariables: Record<string, unknown>[]
  globalVariables: Record<string, unknown>[]
  testSuites?: Record<string, unknown>[]
  // Suite items + folder tree (v1.3 snapshot model). Items are
  // self-contained — they no longer reference APIs-tree endpoints.
  testSuiteItems?: Record<string, unknown>[]
  testSuiteFolders?: Record<string, unknown>[]
  // Mock servers + certificates — git-tracked since v1.2.
  mockServers?: Record<string, unknown>[]
  mockEndpoints?: Record<string, unknown>[]
  mockResponses?: Record<string, unknown>[]
  certificates?: Record<string, unknown>[]
}

// ─── Folder Export Format ────────────────────────────────────────
interface FolderExport {
  version: string
  exportedAt: number
  kind: 'folder'
  rootFolderId: string
  folders: Record<string, unknown>[]
  endpoints: Record<string, unknown>[]
  endpointCases: Record<string, unknown>[]
}

// ─── Test Suite Export Format (snapshot model) ──────────────────
// Self-contained: the suite shell + every item with its inline request
// snapshot + the folder tree that organises them. Items don't reference
// APIs-tree endpoints. `source_endpoint_id` is advisory only and is
// dropped on import so a copy never re-links into the target project.
interface TestSuiteExport {
  version: string
  exportedAt: number
  kind: 'testSuite'
  suite: Record<string, unknown>
  items: Record<string, unknown>[]
  folders: Record<string, unknown>[]
}

// Columns serialised for git-tracked tables. Kept here as a single source of
// truth so export, import, and migration share the same projection.
const MOCK_SERVER_COLUMNS = [
  'id',
  'project_id',
  'name',
  'description',
  'host',
  'port',
  'base_path',
  'auto_start',
  'cors_enabled',
  'cors_allow_origins',
  'cors_allow_methods',
  'cors_allow_headers',
  'cors_allow_credentials',
  'cors_max_age',
  'auth_config',
  'failure_config',
  'rate_limit_config',
  'echo_enabled',
  'proxy_enabled',
  'proxy_target',
  'proxy_record',
  'created_at',
  'updated_at',
] as const

const MOCK_ENDPOINT_COLUMNS = [
  'id',
  'server_id',
  'method',
  'path',
  'path_mode',
  'description',
  'priority',
  'enabled',
  'sort_order',
  'auth_override',
  'schema_validation',
  'created_at',
  'updated_at',
] as const

const MOCK_RESPONSE_COLUMNS = [
  'id',
  'endpoint_id',
  'name',
  'status_code',
  'headers',
  'body_type',
  'body',
  'delay_ms',
  'condition',
  'script',
  'response_order',
  'enabled',
] as const

const CERTIFICATE_COLUMNS = [
  'id',
  'project_id',
  'kind',
  'host',
  'crt_path',
  'key_path',
  'pfx_path',
  'passphrase',
  'enabled',
  'created_at',
] as const

// Returns null when the export shape is acceptable, or a specific user-facing
// error string. Lets the importer point users at the actual problem (empty
// project, missing top-level field, wrong file kind) instead of the generic
// "Invalid project file format." that hid the v1.3.1 export-corruption bug.
export function validateProjectExport(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') {
    return 'Project file is not a JSON object.'
  }
  const doc = parsed as Partial<ProjectExport>
  if (!doc.version || typeof doc.version !== 'string') {
    return 'Project file is missing the required "version" field.'
  }
  if (!doc.project || typeof doc.project !== 'object') {
    return 'Project file is missing the required "project" object.'
  }
  if (
    !Array.isArray(doc.folders) ||
    !Array.isArray(doc.endpoints) ||
    !Array.isArray(doc.savedRequests)
  ) {
    return 'Project file is missing folders/endpoints/savedRequests arrays.'
  }
  if (
    doc.folders.length === 0 &&
    doc.endpoints.length === 0 &&
    doc.savedRequests.length === 0 &&
    (doc.testSuites?.length ?? 0) === 0 &&
    (doc.mockServers?.length ?? 0) === 0
  ) {
    return 'Project file contains no folders, endpoints, suites or mocks. The original export may have failed; re-export the source project before importing.'
  }
  return null
}

export function exportProjectData(projectId: string): ProjectExport {
  const db = getDb()

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<
    string,
    unknown
  >
  const folders = db.prepare('SELECT * FROM folders WHERE project_id = ?').all(projectId) as Record<
    string,
    unknown
  >[]
  const endpoints = db
    .prepare('SELECT * FROM endpoints WHERE project_id = ?')
    .all(projectId) as Record<string, unknown>[]
  const savedRequests = db
    .prepare('SELECT * FROM saved_requests WHERE project_id = ?')
    .all(projectId) as Record<string, unknown>[]

  // Endpoint cases for all endpoints
  const endpointIds = endpoints.map((e) => e.id as string)
  let endpointCases: Record<string, unknown>[] = []
  if (endpointIds.length > 0) {
    const placeholders = endpointIds.map(() => '?').join(',')
    endpointCases = db
      .prepare(`SELECT * FROM endpoint_cases WHERE endpoint_id IN (${placeholders})`)
      .all(...endpointIds) as Record<string, unknown>[]
  }

  // Environments + variables scoped to THIS project
  let environments: Record<string, unknown>[] = []
  let environmentVariables: Record<string, unknown>[] = []
  let globalVariables: Record<string, unknown>[] = []

  environments = db
    .prepare('SELECT * FROM environments WHERE project_id = ?')
    .all(projectId) as Record<string, unknown>[]

  const envIds = environments.map((e) => e.id as string)
  if (envIds.length > 0) {
    const placeholders = envIds.map(() => '?').join(',')
    environmentVariables = db
      .prepare(`SELECT * FROM environment_variables WHERE environment_id IN (${placeholders})`)
      .all(...envIds) as Record<string, unknown>[]
  }

  globalVariables = db
    .prepare('SELECT * FROM global_variables WHERE project_id = ?')
    .all(projectId) as Record<string, unknown>[]

  // Test suites + their self-contained items and folders. Switched from the
  // dropped `test_suite_endpoints` junction (v1.0–v1.2) to the snapshot model
  // (`test_suite_items` + `test_suite_folders`) in v1.3.
  const testSuites = db
    .prepare('SELECT * FROM test_suites WHERE project_id = ?')
    .all(projectId) as Record<string, unknown>[]
  let testSuiteItems: Record<string, unknown>[] = []
  let testSuiteFolders: Record<string, unknown>[] = []
  const suiteIds = testSuites.map((s) => s.id as string)
  if (suiteIds.length > 0) {
    const ph = suiteIds.map(() => '?').join(',')
    testSuiteItems = db
      .prepare(`SELECT * FROM test_suite_items WHERE suite_id IN (${ph})`)
      .all(...suiteIds) as Record<string, unknown>[]
    testSuiteFolders = db
      .prepare(`SELECT * FROM test_suite_folders WHERE suite_id IN (${ph})`)
      .all(...suiteIds) as Record<string, unknown>[]
  }

  // Mock servers, endpoints and responses — collected together so the entire
  // mock graph round-trips through git as one consistent unit.
  const mockServers = db
    .prepare('SELECT * FROM mock_servers WHERE project_id = ?')
    .all(projectId) as Record<string, unknown>[]
  let mockEndpoints: Record<string, unknown>[] = []
  let mockResponses: Record<string, unknown>[] = []
  const serverIds = mockServers.map((s) => s.id as string)
  if (serverIds.length > 0) {
    const ph = serverIds.map(() => '?').join(',')
    mockEndpoints = db
      .prepare(`SELECT * FROM mock_endpoints WHERE server_id IN (${ph})`)
      .all(...serverIds) as Record<string, unknown>[]

    const endpointIdsForMocks = mockEndpoints.map((e) => e.id as string)
    if (endpointIdsForMocks.length > 0) {
      const phEp = endpointIdsForMocks.map(() => '?').join(',')
      mockResponses = db
        .prepare(`SELECT * FROM mock_responses WHERE endpoint_id IN (${phEp})`)
        .all(...endpointIdsForMocks) as Record<string, unknown>[]
    }
  }

  // Client certificate / mTLS configs (passphrase + path metadata; the cert
  // files themselves live on disk under user paths and are NOT serialised).
  const certificates = db
    .prepare('SELECT * FROM certificates WHERE project_id = ?')
    .all(projectId) as Record<string, unknown>[]

  return {
    version: 'testnizer-project/2.0',
    exportedAt: Date.now(),
    kind: 'project',
    project,
    folders,
    endpoints,
    endpointCases,
    savedRequests,
    environments,
    environmentVariables,
    globalVariables,
    testSuites,
    testSuiteItems,
    testSuiteFolders,
    mockServers,
    mockEndpoints,
    mockResponses,
    certificates,
  }
}

// ─── Import (upsert) project data into DB ────────────────────────
export function importProjectDataFromJson(jsonString: string, projectId: string): void {
  const data = JSON.parse(jsonString) as ProjectExport
  importProjectData(data, projectId)
}

function importProjectData(data: ProjectExport, projectId: string): void {
  const db = getDb()

  const upsert = (table: string, rows: Record<string, unknown>[], columns: string[]): void => {
    if (rows.length === 0) return
    const placeholders = columns.map(() => '?').join(',')
    const setClause = columns
      .filter((c) => c !== 'id')
      .map((c) => `${c} = excluded.${c}`)
      .join(', ')
    const stmt = db.prepare(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${setClause}`,
    )
    const tx = db.transaction(() => {
      for (const row of rows) {
        const values = columns.map((c) => row[c] ?? null)
        stmt.run(...values)
      }
    })
    tx()
  }

  // Import folders
  upsert('folders', data.folders, ['id', 'project_id', 'parent_id', 'name', 'sort_order'])

  // Import endpoints
  upsert('endpoints', data.endpoints, [
    'id',
    'project_id',
    'folder_id',
    'name',
    'description',
    'protocol',
    'method',
    'path',
    'status',
    'request_schema',
    'response_schemas',
    'sort_order',
    'created_at',
    'updated_at',
  ])

  // Import endpoint cases
  if (data.endpointCases?.length) {
    upsert('endpoint_cases', data.endpointCases, [
      'id',
      'endpoint_id',
      'name',
      'params',
      'headers',
      'body',
      'auth',
      'assertions',
      'is_default',
      'created_at',
    ])
  }

  // Import saved requests
  upsert('saved_requests', data.savedRequests, [
    'id',
    'project_id',
    'folder_id',
    'name',
    'protocol',
    'method',
    'url',
    'params',
    'headers',
    'body',
    'auth',
    'pre_script',
    'post_script',
    'assertions',
    'metadata',
    'sort_order',
    'created_at',
    'updated_at',
  ])

  // Import environments. `project_id` is part of the upsert column list —
  // without it an imported env keeps the source project's id (or NULL for
  // legacy exports) and becomes invisible to the project that imported it.
  if (data.environments?.length) {
    upsert('environments', data.environments, [
      'id',
      'workspace_id',
      'project_id',
      'name',
      'is_active',
      'created_at',
      'updated_at',
    ])
  }

  // Import environment variables
  if (data.environmentVariables?.length) {
    upsert('environment_variables', data.environmentVariables, [
      'id',
      'environment_id',
      'key',
      'value',
      'description',
      'enabled',
      'secret',
      'initial_value',
    ])
  }

  // Import global variables. Same project_id story as environments — when a
  // global was scoped to a project on the source side, it must land scoped to
  // the target project rather than leaking workspace-wide.
  if (data.globalVariables?.length) {
    upsert('global_variables', data.globalVariables, [
      'id',
      'workspace_id',
      'project_id',
      'key',
      'value',
      'description',
      'enabled',
      'secret',
      'initial_value',
    ])
  }

  // Import test suites
  if (data.testSuites?.length) {
    upsert('test_suites', data.testSuites, [
      'id',
      'project_id',
      'name',
      'description',
      'sort_order',
      'created_at',
      'updated_at',
    ])
  }

  // Import test-suite folders + items (v1.3+ snapshot model). Folders go
  // first because items carry a folder_id FK. Legacy `testSuiteEndpoints`
  // arrays from pre-v1.3 exports are silently ignored — that schema was
  // dropped and the link rows reference endpoints that may not exist in
  // the target project.
  if (data.testSuiteFolders?.length) {
    upsert('test_suite_folders', data.testSuiteFolders, [
      'id',
      'suite_id',
      'parent_id',
      'name',
      'sort_order',
      'created_at',
    ])
  }
  if (data.testSuiteItems?.length) {
    upsert('test_suite_items', data.testSuiteItems, [
      'id',
      'suite_id',
      'folder_id',
      'protocol',
      'name',
      'method',
      'url',
      'request_schema',
      'assertions',
      'source_endpoint_id',
      'sort_order',
      'created_at',
      'updated_at',
    ])
  }

  // Import mock servers + their child endpoints and responses. Order matters:
  // mock_endpoints FK→mock_servers, mock_responses FK→mock_endpoints, so we
  // upsert parents before children. Missing arrays are skipped — pre-v1.2
  // export files don't carry these.
  if (data.mockServers?.length) {
    upsert('mock_servers', data.mockServers, [...MOCK_SERVER_COLUMNS])
  }
  if (data.mockEndpoints?.length) {
    upsert('mock_endpoints', data.mockEndpoints, [...MOCK_ENDPOINT_COLUMNS])
  }
  if (data.mockResponses?.length) {
    upsert('mock_responses', data.mockResponses, [...MOCK_RESPONSE_COLUMNS])
  }

  // Import client certificates (mTLS / SSL pinning configs).
  if (data.certificates?.length) {
    upsert('certificates', data.certificates, [...CERTIFICATE_COLUMNS])
  }
}

// ─── Folder Export / Import ──────────────────────────────────────
function collectFolderTree(rootFolderId: string): {
  folders: Record<string, unknown>[]
  endpoints: Record<string, unknown>[]
  endpointCases: Record<string, unknown>[]
} {
  const db = getDb()

  const rootFolder = db.prepare('SELECT * FROM folders WHERE id = ?').get(rootFolderId) as
    | Record<string, unknown>
    | undefined
  if (!rootFolder) {
    return { folders: [], endpoints: [], endpointCases: [] }
  }

  // Recursively gather all descendant folder IDs (BFS)
  const folders: Record<string, unknown>[] = [rootFolder]
  const queue: string[] = [rootFolderId]
  while (queue.length > 0) {
    const parentId = queue.shift() as string
    const children = db
      .prepare('SELECT * FROM folders WHERE parent_id = ?')
      .all(parentId) as Record<string, unknown>[]
    for (const child of children) {
      folders.push(child)
      queue.push(child.id as string)
    }
  }

  const folderIds = folders.map((f) => f.id as string)
  const ph = folderIds.map(() => '?').join(',')
  const endpoints = db
    .prepare(`SELECT * FROM endpoints WHERE folder_id IN (${ph})`)
    .all(...folderIds) as Record<string, unknown>[]

  const endpointIds = endpoints.map((e) => e.id as string)
  let endpointCases: Record<string, unknown>[] = []
  if (endpointIds.length > 0) {
    const eph = endpointIds.map(() => '?').join(',')
    endpointCases = db
      .prepare(`SELECT * FROM endpoint_cases WHERE endpoint_id IN (${eph})`)
      .all(...endpointIds) as Record<string, unknown>[]
  }

  return { folders, endpoints, endpointCases }
}

export function exportFolderData(folderId: string): FolderExport {
  const { folders, endpoints, endpointCases } = collectFolderTree(folderId)
  return {
    version: '1.0.0',
    exportedAt: Date.now(),
    kind: 'folder',
    rootFolderId: folderId,
    folders,
    endpoints,
    endpointCases,
  }
}

/**
 * Import a folder tree into target project. New IDs are generated
 * so the imported folder is a fresh copy (no collision with source).
 */
export function importFolderData(
  data: FolderExport,
  projectId: string,
  parentFolderId: string | null = null,
): { foldersImported: number; endpointsImported: number } {
  const db = getDb()
  const now = Date.now()

  // ID remapping: oldId → newId
  const folderIdMap = new Map<string, string>()
  const endpointIdMap = new Map<string, string>()

  for (const f of data.folders) folderIdMap.set(f.id as string, randomUUID())
  for (const e of data.endpoints) endpointIdMap.set(e.id as string, randomUUID())

  const insertFolder = db.prepare(
    `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?, ?)`,
  )
  const insertEndpoint = db.prepare(
    `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertCase = db.prepare(
    `INSERT INTO endpoint_cases (id, endpoint_id, name, params, headers, body, auth, assertions, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  const tx = db.transaction(() => {
    // Folders — root's parent becomes parentFolderId, others remap
    for (const f of data.folders) {
      const oldId = f.id as string
      const newId = folderIdMap.get(oldId) as string
      const oldParent = f.parent_id as string | null
      let newParent: string | null
      if (oldId === data.rootFolderId) {
        newParent = parentFolderId
      } else {
        newParent =
          oldParent && folderIdMap.has(oldParent)
            ? (folderIdMap.get(oldParent) as string)
            : parentFolderId
      }
      insertFolder.run(newId, projectId, newParent, f.name, f.sort_order ?? 0)
    }

    // Endpoints
    for (const e of data.endpoints) {
      const newId = endpointIdMap.get(e.id as string) as string
      const oldFolderId = e.folder_id as string | null
      const newFolderId =
        oldFolderId && folderIdMap.has(oldFolderId)
          ? (folderIdMap.get(oldFolderId) as string)
          : null
      insertEndpoint.run(
        newId,
        projectId,
        newFolderId,
        e.name,
        e.description ?? null,
        e.protocol || 'http',
        e.method ?? null,
        e.path,
        e.status || 'developing',
        e.request_schema ?? null,
        e.response_schemas ?? null,
        e.sort_order ?? 0,
        (e.created_at as number) || now,
        now,
      )
    }

    // Cases
    for (const c of data.endpointCases) {
      const newCaseId = randomUUID()
      const newEndpointId = endpointIdMap.get(c.endpoint_id as string)
      if (!newEndpointId) continue
      insertCase.run(
        newCaseId,
        newEndpointId,
        c.name,
        c.params ?? null,
        c.headers ?? null,
        c.body ?? null,
        c.auth ?? null,
        c.assertions ?? null,
        c.is_default ?? 0,
        (c.created_at as number) || now,
      )
    }
  })
  tx()

  return { foldersImported: folderIdMap.size, endpointsImported: endpointIdMap.size }
}

// ─── Test Suite Export / Import (v1.3+ snapshot model) ─────────
//
// A suite export is now self-contained: the suite shell, every item with its
// full inline request snapshot, and the folder tree that organises them.
// Items don't reference back to APIs-tree endpoints — `source_endpoint_id`
// is advisory only and the bond is severed on import.
export function exportTestSuiteData(suiteId: string): TestSuiteExport {
  const db = getDb()
  const suite = db.prepare('SELECT * FROM test_suites WHERE id = ?').get(suiteId) as
    | Record<string, unknown>
    | undefined
  if (!suite) {
    return {
      version: 'testnizer-suite/2.0',
      exportedAt: Date.now(),
      kind: 'testSuite',
      suite: {},
      items: [],
      folders: [],
    }
  }

  const items = db
    .prepare('SELECT * FROM test_suite_items WHERE suite_id = ? ORDER BY sort_order')
    .all(suiteId) as Record<string, unknown>[]
  const folders = db
    .prepare('SELECT * FROM test_suite_folders WHERE suite_id = ? ORDER BY sort_order')
    .all(suiteId) as Record<string, unknown>[]

  return {
    version: '2.0.0',
    exportedAt: Date.now(),
    kind: 'testSuite',
    suite,
    items,
    folders,
  }
}

/**
 * Import a test suite into target project. New IDs are generated for the
 * suite, every folder, and every item so the source export and the target
 * project can coexist. Folder ids are remapped first so item.folder_id can
 * be rewritten to point at the new folder rows.
 */
export function importTestSuiteData(
  data: TestSuiteExport,
  projectId: string,
): { suiteId: string; itemsImported: number } {
  const db = getDb()
  const now = Date.now()
  const folders = data.folders ?? []
  const items = data.items ?? []

  const newSuiteId = randomUUID()
  const folderIdMap = new Map<string, string>()
  for (const f of folders) folderIdMap.set(f.id as string, randomUUID())

  const insertSuite = db.prepare(
    `INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertFolder = db.prepare(
    `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const insertItem = db.prepare(
    `INSERT INTO test_suite_items
       (id, suite_id, folder_id, protocol, name, method, url,
        request_schema, assertions, source_endpoint_id,
        sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )

  const suite = data.suite
  const suiteName = (suite?.name as string) || 'Imported Suite'

  const tx = db.transaction(() => {
    insertSuite.run(
      newSuiteId,
      projectId,
      suiteName,
      suite?.description ?? null,
      suite?.sort_order ?? 0,
      now,
      now,
    )

    // Folders first — items reference folder_id, so the rows must exist.
    // parent_id is remapped through folderIdMap; a null source parent
    // stays null (top-level folder).
    for (const f of folders) {
      const newId = folderIdMap.get(f.id as string) as string
      const newParentId = f.parent_id ? (folderIdMap.get(f.parent_id as string) ?? null) : null
      insertFolder.run(
        newId,
        newSuiteId,
        newParentId,
        f.name ?? 'Folder',
        f.sort_order ?? 0,
        (f.created_at as number) || now,
      )
    }

    for (const it of items) {
      const newFolderId = it.folder_id ? (folderIdMap.get(it.folder_id as string) ?? null) : null
      insertItem.run(
        randomUUID(),
        newSuiteId,
        newFolderId,
        it.protocol || 'http',
        it.name ?? 'Imported request',
        it.method ?? null,
        it.url ?? null,
        (it.request_schema as string) ?? '{}',
        (it.assertions as string) ?? null,
        // source_endpoint_id points at a row in the SOURCE project; keeping
        // it would leak that id into the target. Drop it on import.
        null,
        it.sort_order ?? 0,
        (it.created_at as number) || now,
        now,
      )
    }
  })
  tx()

  return { suiteId: newSuiteId, itemsImported: items.length }
}

/**
 * Multi-format test-suite import. Accepts the raw file content and routes to
 * the appropriate importer based on auto-detected shape. For Postman /
 * Insomnia inputs we (1) reuse the existing project importers to create the
 * endpoints under `projectId` (no folder), then (2) create a fresh test suite
 * and link the imported endpoints to it.
 */
export async function importTestSuiteFromFile(
  content: string,
  projectId: string,
  suiteName?: string,
): Promise<{
  suiteId: string
  itemsImported: number
  format: TestSuiteImportFormat
  warnings?: string[]
}> {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    // Insomnia v5 ships YAML by default; fall back to js-yaml so suite import
    // accepts the same files the APIs-tree importer already handles. We keep
    // JSON as the fast path because it covers Testnizer-native exports and
    // every Postman collection.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const yaml = require('js-yaml') as { load: (s: string) => unknown }
      parsed = yaml.load(content)
    } catch (e) {
      throw new Error('Could not parse file as JSON or YAML: ' + (e as Error).message)
    }
  }

  const format = detectTestSuiteImportFormat(parsed)

  if (format === 'testnizer') {
    const data = parsed as TestSuiteExport
    if (data.kind !== 'testSuite' || !data.suite) {
      throw new Error('Invalid Testnizer test suite export.')
    }
    if (!Array.isArray(data.items) || !Array.isArray(data.folders)) {
      throw new Error('Unsupported Testnizer suite export — please re-export from this version.')
    }
    const out = importTestSuiteData(data, projectId)
    return { suiteId: out.suiteId, itemsImported: out.itemsImported, format }
  }

  if (format === 'postman' || format === 'insomnia') {
    // Step 1: reuse the existing Postman / Insomnia importer to materialise
    // endpoint rows in the APIs tree. This is the cheapest way to get a
    // canonical request_schema for each request (the importer already maps
    // the source format into our shape — re-implementing that here would
    // duplicate hundreds of lines of normalisation).
    const result =
      format === 'postman'
        ? await importPostman(projectId, content, null)
        : await importInsomnia(projectId, content, null)

    if (!result.success) {
      throw new Error(result.error || `${format} import failed`)
    }

    const endpointIds = result.endpointIds ?? []

    let derivedName = suiteName
    if (!derivedName) {
      if (format === 'postman') {
        const doc = parsed as { info?: { name?: string } }
        derivedName = doc.info?.name ? `${doc.info.name} (imported)` : 'Imported Postman Suite'
      } else {
        const doc = parsed as { name?: string }
        derivedName = doc.name ? `${doc.name} (imported)` : 'Imported Insomnia Suite'
      }
    }

    const db = getDb()
    const now = Date.now()
    const newSuiteId = randomUUID()
    // De-duplicate against suites already present in the project so a user
    // re-importing the same export gets "X", "X (1)", "X (2)" instead of two
    // suites with identical names (v1.3.1 §5.9).
    derivedName = ensureUniqueSuiteName(db, projectId, derivedName)

    // Step 2: snapshot each freshly-imported endpoint into test_suite_items
    // and delete the source endpoint row. The user's intent for a suite
    // import is "I want these requests as a test suite" — leaving them in
    // the APIs tree as a duplicate set creates the cross-contamination the
    // copy-on-add model was built to prevent.
    const insertSuite = db.prepare(
      `INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    const insertItem = db.prepare(
      `INSERT INTO test_suite_items
         (id, suite_id, folder_id, protocol, name, method, url,
          request_schema, assertions, source_endpoint_id,
          sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const deleteEndpoint = db.prepare(`DELETE FROM endpoints WHERE id = ?`)

    // Atomic snapshot transaction. `importPostman` / `importInsomnia` have
    // already committed endpoint rows above; if the snapshot loop throws,
    // we'd leave APIs-tree leftovers that the user never asked for. Catch
    // and roll them back ourselves so the operation is all-or-nothing from
    // the caller's perspective.
    let itemsCreated = 0
    try {
      const tx = db.transaction(() => {
        insertSuite.run(newSuiteId, projectId, derivedName, null, 0, now, now)
        let order = 0
        for (const epId of endpointIds) {
          const snap = snapshotEndpointForSuite(epId)
          if (!snap) continue
          insertItem.run(
            randomUUID(),
            newSuiteId,
            null,
            snap.protocol,
            snap.name,
            snap.method,
            snap.url,
            snap.request_schema,
            snap.assertions,
            // The source endpoint is about to be deleted; don't carry a
            // stale pointer that won't resolve.
            null,
            order++,
            now,
            now,
          )
          deleteEndpoint.run(epId)
          itemsCreated++
        }
      })
      tx()
    } catch (e) {
      // Snapshot failed mid-flight. The transaction itself rolled back, but
      // the importPostman/Insomnia commit before it didn't — clean up the
      // endpoint rows it created so the user doesn't see ghost imports.
      const cleanup = db.transaction(() => {
        for (const epId of endpointIds) deleteEndpoint.run(epId)
      })
      try {
        cleanup()
      } catch {
        /* best effort */
      }
      throw e
    }

    return {
      suiteId: newSuiteId,
      itemsImported: itemsCreated,
      format,
      warnings: result.warnings,
    }
  }

  throw new Error(
    'Unknown test suite format. Expected Testnizer (.json), Postman v2.x, or Insomnia v4/v5 export.',
  )
}

/**
 * Append `(imported)` / `(imported 2)` / `(imported 3)` … to `baseName` until
 * the resulting name doesn't collide with any existing project in the given
 * workspace. Compares against BOTH `name` (canonical key) and `display_name`
 * (Project Hub label) so import doesn't quietly drop you next to an identical
 * row from a previous run (Dilek #6 / B4).
 */
function ensureUniqueProjectName(
  db: ReturnType<typeof getDb>,
  workspaceId: string,
  baseName: string,
): string {
  const taken = new Set<string>()
  const rows = db
    .prepare('SELECT name, display_name FROM projects WHERE workspace_id = ?')
    .all(workspaceId) as { name: string; display_name: string | null }[]
  for (const r of rows) {
    if (r.name) taken.add(r.name)
    if (r.display_name) taken.add(r.display_name)
  }
  if (!taken.has(baseName)) return baseName
  const first = `${baseName} (imported)`
  if (!taken.has(first)) return first
  for (let i = 2; i < 1000; i++) {
    const candidate = `${baseName} (imported ${i})`
    if (!taken.has(candidate)) return candidate
  }
  return `${baseName} (imported ${Date.now()})`
}

/**
 * Import a whole project (from exported JSON) as a NEW project in the
 * target workspace. All IDs are regenerated so source and target can
 * coexist. Returns the new project id.
 */
export function importProjectAsNew(
  data: ProjectExport,
  workspaceId: string,
  overrides?: { name?: string },
): { projectId: string } {
  const db = getDb()
  const now = Date.now()

  const newProjectId = randomUUID()
  const folderIdMap = new Map<string, string>()
  const endpointIdMap = new Map<string, string>()
  const savedReqIdMap = new Map<string, string>()
  const envIdMap = new Map<string, string>()
  const suiteIdMap = new Map<string, string>()

  for (const f of data.folders) folderIdMap.set(f.id as string, randomUUID())
  for (const e of data.endpoints) endpointIdMap.set(e.id as string, randomUUID())
  for (const s of data.savedRequests) savedReqIdMap.set(s.id as string, randomUUID())
  for (const env of data.environments) envIdMap.set(env.id as string, randomUUID())
  for (const s of data.testSuites || []) suiteIdMap.set(s.id as string, randomUUID())

  const proj = data.project || {}
  const desiredName = overrides?.name || (proj.name as string) || 'Imported Project'
  // Project Hub keys off display_name when present, otherwise name. If the
  // user explicitly passed an override we honour it verbatim (the Duplicate
  // flow already chose its own "(copy)"-suffixed name). Otherwise we
  // disambiguate against existing rows in the workspace by appending
  // "(imported)" / "(imported N)" so a freshly imported project never
  // collides visually with an already-loaded one (Dilek #6 / B4).
  const projName = overrides?.name
    ? desiredName
    : ensureUniqueProjectName(db, workspaceId, desiredName)

  const tx = db.transaction(() => {
    // Insert project
    db.prepare(
      `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at, save_mode, local_path, icon_emoji, icon_color, display_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newProjectId,
      workspaceId,
      projName,
      proj.description ?? null,
      proj.type || 'http',
      proj.sort_order ?? 0,
      now,
      now,
      proj.save_mode || 'local',
      proj.local_path ?? null,
      proj.icon_emoji ?? null,
      proj.icon_color ?? '#2D5FA0',
      // Display name follows the same uniqueness rule as `name` so the Project
      // Hub doesn't show two identical labels after an import. If the caller
      // passed an explicit override, that wins.
      overrides?.name ?? (projName !== desiredName ? projName : (proj.display_name ?? null)),
    )

    // Folders
    const insertFolder = db.prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?, ?)`,
    )
    for (const f of data.folders) {
      const newId = folderIdMap.get(f.id as string) as string
      const oldParent = f.parent_id as string | null
      const newParent =
        oldParent && folderIdMap.has(oldParent) ? (folderIdMap.get(oldParent) as string) : null
      insertFolder.run(newId, newProjectId, newParent, f.name, f.sort_order ?? 0)
    }

    // Endpoints
    const insertEndpoint = db.prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const e of data.endpoints) {
      const newId = endpointIdMap.get(e.id as string) as string
      const oldFolderId = e.folder_id as string | null
      const newFolderId =
        oldFolderId && folderIdMap.has(oldFolderId)
          ? (folderIdMap.get(oldFolderId) as string)
          : null
      insertEndpoint.run(
        newId,
        newProjectId,
        newFolderId,
        e.name,
        e.description ?? null,
        e.protocol || 'http',
        e.method ?? null,
        e.path,
        e.status || 'developing',
        e.request_schema ?? null,
        e.response_schemas ?? null,
        e.sort_order ?? 0,
        (e.created_at as number) || now,
        now,
      )
    }

    // Endpoint cases
    const insertCase = db.prepare(
      `INSERT INTO endpoint_cases (id, endpoint_id, name, params, headers, body, auth, assertions, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const c of data.endpointCases || []) {
      const newEndpointId = endpointIdMap.get(c.endpoint_id as string)
      if (!newEndpointId) continue
      insertCase.run(
        randomUUID(),
        newEndpointId,
        c.name,
        c.params ?? null,
        c.headers ?? null,
        c.body ?? null,
        c.auth ?? null,
        c.assertions ?? null,
        c.is_default ?? 0,
        (c.created_at as number) || now,
      )
    }

    // Saved requests
    const insertSaved = db.prepare(
      `INSERT INTO saved_requests (id, project_id, folder_id, name, protocol, method, url, params, headers, body, auth, pre_script, post_script, assertions, metadata, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const s of data.savedRequests || []) {
      const newId = savedReqIdMap.get(s.id as string) as string
      const oldFolderId = s.folder_id as string | null
      const newFolderId =
        oldFolderId && folderIdMap.has(oldFolderId)
          ? (folderIdMap.get(oldFolderId) as string)
          : null
      insertSaved.run(
        newId,
        newProjectId,
        newFolderId,
        s.name,
        s.protocol || 'http',
        s.method ?? null,
        s.url ?? null,
        s.params ?? null,
        s.headers ?? null,
        s.body ?? null,
        s.auth ?? null,
        s.pre_script ?? null,
        s.post_script ?? null,
        s.assertions ?? null,
        s.metadata ?? null,
        s.sort_order ?? 0,
        (s.created_at as number) || now,
        now,
      )
    }

    // Environments
    const insertEnv = db.prepare(
      `INSERT INTO environments (id, workspace_id, name, is_active, created_at, updated_at, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const env of data.environments || []) {
      const newEnvId = envIdMap.get(env.id as string) as string
      insertEnv.run(
        newEnvId,
        workspaceId,
        env.name,
        env.is_active ?? 0,
        (env.created_at as number) || now,
        now,
        newProjectId,
      )
    }

    // Environment variables
    const insertEnvVar = db.prepare(
      `INSERT INTO environment_variables (id, environment_id, key, value, description, enabled, secret, initial_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const v of data.environmentVariables || []) {
      const newEnvId = envIdMap.get(v.environment_id as string)
      if (!newEnvId) continue
      insertEnvVar.run(
        randomUUID(),
        newEnvId,
        v.key,
        v.value ?? null,
        v.description ?? null,
        v.enabled ?? 1,
        v.secret ?? 0,
        v.initial_value ?? null,
      )
    }

    // Global variables
    const insertGlobal = db.prepare(
      `INSERT INTO global_variables (id, workspace_id, key, value, description, enabled, secret, initial_value, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const g of data.globalVariables || []) {
      insertGlobal.run(
        randomUUID(),
        workspaceId,
        g.key,
        g.value ?? null,
        g.description ?? null,
        g.enabled ?? 1,
        g.secret ?? 0,
        g.initial_value ?? null,
        newProjectId,
      )
    }

    // Test suites
    const insertSuite = db.prepare(
      `INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const s of data.testSuites || []) {
      const newId = suiteIdMap.get(s.id as string) as string
      insertSuite.run(
        newId,
        newProjectId,
        s.name,
        s.description ?? null,
        s.sort_order ?? 0,
        (s.created_at as number) || now,
        now,
      )
    }

    // Test suite folders + items (v1.3+ snapshot model). Folders are
    // inserted first because items carry a folder_id FK. Folder parent_id
    // and item folder_id are remapped through `folderIdMap` so the suite
    // tree shape is preserved end-to-end.
    const insertSuiteFolder = db.prepare(
      `INSERT INTO test_suite_folders (id, suite_id, parent_id, name, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    const insertSuiteItem = db.prepare(
      `INSERT INTO test_suite_items
         (id, suite_id, folder_id, protocol, name, method, url,
          request_schema, assertions, source_endpoint_id,
          sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const suiteFolderIdMap = new Map<string, string>()
    for (const f of data.testSuiteFolders || []) {
      suiteFolderIdMap.set(f.id as string, randomUUID())
    }
    for (const f of data.testSuiteFolders || []) {
      const newSuiteId = suiteIdMap.get(f.suite_id as string)
      if (!newSuiteId) continue
      const newId = suiteFolderIdMap.get(f.id as string) as string
      const newParentId = f.parent_id ? (suiteFolderIdMap.get(f.parent_id as string) ?? null) : null
      insertSuiteFolder.run(
        newId,
        newSuiteId,
        newParentId,
        f.name ?? 'Folder',
        f.sort_order ?? 0,
        (f.created_at as number) || now,
      )
    }
    for (const it of data.testSuiteItems || []) {
      const newSuiteId = suiteIdMap.get(it.suite_id as string)
      if (!newSuiteId) continue
      const newFolderId = it.folder_id
        ? (suiteFolderIdMap.get(it.folder_id as string) ?? null)
        : null
      insertSuiteItem.run(
        randomUUID(),
        newSuiteId,
        newFolderId,
        it.protocol || 'http',
        it.name ?? 'Imported request',
        it.method ?? null,
        it.url ?? null,
        (it.request_schema as string) ?? '{}',
        (it.assertions as string) ?? null,
        // source_endpoint_id pointed at the source project's row — that id
        // doesn't exist in the new project, so drop the advisory link.
        null,
        it.sort_order ?? 0,
        (it.created_at as number) || now,
        now,
      )
    }
  })
  tx()

  return { projectId: newProjectId }
}

// ─── Git helpers ─────────────────────────────────────────────────
function getSecureStore(): Promise<{
  get(key: string): unknown
  set(key: string, value: unknown): void
}> {
  // NOTE: electron-store `encryptionKey` is obfuscation, not real security
  // (the key sits in the binary). The actual sensitive credentials should
  // be wrapped with safeStorage at write-time — `secure-storage.ts` handles
  // that. After the rename, existing users will see an empty credentials
  // store and be prompted to re-enter their git token; that's the migration.
  return import('electron-store').then(({ default: Store }) => {
    return new Store({
      name: 'git-credentials',
      encryptionKey: 'testnizer-secure-key-v1',
    }) as unknown as { get(key: string): unknown; set(key: string, value: unknown): void }
  })
}

function buildAuthUrl(repoUrl: string, username: string, token: string): string {
  const urlObj = new URL(repoUrl)
  urlObj.username = encodeURIComponent(username)
  urlObj.password = encodeURIComponent(token)
  return urlObj.toString()
}

function getSettingsStore(): Promise<{
  get(key: string): unknown
  set(key: string, value: unknown): void
}> {
  return import('electron-store').then(({ default: Store }) => {
    return new Store({
      name: 'settings',
    }) as unknown as { get(key: string): unknown; set(key: string, value: unknown): void }
  })
}

async function getProjectGitConfig(projectId: string): Promise<{
  repoUrl: string
  username: string
  branch: string
  token: string
} | null> {
  try {
    const settingsStore = await getSettingsStore()
    const gitConfig = settingsStore.get(`git`) as
      | Record<
          string,
          {
            repoUrl?: string
            username?: string
            branch?: string
            token?: string
          }
        >
      | undefined

    const config = gitConfig?.[projectId]
    if (!config?.repoUrl) return null

    // Token may be in config directly, or in secure store (legacy).
    // Values written since the safeStorage migration are decrypted here.
    let token = decryptSecret(config.token || '') || ''
    if (!token) {
      try {
        const secureStore = await getSecureStore()
        const b64Key = `git.${Buffer.from(config.repoUrl).toString('base64').slice(0, 32)}`
        const creds = secureStore.get(b64Key) as { token?: string } | undefined
        token = decryptSecret(creds?.token || '') || ''
      } catch {
        /* ignore */
      }
    }

    return {
      repoUrl: config.repoUrl,
      username: config.username || '',
      branch: config.branch || 'main',
      token,
    }
  } catch {
    return null
  }
}

// ─── Register all handlers ───────────────────────────────────────
export function registerSaveHandlers(): void {
  // ─── Generic: write JSON to file via save dialog ───────────
  async function writeJsonViaSaveDialog(
    content: string,
    defaultName: string,
  ): Promise<{ success: boolean; path?: string; error?: string }> {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
      filters: [
        { name: 'JSON', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Cancelled' }
    }
    writeFileSync(result.filePath, content, 'utf-8')
    return { success: true, path: result.filePath }
  }

  // ─── Export Project (JSON file dialog) ─────────────────────
  ipcMain.handle('save:exportProject', async (_event, projectId: string) => {
    try {
      const data = exportProjectData(projectId)
      if (!data.project || Object.keys(data.project).length === 0) {
        return {
          success: false,
          error: `Project ${projectId} not found in database (export skipped)`,
        }
      }
      const counts = {
        folders: data.folders.length,
        endpoints: data.endpoints.length,
        savedRequests: data.savedRequests.length,
        environments: data.environments.length,
        testSuites: data.testSuites?.length ?? 0,
        mockServers: data.mockServers?.length ?? 0,
      }
      const projectName = ((data.project?.name as string) || 'project').replace(
        /[^a-zA-Z0-9-_]/g,
        '_',
      )
      const dateStr = new Date().toISOString().slice(0, 10)
      const defaultName = `${projectName}-${dateStr}.json`
      const res = await writeJsonViaSaveDialog(JSON.stringify(data, null, 2), defaultName)
      if (!res.success) return { success: false, error: res.error }
      return { success: true, data: { path: res.path, counts } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Export Folder ─────────────────────────────────────────
  ipcMain.handle('save:exportFolder', async (_event, folderId: string) => {
    try {
      const data = exportFolderData(folderId)
      const db = getDb()
      const folder = db
        .prepare('SELECT name, project_id FROM folders WHERE id = ?')
        .get(folderId) as { name?: string; project_id?: string } | undefined
      // Fix v1.3.1 B23: filenames came out as "folder-folder-2026-05-15.json"
      // because the project-root folder was literally named "folder". Use the
      // owning project's name when the folder name is empty or the generic
      // "folder" placeholder, and drop the redundant `folder-` prefix.
      const project = folder?.project_id
        ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(folder.project_id) as
            | { name?: string }
            | undefined)
        : undefined
      const rawName =
        !folder?.name || folder.name.toLowerCase() === 'folder'
          ? project?.name || 'project'
          : folder.name
      const slug = rawName.replace(/[^a-zA-Z0-9-_]/g, '_')
      const defaultName = `${slug}-${new Date().toISOString().slice(0, 10)}.json`
      const res = await writeJsonViaSaveDialog(JSON.stringify(data, null, 2), defaultName)
      if (!res.success) return { success: false, error: res.error }
      return { success: true, data: { path: res.path } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Export Test Suite ─────────────────────────────────────
  ipcMain.handle('save:exportTestSuite', async (_event, suiteId: string) => {
    try {
      const data = exportTestSuiteData(suiteId)
      const suiteName = ((data.suite?.name as string) || 'suite').replace(/[^a-zA-Z0-9-_]/g, '_')
      const defaultName = `suite-${suiteName}-${new Date().toISOString().slice(0, 10)}.json`
      const res = await writeJsonViaSaveDialog(JSON.stringify(data, null, 2), defaultName)
      if (!res.success) return { success: false, error: res.error }
      return { success: true, data: { path: res.path } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Duplicate Project (in same workspace, optional new name) ──
  // v1.3.1 B3: the project-level "..." menu only offered Rename + Delete,
  // even though the folder context menu already had Duplicate. We reuse the
  // export → importProjectAsNew pipeline so the clone is a true deep copy
  // (folders, endpoints, environments, test suites, mocks, certificates).
  ipcMain.handle(
    'project:duplicate',
    async (_event, payload: { projectId: string; workspaceId: string; name?: string }) => {
      try {
        const data = exportProjectData(payload.projectId)
        if (!data.project || Object.keys(data.project).length === 0) {
          return { success: false, error: 'Source project not found' }
        }
        const baseName =
          payload.name ||
          `${(data.project.display_name as string) || (data.project.name as string) || 'Project'} (copy)`
        const res = importProjectAsNew(data, payload.workspaceId, { name: baseName })
        return { success: true, data: { projectId: res.projectId } }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Import Project from pre-loaded JSON content ───────────
  // Used by the APIs Import wizard (B25) where the file content has already
  // been read via importExport.openFile. Skips the native open-dialog so the
  // wizard's own folder selection stays in charge.
  ipcMain.handle(
    'save:importProjectFromContent',
    async (_event, payload: { workspaceId: string; content: string; name?: string }) => {
      try {
        const parsed = JSON.parse(payload.content) as ProjectExport
        const validationError = validateProjectExport(parsed)
        if (validationError) {
          return { success: false, error: validationError }
        }
        const res = importProjectAsNew(parsed, payload.workspaceId, { name: payload.name })
        return { success: true, data: { projectId: res.projectId } }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Import Project (as NEW project in workspace) ──────────
  ipcMain.handle(
    'save:importProject',
    async (_event, payload: { workspaceId: string; name?: string }) => {
      try {
        const win = BrowserWindow.getFocusedWindow()
        const result = await dialog.showOpenDialog(win!, {
          properties: ['openFile'],
          title: 'Select project export file',
          filters: [{ name: 'JSON Files', extensions: ['json'] }],
        })
        if (result.canceled || !result.filePaths[0]) {
          return { success: false, error: 'Cancelled' }
        }
        const content = readFileSync(result.filePaths[0], 'utf-8')
        const parsed = JSON.parse(content) as ProjectExport
        const validationError = validateProjectExport(parsed)
        if (validationError) {
          return { success: false, error: validationError }
        }
        const res = importProjectAsNew(parsed, payload.workspaceId, { name: payload.name })
        return { success: true, data: { projectId: res.projectId } }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Import Folder (into existing project, optional parent) ─
  ipcMain.handle(
    'save:importFolder',
    async (_event, payload: { projectId: string; parentFolderId?: string | null }) => {
      try {
        const win = BrowserWindow.getFocusedWindow()
        const result = await dialog.showOpenDialog(win!, {
          properties: ['openFile'],
          title: 'Select folder export file',
          filters: [{ name: 'JSON Files', extensions: ['json'] }],
        })
        if (result.canceled || !result.filePaths[0]) {
          return { success: false, error: 'Cancelled' }
        }
        const content = readFileSync(result.filePaths[0], 'utf-8')
        const parsed = JSON.parse(content) as FolderExport
        if (!parsed.version || parsed.kind !== 'folder') {
          return { success: false, error: 'Invalid folder export file.' }
        }
        const out = importFolderData(parsed, payload.projectId, payload.parentFolderId ?? null)
        return { success: true, data: out }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Import Test Suite (multi-format, auto-detect) ─────────
  // Accepts either a raw `content` string (already-read file) or, when
  // omitted, opens a file picker. Auto-detects Testnizer/Postman/Insomnia
  // based on top-level shape — see `detectTestSuiteImportFormat`.
  ipcMain.handle(
    'save:importTestSuite',
    async (_event, payload: { projectId: string; content?: string; suiteName?: string }) => {
      try {
        let content = payload.content
        if (!content) {
          const win = BrowserWindow.getFocusedWindow()
          const result = await dialog.showOpenDialog(win!, {
            properties: ['openFile'],
            title: 'Select test suite / collection file',
            // Accept both JSON (Postman, Insomnia v4, Testnizer native) and
            // YAML (Insomnia v5). Without yaml/yml here, the v5 export shape
            // documented by Insomnia 8+ is invisible in the picker.
            filters: [
              { name: 'Collections', extensions: ['json', 'yaml', 'yml'] },
              { name: 'JSON', extensions: ['json'] },
              { name: 'YAML', extensions: ['yaml', 'yml'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          })
          if (result.canceled || !result.filePaths[0]) {
            return { success: false, error: 'Cancelled' }
          }
          content = readFileSync(result.filePaths[0], 'utf-8')
        }

        const out = await importTestSuiteFromFile(content, payload.projectId, payload.suiteName)
        return { success: true, data: out }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Save Local ─────────────────────────────────────────────
  ipcMain.handle(
    'save:local',
    async (
      _event,
      payload: {
        projectId: string
        directoryPath?: string
      },
    ) => {
      try {
        let dirPath = payload.directoryPath

        if (!dirPath) {
          const win = BrowserWindow.getFocusedWindow()
          const result = await dialog.showOpenDialog(win!, {
            properties: ['openDirectory', 'createDirectory'],
            title: 'Select save directory',
          })
          if (result.canceled || !result.filePaths[0]) {
            return { success: false, error: 'Cancelled' }
          }
          dirPath = result.filePaths[0]
        }

        const data = exportProjectData(payload.projectId)
        const projectName = ((data.project?.name as string) || 'project').replace(
          /[^a-zA-Z0-9-_]/g,
          '_',
        )
        const dateStr = new Date().toISOString().slice(0, 10)
        const fileName = `${projectName}-${dateStr}.json`
        const filePath = join(dirPath, fileName)

        writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')

        addSaveHistory({
          project_id: payload.projectId,
          mode: 'local',
          path: filePath,
          message: `Saved to ${fileName}`,
        })

        return { success: true, data: { path: filePath, fileName } }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Select JSON File ───────────────────────────────────────
  ipcMain.handle('save:selectFile', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openFile'],
        title: 'Select project file',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePaths[0]) {
        return { success: false, error: 'Cancelled' }
      }
      // Read and validate JSON
      const filePath = result.filePaths[0]
      const content = readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content) as ProjectExport
      if (!data.version || !data.project) {
        return { success: false, error: 'Invalid project file format.' }
      }
      return { success: true, data: { filePath, project: data } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Import Local File ─────────────────────────────────────
  ipcMain.handle(
    'save:importLocal',
    async (
      _event,
      payload: {
        filePath: string
        projectId: string
      },
    ) => {
      try {
        const safePath = assertImportFilePath(payload.filePath)
        const content = readFileSync(safePath, 'utf-8')
        const data = JSON.parse(content) as ProjectExport
        if (!data.version || !data.project) {
          return { success: false, error: 'Invalid project file format.' }
        }
        importProjectData(data, payload.projectId)
        return {
          success: true,
          data: {
            imported: {
              folders: data.folders?.length || 0,
              endpoints: data.endpoints?.length || 0,
              savedRequests: data.savedRequests?.length || 0,
              environments: data.environments?.length || 0,
              globalVariables: data.globalVariables?.length || 0,
            },
          },
        }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Select Directory ───────────────────────────────────────
  ipcMain.handle('save:selectDirectory', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select save directory',
      })
      if (result.canceled || !result.filePaths[0]) {
        return { success: false, error: 'Cancelled' }
      }
      return { success: true, data: result.filePaths[0] }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Git Push (manual with explicit creds) ─────────────────
  ipcMain.handle(
    'save:git',
    async (
      _event,
      payload: {
        projectId: string
        repoUrl: string
        branch: string
        username: string
        token: string
        commitMessage: string
      },
    ) => {
      try {
        const { simpleGit } = await import('simple-git')

        const data = exportProjectData(payload.projectId)
        const projectName = ((data.project?.name as string) || 'project').replace(
          /[^a-zA-Z0-9-_]/g,
          '_',
        )
        const authUrl = buildAuthUrl(payload.repoUrl, payload.username, payload.token)

        const tmpDir = join(tmpdir(), `testnizer-git-${randomUUID()}`)
        mkdirSync(tmpDir, { recursive: true })

        const git = simpleGit()

        // Clone
        let isEmptyRepo = false
        try {
          await git.clone(authUrl, tmpDir, [
            '--branch',
            payload.branch,
            '--single-branch',
            '--depth',
            '1',
          ])
        } catch {
          // If branch doesn't exist, try default branch
          rmSync(tmpDir, { recursive: true, force: true })
          mkdirSync(tmpDir, { recursive: true })
          try {
            await git.clone(authUrl, tmpDir, ['--depth', '1'])
            const gitRepo = simpleGit(tmpDir)
            await gitRepo.checkoutLocalBranch(payload.branch)
          } catch {
            // Completely empty repo — init locally
            rmSync(tmpDir, { recursive: true, force: true })
            mkdirSync(tmpDir, { recursive: true })
            const gitRepo = simpleGit(tmpDir)
            await gitRepo.init()
            await gitRepo.addRemote('origin', authUrl)
            await gitRepo.checkoutLocalBranch(payload.branch)
            isEmptyRepo = true
          }
        }

        const gitRepo = simpleGit(tmpDir)

        // Write project JSON
        const fileName = `${projectName}.json`
        writeFileSync(join(tmpDir, fileName), JSON.stringify(data, null, 2), 'utf-8')

        // Commit and push
        await gitRepo.add(fileName)
        const status = await gitRepo.status()
        if (status.staged.length === 0 && status.modified.length === 0 && !isEmptyRepo) {
          rmSync(tmpDir, { recursive: true, force: true })
          return {
            success: true,
            data: {
              repoUrl: payload.repoUrl,
              branch: payload.branch,
              message: 'No changes to push',
            },
          }
        }

        await gitRepo.commit(payload.commitMessage || `Update ${projectName}`)
        await gitRepo.push('origin', payload.branch, isEmptyRepo ? ['--set-upstream'] : [])

        // Save credentials securely (token is wrapped via OS keychain).
        const store = await getSecureStore()
        store.set(`git.${Buffer.from(payload.repoUrl).toString('base64').slice(0, 32)}`, {
          repoUrl: payload.repoUrl,
          username: payload.username,
          token: encryptSecret(payload.token),
        })

        addSaveHistory({
          project_id: payload.projectId,
          mode: 'git',
          path: `${payload.repoUrl}@${payload.branch}`,
          message: payload.commitMessage || `Update ${projectName}`,
        })

        rmSync(tmpDir, { recursive: true, force: true })

        return { success: true, data: { repoUrl: payload.repoUrl, branch: payload.branch } }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Git Push (auto — uses stored creds) ───────────────────
  ipcMain.handle(
    'save:gitPush',
    async (
      _event,
      payload: {
        projectId: string
        commitMessage?: string
      },
    ) => {
      try {
        const config = await getProjectGitConfig(payload.projectId)
        if (!config || !config.repoUrl || !config.token) {
          return {
            success: false,
            error: 'Git yapılandırması bulunamadı. Proje ayarlarından Git bilgilerini girin.',
          }
        }

        const { simpleGit } = await import('simple-git')

        const data = exportProjectData(payload.projectId)
        const projectName = ((data.project?.name as string) || 'project').replace(
          /[^a-zA-Z0-9-_]/g,
          '_',
        )
        const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)

        const tmpDir = join(tmpdir(), `testnizer-push-${randomUUID()}`)
        mkdirSync(tmpDir, { recursive: true })

        const git = simpleGit()

        // Clone
        let isEmptyRepo = false
        try {
          await git.clone(authUrl, tmpDir, [
            '--branch',
            config.branch,
            '--single-branch',
            '--depth',
            '1',
          ])
        } catch {
          rmSync(tmpDir, { recursive: true, force: true })
          mkdirSync(tmpDir, { recursive: true })
          try {
            await git.clone(authUrl, tmpDir, ['--depth', '1'])
            const gitRepo = simpleGit(tmpDir)
            await gitRepo.checkoutLocalBranch(config.branch)
          } catch {
            // Completely empty repo — init locally
            rmSync(tmpDir, { recursive: true, force: true })
            mkdirSync(tmpDir, { recursive: true })
            const gitRepo = simpleGit(tmpDir)
            await gitRepo.init()
            await gitRepo.addRemote('origin', authUrl)
            await gitRepo.checkoutLocalBranch(config.branch)
            isEmptyRepo = true
          }
        }

        const gitRepo = simpleGit(tmpDir)

        // Write project JSON
        const fileName = `${projectName}.json`
        writeFileSync(join(tmpDir, fileName), JSON.stringify(data, null, 2), 'utf-8')

        // Check for changes
        await gitRepo.add(fileName)
        const status = await gitRepo.status()
        if (status.staged.length === 0 && !isEmptyRepo) {
          rmSync(tmpDir, { recursive: true, force: true })
          return {
            success: true,
            data: { noChanges: true, message: 'Değişiklik yok — her şey güncel.' },
          }
        }

        const msg =
          payload.commitMessage || `Update ${projectName} — ${new Date().toLocaleString()}`
        await gitRepo.commit(msg)
        await gitRepo.push('origin', config.branch, isEmptyRepo ? ['--set-upstream'] : [])

        addSaveHistory({
          project_id: payload.projectId,
          mode: 'git',
          path: `${config.repoUrl}@${config.branch}`,
          message: msg,
        })

        rmSync(tmpDir, { recursive: true, force: true })

        return {
          success: true,
          data: { repoUrl: config.repoUrl, branch: config.branch, message: msg },
        }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Git Pull (import from git to local DB) ────────────────
  ipcMain.handle(
    'save:gitPull',
    async (
      _event,
      payload: {
        projectId: string
      },
    ) => {
      try {
        const config = await getProjectGitConfig(payload.projectId)
        if (!config || !config.repoUrl || !config.token) {
          return {
            success: false,
            error: 'Git yapılandırması bulunamadı. Proje ayarlarından Git bilgilerini girin.',
          }
        }

        const { simpleGit } = await import('simple-git')

        const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)

        const tmpDir = join(tmpdir(), `testnizer-pull-${randomUUID()}`)
        mkdirSync(tmpDir, { recursive: true })

        const git = simpleGit()

        try {
          await git.clone(authUrl, tmpDir, [
            '--branch',
            config.branch,
            '--single-branch',
            '--depth',
            '1',
          ])
        } catch {
          // Branch not found — try default branch
          rmSync(tmpDir, { recursive: true, force: true })
          mkdirSync(tmpDir, { recursive: true })
          try {
            await git.clone(authUrl, tmpDir, ['--depth', '1'])
          } catch {
            // Empty repo — nothing to pull
            rmSync(tmpDir, { recursive: true, force: true })
            return { success: false, error: 'Git repository boş — henüz push yapılmamış.' }
          }
        }

        // Find JSON files
        const files = readdirSync(tmpDir).filter((f) => f.endsWith('.json') && !f.startsWith('.'))
        if (files.length === 0) {
          rmSync(tmpDir, { recursive: true, force: true })
          return { success: false, error: "Git repository'de proje dosyası bulunamadı." }
        }

        // Read first (or matching) JSON file
        const content = readFileSync(join(tmpDir, files[0]), 'utf-8')
        const data = JSON.parse(content) as ProjectExport

        if (!data.version || !data.project) {
          rmSync(tmpDir, { recursive: true, force: true })
          return { success: false, error: 'Geçersiz proje dosyası formatı.' }
        }

        // Import into DB
        importProjectData(data, payload.projectId)

        addSaveHistory({
          project_id: payload.projectId,
          mode: 'git',
          path: `${config.repoUrl}@${config.branch}`,
          message: `Pull from ${config.branch}`,
        })

        rmSync(tmpDir, { recursive: true, force: true })

        return {
          success: true,
          data: {
            imported: {
              folders: data.folders?.length || 0,
              endpoints: data.endpoints?.length || 0,
              savedRequests: data.savedRequests?.length || 0,
              environments: data.environments?.length || 0,
              environmentVariables: data.environmentVariables?.length || 0,
              globalVariables: data.globalVariables?.length || 0,
            },
          },
        }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Store Git Token (called from renderer during project setup) ──
  ipcMain.handle(
    'save:storeGitToken',
    async (
      _event,
      payload: {
        repoUrl: string
        username: string
        token: string
      },
    ) => {
      try {
        const store = await getSecureStore()
        const b64Key = `git.${Buffer.from(payload.repoUrl).toString('base64').slice(0, 32)}`
        store.set(b64Key, {
          repoUrl: payload.repoUrl,
          username: payload.username,
          token: encryptSecret(payload.token),
        })
        return { success: true }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Git Config (get stored config for project) ────────────
  ipcMain.handle('save:gitConfig', async (_event, projectId: string) => {
    try {
      const config = await getProjectGitConfig(projectId)
      if (config) {
        return {
          success: true,
          data: {
            repoUrl: config.repoUrl,
            username: config.username,
            branch: config.branch,
            hasToken: !!config.token,
          },
        }
      }
      return { success: true, data: null }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Open from Git ──────────────────────────────────────────
  ipcMain.handle(
    'save:gitListFiles',
    async (
      _event,
      payload: {
        repoUrl: string
        branch: string
        username: string
        token: string
      },
    ) => {
      try {
        const { simpleGit } = await import('simple-git')

        const authUrl = buildAuthUrl(payload.repoUrl, payload.username, payload.token)

        const tmpDir = join(tmpdir(), `testnizer-git-list-${randomUUID()}`)
        mkdirSync(tmpDir, { recursive: true })

        const git = simpleGit()

        let isEmpty = false
        try {
          await git.clone(authUrl, tmpDir, [
            '--branch',
            payload.branch,
            '--single-branch',
            '--depth',
            '1',
          ])
        } catch {
          // Branch not found — try cloning without branch (default branch)
          rmSync(tmpDir, { recursive: true, force: true })
          mkdirSync(tmpDir, { recursive: true })
          try {
            await git.clone(authUrl, tmpDir, ['--depth', '1'])
          } catch {
            // Completely empty repo — init locally and set remote
            rmSync(tmpDir, { recursive: true, force: true })
            mkdirSync(tmpDir, { recursive: true })
            const gitRepo = simpleGit(tmpDir)
            await gitRepo.init()
            await gitRepo.addRemote('origin', authUrl)
            isEmpty = true
          }
        }

        const files = isEmpty
          ? []
          : readdirSync(tmpDir)
              .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
              .map((f) => {
                const stat = statSync(join(tmpDir, f))
                return { name: f, path: join(tmpDir, f), size: stat.size }
              })

        return { success: true, data: { tmpDir, files, isEmpty } }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('save:gitReadFile', async (_event, filePath: string) => {
    try {
      const safePath = assertTmpSubpath(filePath, GIT_TMP_PREFIXES)
      if (!existsSync(safePath)) {
        return { success: false, error: 'File not found' }
      }
      const content = readFileSync(safePath, 'utf-8')
      const data = JSON.parse(content)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('save:gitCleanup', async (_event, tmpDir: string) => {
    try {
      const safeDir = assertTmpSubpath(tmpDir, GIT_TMP_PREFIXES)
      rmSync(safeDir, { recursive: true, force: true })
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Stored Git Credentials ────────────────────────────────
  ipcMain.handle('save:getGitCredentials', async () => {
    try {
      const store = await getSecureStore()
      const all = store.get('git') as Record<string, unknown> | undefined
      return { success: true, data: all || {} }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Git Diff Preview ─────────────────────────────────────
  ipcMain.handle(
    'save:gitDiff',
    async (_event, payload: { projectId: string; direction: 'push' | 'pull' }) => {
      try {
        const config = await getProjectGitConfig(payload.projectId)
        if (!config || !config.repoUrl || !config.token) {
          return { success: false, error: 'Git configuration not found.' }
        }

        const { simpleGit } = await import('simple-git')
        const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)

        const tmpDir = join(tmpdir(), `testnizer-diff-${randomUUID()}`)
        mkdirSync(tmpDir, { recursive: true })

        const git = simpleGit()

        let cloned = true
        try {
          await git.clone(authUrl, tmpDir, [
            '--branch',
            config.branch,
            '--single-branch',
            '--depth',
            '1',
          ])
        } catch {
          cloned = false
          rmSync(tmpDir, { recursive: true, force: true })
        }

        let remoteData: ProjectExport | null = null
        if (cloned) {
          const files = readdirSync(tmpDir).filter((f) => f.endsWith('.json') && !f.startsWith('.'))
          if (files.length > 0) {
            try {
              const content = readFileSync(join(tmpDir, files[0]), 'utf-8')
              remoteData = JSON.parse(content) as ProjectExport
            } catch {
              /* ignore */
            }
          }
          rmSync(tmpDir, { recursive: true, force: true })
        }

        const localData = exportProjectData(payload.projectId)

        function diffCollection(
          local: Record<string, unknown>[],
          remote: Record<string, unknown>[],
        ) {
          const localMap = new Map(local.map((item) => [item.id as string, item]))
          const remoteMap = new Map(remote.map((item) => [item.id as string, item]))
          const details: Array<{
            id: string
            name: string
            status: 'added' | 'removed' | 'modified'
          }> = []
          let added = 0,
            removed = 0,
            modified = 0

          for (const [id, item] of localMap) {
            const remoteCopy = remoteMap.get(id)
            const itemName = (item.name || item.key || item.path || id) as string
            if (!remoteCopy) {
              added++
              details.push({ id, name: itemName, status: 'added' })
            } else if (JSON.stringify(item) !== JSON.stringify(remoteCopy)) {
              modified++
              details.push({ id, name: itemName, status: 'modified' })
            }
          }
          for (const [id, item] of remoteMap) {
            if (!localMap.has(id)) {
              removed++
              details.push({
                id,
                name: (item.name || item.key || item.path || id) as string,
                status: 'removed',
              })
            }
          }
          return { added, removed, modified, details }
        }

        const src = payload.direction === 'push' ? localData : remoteData || localData
        const empty = {
          endpoints: [],
          folders: [],
          savedRequests: [],
          environments: [],
          globalVariables: [],
        } as unknown as ProjectExport
        const tgt = payload.direction === 'push' ? remoteData || empty : localData

        const endpointsDiff = diffCollection(src.endpoints, tgt.endpoints)
        const foldersDiff = diffCollection(src.folders, tgt.folders)
        const savedRequestsDiff = diffCollection(src.savedRequests, tgt.savedRequests)
        const envsDiff = diffCollection(src.environments || [], tgt.environments || [])
        const globalsDiff = diffCollection(src.globalVariables || [], tgt.globalVariables || [])

        const totalChanges =
          endpointsDiff.added +
          endpointsDiff.removed +
          endpointsDiff.modified +
          foldersDiff.added +
          foldersDiff.removed +
          foldersDiff.modified +
          savedRequestsDiff.added +
          savedRequestsDiff.removed +
          savedRequestsDiff.modified +
          envsDiff.added +
          envsDiff.removed +
          envsDiff.modified +
          globalsDiff.added +
          globalsDiff.removed +
          globalsDiff.modified

        return {
          success: true,
          data: {
            direction: payload.direction,
            remoteExists: !!remoteData,
            totalChanges,
            changes: {
              endpoints: endpointsDiff,
              folders: foldersDiff,
              savedRequests: savedRequestsDiff,
              environments: envsDiff,
              globalVariables: globalsDiff,
            },
            summary:
              totalChanges === 0
                ? 'No changes — everything is in sync.'
                : `${totalChanges} change(s) detected.`,
          },
        }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Save History ──────────────────────────────────────────
  ipcMain.handle('save:history', async (_event, projectId: string) => {
    try {
      const db = getDb()
      const rows = db
        .prepare('SELECT * FROM save_history WHERE project_id = ? ORDER BY timestamp DESC LIMIT 20')
        .all(projectId)
      return { success: true, data: rows }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
