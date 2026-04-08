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
  `)
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
