import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { getDb } from '../db/database'
import { addSaveHistory } from '../db/branch.repo'
import { encryptSecret, decryptSecret } from '../lib/secure-storage'

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
  testSuiteEndpoints?: Record<string, unknown>[]
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

// ─── Test Suite Export Format ────────────────────────────────────
interface TestSuiteExport {
  version: string
  exportedAt: number
  kind: 'testSuite'
  suite: Record<string, unknown>
  endpoints: Record<string, unknown>[]
  endpointCases: Record<string, unknown>[]
  suiteEndpoints: Record<string, unknown>[]
}

export function exportProjectData(projectId: string): ProjectExport {
  const db = getDb()

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as Record<string, unknown>
  const folders = db.prepare('SELECT * FROM folders WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
  const endpoints = db.prepare('SELECT * FROM endpoints WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
  const savedRequests = db.prepare('SELECT * FROM saved_requests WHERE project_id = ?').all(projectId) as Record<string, unknown>[]

  // Endpoint cases for all endpoints
  const endpointIds = endpoints.map((e) => e.id as string)
  let endpointCases: Record<string, unknown>[] = []
  if (endpointIds.length > 0) {
    const placeholders = endpointIds.map(() => '?').join(',')
    endpointCases = db.prepare(
      `SELECT * FROM endpoint_cases WHERE endpoint_id IN (${placeholders})`
    ).all(...endpointIds) as Record<string, unknown>[]
  }

  // Environments + variables scoped to THIS project
  let environments: Record<string, unknown>[] = []
  let environmentVariables: Record<string, unknown>[] = []
  let globalVariables: Record<string, unknown>[] = []

  environments = db.prepare('SELECT * FROM environments WHERE project_id = ?').all(projectId) as Record<string, unknown>[]

  const envIds = environments.map((e) => e.id as string)
  if (envIds.length > 0) {
    const placeholders = envIds.map(() => '?').join(',')
    environmentVariables = db.prepare(
      `SELECT * FROM environment_variables WHERE environment_id IN (${placeholders})`
    ).all(...envIds) as Record<string, unknown>[]
  }

  globalVariables = db.prepare('SELECT * FROM global_variables WHERE project_id = ?').all(projectId) as Record<string, unknown>[]

  // Test suites + M2M endpoint links
  const testSuites = db.prepare('SELECT * FROM test_suites WHERE project_id = ?').all(projectId) as Record<string, unknown>[]
  let testSuiteEndpoints: Record<string, unknown>[] = []
  const suiteIds = testSuites.map((s) => s.id as string)
  if (suiteIds.length > 0) {
    const ph = suiteIds.map(() => '?').join(',')
    testSuiteEndpoints = db.prepare(
      `SELECT * FROM test_suite_endpoints WHERE suite_id IN (${ph})`
    ).all(...suiteIds) as Record<string, unknown>[]
  }

  return {
    version: '1.0.0',
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
    testSuiteEndpoints,
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
    const setClause = columns.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')
    const stmt = db.prepare(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${setClause}`
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
    'id', 'project_id', 'folder_id', 'name', 'description', 'protocol', 'method',
    'path', 'status', 'request_schema', 'response_schemas', 'sort_order', 'created_at', 'updated_at'
  ])

  // Import endpoint cases
  if (data.endpointCases?.length) {
    upsert('endpoint_cases', data.endpointCases, [
      'id', 'endpoint_id', 'name', 'params', 'headers', 'body', 'auth', 'assertions', 'is_default', 'created_at'
    ])
  }

  // Import saved requests
  upsert('saved_requests', data.savedRequests, [
    'id', 'project_id', 'folder_id', 'name', 'protocol', 'method', 'url',
    'params', 'headers', 'body', 'auth', 'pre_script', 'post_script', 'assertions', 'metadata',
    'sort_order', 'created_at', 'updated_at'
  ])

  // Import environments
  if (data.environments?.length) {
    upsert('environments', data.environments, [
      'id', 'workspace_id', 'name', 'is_active', 'created_at', 'updated_at'
    ])
  }

  // Import environment variables
  if (data.environmentVariables?.length) {
    upsert('environment_variables', data.environmentVariables, [
      'id', 'environment_id', 'key', 'value', 'description', 'enabled', 'secret', 'initial_value'
    ])
  }

  // Import global variables
  if (data.globalVariables?.length) {
    upsert('global_variables', data.globalVariables, [
      'id', 'workspace_id', 'key', 'value', 'description', 'enabled', 'secret', 'initial_value'
    ])
  }

  // Import test suites
  if (data.testSuites?.length) {
    upsert('test_suites', data.testSuites, [
      'id', 'project_id', 'name', 'description', 'sort_order', 'created_at', 'updated_at'
    ])
  }

  // Import test_suite_endpoints
  if (data.testSuiteEndpoints?.length) {
    upsert('test_suite_endpoints', data.testSuiteEndpoints, [
      'id', 'suite_id', 'endpoint_id', 'sort_order'
    ])
  }
}

// ─── Folder Export / Import ──────────────────────────────────────
function collectFolderTree(rootFolderId: string): { folders: Record<string, unknown>[]; endpoints: Record<string, unknown>[]; endpointCases: Record<string, unknown>[] } {
  const db = getDb()

  const rootFolder = db.prepare('SELECT * FROM folders WHERE id = ?').get(rootFolderId) as Record<string, unknown> | undefined
  if (!rootFolder) {
    return { folders: [], endpoints: [], endpointCases: [] }
  }

  // Recursively gather all descendant folder IDs (BFS)
  const folders: Record<string, unknown>[] = [rootFolder]
  const queue: string[] = [rootFolderId]
  while (queue.length > 0) {
    const parentId = queue.shift() as string
    const children = db.prepare('SELECT * FROM folders WHERE parent_id = ?').all(parentId) as Record<string, unknown>[]
    for (const child of children) {
      folders.push(child)
      queue.push(child.id as string)
    }
  }

  const folderIds = folders.map((f) => f.id as string)
  const ph = folderIds.map(() => '?').join(',')
  const endpoints = db.prepare(
    `SELECT * FROM endpoints WHERE folder_id IN (${ph})`
  ).all(...folderIds) as Record<string, unknown>[]

  const endpointIds = endpoints.map((e) => e.id as string)
  let endpointCases: Record<string, unknown>[] = []
  if (endpointIds.length > 0) {
    const eph = endpointIds.map(() => '?').join(',')
    endpointCases = db.prepare(
      `SELECT * FROM endpoint_cases WHERE endpoint_id IN (${eph})`
    ).all(...endpointIds) as Record<string, unknown>[]
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
    `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?, ?)`
  )
  const insertEndpoint = db.prepare(
    `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertCase = db.prepare(
    `INSERT INTO endpoint_cases (id, endpoint_id, name, params, headers, body, auth, assertions, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        newParent = oldParent && folderIdMap.has(oldParent) ? folderIdMap.get(oldParent) as string : parentFolderId
      }
      insertFolder.run(newId, projectId, newParent, f.name, f.sort_order ?? 0)
    }

    // Endpoints
    for (const e of data.endpoints) {
      const newId = endpointIdMap.get(e.id as string) as string
      const oldFolderId = e.folder_id as string | null
      const newFolderId = oldFolderId && folderIdMap.has(oldFolderId) ? folderIdMap.get(oldFolderId) as string : null
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

// ─── Test Suite Export / Import ──────────────────────────────────
export function exportTestSuiteData(suiteId: string): TestSuiteExport {
  const db = getDb()
  const suite = db.prepare('SELECT * FROM test_suites WHERE id = ?').get(suiteId) as Record<string, unknown> | undefined
  if (!suite) {
    return {
      version: '1.0.0',
      exportedAt: Date.now(),
      kind: 'testSuite',
      suite: {},
      endpoints: [],
      endpointCases: [],
      suiteEndpoints: [],
    }
  }

  const suiteEndpoints = db.prepare(
    'SELECT * FROM test_suite_endpoints WHERE suite_id = ?'
  ).all(suiteId) as Record<string, unknown>[]

  const endpointIds = suiteEndpoints.map((se) => se.endpoint_id as string)
  let endpoints: Record<string, unknown>[] = []
  let endpointCases: Record<string, unknown>[] = []
  if (endpointIds.length > 0) {
    const ph = endpointIds.map(() => '?').join(',')
    endpoints = db.prepare(
      `SELECT * FROM endpoints WHERE id IN (${ph})`
    ).all(...endpointIds) as Record<string, unknown>[]
    endpointCases = db.prepare(
      `SELECT * FROM endpoint_cases WHERE endpoint_id IN (${ph})`
    ).all(...endpointIds) as Record<string, unknown>[]
  }

  return {
    version: '1.0.0',
    exportedAt: Date.now(),
    kind: 'testSuite',
    suite,
    endpoints,
    endpointCases,
    suiteEndpoints,
  }
}

/**
 * Import a test suite into target project. New IDs are generated.
 * All endpoints come in without a folder (folder_id = null) to avoid
 * dangling folder references from the source project.
 */
export function importTestSuiteData(
  data: TestSuiteExport,
  projectId: string,
): { suiteId: string; endpointsImported: number } {
  const db = getDb()
  const now = Date.now()

  const newSuiteId = randomUUID()
  const endpointIdMap = new Map<string, string>()
  for (const e of data.endpoints) endpointIdMap.set(e.id as string, randomUUID())

  const insertSuite = db.prepare(
    `INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
  const insertEndpoint = db.prepare(
    `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertCase = db.prepare(
    `INSERT INTO endpoint_cases (id, endpoint_id, name, params, headers, body, auth, assertions, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const insertLink = db.prepare(
    `INSERT INTO test_suite_endpoints (id, suite_id, endpoint_id, sort_order) VALUES (?, ?, ?, ?)`
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

    for (const e of data.endpoints) {
      const newId = endpointIdMap.get(e.id as string) as string
      insertEndpoint.run(
        newId,
        projectId,
        null, // drop folder association on import
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

    for (const c of data.endpointCases) {
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

    for (const link of data.suiteEndpoints) {
      const newEndpointId = endpointIdMap.get(link.endpoint_id as string)
      if (!newEndpointId) continue
      insertLink.run(randomUUID(), newSuiteId, newEndpointId, link.sort_order ?? 0)
    }
  })
  tx()

  return { suiteId: newSuiteId, endpointsImported: endpointIdMap.size }
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
  const projName = overrides?.name || (proj.name as string) || 'Imported Project'

  const tx = db.transaction(() => {
    // Insert project
    db.prepare(
      `INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at, save_mode, local_path, icon_emoji, icon_color, display_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      overrides?.name ?? (proj.display_name ?? null),
    )

    // Folders
    const insertFolder = db.prepare(
      `INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, ?, ?, ?)`
    )
    for (const f of data.folders) {
      const newId = folderIdMap.get(f.id as string) as string
      const oldParent = f.parent_id as string | null
      const newParent = oldParent && folderIdMap.has(oldParent) ? folderIdMap.get(oldParent) as string : null
      insertFolder.run(newId, newProjectId, newParent, f.name, f.sort_order ?? 0)
    }

    // Endpoints
    const insertEndpoint = db.prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, description, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const e of data.endpoints) {
      const newId = endpointIdMap.get(e.id as string) as string
      const oldFolderId = e.folder_id as string | null
      const newFolderId = oldFolderId && folderIdMap.has(oldFolderId) ? folderIdMap.get(oldFolderId) as string : null
      insertEndpoint.run(
        newId, newProjectId, newFolderId,
        e.name, e.description ?? null, e.protocol || 'http', e.method ?? null, e.path,
        e.status || 'developing', e.request_schema ?? null, e.response_schemas ?? null,
        e.sort_order ?? 0, (e.created_at as number) || now, now,
      )
    }

    // Endpoint cases
    const insertCase = db.prepare(
      `INSERT INTO endpoint_cases (id, endpoint_id, name, params, headers, body, auth, assertions, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const c of data.endpointCases || []) {
      const newEndpointId = endpointIdMap.get(c.endpoint_id as string)
      if (!newEndpointId) continue
      insertCase.run(
        randomUUID(), newEndpointId, c.name,
        c.params ?? null, c.headers ?? null, c.body ?? null, c.auth ?? null, c.assertions ?? null,
        c.is_default ?? 0, (c.created_at as number) || now,
      )
    }

    // Saved requests
    const insertSaved = db.prepare(
      `INSERT INTO saved_requests (id, project_id, folder_id, name, protocol, method, url, params, headers, body, auth, pre_script, post_script, assertions, metadata, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const s of data.savedRequests || []) {
      const newId = savedReqIdMap.get(s.id as string) as string
      const oldFolderId = s.folder_id as string | null
      const newFolderId = oldFolderId && folderIdMap.has(oldFolderId) ? folderIdMap.get(oldFolderId) as string : null
      insertSaved.run(
        newId, newProjectId, newFolderId,
        s.name, s.protocol || 'http', s.method ?? null, s.url ?? null,
        s.params ?? null, s.headers ?? null, s.body ?? null, s.auth ?? null,
        s.pre_script ?? null, s.post_script ?? null, s.assertions ?? null, s.metadata ?? null,
        s.sort_order ?? 0, (s.created_at as number) || now, now,
      )
    }

    // Environments
    const insertEnv = db.prepare(
      `INSERT INTO environments (id, workspace_id, name, is_active, created_at, updated_at, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const env of data.environments || []) {
      const newEnvId = envIdMap.get(env.id as string) as string
      insertEnv.run(
        newEnvId, workspaceId, env.name, env.is_active ?? 0,
        (env.created_at as number) || now, now, newProjectId,
      )
    }

    // Environment variables
    const insertEnvVar = db.prepare(
      `INSERT INTO environment_variables (id, environment_id, key, value, description, enabled, secret, initial_value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const v of data.environmentVariables || []) {
      const newEnvId = envIdMap.get(v.environment_id as string)
      if (!newEnvId) continue
      insertEnvVar.run(
        randomUUID(), newEnvId, v.key, v.value ?? null,
        v.description ?? null, v.enabled ?? 1, v.secret ?? 0, v.initial_value ?? null,
      )
    }

    // Global variables
    const insertGlobal = db.prepare(
      `INSERT INTO global_variables (id, workspace_id, key, value, description, enabled, secret, initial_value, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const g of data.globalVariables || []) {
      insertGlobal.run(
        randomUUID(), workspaceId, g.key, g.value ?? null,
        g.description ?? null, g.enabled ?? 1, g.secret ?? 0, g.initial_value ?? null, newProjectId,
      )
    }

    // Test suites
    const insertSuite = db.prepare(
      `INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const s of data.testSuites || []) {
      const newId = suiteIdMap.get(s.id as string) as string
      insertSuite.run(
        newId, newProjectId, s.name, s.description ?? null, s.sort_order ?? 0,
        (s.created_at as number) || now, now,
      )
    }

    // Test suite endpoints
    const insertLink = db.prepare(
      `INSERT INTO test_suite_endpoints (id, suite_id, endpoint_id, sort_order) VALUES (?, ?, ?, ?)`
    )
    for (const link of data.testSuiteEndpoints || []) {
      const newSuiteId = suiteIdMap.get(link.suite_id as string)
      const newEndpointId = endpointIdMap.get(link.endpoint_id as string)
      if (!newSuiteId || !newEndpointId) continue
      insertLink.run(randomUUID(), newSuiteId, newEndpointId, link.sort_order ?? 0)
    }
  })
  tx()

  return { projectId: newProjectId }
}

// ─── Git helpers ─────────────────────────────────────────────────
function getSecureStore(): Promise<{ get(key: string): unknown; set(key: string, value: unknown): void }> {
  return import('electron-store').then(({ default: Store }) => {
    return new Store({
      name: 'git-credentials',
      encryptionKey: 'apinizer-secure-key-v1',
    }) as unknown as { get(key: string): unknown; set(key: string, value: unknown): void }
  })
}

function buildAuthUrl(repoUrl: string, username: string, token: string): string {
  const urlObj = new URL(repoUrl)
  urlObj.username = encodeURIComponent(username)
  urlObj.password = encodeURIComponent(token)
  return urlObj.toString()
}

function getSettingsStore(): Promise<{ get(key: string): unknown; set(key: string, value: unknown): void }> {
  return import('electron-store').then(({ default: Store }) => {
    return new Store({
      name: 'settings',
    }) as unknown as { get(key: string): unknown; set(key: string, value: unknown): void }
  })
}

async function getProjectGitConfig(projectId: string): Promise<{
  repoUrl: string; username: string; branch: string; token: string
} | null> {
  try {
    const settingsStore = await getSettingsStore()
    const gitConfig = settingsStore.get(`git`) as Record<string, {
      repoUrl?: string; username?: string; branch?: string; token?: string
    }> | undefined

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
      } catch { /* ignore */ }
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
  async function writeJsonViaSaveDialog(content: string, defaultName: string): Promise<{ success: boolean; path?: string; error?: string }> {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
      filters: [{ name: 'JSON', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }],
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
      const projectName = (data.project?.name as string || 'project').replace(/[^a-zA-Z0-9-_]/g, '_')
      const dateStr = new Date().toISOString().slice(0, 10)
      const defaultName = `${projectName}-${dateStr}.json`
      const res = await writeJsonViaSaveDialog(JSON.stringify(data, null, 2), defaultName)
      if (!res.success) return { success: false, error: res.error }
      return { success: true, data: { path: res.path } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Export Folder ─────────────────────────────────────────
  ipcMain.handle('save:exportFolder', async (_event, folderId: string) => {
    try {
      const data = exportFolderData(folderId)
      const db = getDb()
      const folder = db.prepare('SELECT name FROM folders WHERE id = ?').get(folderId) as { name?: string } | undefined
      const folderName = (folder?.name || 'folder').replace(/[^a-zA-Z0-9-_]/g, '_')
      const defaultName = `folder-${folderName}-${new Date().toISOString().slice(0, 10)}.json`
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

  // ─── Import Project (as NEW project in workspace) ──────────
  ipcMain.handle('save:importProject', async (_event, payload: { workspaceId: string; name?: string }) => {
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
      if (!parsed.version || !parsed.project) {
        return { success: false, error: 'Invalid project file format.' }
      }
      const res = importProjectAsNew(parsed, payload.workspaceId, { name: payload.name })
      return { success: true, data: { projectId: res.projectId } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Import Folder (into existing project, optional parent) ─
  ipcMain.handle('save:importFolder', async (_event, payload: { projectId: string; parentFolderId?: string | null }) => {
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
  })

  // ─── Import Test Suite (into existing project) ─────────────
  ipcMain.handle('save:importTestSuite', async (_event, payload: { projectId: string }) => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openFile'],
        title: 'Select test suite export file',
        filters: [{ name: 'JSON Files', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePaths[0]) {
        return { success: false, error: 'Cancelled' }
      }
      const content = readFileSync(result.filePaths[0], 'utf-8')
      const parsed = JSON.parse(content) as TestSuiteExport
      if (!parsed.version || parsed.kind !== 'testSuite') {
        return { success: false, error: 'Invalid test suite export file.' }
      }
      const out = importTestSuiteData(parsed, payload.projectId)
      return { success: true, data: out }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Save Local ─────────────────────────────────────────────
  ipcMain.handle('save:local', async (_event, payload: {
    projectId: string
    directoryPath?: string
  }) => {
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
      const projectName = (data.project?.name as string || 'project').replace(/[^a-zA-Z0-9-_]/g, '_')
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
  })

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
  ipcMain.handle('save:importLocal', async (_event, payload: {
    filePath: string
    projectId: string
  }) => {
    try {
      const content = readFileSync(payload.filePath, 'utf-8')
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
  })

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
  ipcMain.handle('save:git', async (_event, payload: {
    projectId: string
    repoUrl: string
    branch: string
    username: string
    token: string
    commitMessage: string
  }) => {
    try {
      const { simpleGit } = await import('simple-git')

      const data = exportProjectData(payload.projectId)
      const projectName = (data.project?.name as string || 'project').replace(/[^a-zA-Z0-9-_]/g, '_')
      const authUrl = buildAuthUrl(payload.repoUrl, payload.username, payload.token)

      const tmpDir = join(tmpdir(), `apinizer-git-${randomUUID()}`)
      mkdirSync(tmpDir, { recursive: true })

      const git = simpleGit()

      // Clone
      let isEmptyRepo = false
      try {
        await git.clone(authUrl, tmpDir, ['--branch', payload.branch, '--single-branch', '--depth', '1'])
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
        return { success: true, data: { repoUrl: payload.repoUrl, branch: payload.branch, message: 'No changes to push' } }
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
  })

  // ─── Git Push (auto — uses stored creds) ───────────────────
  ipcMain.handle('save:gitPush', async (_event, payload: {
    projectId: string
    commitMessage?: string
  }) => {
    try {
      const config = await getProjectGitConfig(payload.projectId)
      if (!config || !config.repoUrl || !config.token) {
        return { success: false, error: 'Git yapılandırması bulunamadı. Proje ayarlarından Git bilgilerini girin.' }
      }

      const { simpleGit } = await import('simple-git')

      const data = exportProjectData(payload.projectId)
      const projectName = (data.project?.name as string || 'project').replace(/[^a-zA-Z0-9-_]/g, '_')
      const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)

      const tmpDir = join(tmpdir(), `apinizer-push-${randomUUID()}`)
      mkdirSync(tmpDir, { recursive: true })

      const git = simpleGit()

      // Clone
      let isEmptyRepo = false
      try {
        await git.clone(authUrl, tmpDir, ['--branch', config.branch, '--single-branch', '--depth', '1'])
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
        return { success: true, data: { noChanges: true, message: 'Değişiklik yok — her şey güncel.' } }
      }

      const msg = payload.commitMessage || `Update ${projectName} — ${new Date().toLocaleString()}`
      await gitRepo.commit(msg)
      await gitRepo.push('origin', config.branch, isEmptyRepo ? ['--set-upstream'] : [])

      addSaveHistory({
        project_id: payload.projectId,
        mode: 'git',
        path: `${config.repoUrl}@${config.branch}`,
        message: msg,
      })

      rmSync(tmpDir, { recursive: true, force: true })

      return { success: true, data: { repoUrl: config.repoUrl, branch: config.branch, message: msg } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Git Pull (import from git to local DB) ────────────────
  ipcMain.handle('save:gitPull', async (_event, payload: {
    projectId: string
  }) => {
    try {
      const config = await getProjectGitConfig(payload.projectId)
      if (!config || !config.repoUrl || !config.token) {
        return { success: false, error: 'Git yapılandırması bulunamadı. Proje ayarlarından Git bilgilerini girin.' }
      }

      const { simpleGit } = await import('simple-git')

      const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)

      const tmpDir = join(tmpdir(), `apinizer-pull-${randomUUID()}`)
      mkdirSync(tmpDir, { recursive: true })

      const git = simpleGit()

      try {
        await git.clone(authUrl, tmpDir, ['--branch', config.branch, '--single-branch', '--depth', '1'])
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
        return { success: false, error: 'Git repository\'de proje dosyası bulunamadı.' }
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
          }
        }
      }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Store Git Token (called from renderer during project setup) ──
  ipcMain.handle('save:storeGitToken', async (_event, payload: {
    repoUrl: string
    username: string
    token: string
  }) => {
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
  })

  // ─── Git Config (get stored config for project) ────────────
  ipcMain.handle('save:gitConfig', async (_event, projectId: string) => {
    try {
      const config = await getProjectGitConfig(projectId)
      if (config) {
        return { success: true, data: { repoUrl: config.repoUrl, username: config.username, branch: config.branch, hasToken: !!config.token } }
      }
      return { success: true, data: null }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Open from Git ──────────────────────────────────────────
  ipcMain.handle('save:gitListFiles', async (_event, payload: {
    repoUrl: string
    branch: string
    username: string
    token: string
  }) => {
    try {
      const { simpleGit } = await import('simple-git')

      const authUrl = buildAuthUrl(payload.repoUrl, payload.username, payload.token)

      const tmpDir = join(tmpdir(), `apinizer-git-list-${randomUUID()}`)
      mkdirSync(tmpDir, { recursive: true })

      const git = simpleGit()

      let isEmpty = false
      try {
        await git.clone(authUrl, tmpDir, ['--branch', payload.branch, '--single-branch', '--depth', '1'])
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

      const files = isEmpty ? [] : readdirSync(tmpDir)
        .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
        .map((f) => {
          const stat = statSync(join(tmpDir, f))
          return { name: f, path: join(tmpDir, f), size: stat.size }
        })

      return { success: true, data: { tmpDir, files, isEmpty } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('save:gitReadFile', async (_event, filePath: string) => {
    try {
      if (!existsSync(filePath)) {
        return { success: false, error: 'File not found' }
      }
      const content = readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)
      return { success: true, data }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('save:gitCleanup', async (_event, tmpDir: string) => {
    try {
      rmSync(tmpDir, { recursive: true, force: true })
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
  ipcMain.handle('save:gitDiff', async (_event, payload: { projectId: string; direction: 'push' | 'pull' }) => {
    try {
      const config = await getProjectGitConfig(payload.projectId)
      if (!config || !config.repoUrl || !config.token) {
        return { success: false, error: 'Git configuration not found.' }
      }

      const { simpleGit } = await import('simple-git')
      const authUrl = buildAuthUrl(config.repoUrl, config.username, config.token)

      const tmpDir = join(tmpdir(), `apinizer-diff-${randomUUID()}`)
      mkdirSync(tmpDir, { recursive: true })

      const git = simpleGit()

      let cloned = true
      try {
        await git.clone(authUrl, tmpDir, ['--branch', config.branch, '--single-branch', '--depth', '1'])
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
          } catch { /* ignore */ }
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
        const details: Array<{ id: string; name: string; status: 'added' | 'removed' | 'modified' }> = []
        let added = 0, removed = 0, modified = 0

        for (const [id, item] of localMap) {
          const remoteCopy = remoteMap.get(id)
          const itemName = (item.name || item.key || item.path || id) as string
          if (!remoteCopy) { added++; details.push({ id, name: itemName, status: 'added' }) }
          else if (JSON.stringify(item) !== JSON.stringify(remoteCopy)) { modified++; details.push({ id, name: itemName, status: 'modified' }) }
        }
        for (const [id, item] of remoteMap) {
          if (!localMap.has(id)) { removed++; details.push({ id, name: (item.name || item.key || item.path || id) as string, status: 'removed' }) }
        }
        return { added, removed, modified, details }
      }

      const src = payload.direction === 'push' ? localData : (remoteData || localData)
      const empty = { endpoints: [], folders: [], savedRequests: [], environments: [], globalVariables: [] } as unknown as ProjectExport
      const tgt = payload.direction === 'push' ? (remoteData || empty) : localData

      const endpointsDiff = diffCollection(src.endpoints, tgt.endpoints)
      const foldersDiff = diffCollection(src.folders, tgt.folders)
      const savedRequestsDiff = diffCollection(src.savedRequests, tgt.savedRequests)
      const envsDiff = diffCollection(src.environments || [], tgt.environments || [])
      const globalsDiff = diffCollection(src.globalVariables || [], tgt.globalVariables || [])

      const totalChanges = endpointsDiff.added + endpointsDiff.removed + endpointsDiff.modified +
        foldersDiff.added + foldersDiff.removed + foldersDiff.modified +
        savedRequestsDiff.added + savedRequestsDiff.removed + savedRequestsDiff.modified +
        envsDiff.added + envsDiff.removed + envsDiff.modified +
        globalsDiff.added + globalsDiff.removed + globalsDiff.modified

      return {
        success: true,
        data: {
          direction: payload.direction,
          remoteExists: !!remoteData,
          totalChanges,
          changes: { endpoints: endpointsDiff, folders: foldersDiff, savedRequests: savedRequestsDiff, environments: envsDiff, globalVariables: globalsDiff },
          summary: totalChanges === 0 ? 'No changes — everything is in sync.' : `${totalChanges} change(s) detected.`,
        },
      }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Save History ──────────────────────────────────────────
  ipcMain.handle('save:history', async (_event, projectId: string) => {
    try {
      const db = getDb()
      const rows = db.prepare(
        'SELECT * FROM save_history WHERE project_id = ? ORDER BY timestamp DESC LIMIT 20'
      ).all(projectId)
      return { success: true, data: rows }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
