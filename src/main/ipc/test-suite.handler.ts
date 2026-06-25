import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../db/database'
import {
  createItem,
  updateItem,
  deleteItem,
  getItemById,
  listItemsBySuite,
  moveItem,
  bulkInsertItems,
  type CreateTestSuiteItemInput,
} from '../db/test-suite-item.repo'
import {
  createFolder,
  renameFolder,
  deleteFolder,
  getFolderById,
  listFoldersBySuite,
  moveFolder,
  isDescendantOf,
  updateFolderSettings,
} from '../db/test-suite-folder.repo'
import {
  getEndpointById,
  getSavedRequestById,
  getCasesByEndpoint,
  type EndpointCaseRow,
} from '../db/endpoint.repo'

interface TestSuiteRow {
  id: string
  project_id: string
  name: string
  description: string | null
  sort_order: number
  created_at: number
  updated_at: number
}

/**
 * Returns `name` if there is no test suite with that exact name in the project;
 * otherwise appends " (1)", " (2)"… until the result is unique. Used by the
 * create and import flows so re-importing an exported suite produces a clearly
 * disambiguated copy instead of two suites with identical names (v1.3.1 §5.9).
 */
export function ensureUniqueSuiteName(
  db: ReturnType<typeof getDb>,
  projectId: string,
  baseName: string,
): string {
  const taken = new Set<string>(
    (
      db.prepare('SELECT name FROM test_suites WHERE project_id = ?').all(projectId) as Array<{
        name: string
      }>
    ).map((r) => r.name),
  )
  if (!taken.has(baseName)) return baseName
  for (let i = 1; i < 1000; i++) {
    const candidate = `${baseName} (${i})`
    if (!taken.has(candidate)) return candidate
  }
  // Astronomically unlikely; fall through with a uuid suffix rather than loop forever.
  return `${baseName} (${randomUUID().slice(0, 8)})`
}

/**
 * Build a unified `request_schema` JSON string from either an endpoint
 * (whose `request_schema` is already a JSON blob produced by the importer)
 * or a saved_request (whose request fields live in separate columns).
 * Returns null when the source can't be resolved — the caller treats this
 * as a hard error.
 */
export interface SnapshotForSuite {
  protocol: string
  name: string
  method: string | null
  url: string | null
  request_schema: string
  assertions: string | null
  source_endpoint_id: string
}

/**
 * Exported so the project-export importer (save.handler.ts) can turn
 * Postman / Insomnia endpoints into self-contained test_suite_items rows
 * instead of writing into the dropped `test_suite_endpoints` junction.
 */
export function snapshotEndpointForSuite(endpointId: string): SnapshotForSuite | null {
  const ep = getEndpointById(endpointId)
  if (ep) {
    // Endpoint serialises *template* shape (URL pattern, body schema) into
    // request_schema, but per-environment values — params, headers, body,
    // auth, assertions — live on endpoint_cases. The "default" case is
    // what the APIs editor reads on tab open. Without it the snapshot is
    // empty of real values and test suite items show blank request panes
    // even though the source endpoint had fully-populated requests
    // (v1.4.4 §4: "bazı environmtlar gelmemiş gözüküyor").
    const cases = getCasesByEndpoint(ep.id)
    const defaultCase: EndpointCaseRow | undefined =
      cases.find((c) => c.is_default === 1) ?? cases[0]

    const baseSchema = tryParseJSON<Record<string, unknown>>(ep.request_schema, {})
    const mergedSchema: Record<string, unknown> = { ...baseSchema }
    if (defaultCase) {
      // Overlay each case column only when it carries an actual value.
      // `endpoint_cases.{params,headers,body,auth}` are nullable; an
      // unconditional `tryParseJSON(null, [])` would emit the empty
      // fallback and clobber whatever the endpoint's `request_schema`
      // already had at the template level — an OpenAPI-imported endpoint
      // with populated `headers` but a default case row whose `headers`
      // column was never set would lose its template headers in the
      // snapshot. Keep base values when the case is silent.
      if (defaultCase.params !== null) {
        mergedSchema.params = tryParseJSON(defaultCase.params, [])
      }
      if (defaultCase.headers !== null) {
        mergedSchema.headers = tryParseJSON(defaultCase.headers, [])
      }
      if (defaultCase.body !== null) {
        mergedSchema.body = tryParseJSON(defaultCase.body, { type: 'none', content: '' })
      }
      if (defaultCase.auth !== null) {
        mergedSchema.auth = tryParseJSON(defaultCase.auth, { type: 'none' })
      }
    }
    return {
      protocol: ep.protocol || 'http',
      name: ep.name,
      method: ep.method,
      url: ep.path ?? null,
      request_schema: JSON.stringify(mergedSchema),
      assertions: defaultCase?.assertions ?? null,
      source_endpoint_id: ep.id,
    }
  }
  const sr = getSavedRequestById(endpointId)
  if (sr) {
    // saved_requests has individual columns; rebuild a schema object that
    // mirrors what the renderer's request store expects on load.
    const schema = {
      params: tryParseJSON(sr.params, []),
      headers: tryParseJSON(sr.headers, []),
      body: tryParseJSON(sr.body, { type: 'none', content: '' }),
      auth: tryParseJSON(sr.auth, { type: 'none' }),
      preScript: sr.pre_script ?? '',
      postScript: sr.post_script ?? '',
    }
    return {
      protocol: sr.protocol || 'http',
      name: sr.name,
      method: sr.method,
      url: sr.url ?? null,
      request_schema: JSON.stringify(schema),
      assertions: sr.assertions ?? null,
      source_endpoint_id: sr.id,
    }
  }
  return null
}

