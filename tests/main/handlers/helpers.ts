/**
 * Shared helpers for IPC handler smoke tests.
 *
 * The handlers in `src/main/ipc/` call `ipcMain.handle()` at import time
 * (well, when their `registerXHandlers()` is invoked). To exercise them in
 * Vitest we mock the `electron` module so each handler registration is
 * captured into a map, and we drive each handler by invoking it from that
 * map directly — no real Electron required.
 *
 * Every test file follows roughly this shape:
 *
 *   import { vi } from 'vitest'
 *   import { setupHandlerHarness } from './helpers'
 *   const harness = setupHandlerHarness()
 *   // ... vi.mock(...) for any other modules a handler needs ...
 *   const { registerFooHandlers } = await import('../../../src/main/ipc/foo.handler')
 *   beforeEach(() => { harness.reset(); registerFooHandlers() })
 *   it('returns envelope', async () => {
 *     const res = await harness.invoke('foo:bar', { ... })
 *     expect(res).toHaveProperty('success')
 *   })
 */

import { vi } from 'vitest'

export interface HandlerHarness {
  /** Captured handler functions keyed by IPC channel name. */
  handlers: Map<string, (event: unknown, ...args: unknown[]) => unknown>
  /** Captured `ipcMain.on` listeners keyed by channel name. */
  listeners: Map<string, Array<(event: unknown, ...args: unknown[]) => void>>
  /** Invoke a captured handler with a fake event object. */
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  /** Drop captured handlers — call before each re-registration. */
  reset: () => void
}

/**
 * Install a vi.mock('electron') that captures handlers into the returned
 * harness. Call this at the top of a test file BEFORE importing the handler
 * module under test (Vitest hoists `vi.mock` calls so order is preserved).
 *
 * NOTE: vi.mock('electron') must be invoked unconditionally at the
 * top-level of each test file, because Vitest hoists it. The actual
 * factory function references the module-level `getCurrentHarness()`
 * via a closure that we set right after.
 */
let currentHarness: HandlerHarness | null = null

export function getCurrentHarness(): HandlerHarness {
  if (!currentHarness) {
    throw new Error('Test harness not initialised — call setupHandlerHarness() first')
  }
  return currentHarness
}

export function setupHandlerHarness(): HandlerHarness {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const listeners = new Map<string, Array<(event: unknown, ...args: unknown[]) => void>>()

  const harness: HandlerHarness = {
    handlers,
    listeners,
    invoke: async (channel: string, ...args: unknown[]) => {
      const fn = handlers.get(channel)
      if (!fn) {
        throw new Error(`No handler registered for channel "${channel}"`)
      }
      return fn(makeFakeEvent(), ...args)
    },
    reset: () => {
      handlers.clear()
      listeners.clear()
    },
  }

  currentHarness = harness
  return harness
}

/** Fake event passed to every handler. Carries a no-op `sender`. */
export function makeFakeEvent(): { sender: { id: number; send: () => void } } {
  return {
    sender: {
      id: 1,
      send: () => {},
    },
  }
}

/**
 * The default electron-module mock factory. Apply it in test files like:
 *
 *   vi.mock('electron', () => makeElectronMock())
 *
 * It looks up the active harness at call-time so each handler registration
 * lands in the right map — even when Vitest hoists the mock above the
 * harness setup call.
 */
export function makeElectronMock(): Record<string, unknown> {
  return {
    ipcMain: {
      handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
        getCurrentHarness().handlers.set(channel, fn)
      },
      removeHandler: (channel: string) => {
        getCurrentHarness().handlers.delete(channel)
      },
      on: (channel: string, fn: (event: unknown, ...args: unknown[]) => void) => {
        const list = getCurrentHarness().listeners.get(channel) ?? []
        list.push(fn)
        getCurrentHarness().listeners.set(channel, list)
      },
      removeAllListeners: (channel?: string) => {
        if (channel) getCurrentHarness().listeners.delete(channel)
        else getCurrentHarness().listeners.clear()
      },
    },
    app: {
      getPath: (_name: string) => '/tmp/testnizer-test',
      getVersion: () => '0.0.0-test',
      getName: () => 'Testnizer',
      quit: () => {},
      on: () => {},
    },
    dialog: {
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
      showMessageBox: vi.fn(async () => ({ response: 0 })),
    },
    BrowserWindow: {
      getFocusedWindow: () => null,
      getAllWindows: () => [],
      fromWebContents: () => null,
      fromId: () => null,
    },
    shell: {
      openExternal: vi.fn(async () => undefined),
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: Buffer) => b.toString('utf-8'),
    },
  }
}

// ─── Database setup helpers ───────────────────────────────────────────

import Database from 'better-sqlite3'

