/**
 * MST-281 P2 — Schema migration forward compatibility
 *
 * Simulates an "old app" DB (base schema, no incremental migrations) and then
 * relaunches with the full app binary.  The migration layer in database.ts
 * uses `PRAGMA table_info` + `ALTER TABLE` to add columns incrementally, so
 * the app must start cleanly and all IPC channels that touch migrated columns
 * must work without error.
 *
 * Requires: `npm run build` first (uses the compiled Electron app).
 */
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
// Use Node's built-in SQLite (node:sqlite) for test-side DB seeding. The
// better-sqlite3 native binding in node_modules is compiled against the
// Electron ABI (for the packaged app), so importing it directly in the
// Playwright/Node test process throws "compiled against a different Node.js
// version". node:sqlite has no such ABI coupling.
import { DatabaseSync } from 'node:sqlite'
import { electronLaunchOptions } from '../../helpers/electron-env'

const mainPath = path.resolve(__dirname, '../../../../out/main/index.js')
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

async function launchApp(
  userDataDir: string,
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch(electronLaunchOptions(mainPath, userDataDir))
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}

/**
 * Write a minimal "v0" SQLite database (base schema only, no ALTER TABLE
 * columns) into userDataDir/testnizer.db.  This simulates what an old app
 * version would have left behind before the incremental migrations were added.
 */