function tryParseJSON<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function registerTestSuiteHandlers(): void {
  // ─── List suites for a project ────────────────────────────
  ipcMain.handle('testSuite:list', async (_event, projectId: string) => {
    try {
      const db = getDb()
      const suites = db
        .prepare('SELECT * FROM test_suites WHERE project_id = ? ORDER BY sort_order, created_at')
        .all(projectId) as TestSuiteRow[]
      return { success: true, data: suites }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Get single suite ─────────────────────────────────────
  ipcMain.handle('testSuite:get', async (_event, suiteId: string) => {
    try {
      const db = getDb()
      const suite = db.prepare('SELECT * FROM test_suites WHERE id = ?').get(suiteId) as
        | TestSuiteRow
        | undefined
      if (!suite) return { success: false, error: 'Test suite not found' }
      return { success: true, data: suite }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Create suite ─────────────────────────────────────────
  ipcMain.handle(
    'testSuite:create',
    async (_event, payload: { project_id: string; name: string; description?: string }) => {
      try {
        const db = getDb()
        const id = randomUUID()
        const now = Date.now()
        // De-duplicate suite names within a project. v1.3.1 §5.9 reported that
        // re-importing an export of the same suite produced two suites with
        // identical names sitting side-by-side in the sidebar. Auto-append
        // " (1)", " (2)"… until the name is unique so the user can still see
        // both copies, but the names disambiguate clearly.
        const uniqueName = ensureUniqueSuiteName(db, payload.project_id, payload.name)
        db.prepare(
          `INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?)`,
        ).run(id, payload.project_id, uniqueName, payload.description || null, now, now)
        const suite = db.prepare('SELECT * FROM test_suites WHERE id = ?').get(id) as TestSuiteRow
        return { success: true, data: suite }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Update suite ─────────────────────────────────────────
  ipcMain.handle(
    'testSuite:update',
    async (
      _event,
      id: string,
      payload: { name?: string; description?: string; sort_order?: number },
    ) => {
      try {
        const db = getDb()
        const now = Date.now()
        db.prepare(
          `UPDATE test_suites SET
             name = COALESCE(?, name),
             description = COALESCE(?, description),
             sort_order = COALESCE(?, sort_order),
             updated_at = ?
           WHERE id = ?`,
        ).run(
          payload.name ?? null,
          payload.description ?? null,
          payload.sort_order ?? null,
          now,
          id,
        )
        const suite = db.prepare('SELECT * FROM test_suites WHERE id = ?').get(id) as TestSuiteRow
        return { success: true, data: suite }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Duplicate suite ──────────────────────────────────────
  // Clones the suite metadata + every test_suite_item (full request snapshots)
  // and every test_suite_folder underneath. Items are independent copies —
  // editing one suite never bleeds into another.
  ipcMain.handle('testSuite:duplicate', async (_event, id: string) => {
    try {
      const db = getDb()
      const original = db
        .prepare('SELECT id, project_id, name, description FROM test_suites WHERE id = ?')
        .get(id) as
        | { id: string; project_id: string; name: string; description: string | null }
        | undefined
      if (!original) return { success: false, error: 'Suite not found' }

      const newId = randomUUID()
      const now = Date.now()
      const maxOrder = db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) as mx FROM test_suites WHERE project_id = ?')
        .get(original.project_id) as { mx: number }

      const txn = db.transaction(() => {
        db.prepare(
          `INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          newId,
          original.project_id,
          // De-dupe so duplicating twice yields "X (copy)", "X (copy) (1)", …
          // rather than two suites named identically.
          ensureUniqueSuiteName(db, original.project_id, `${original.name} (copy)`),
          original.description,
          maxOrder.mx + 1,
          now,
          now,
        )

        // Copy folders first (depth-first by parent so child ids map onto
        // freshly-minted parent ids). The mapping table is built as we go.
        const folderIdMap = new Map<string, string>()
        const folders = listFoldersBySuite(id)
        // Insert roots first, then nest as we encounter children.
        const orderedFolders = [...folders].sort((a, b) => {
          if (a.parent_id === null && b.parent_id !== null) return -1
          if (b.parent_id === null && a.parent_id !== null) return 1
          return a.sort_order - b.sort_order
        })
        const insertFolderStmt = db.prepare(
          `INSERT INTO test_suite_folders
             (id, suite_id, parent_id, name, sort_order, auth, pre_script, post_script, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        for (const f of orderedFolders) {
          const newFolderId = randomUUID()
          folderIdMap.set(f.id, newFolderId)
          const newParent = f.parent_id ? (folderIdMap.get(f.parent_id) ?? null) : null
          insertFolderStmt.run(
            newFolderId,
            newId,
            newParent,
            f.name,
            f.sort_order,
            f.auth ?? null,
            f.pre_script ?? null,
            f.post_script ?? null,
            now,
          )
        }

        // Copy items, remapping folder_id through the map.
        const items = listItemsBySuite(id)
        const insertItemStmt = db.prepare(
          `INSERT INTO test_suite_items
             (id, suite_id, folder_id, protocol, name, method, url,
              request_schema, assertions, source_endpoint_id,
              sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        for (const it of items) {
          const newItemId = randomUUID()
          const newFolderId = it.folder_id ? (folderIdMap.get(it.folder_id) ?? null) : null
          insertItemStmt.run(
            newItemId,
            newId,
            newFolderId,
            it.protocol,
            it.name,
            it.method,
            it.url,
            it.request_schema,
            it.assertions,
            it.source_endpoint_id,
            it.sort_order,
            now,
            now,
          )
        }
      })
      txn()

      const row = db.prepare('SELECT * FROM test_suites WHERE id = ?').get(newId)
      return { success: true, data: row }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Delete suite ─────────────────────────────────────────
  ipcMain.handle('testSuite:delete', async (_event, id: string) => {
    try {
      const db = getDb()
      // FK cascade handles folders + items
      db.prepare('DELETE FROM test_suites WHERE id = ?').run(id)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── List items + folders in a suite ──────────────────────
  // Single round-trip for the TestsPanel tree render. Channel name is kept
  // as `testSuite:listEndpoints` for backward compat with renderer code that
  // hasn't migrated yet; payload now carries folders alongside items.
  ipcMain.handle('testSuite:listEndpoints', async (_event, suiteId: string) => {
    try {
      const items = listItemsBySuite(suiteId)
      const folders = listFoldersBySuite(suiteId)
      return { success: true, data: { items, folders } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Import endpoints from APIs tree as copies ────────────
  // Reads each endpoint/saved_request, snapshots its full request shape,
  // and writes one test_suite_items row per input. `source_endpoint_id` is
  // populated for traceability but the bond is severed afterwards — editing
  // the original endpoint never propagates to the suite item.
  ipcMain.handle(
    'testSuite:importEndpoints',
    async (
      _event,
      payload: { suite_id: string; endpoint_ids: string[]; folder_id?: string | null },
    ) => {
      try {
        const db = getDb()
        const suite = db
          .prepare('SELECT project_id FROM test_suites WHERE id = ?')
          .get(payload.suite_id) as { project_id: string } | undefined
        if (!suite) return { success: false, error: 'Suite not found' }

        const folderId = payload.folder_id ?? null
        const rows: CreateTestSuiteItemInput[] = []
        const rejected: string[] = []
        for (const eid of payload.endpoint_ids ?? []) {
          if (typeof eid !== 'string' || !eid) continue
          const snap = snapshotEndpointForSuite(eid)
          if (!snap) {
            rejected.push(eid)
            continue
          }
          rows.push({
            suite_id: payload.suite_id,
            folder_id: folderId,
            protocol: snap.protocol,
            name: snap.name,
            method: snap.method,
            url: snap.url,
            request_schema: snap.request_schema,
            assertions: snap.assertions,
            source_endpoint_id: snap.source_endpoint_id,
          })
        }
        const inserted = bulkInsertItems(rows)
        return {
          success: true,
          data: { added: inserted.length, rejected: rejected.length, rejectedIds: rejected },
        }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Test Suite Items: CRUD + move ────────────────────────

  ipcMain.handle('testSuiteItem:list', async (_event, suiteId: string) => {
    try {
      return { success: true, data: listItemsBySuite(suiteId) }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('testSuiteItem:get', async (_event, id: string) => {
    try {
      const row = getItemById(id)
      if (!row) return { success: false, error: 'Item not found' }
      return { success: true, data: row }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(
    'testSuiteItem:create',
    async (
      _event,
      input: {
        suite_id: string
        folder_id?: string | null
        protocol: string
        name: string
        method?: string | null
        url?: string | null
        request_schema?: string
        assertions?: string | null
      },
    ) => {
      try {
        const row = createItem({
          suite_id: input.suite_id,
          folder_id: input.folder_id ?? null,
          protocol: input.protocol,
          name: input.name,
          method: input.method ?? null,
          url: input.url ?? null,
          // Start every new item with an empty schema so the renderer's
          // RequestEditor has something deterministic to deserialise.
          request_schema: input.request_schema ?? '{}',
          assertions: input.assertions ?? null,
        })
        return { success: true, data: row }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle(
    'testSuiteItem:update',
    async (
      _event,
      id: string,
      patch: {
        name?: string
        folder_id?: string | null
        protocol?: string
        method?: string | null
        url?: string | null
        request_schema?: string
        assertions?: string | null
      },
    ) => {
      try {
        const row = updateItem(id, patch)
        if (!row) return { success: false, error: 'Item not found' }
        return { success: true, data: row }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('testSuiteItem:delete', async (_event, id: string) => {
    try {
      const ok = deleteItem(id)
      return { success: true, data: { deleted: ok } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(
    'testSuiteItem:move',
    async (
      _event,
      payload: {
        id: string
        targetSuiteId: string
        targetFolderId: string | null
        insertBeforeId: string | null
      },
    ) => {
      try {
        // Guard: target folder must exist within the same suite.
        if (payload.targetFolderId) {
          const f = getFolderById(payload.targetFolderId)
          if (!f) return { success: false, error: 'Target folder not found' }
          if (f.suite_id !== payload.targetSuiteId) {
            return { success: false, error: 'Cannot move item across suites' }
          }
        }
        const row = moveItem(payload)
        if (!row) return { success: false, error: 'Item not found' }
        return { success: true, data: row }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // Back-compat alias for `testSuite:removeEndpoint` — old renderer code
  // calls this; route to the new item-delete path.
  ipcMain.handle(
    'testSuite:removeEndpoint',
    async (_event, payload: { suite_id: string; endpoint_id: string }) => {
      try {
        // The old payload referred to endpoint_id but the new model has
        // suite item ids; treat it as the item id.
        const ok = deleteItem(payload.endpoint_id)
        return { success: true, data: ok }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Test Suite Folders: CRUD + move ──────────────────────

  ipcMain.handle(
    'testSuiteFolder:create',
    async (_event, input: { suite_id: string; parent_id?: string | null; name: string }) => {
      try {
        const row = createFolder(input)
        return { success: true, data: row }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle('testSuiteFolder:rename', async (_event, id: string, name: string) => {
    try {
      const row = renameFolder(id, name)
      if (!row) return { success: false, error: 'Folder not found' }
      return { success: true, data: row }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('testSuiteFolder:delete', async (_event, id: string) => {
    try {
      const ok = deleteFolder(id)
      return { success: true, data: { deleted: ok } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // Folder-level auth + cascade scripts (mirrors the APIs `folder:update` path).
  ipcMain.handle('testSuiteFolder:getSettings', async (_event, id: string) => {
    try {
      const row = getFolderById(id)
      if (!row) return { success: false, error: 'Folder not found' }
      return {
        success: true,
        data: { auth: row.auth, pre_script: row.pre_script, post_script: row.post_script },
      }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(
    'testSuiteFolder:updateSettings',
    async (
      _event,
      id: string,
      settings: { auth?: string | null; pre_script?: string | null; post_script?: string | null },
    ) => {
      try {
        const row = updateFolderSettings(id, settings)
        if (!row) return { success: false, error: 'Folder not found' }
        return { success: true, data: row }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  ipcMain.handle(
    'testSuiteFolder:move',
    async (
      _event,
      payload: {
        id: string
        targetSuiteId: string
        targetParentId: string | null
        insertBeforeId: string | null
      },
    ) => {
      try {
        // Prevent folder cycles: dropping a folder into itself or one of
        // its descendants would orphan an entire subtree.
        if (payload.targetParentId && isDescendantOf(payload.targetParentId, payload.id)) {
          return { success: false, error: 'Cannot move a folder into itself or its descendants' }
        }
        const row = moveFolder(payload)
        if (!row) return { success: false, error: 'Folder not found' }
        return { success: true, data: row }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )
}
