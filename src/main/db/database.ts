import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.')
  }
  return db
}

export function initDatabase(): void {
  const dbPath = join(app.getPath('userData'), 'testnizer.db')
  db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)
  seedDefaults(db)
}

function runMigrations(database: Database.Database): void {
  database.exec(`
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
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
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
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
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
      created_at INTEGER NOT NULL,
      FOREIGN KEY (endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
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
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS environments (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS environment_variables (
      id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      secret INTEGER NOT NULL DEFAULT 0,
      initial_value TEXT,
      FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS global_variables (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '',
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      secret INTEGER NOT NULL DEFAULT 0,
      initial_value TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
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

    CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_folders_project ON folders(project_id);
    CREATE INDEX IF NOT EXISTS idx_endpoints_project ON endpoints(project_id);
    CREATE INDEX IF NOT EXISTS idx_endpoints_folder ON endpoints(folder_id);
    CREATE INDEX IF NOT EXISTS idx_endpoint_cases_endpoint ON endpoint_cases(endpoint_id);
    CREATE INDEX IF NOT EXISTS idx_saved_requests_project ON saved_requests(project_id);
    CREATE INDEX IF NOT EXISTS idx_environments_workspace ON environments(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_env_vars_environment ON environment_variables(environment_id);
    CREATE INDEX IF NOT EXISTS idx_global_vars_workspace ON global_variables(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_history_workspace ON history(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_history_executed_at ON history(executed_at);

    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      parent_branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      is_default INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_branches_project ON branches(project_id);

    CREATE TABLE IF NOT EXISTS save_history (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'local',
      path TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_save_history_project ON save_history(project_id);
  `)

  // ─── Incremental migrations ─────────────────────────────────
  // Add save settings columns to projects (safe to re-run)
  const cols = database.pragma('table_info(projects)') as Array<{ name: string }>
  const colNames = cols.map((c) => c.name)
  if (!colNames.includes('save_mode')) {
    database.exec(`ALTER TABLE projects ADD COLUMN save_mode TEXT NOT NULL DEFAULT 'local'`)
  }
  if (!colNames.includes('local_path')) {
    database.exec(`ALTER TABLE projects ADD COLUMN local_path TEXT`)
  }
  if (!colNames.includes('icon_emoji')) {
    database.exec(`ALTER TABLE projects ADD COLUMN icon_emoji TEXT`)
  }
  if (!colNames.includes('icon_color')) {
    database.exec(`ALTER TABLE projects ADD COLUMN icon_color TEXT DEFAULT '#2D5FA0'`)
  }
  if (!colNames.includes('display_name')) {
    database.exec(`ALTER TABLE projects ADD COLUMN display_name TEXT`)
  }

  // Scope environments to a project. Postman has environments per workspace
  // but the user wants per-project isolation. NULL project_id means legacy
  // workspace-scoped (shown only when no project is active).
  const envCols = database.pragma('table_info(environments)') as Array<{ name: string }>
  const envColNames = envCols.map((c) => c.name)
  if (!envColNames.includes('project_id')) {
    database.exec(`ALTER TABLE environments ADD COLUMN project_id TEXT`)
    database.exec(`CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id)`)
  }

  // Same for global_variables: per-project scope for globals that should only
  // apply within one project.
  const gvCols = database.pragma('table_info(global_variables)') as Array<{ name: string }>
  const gvColNames = gvCols.map((c) => c.name)
  if (!gvColNames.includes('project_id')) {
    database.exec(`ALTER TABLE global_variables ADD COLUMN project_id TEXT`)
    database.exec(
      `CREATE INDEX IF NOT EXISTS idx_global_vars_project ON global_variables(project_id)`,
    )
  }

  // Scheduled tasks table
  database.exec(`
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
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_project ON scheduled_tasks(project_id);
  `)

  // Runner history table
  database.exec(`
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
      started_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_runner_history_project ON runner_history(project_id);
    CREATE INDEX IF NOT EXISTS idx_runner_history_started ON runner_history(started_at);
  `)

  // Add folder_name column to runner_history if missing
  const rhCols = database.pragma('table_info(runner_history)') as Array<{ name: string }>
  const rhColNames = rhCols.map((c) => c.name)
  if (!rhColNames.includes('folder_name')) {
    database.exec(`ALTER TABLE runner_history ADD COLUMN folder_name TEXT`)
  }
  if (!rhColNames.includes('source_label')) {
    database.exec(`ALTER TABLE runner_history ADD COLUMN source_label TEXT`)
  }
  // scheduled_task_id ties runner_history rows back to the scheduled_tasks
  // row that produced them. We used to filter by source_label match on the
  // task name, which broke as soon as a task was renamed or deleted (the
  // history orphaned with no way to look it up). A dedicated FK column is
  // the durable answer.
  if (!rhColNames.includes('scheduled_task_id')) {
    database.exec(`ALTER TABLE runner_history ADD COLUMN scheduled_task_id TEXT`)
    database.exec(
      `CREATE INDEX IF NOT EXISTS idx_runner_history_scheduled_task ON runner_history(scheduled_task_id)`,
    )
  }

  // scheduled_tasks: richer scheduling than "every N {minutes/hours/days}".
  // schedule_type:
  //   'interval' (default, legacy): every interval_value × interval_unit
  //   'daily': fires at schedule_time (HH:MM) every day
  //   'weekly': fires at schedule_time on the weekdays in schedule_days
  //            (JSON array of 0–6, Sunday = 0 matching Date#getDay)
  //   'cron': fires per schedule_cron expression (basic 5-field)
  // schedule_time / schedule_days / schedule_cron are nullable for legacy
  // rows. The migration leaves existing tasks on 'interval' so they keep
  // running unchanged.
  const stCols = database.pragma('table_info(scheduled_tasks)') as Array<{ name: string }>
  const stColNames = stCols.map((c) => c.name)
  if (!stColNames.includes('schedule_type')) {
    database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN schedule_type TEXT DEFAULT 'interval'`)
  }
  if (!stColNames.includes('schedule_time')) {
    database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN schedule_time TEXT`)
  }
  if (!stColNames.includes('schedule_days')) {
    database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN schedule_days TEXT`)
  }
  if (!stColNames.includes('schedule_cron')) {
    database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN schedule_cron TEXT`)
  }
  if (!stColNames.includes('suite_id')) {
    database.exec(`ALTER TABLE scheduled_tasks ADD COLUMN suite_id TEXT`)
  }

  // ─── Auth tables ─────────────────────────────────────────
  database.exec(`
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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `)

  // Add recovery_email column to users (safe to re-run)
  const userCols = database.pragma('table_info(users)') as Array<{ name: string }>
  const userColNames = userCols.map((c) => c.name)
  if (!userColNames.includes('recovery_email')) {
    database.exec(`ALTER TABLE users ADD COLUMN recovery_email TEXT`)
  }

  // ─── Certificates (per-project: CA + Client) ──────────────
  database.exec(`
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
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_certificates_project ON certificates(project_id);
  `)

  // ─── Test Suites ──────────────────────────────────────────
  // Self-contained item model: suites own folders + items (full request
  // snapshots), and items are decoupled from APIs-tree endpoints once
  // imported. This replaced the old `test_suite_endpoints` junction; the
  // legacy table is dropped below as part of the same migration so
  // dev-mode users boot up clean.
  database.exec(`
    CREATE TABLE IF NOT EXISTS test_suites (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_test_suites_project ON test_suites(project_id);

    -- Folders that organise items inside a suite. Optional parent_id for
    -- nesting. Cascading delete: dropping a suite or parent folder removes
    -- everything beneath.
    CREATE TABLE IF NOT EXISTS test_suite_folders (
      id TEXT PRIMARY KEY,
      suite_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (suite_id) REFERENCES test_suites(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES test_suite_folders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tsf_suite ON test_suite_folders(suite_id);
    CREATE INDEX IF NOT EXISTS idx_tsf_parent ON test_suite_folders(parent_id);

    -- One row per inline request in a suite. Carries the entire request
    -- (URL, method, headers, body, scripts, assertions) so a suite is fully
    -- self-describing and survives deletion of the original endpoint it was
    -- imported from. source_endpoint_id is advisory only -- no FK.
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
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (suite_id) REFERENCES test_suites(id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES test_suite_folders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_tsi_suite ON test_suite_items(suite_id);
    CREATE INDEX IF NOT EXISTS idx_tsi_folder ON test_suite_items(folder_id);
    CREATE INDEX IF NOT EXISTS idx_tsi_suite_sort ON test_suite_items(suite_id, sort_order);

    -- One-shot drop of the legacy junction. Dev phase only — production
    -- migration would have moved rows into test_suite_items first; here we
    -- just discard. Idempotent.
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
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mock_servers_project ON mock_servers(project_id);

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
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (server_id) REFERENCES mock_servers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mock_endpoints_server ON mock_endpoints(server_id);

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
      enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (endpoint_id) REFERENCES mock_endpoints(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mock_responses_endpoint ON mock_responses(endpoint_id);
  `)

  // Idempotent column additions for existing installs. Each ALTER is wrapped
  // in its own try/catch — SQLite errors when a column already exists.
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
    try {
      database.exec(sql)
    } catch {
      // Column already exists — fine.
    }
  }
}

function seedDefaults(database: Database.Database): void {
  const count = database.prepare('SELECT COUNT(*) as cnt FROM workspaces').get() as { cnt: number }
  if (count.cnt > 0) return

  const now = Date.now()
  const workspaceId = randomUUID()
  const projectId = randomUUID()

  database
    .prepare(
      `
    INSERT INTO workspaces (id, name, description, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .run(workspaceId, 'Default Workspace', 'Your first workspace', '#2D5FA0', now, now)

  database
    .prepare(
      `
    INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(projectId, workspaceId, 'My Project', 'Default project', 'http', 0, now, now)
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
