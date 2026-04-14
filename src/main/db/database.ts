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
  const dbPath = join(app.getPath('userData'), 'apinizer.db')
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
    database.exec(`ALTER TABLE projects ADD COLUMN icon_color TEXT DEFAULT '#7c73e6'`)
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
    database.exec(`CREATE INDEX IF NOT EXISTS idx_global_vars_project ON global_variables(project_id)`)
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
}

function seedDefaults(database: Database.Database): void {
  const count = database.prepare('SELECT COUNT(*) as cnt FROM workspaces').get() as { cnt: number }
  if (count.cnt > 0) return

  const now = Date.now()
  const workspaceId = randomUUID()
  const projectId = randomUUID()

  database.prepare(`
    INSERT INTO workspaces (id, name, description, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(workspaceId, 'Default Workspace', 'Your first workspace', '#7c73e6', now, now)

  database.prepare(`
    INSERT INTO projects (id, workspace_id, name, description, type, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, workspaceId, 'My Project', 'Default project', 'http', 0, now, now)
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}
