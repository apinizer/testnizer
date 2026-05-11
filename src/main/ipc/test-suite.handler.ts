import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getDb } from '../db/database'
import { projectIdOfRunnable } from '../lib/ownership'

interface TestSuiteRow {
  id: string
  project_id: string
  name: string
  description: string | null
  sort_order: number
  created_at: number
  updated_at: number
}

interface EndpointRow {
  id: string
  name: string
  method: string | null
  path: string
  protocol: string
  folder_id: string | null
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
    async (
      _event,
      payload: {
        project_id: string
        name: string
        description?: string
      },
    ) => {
      try {
        const db = getDb()
        const id = randomUUID()
        const now = Date.now()
        db.prepare(
          `
        INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, ?, ?)
      `,
        ).run(id, payload.project_id, payload.name, payload.description || null, now, now)
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
      payload: {
        name?: string
        description?: string
        sort_order?: number
      },
    ) => {
      try {
        const db = getDb()
        const now = Date.now()
        db.prepare(
          `
        UPDATE test_suites SET
          name = COALESCE(?, name),
          description = COALESCE(?, description),
          sort_order = COALESCE(?, sort_order),
          updated_at = ?
        WHERE id = ?
      `,
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
  // Clones a suite + every test_suite_endpoints junction row pointing at it.
  // The underlying endpoint records are NOT duplicated — both suites share
  // the same endpoint references, which is consistent with the existing
  // remove/add semantics.
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
          `
          INSERT INTO test_suites (id, project_id, name, description, sort_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          newId,
          original.project_id,
          `${original.name} (copy)`,
          original.description,
          maxOrder.mx + 1,
          now,
          now,
        )

        const junctions = db
          .prepare(
            'SELECT endpoint_id, sort_order FROM test_suite_endpoints WHERE suite_id = ? ORDER BY sort_order',
          )
          .all(id) as Array<{ endpoint_id: string; sort_order: number }>
        const ins = db.prepare(
          'INSERT INTO test_suite_endpoints (id, suite_id, endpoint_id, sort_order) VALUES (?, ?, ?, ?)',
        )
        for (const j of junctions) ins.run(randomUUID(), newId, j.endpoint_id, j.sort_order)
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
      db.prepare('DELETE FROM test_suites WHERE id = ?').run(id)
      return { success: true, data: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── List endpoints in a suite ────────────────────────────
  // The `test_suite_endpoints.endpoint_id` column can reference either an
  // imported endpoint (`endpoints` table) or a manually saved request
  // (`saved_requests` table). UNION both so the suite UI surfaces every
  // item regardless of its origin — without this, manual requests are
  // invisible from the suite view (Bug 7).
  ipcMain.handle('testSuite:listEndpoints', async (_event, suiteId: string) => {
    try {
      const db = getDb()
      const rows = db
        .prepare(
          `
        SELECT e.id, e.name, e.method, e.path, e.protocol, e.folder_id,
               f.name AS folder_name, tse.sort_order
        FROM test_suite_endpoints tse
        JOIN endpoints e ON e.id = tse.endpoint_id
        LEFT JOIN folders f ON f.id = e.folder_id
        WHERE tse.suite_id = ?
        UNION ALL
        SELECT r.id, r.name, r.method, r.url AS path, r.protocol, r.folder_id,
               f.name AS folder_name, tse.sort_order
        FROM test_suite_endpoints tse
        JOIN saved_requests r ON r.id = tse.endpoint_id
        LEFT JOIN folders f ON f.id = r.folder_id
        WHERE tse.suite_id = ?
        ORDER BY sort_order
      `,
        )
        .all(suiteId, suiteId) as (EndpointRow & {
        folder_name: string | null
        sort_order: number
      })[]
      return { success: true, data: rows }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // ─── Add endpoints to a suite ─────────────────────────────
  ipcMain.handle(
    'testSuite:addEndpoints',
    async (
      _event,
      payload: {
        suite_id: string
        endpoint_ids: string[]
      },
    ) => {
      try {
        const db = getDb()
        // Verify the suite exists + capture its project_id so we can refuse
        // foreign-project endpoint references (which would later run-time
        // fail as "Endpoint not found" with no signal to the user).
        const suite = db
          .prepare('SELECT project_id FROM test_suites WHERE id = ?')
          .get(payload.suite_id) as { project_id: string } | undefined
        if (!suite) return { success: false, error: 'Suite not found' }

        // Filter to ids that actually exist + belong to the suite's project.
        // INSERT OR IGNORE alone would just silently drop bad refs; this
        // surfaces the count so the renderer can warn the user.
        const valid: string[] = []
        const rejected: string[] = []
        for (const eid of payload.endpoint_ids) {
          if (typeof eid !== 'string' || !eid) continue
          const owner = projectIdOfRunnable(eid)
          if (owner && owner === suite.project_id) {
            valid.push(eid)
          } else {
            rejected.push(eid)
          }
        }

        const maxOrder = db
          .prepare(
            'SELECT COALESCE(MAX(sort_order), -1) as mx FROM test_suite_endpoints WHERE suite_id = ?',
          )
          .get(payload.suite_id) as { mx: number }
        let order = maxOrder.mx + 1

        const stmt = db.prepare(`
        INSERT OR IGNORE INTO test_suite_endpoints (id, suite_id, endpoint_id, sort_order)
        VALUES (?, ?, ?, ?)
      `)

        for (const eid of valid) {
          stmt.run(randomUUID(), payload.suite_id, eid, order++)
        }

        return {
          success: true,
          data: { added: valid.length, rejected: rejected.length, rejectedIds: rejected },
        }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )

  // ─── Remove endpoint from a suite ─────────────────────────
  ipcMain.handle(
    'testSuite:removeEndpoint',
    async (
      _event,
      payload: {
        suite_id: string
        endpoint_id: string
      },
    ) => {
      try {
        const db = getDb()
        db.prepare('DELETE FROM test_suite_endpoints WHERE suite_id = ? AND endpoint_id = ?').run(
          payload.suite_id,
          payload.endpoint_id,
        )
        return { success: true, data: true }
      } catch (e) {
        return { success: false, error: (e as Error).message }
      }
    },
  )
}
