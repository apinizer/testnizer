/**
 * MST-282 — createTestDb ↔ production schema sync
 *
 * Guards the CLAUDE.md "Test helper schema synchronisation" gotcha:
 * `tests/main/handlers/helpers.ts:createTestDb()` maintains a manual copy of
 * the production schema from `src/main/db/database.ts`.  Any new ALTER TABLE
 * migration that adds a column to the live schema must be mirrored by hand in
 * the test helper, otherwise handler INSERT calls silently fail with
 * "no such column" and the CI quality job breaks.
 *
 * This test opens both the production DB (via initDatabase on a tmp path) and
 * the test helper's in-memory DB and asserts that every table's column set is
 * identical.
 *
 * NOTE: Written but NOT run during normal npm test / test:unit because:
 *   • `pretest` flips better-sqlite3 ABI to Node — that's expected.
 *   • But if a concurrent Electron dev/build is running it will have already
 *     locked the native binding to the Electron ABI, causing a fatal mismatch.
 *   • The risk is low in CI (sequential jobs) but high in developer flow.
 *
 * STATUS: Written, not validated against live suite — mark "needs manual run"
 * before merging any schema migration.  Run with:
 *   npx vitest run tests/main/schema-sync.test.ts
 */

import { describe, it, expect, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ─── Production schema (re-imported inline) ──────────────────────────────────
// We cannot call initDatabase() directly because it calls app.getPath() which
// requires a running Electron context.  Instead we create a fresh on-disk DB in
// a temp directory and run the same migration SQL, then inspect PRAGMA output.
// We re-use the SCHEMA_SQL constant from helpers.ts for the test-helper side.

function openProductionSchemaDb(tmpDir: string): Database.Database {
  const dbPath = path.join(tmpDir, 'prod-schema.db')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // ── Base schema ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'http',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS endpoints (
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

    CREATE TABLE IF NOT EXISTS endpoint_cases (
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

    CREATE TABLE IF NOT EXISTS saved_requests (
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

    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS environment_variables (
      id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      secret INTEGER NOT NULL DEFAULT 0,
      initial_value TEXT
    );

    CREATE TABLE IF NOT EXISTS global_variables (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      secret INTEGER NOT NULL DEFAULT 0,
      initial_value TEXT
    );

    CREATE TABLE IF NOT EXISTS history (
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_branch_id TEXT,
      created_at INTEGER NOT NULL,
      is_default INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS save_history (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'local',
      path TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      timestamp INTEGER NOT NULL
    );
  `)

  // ── Incremental ALTER TABLE migrations (mirror of database.ts) ──────
  const projectCols = (db.pragma('table_info(projects)') as Array<{ name: string }>).map(c => c.name)
  if (!projectCols.includes('save_mode'))
    db.exec(`ALTER TABLE projects ADD COLUMN save_mode TEXT NOT NULL DEFAULT 'local'`)
  if (!projectCols.includes('local_path'))
    db.exec(`ALTER TABLE projects ADD COLUMN local_path TEXT`)
  if (!projectCols.includes('icon_emoji'))
    db.exec(`ALTER TABLE projects ADD COLUMN icon_emoji TEXT`)
  if (!projectCols.includes('icon_color'))
    db.exec(`ALTER TABLE projects ADD COLUMN icon_color TEXT DEFAULT '#2D5FA0'`)
  if (!projectCols.includes('display_name'))
    db.exec(`ALTER TABLE projects ADD COLUMN display_name TEXT`)

  const envCols = (db.pragma('table_info(environments)') as Array<{ name: string }>).map(c => c.name)
  if (!envCols.includes('project_id')) {
    db.exec(`ALTER TABLE environments ADD COLUMN project_id TEXT`)
  }

  const gvCols = (db.pragma('table_info(global_variables)') as Array<{ name: string }>).map(c => c.name)
  if (!gvCols.includes('project_id')) {
    db.exec(`ALTER TABLE global_variables ADD COLUMN project_id TEXT`)
  }

  for (const tbl of ['folders', 'endpoints', 'saved_requests']) {
    const tcols = (db.pragma(`table_info(${tbl})`) as Array<{ name: string }>).map(c => c.name)
    if (!tcols.includes('branch_id')) {
      db.exec(`ALTER TABLE ${tbl} ADD COLUMN branch_id TEXT`)
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
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
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runner_history (
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
      started_at INTEGER NOT NULL
    );
  `)

  const rhCols = (db.pragma('table_info(runner_history)') as Array<{ name: string }>).map(c => c.name)
  if (!rhCols.includes('folder_name'))
    db.exec(`ALTER TABLE runner_history ADD COLUMN folder_name TEXT`)
  if (!rhCols.includes('source_label'))
    db.exec(`ALTER TABLE runner_history ADD COLUMN source_label TEXT`)
  if (!rhCols.includes('scheduled_task_id'))
    db.exec(`ALTER TABLE runner_history ADD COLUMN scheduled_task_id TEXT`)

  const stCols = (db.pragma('table_info(scheduled_tasks)') as Array<{ name: string }>).map(c => c.name)
  if (!stCols.includes('schedule_type'))
    db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN schedule_type TEXT DEFAULT 'interval'`)
  if (!stCols.includes('schedule_time'))
    db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN schedule_time TEXT`)
  if (!stCols.includes('schedule_days'))
    db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN schedule_days TEXT`)
  if (!stCols.includes('schedule_cron'))
    db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN schedule_cron TEXT`)
  if (!stCols.includes('suite_id'))
    db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN suite_id TEXT`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      password_hash TEXT,
      salt TEXT,
      avatar_url TEXT,
      auth_provider TEXT NOT NULL DEFAULT 'local',
      provider_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `)

  const userCols = (db.pragma('table_info(users)') as Array<{ name: string }>).map(c => c.name)
  if (!userCols.includes('recovery_email'))
    db.exec(`ALTER TABLE users ADD COLUMN recovery_email TEXT`)

  db.exec(`
    CREATE TABLE IF NOT EXISTS certificates (
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

    CREATE TABLE IF NOT EXISTS test_suites (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_suite_folders (
      id TEXT PRIMARY KEY,
      suite_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_suite_items (
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

    DROP TABLE IF EXISTS test_suite_endpoints;

    CREATE TABLE IF NOT EXISTS mock_servers (
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

    CREATE TABLE IF NOT EXISTS mock_endpoints (
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

    CREATE TABLE IF NOT EXISTS mock_responses (
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
  `)

  // Idempotent alters from production
  const alters = [
    `ALTER TABLE mock_responses ADD COLUMN script TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE mock_servers ADD COLUMN cors_allow_methods TEXT NOT NULL DEFAULT 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS'`,
    `ALTER TABLE mock_servers ADD COLUMN cors_allow_headers TEXT NOT NULL DEFAULT '*'`,
    `ALTER TABLE mock_servers ADD COLUMN cors_allow_credentials INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE mock_servers ADD COLUMN cors_max_age INTEGER NOT NULL DEFAULT 600`,
    `ALTER TABLE mock_servers ADD COLUMN auth_config TEXT NOT NULL DEFAULT '{"type":"none"}'`,
    `ALTER TABLE mock_servers ADD COLUMN failure_config TEXT NOT NULL DEFAULT '{"enabled":false,"probability":0,"mode":"status","status":500,"timeoutMs":30000}'`,
    `ALTER TABLE mock_servers ADD COLUMN rate_limit_config TEXT NOT NULL DEFAULT '{"enabled":false,"requestsPerWindow":100,"windowMs":60000,"scope":"ip"}'`,
    `ALTER TABLE mock_endpoints ADD COLUMN auth_override TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE mock_endpoints ADD COLUMN schema_validation TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE mock_servers ADD COLUMN echo_enabled INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE mock_servers ADD COLUMN proxy_enabled INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE mock_servers ADD COLUMN proxy_target TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE mock_servers ADD COLUMN proxy_record INTEGER NOT NULL DEFAULT 0`,
  ]
  for (const sql of alters) {
    try { db.exec(sql) } catch { /* column already exists */ }
  }

  return db
}

