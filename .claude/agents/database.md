# Database Agent

## Rol
`better-sqlite3` ile SQLite katmanını implement edersin. Tüm DB işlemleri main process'te.

## Kapsam
`src/main/db/`

---

## Init (`database.ts`)

```typescript
import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'

const DB_PATH = path.join(app.getPath('userData'), 'apinizer-tester.db')

export function initDatabase(): Database.Database {
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')    // crash protection
  db.pragma('foreign_keys = ON')
  db.pragma('cache_size = -64000')   // 64MB cache
  runMigrations(db)
  return db
}
```

---

## Schema (Migration 1–11)

```sql
-- 1: workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 2: projects
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'http',
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 3: folders
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  parent_id TEXT REFERENCES folders(id),
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

-- 4: endpoints
CREATE TABLE IF NOT EXISTS endpoints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  folder_id TEXT REFERENCES folders(id),
  name TEXT NOT NULL,
  description TEXT,
  protocol TEXT NOT NULL DEFAULT 'http',
  method TEXT,
  path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'developing',
  request_schema TEXT,    -- JSON
  response_schemas TEXT,  -- JSON array
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 5: endpoint_cases
CREATE TABLE IF NOT EXISTS endpoint_cases (
  id TEXT PRIMARY KEY,
  endpoint_id TEXT NOT NULL REFERENCES endpoints(id),
  name TEXT NOT NULL,
  params TEXT,          -- JSON
  headers TEXT,         -- JSON
  body TEXT,            -- JSON
  auth TEXT,            -- JSON
  assertions TEXT,      -- JSON
  is_default INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- 6: saved_requests
CREATE TABLE IF NOT EXISTS saved_requests (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id),
  folder_id TEXT REFERENCES folders(id),
  name TEXT NOT NULL,
  protocol TEXT NOT NULL DEFAULT 'http',
  method TEXT,
  url TEXT NOT NULL DEFAULT '',
  params TEXT,          -- JSON
  headers TEXT,         -- JSON
  body TEXT,            -- JSON
  auth TEXT,            -- JSON
  pre_script TEXT,
  post_script TEXT,
  assertions TEXT,      -- JSON
  metadata TEXT,        -- JSON (wsdl_url, proto_path etc.)
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 7: environments
CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  is_active INTEGER DEFAULT 0,
  variables TEXT NOT NULL DEFAULT '[]',  -- JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 8: global_variables
CREATE TABLE IF NOT EXISTS global_variables (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  key TEXT NOT NULL,
  value TEXT,
  enabled INTEGER DEFAULT 1,
  secret INTEGER DEFAULT 0
);

-- 9: history
CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id),
  project_id TEXT REFERENCES projects(id),
  endpoint_id TEXT,
  protocol TEXT,
  method TEXT,
  url TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  request_snapshot TEXT,   -- JSON
  response_snapshot TEXT,  -- JSON
  executed_at INTEGER NOT NULL
);

-- 10: schema_version
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

-- 11: settings (tek satır)
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  settings TEXT NOT NULL DEFAULT '{}'  -- JSON
);
```

---

## Repository Pattern

```typescript
// workspace.repo.ts — örnek
export class WorkspaceRepository {
  constructor(private db: Database.Database) {}

  findAll(): Workspace[] {
    return this.db.prepare(
      'SELECT * FROM workspaces ORDER BY created_at ASC'
    ).all() as Workspace[]
  }

  findById(id: string): Workspace | null {
    return this.db.prepare(
      'SELECT * FROM workspaces WHERE id = ?'
    ).get(id) as Workspace | null
  }

  create(data: Omit<Workspace, 'id' | 'created_at' | 'updated_at'>): Workspace {
    const id = crypto.randomUUID()
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO workspaces (id, name, description, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.description ?? null, data.color ?? null, now, now)
    return this.findById(id)!
  }

  update(id: string, patch: Partial<Workspace>): Workspace {
    const entries = Object.entries(patch)
      .filter(([k]) => !['id','created_at','updated_at'].includes(k))
    const sets = entries.map(([k]) => `${k} = ?`).join(', ')
    this.db.prepare(`UPDATE workspaces SET ${sets}, updated_at = ? WHERE id = ?`)
      .run(...entries.map(([,v]) => v), Date.now(), id)
    return this.findById(id)!
  }

  delete(id: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM history WHERE workspace_id = ?').run(id)
      this.db.prepare('DELETE FROM global_variables WHERE workspace_id = ?').run(id)
      this.db.prepare('DELETE FROM environments WHERE workspace_id = ?').run(id)
      // projects cascade ayrı repo'da
      this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
    })()
  }
}
```

---

## JSON Serde Helper

```typescript
// Serialize (DB'ye yazarken)
function serializeRequest(req: Partial<SavedRequest>): Record<string, any> {
  return {
    ...req,
    params:     req.params     ? JSON.stringify(req.params)     : '[]',
    headers:    req.headers    ? JSON.stringify(req.headers)    : '[]',
    body:       req.body       ? JSON.stringify(req.body)       : null,
    auth:       req.auth       ? JSON.stringify(req.auth)       : '{"type":"none"}',
    assertions: req.assertions ? JSON.stringify(req.assertions) : '[]',
    metadata:   req.metadata   ? JSON.stringify(req.metadata)   : '{}',
  }
}

// Deserialize (DB'den okurken)
function deserializeRequest(row: any): SavedRequest {
  return {
    ...row,
    params:     JSON.parse(row.params     || '[]'),
    headers:    JSON.parse(row.headers    || '[]'),
    body:       row.body       ? JSON.parse(row.body)       : undefined,
    auth:       JSON.parse(row.auth       || '{"type":"none"}'),
    assertions: JSON.parse(row.assertions || '[]'),
    metadata:   JSON.parse(row.metadata   || '{}'),
  }
}
```

---

## History Pruning

```typescript
function pruneHistory(db: Database.Database, workspaceId: string, limit: number): void {
  db.prepare(`
    DELETE FROM history
    WHERE workspace_id = ?
    AND id NOT IN (
      SELECT id FROM history WHERE workspace_id = ?
      ORDER BY executed_at DESC LIMIT ?
    )
  `).run(workspaceId, workspaceId, limit)
}
// Her INSERT'ten sonra çağrılır
```

---

## Singleton Pattern

```typescript
// database.ts
let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) throw new Error('Database not initialized')
  return _db
}

export function initDatabase(): Database.Database {
  _db = new Database(DB_PATH)
  // ... pragmas + migrations
  return _db
}
```

---

## Kurallar

- Renderer'dan hiçbir zaman DB erişimi yapılmaz
- Prepared statements zorunlu — string interpolasyon yasak (SQL injection)
- Return tipleri tam TypeScript — raw `any` row yok
- Transaction: multi-step write'larda her zaman
- Her repo bağımsız test scriptiyle test edilir
- ID: `crypto.randomUUID()`, Timestamp: `Date.now()` (ms)