/**
 * Create an in-memory better-sqlite3 instance with the full Testnizer
 * schema applied. Used by handlers that touch the DB.
 *
 * This intentionally duplicates the migration code rather than importing
 * `initDatabase()` because the real init calls `app.getPath('userData')`
 * — which we can avoid entirely with an in-memory DB.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_SQL)
  return db
}

const SCHEMA_SQL = `
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
    save_mode TEXT NOT NULL DEFAULT 'local',
    local_path TEXT,
    icon_emoji TEXT,
    icon_color TEXT DEFAULT '#2D5FA0',
    display_name TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    branch_id TEXT,
    auth TEXT,
    pre_script TEXT,
    post_script TEXT
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
    updated_at INTEGER NOT NULL,
    branch_id TEXT
  );

  CREATE TABLE endpoint_cases (
    id TEXT PRIMARY KEY,
    endpoint_id TEXT NOT NULL,
    name TEXT NOT NULL,
    params TEXT,
    headers TEXT,
    body TEXT,
    auth TEXT,
    assertions TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
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
    updated_at INTEGER NOT NULL,
    branch_id TEXT
  );

  CREATE TABLE environments (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    project_id TEXT,
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
    project_id TEXT,
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

  CREATE TABLE scheduled_tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    endpoint_ids TEXT NOT NULL DEFAULT '[]',
    folder_id TEXT,
    environment_id TEXT,
    interval_value INTEGER NOT NULL DEFAULT 60,
    interval_unit TEXT NOT NULL DEFAULT 'minutes',
    delay_ms INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    next_run_at INTEGER,
    created_at INTEGER NOT NULL,
    schedule_type TEXT DEFAULT 'interval',
    schedule_time TEXT,
    schedule_days TEXT,
    schedule_cron TEXT,
    suite_id TEXT
  );

  CREATE TABLE runner_history (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    environment_name TEXT,
    source TEXT NOT NULL DEFAULT 'Runner',
    iterations INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    total_endpoints INTEGER NOT NULL DEFAULT 0,
    passed_endpoints INTEGER NOT NULL DEFAULT 0,
    failed_endpoints INTEGER NOT NULL DEFAULT 0,
    total_tests INTEGER NOT NULL DEFAULT 0,
    passed_tests INTEGER NOT NULL DEFAULT 0,
    failed_tests INTEGER NOT NULL DEFAULT 0,
    skipped_tests INTEGER NOT NULL DEFAULT 0,
    avg_resp_time INTEGER NOT NULL DEFAULT 0,
    results_json TEXT,
    started_at INTEGER NOT NULL,
    folder_name TEXT,
    source_label TEXT,
    scheduled_task_id TEXT
  );

  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT,
    password_hash TEXT,
    salt TEXT,
    avatar_url TEXT,
    auth_provider TEXT NOT NULL DEFAULT 'local',
    provider_id TEXT,
    recovery_email TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE certificates (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'client',
    host TEXT,
    crt_path TEXT,
    key_path TEXT,
    pfx_path TEXT,
    passphrase TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE test_suites (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE test_suite_folders (
    id TEXT PRIMARY KEY,
    suite_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    auth TEXT,
    pre_script TEXT,
    post_script TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE test_suite_items (
    id TEXT PRIMARY KEY,
    suite_id TEXT NOT NULL,
    folder_id TEXT,
    protocol TEXT NOT NULL,
    name TEXT NOT NULL,
    method TEXT,
    url TEXT,
    request_schema TEXT NOT NULL,
    assertions TEXT,
    source_endpoint_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE mock_servers (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    host TEXT NOT NULL DEFAULT '127.0.0.1',
    port INTEGER NOT NULL,
    base_path TEXT NOT NULL DEFAULT '',
    auto_start INTEGER NOT NULL DEFAULT 0,
    cors_enabled INTEGER NOT NULL DEFAULT 0,
    cors_allow_origins TEXT NOT NULL DEFAULT '*',
    cors_allow_methods TEXT NOT NULL DEFAULT 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
    cors_allow_headers TEXT NOT NULL DEFAULT '*',
    cors_allow_credentials INTEGER NOT NULL DEFAULT 0,
    cors_max_age INTEGER NOT NULL DEFAULT 600,
    auth_config TEXT NOT NULL DEFAULT '{"type":"none"}',
    failure_config TEXT NOT NULL DEFAULT '{"enabled":false,"probability":0,"mode":"status","status":500,"timeoutMs":30000}',
    rate_limit_config TEXT NOT NULL DEFAULT '{"enabled":false,"requestsPerWindow":100,"windowMs":60000,"scope":"ip"}',
    echo_enabled INTEGER NOT NULL DEFAULT 0,
    proxy_enabled INTEGER NOT NULL DEFAULT 0,
    proxy_target TEXT NOT NULL DEFAULT '',
    proxy_record INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE mock_endpoints (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'GET',
    path TEXT NOT NULL,
    path_mode TEXT NOT NULL DEFAULT 'exact',
    description TEXT NOT NULL DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    auth_override TEXT NOT NULL DEFAULT '',
    schema_validation TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE mock_responses (
    id TEXT PRIMARY KEY,
    endpoint_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    status_code INTEGER NOT NULL DEFAULT 200,
    headers TEXT NOT NULL DEFAULT '[]',
    body_type TEXT NOT NULL DEFAULT 'json',
    body TEXT NOT NULL DEFAULT '',
    delay_ms INTEGER NOT NULL DEFAULT 0,
    condition TEXT NOT NULL DEFAULT '{"type":"always"}',
    script TEXT NOT NULL DEFAULT '',
    response_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1
  );
`

/** Insert a workspace and return its id. */
export function seedWorkspace(db: Database.Database, name = 'WS1'): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO workspaces (id, name, color, created_at, updated_at)
     VALUES (?, ?, '#000', ?, ?)`,
  ).run(id, name, now, now)
  return id
}

/** Insert a project tied to a workspace. */
export function seedProject(
  db: Database.Database,
  workspaceId: string,
  name = 'Project 1',
): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, type, sort_order, save_mode, created_at, updated_at)
     VALUES (?, ?, ?, 'http', 0, 'local', ?, ?)`,
  ).run(id, workspaceId, name, now, now)
  return id
}