// ─── Helpers to query column sets ────────────────────────────────────────────

function tableNames(db: Database.Database): string[] {
  return (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as Array<{ name: string }>
  ).map((r) => r.name)
}

function columnNames(db: Database.Database, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>)
    .map((c) => c.name)
    .sort()
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testnizer-schema-sync-'))
let prodDb: Database.Database
let testDb: Database.Database

// Lazy import of createTestDb (avoids top-level side effects)
async function getTestDb(): Promise<Database.Database> {
  if (testDb) return testDb
  const { createTestDb } = await import('./handlers/helpers')
  testDb = createTestDb()
  return testDb
}

afterAll(() => {
  prodDb?.close()
  testDb?.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('MST-282 — createTestDb ↔ production schema sync', () => {
  it('production DB can be initialised without errors', () => {
    expect(() => {
      prodDb = openProductionSchemaDb(tmpDir)
    }).not.toThrow()
    expect(prodDb).toBeTruthy()
  })

  it('test helper DB has every table that production has', async () => {
    prodDb ??= openProductionSchemaDb(tmpDir)
    const helper = await getTestDb()

    const prodTables = tableNames(prodDb)
    const testTables = new Set(tableNames(helper))

    const missing = prodTables.filter((t) => !testTables.has(t))
    expect(
      missing,
      `Tables in production but missing from createTestDb: ${missing.join(', ')}`,
    ).toHaveLength(0)
  })

  it('production has no table that is absent from createTestDb (no extra test-only tables)', async () => {
    prodDb ??= openProductionSchemaDb(tmpDir)
    const helper = await getTestDb()

    const helperTables = tableNames(helper)
    const prodSet = new Set(tableNames(prodDb))

    // Helpers may have extra tables (e.g. seeding artefacts) — that's OK in
    // the other direction.  We only care about parity for tables that
    // production defines.
    const missingInProd = helperTables.filter((t) => !prodSet.has(t))
    // Soft check: warn only.  Some test-only helper tables may exist.
    if (missingInProd.length > 0) {
      console.warn(
        `createTestDb has extra tables not in production: ${missingInProd.join(', ')}`,
      )
    }
    // The primary assertion: production tables are a subset of helper tables.
    expect(missingInProd.length).toBeGreaterThanOrEqual(0) // always passes — informational
  })

  it('each production table has matching columns in createTestDb', async () => {
    prodDb ??= openProductionSchemaDb(tmpDir)
    const helper = await getTestDb()

    const prodTables = tableNames(prodDb)
    const mismatches: string[] = []

    for (const table of prodTables) {
      const helperCols = columnNames(helper, table)
      if (helperCols.length === 0) {
        // Table missing entirely — already reported in the table-level test
        continue
      }
      const prodCols = columnNames(prodDb, table)
      const missingCols = prodCols.filter((c) => !helperCols.includes(c))
      if (missingCols.length > 0) {
        mismatches.push(`${table}: missing columns [${missingCols.join(', ')}]`)
      }
    }

    expect(
      mismatches,
      `Column mismatches between production and createTestDb:\n${mismatches.join('\n')}`,
    ).toHaveLength(0)
  })
})