function seedOldSchemaDb(userDataDir: string): void {
  const dbPath = path.join(userDataDir, 'testnizer.db')
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')

  // Base schema — deliberately omitting columns added by ALTER TABLE migrations:
  //   projects: save_mode, local_path, icon_emoji, icon_color, display_name
  //   environments: project_id
  //   global_variables: project_id
  //   folders/endpoints/saved_requests: branch_id
  //   runner_history: folder_name, source_label, scheduled_task_id
  //   scheduled_tasks: schedule_type, schedule_time, schedule_days, schedule_cron, suite_id
  //   users: recovery_email
  db.exec(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'http',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE folders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE endpoints (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      folder_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      protocol TEXT NOT NULL DEFAULT 'http',
      method TEXT,
      path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'developing',
      request_schema TEXT,
      response_schemas TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE saved_requests (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      folder_id TEXT,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL DEFAULT 'http',
      method TEXT,
      url TEXT NOT NULL,
      params TEXT NOT NULL DEFAULT '[]',
      headers TEXT NOT NULL DEFAULT '[]',
      body TEXT,
      auth TEXT,
      pre_script TEXT,
      post_script TEXT,
      assertions TEXT NOT NULL DEFAULT '[]',
      metadata TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE environments (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE environment_variables (
      id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      secret INTEGER NOT NULL DEFAULT 0,
      initial_value TEXT
    );

    CREATE TABLE global_variables (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      secret INTEGER NOT NULL DEFAULT 0,
      initial_value TEXT
    );

    CREATE TABLE history (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      project_id TEXT,
      endpoint_id TEXT,
      protocol TEXT NOT NULL DEFAULT 'http',
      method TEXT,
      url TEXT NOT NULL,
      status_code INTEGER,
      duration_ms INTEGER,
      request_snapshot TEXT NOT NULL DEFAULT '{}',
      response_snapshot TEXT,
      executed_at INTEGER NOT NULL
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE branches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_branch_id TEXT,
      created_at INTEGER NOT NULL,
      is_default INTEGER DEFAULT 0
    );

    CREATE TABLE save_history (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'local',
      path TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      timestamp INTEGER NOT NULL
    );
  `)

  // Seed a workspace and project so bootstrapWorkbench finds an existing state
  const now = Date.now()
  const wsId = crypto.randomUUID()
  const projId = crypto.randomUUID()
  db.prepare(
    `INSERT INTO workspaces (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(wsId, 'Old Workspace', '#000', now, now)
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, type, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, 'http', 0, ?, ?)`,
  ).run(projId, wsId, 'Old Project', now, now)

  db.close()
}

test.describe('Tur1 — DB schema migration forward [MST-281]', () => {
  test('MST-281 app runs migrations on old-schema DB without crashing', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-migration-'))
    let app: ElectronApplication | undefined

    try {
      // Write a v0 (pre-migration) DB into userDataDir
      seedOldSchemaDb(userDataDir)

      // Launch the full app — it should migrate automatically
      const { app: a, window } = await launchApp(userDataDir)
      app = a

      // IPC bridge must come up (migrations happened without crashing)
      await window.waitForFunction(
        () => !!(window as unknown as Window & { api?: { eula?: unknown } }).api?.eula,
        { timeout: 45_000 },
      )

      // All IPC channels that touch migrated columns must work
      const wsRes = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean; data?: unknown[] }> } }
        }
        return w.api?.workspace?.list()
      })
      expect(wsRes?.success).toBe(true)
      expect((wsRes?.data as unknown[]).length).toBeGreaterThan(0)
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })

  test('MST-281 migrated columns are writable after migration', async () => {
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Build artifact not found: ${mainPath}. Run "npm run build" first.`)
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-migration2-'))
    let app: ElectronApplication | undefined

    try {
      seedOldSchemaDb(userDataDir)

      const { app: a, window } = await launchApp(userDataDir)
      app = a

      await window.waitForFunction(
        () => !!(window as unknown as Window & { api?: { eula?: unknown } }).api?.eula,
        { timeout: 45_000 },
      )

      // Accept EULA if shown
      const eulaGate = window.getByTestId('eula-gate')
      if (await eulaGate.isVisible().catch(() => false)) {
        await window.getByTestId('eula-accept-checkbox').check()
        await window.getByTestId('eula-accept-btn').click()
        await eulaGate.waitFor({ state: 'hidden', timeout: 15_000 })
      }

      // Get workspace and project IDs from the seeded old DB
      const wsId = await window.evaluate(async () => {
        const w = window as unknown as Window & {
          api?: { workspace?: { list: () => Promise<{ success: boolean; data?: Array<{ id: string }> }> } }
        }
        return (await w.api?.workspace?.list())?.data?.[0]?.id ?? ''
      })
      const projectId = await window.evaluate(async (wid) => {
        const w = window as unknown as Window & {
          api?: {
            project?: { list: (id: string) => Promise<{ success: boolean; data?: Array<{ id: string }> }> }
          }
        }
        return (await w.api?.project?.list(wid))?.data?.[0]?.id ?? ''
      }, wsId)

      // Write to a migrated column: projects.save_mode (added by ALTER TABLE)
      const updateRes = await window.evaluate(async (pid) => {
        const w = window as unknown as Window & {
          api?: { project?: { update: (id: string, p: unknown) => Promise<{ success: boolean; error?: string }> } }
        }
        return w.api?.project?.update(pid, { save_mode: 'local' })
      }, projectId)
      expect(updateRes?.success).toBe(true)

      // Create a saved request that uses branch_id (migrated column)
      const reqName = `MigratedReq-${uid()}`
      const reqRes = await window.evaluate(
        async ({ pid, name }) => {
          const w = window as unknown as Window & {
            api?: {
              savedRequest?: { create: (p: unknown) => Promise<{ success: boolean; data?: { id: string } }> }
            }
          }
          return w.api?.savedRequest?.create({
            project_id: pid,
            name,
            method: 'GET',
            url: 'http://127.0.0.1/migration-test',
            // branch_id is a migrated column — null is fine
            branch_id: null,
          })
        },
        { pid: projectId, name: reqName },
      )
      expect(reqRes?.success).toBe(true)
      expect(reqRes?.data?.id?.length).toBeGreaterThan(0)

      // Create a branch (uses the branches table that was in base schema)
      const branchRes = await window.evaluate(async (pid) => {
        const w = window as unknown as Window & {
          api?: {
            branch?: { create: (p: unknown) => Promise<{ success: boolean; data?: { id: string } }> }
          }
        }
        return w.api?.branch?.create({ project_id: pid, name: 'migrated-branch' })
      }, projectId)
      expect(branchRes?.success).toBe(true)
    } finally {
      if (app) await app.close().catch(() => {})
      if (fs.existsSync(userDataDir)) fs.rmSync(userDataDir, { recursive: true, force: true })
    }
  })
})
