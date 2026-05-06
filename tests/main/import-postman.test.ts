/**
 * Postman v2.1 import + export end-to-end tests.
 *
 * Mocks `electron` and the database module so importPostman / exportAsPostman
 * can be exercised against an in-memory SQLite DB without an Electron runtime.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

// ─── Module mocks ──────────────────────────────────────────
// `electron` is imported at module-load time by the handler — stub a minimal
// surface so vitest can resolve it under Node.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') },
}))

// In-memory SQLite — the schema is a strict subset of the production schema
// covering the tables touched by importPostman / exportAsPostman.
let memDb: Database.Database

vi.mock('../../src/main/db/database', () => ({
  getDb: () => memDb,
}))

// Imported AFTER mocks are registered so the handler picks up the stubs.
let importPostman: typeof import('../../src/main/ipc/import-export.handler').importPostman
let exportAsPostman: typeof import('../../src/main/ipc/import-export.handler').exportAsPostman

beforeEach(async () => {
  memDb = new Database(':memory:')
  memDb.exec(`
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
  `)
  // seed a project to import into
  memDb
    .prepare(
      `INSERT INTO projects (id, workspace_id, name, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run('proj-1', 'ws-1', 'Test Project', 'a test project', Date.now(), Date.now())

  // dynamic import after mocks are registered
  const mod = await import('../../src/main/ipc/import-export.handler')
  importPostman = mod.importPostman
  exportAsPostman = mod.exportAsPostman
})

// ─── Fixture helpers ───────────────────────────────────────

function buildRealisticCollection(): Record<string, unknown> {
  return {
    info: {
      name: 'Petstore Sample',
      description: 'Realistic v2.1 fixture',
      _postman_id: 'pid-realistic',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'baseUrl', value: 'https://api.example.com' },
      { key: 'apiVersion', value: 'v1' },
    ],
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{collectionToken}}', type: 'string' }],
    },
    event: [
      {
        listen: 'prerequest',
        script: { exec: ['// collection-level pre', 'pm.environment.set("k","v");'] },
      },
    ],
    item: [
      {
        name: 'Health',
        request: {
          method: 'GET',
          url: '{{baseUrl}}/health',
        },
      },
      {
        name: 'Pets',
        item: [
          {
            name: 'List Pets',
            event: [
              {
                listen: 'test',
                script: {
                  exec: [
                    'pm.test("status is 200", () => pm.response.to.have.status(200));',
                  ],
                },
              },
            ],
            request: {
              method: 'GET',
              header: [{ key: 'Accept', value: 'application/json' }],
              url: {
                raw: '{{baseUrl}}/{{apiVersion}}/pets?limit=10',
                host: ['{{baseUrl}}'],
                path: ['{{apiVersion}}', 'pets'],
                query: [{ key: 'limit', value: '10' }],
              },
            },
          },
          {
            name: 'Create Pet',
            event: [
              {
                listen: 'prerequest',
                script: { exec: 'pm.environment.set("petId", 42);' },
              },
              {
                listen: 'test',
                script: {
                  exec: [
                    'pm.test("created", () => {',
                    '  pm.expect(pm.response.code).to.be.oneOf([200, 201]);',
                    '});',
                  ],
                },
              },
            ],
            request: {
              method: 'POST',
              header: [{ key: 'Content-Type', value: 'application/json' }],
              url: '{{baseUrl}}/pets',
              body: {
                mode: 'raw',
                raw: '{"name":"rex","kind":"dog"}',
                options: { raw: { language: 'json' } },
              },
              // per-request override
              auth: {
                type: 'basic',
                basic: [
                  { key: 'username', value: 'admin' },
                  { key: 'password', value: 'secret' },
                ],
              },
            },
          },
          {
            name: 'Nested',
            item: [
              {
                name: 'Search Pets',
                request: {
                  method: 'GET',
                  url: {
                    raw: '{{baseUrl}}/pets/search?q={{searchTerm}}',
                    host: ['{{baseUrl}}'],
                    path: ['pets', 'search'],
                    query: [{ key: 'q', value: '{{searchTerm}}' }],
                  },
                },
              },
            ],
          },
        ],
      },
      {
        name: 'Submit Form',
        request: {
          method: 'POST',
          url: 'https://api.example.com/submit',
          body: {
            mode: 'urlencoded',
            urlencoded: [
              { key: 'a', value: '1' },
              { key: 'b', value: '2', disabled: true },
            ],
          },
        },
      },
      {
        name: 'Upload',
        request: {
          method: 'POST',
          url: 'https://api.example.com/upload',
          body: {
            mode: 'formdata',
            formdata: [
              { key: 'title', value: 'demo', type: 'text' },
              { key: 'file', type: 'file', src: '/tmp/demo.bin' },
            ],
          },
        },
      },
      {
        name: 'Binary Upload',
        request: {
          method: 'PUT',
          url: 'https://api.example.com/blob',
          body: { mode: 'file', file: { src: '/tmp/raw.bin' } },
        },
      },
    ],
  }
}

// ─── Tests ─────────────────────────────────────────────────

describe('importPostman — realistic v2.1 collection', () => {
  it('imports nested folders, multiple methods, scripts, auth, and bodies', async () => {
    const collection = buildRealisticCollection()
    const result = await importPostman('proj-1', JSON.stringify(collection))

    expect(result.success).toBe(true)
    // 4 root-level requests (Health, Submit Form, Upload, Binary Upload) +
    // 2 inside /Pets (List Pets, Create Pet) + 1 inside /Pets/Nested (Search Pets) = 7
    expect(result.endpointCount).toBe(7)
    // /Pets, /Pets/Nested = 2 folders
    expect(result.folderCount).toBe(2)
    expect(result.suggestedEnvVars).toEqual({
      baseUrl: 'https://api.example.com',
      apiVersion: 'v1',
    })
  })

  it('persists pre-request scripts under preScript', async () => {
    const collection = buildRealisticCollection()
    await importPostman('proj-1', JSON.stringify(collection))

    const ep = memDb
      .prepare('SELECT request_schema FROM endpoints WHERE name = ?')
      .get('Create Pet') as { request_schema: string }
    const schema = JSON.parse(ep.request_schema)
    expect(schema.preScript).toContain('pm.environment.set("petId", 42)')
  })

  it('persists test scripts under postScript', async () => {
    const collection = buildRealisticCollection()
    await importPostman('proj-1', JSON.stringify(collection))

    const ep = memDb
      .prepare('SELECT request_schema FROM endpoints WHERE name = ?')
      .get('Create Pet') as { request_schema: string }
    const schema = JSON.parse(ep.request_schema)
    expect(schema.postScript).toContain('pm.test')
    expect(schema.postScript).toContain('pm.expect')
  })

  it('honours per-request auth override over collection-level auth', async () => {
    const collection = buildRealisticCollection()
    await importPostman('proj-1', JSON.stringify(collection))

    const create = JSON.parse(
      (memDb
        .prepare('SELECT request_schema FROM endpoints WHERE name = ?')
        .get('Create Pet') as { request_schema: string }).request_schema,
    )
    expect(create.auth).toEqual({
      type: 'basic',
      basic: { username: 'admin', password: 'secret' },
    })

    // List Pets has no per-request auth → falls back to collection-level bearer
    const list = JSON.parse(
      (memDb
        .prepare('SELECT request_schema FROM endpoints WHERE name = ?')
        .get('List Pets') as { request_schema: string }).request_schema,
    )
    expect(list.auth.type).toBe('bearer')
    expect((list.auth.bearer as { token: string }).token).toBe('{{collectionToken}}')
  })

  it('preserves {{baseUrl}} variable substitution in URLs', async () => {
    const collection = buildRealisticCollection()
    await importPostman('proj-1', JSON.stringify(collection))

    const list = JSON.parse(
      (memDb
        .prepare('SELECT request_schema FROM endpoints WHERE name = ?')
        .get('List Pets') as { request_schema: string }).request_schema,
    )
    expect(list.url).toContain('{{baseUrl}}')
    expect(list.url).toContain('{{apiVersion}}')
  })

  it('imports body variants: json, urlencoded, form-data text/file, binary', async () => {
    const collection = buildRealisticCollection()
    await importPostman('proj-1', JSON.stringify(collection))

    const get = (name: string) =>
      JSON.parse(
        (memDb
          .prepare('SELECT request_schema FROM endpoints WHERE name = ?')
          .get(name) as { request_schema: string }).request_schema,
      )

    expect(get('Create Pet').body).toEqual({
      type: 'json',
      content: '{"name":"rex","kind":"dog"}',
    })
    const submit = get('Submit Form').body
    expect(submit.type).toBe('urlencoded')
    expect(submit.urlEncoded[0]).toMatchObject({ key: 'a', value: '1', enabled: true })
    expect(submit.urlEncoded[1]).toMatchObject({ key: 'b', enabled: false })

    const upload = get('Upload').body
    expect(upload.type).toBe('form-data')
    expect(upload.formData).toHaveLength(2)
    expect(upload.formData[0]).toMatchObject({ key: 'title', value: 'demo' })
    // form-data file row: importer puts src into value
    // form-data file rows: import keeps basename in `value`, full path in `filePath`,
    // and tags the row `type: 'file'` (matches the form-data feature shipped earlier).
    expect(upload.formData[1]).toMatchObject({
      key: 'file',
      type: 'file',
      filePath: '/tmp/demo.bin',
    })

    const blob = get('Binary Upload').body
    expect(blob).toEqual({ type: 'binary', content: '/tmp/raw.bin' })
  })
})

// ─── Round-trip ────────────────────────────────────────────

describe('Postman round-trip: import → exportAsPostman → re-import', () => {
  it('preserves request count, methods, and folders', async () => {
    const original = buildRealisticCollection()
    await importPostman('proj-1', JSON.stringify(original))

    const exported = exportAsPostman('proj-1')
    const reparsed = JSON.parse(exported)
    expect(reparsed.info.name).toBe('Test Project')
    expect(reparsed.info.schema).toContain('v2.1.0')

    // Wipe + re-import into proj-2
    memDb
      .prepare(
        `INSERT INTO projects (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run('proj-2', 'ws-1', 'Re-import', Date.now(), Date.now())
    const round = await importPostman('proj-2', exported)

    expect(round.success).toBe(true)
    expect(round.endpointCount).toBe(7)
    expect(round.folderCount).toBe(2)

    const methods = (
      memDb
        .prepare('SELECT method FROM endpoints WHERE project_id = ? ORDER BY name')
        .all('proj-2') as Array<{ method: string }>
    )
      .map((r) => r.method)
      .sort()
    expect(methods).toEqual(['GET', 'GET', 'GET', 'POST', 'POST', 'POST', 'PUT'])
  })

  it('BUG: pre/test scripts are LOST on round-trip (export does not emit event[])', async () => {
    await importPostman('proj-1', JSON.stringify(buildRealisticCollection()))
    const exported = JSON.parse(exportAsPostman('proj-1'))

    // Walk every item recursively
    type Item = { event?: unknown[]; item?: Item[] }
    const collectEvents = (items: Item[]): unknown[] => {
      const out: unknown[] = []
      for (const it of items) {
        if (it.event) out.push(...it.event)
        if (it.item) out.push(...collectEvents(it.item))
      }
      return out
    }
    const allEvents = collectEvents(exported.item)
    // Documents the regression: should be > 0 once exporter emits event[].
    expect(allEvents.length).toBe(0)
  })

  it('BUG: collection-level variable[] is LOST on round-trip', async () => {
    await importPostman('proj-1', JSON.stringify(buildRealisticCollection()))
    const exported = JSON.parse(exportAsPostman('proj-1'))
    // Documents the regression: exporter should emit variable[].
    expect(exported.variable).toBeUndefined()
  })

  it('preserves form-data file rows on round-trip (type:file + src)', async () => {
    await importPostman('proj-1', JSON.stringify(buildRealisticCollection()))
    const exported = JSON.parse(exportAsPostman('proj-1'))

    type Item = {
      name?: string
      request?: { body?: { mode?: string; formdata?: Array<{ key?: string; type?: string; src?: string }> } }
      item?: Item[]
    }
    const find = (items: Item[], name: string): Item | undefined => {
      for (const it of items) {
        if (it.name === name) return it
        if (it.item) {
          const f = find(it.item, name)
          if (f) return f
        }
      }
      return undefined
    }
    const upload = find(exported.item as Item[], 'Upload')
    const fileRow = upload?.request?.body?.formdata?.find((r) => r.key === 'file')
    expect(fileRow).toMatchObject({ type: 'file', src: '/tmp/demo.bin' })
  })

  it('preserves bearer/basic auth shape on round-trip', async () => {
    await importPostman('proj-1', JSON.stringify(buildRealisticCollection()))
    const exported = JSON.parse(exportAsPostman('proj-1'))

    type Item = {
      name?: string
      request?: { auth?: { type?: string } }
      item?: Item[]
    }
    const find = (items: Item[], name: string): Item | undefined => {
      for (const it of items) {
        if (it.name === name) return it
        if (it.item) {
          const f = find(it.item, name)
          if (f) return f
        }
      }
      return undefined
    }
    const create = find(exported.item as Item[], 'Create Pet')
    expect(create?.request?.auth?.type).toBe('basic')
  })
})

// ─── Edge cases ────────────────────────────────────────────

describe('importPostman — edge cases', () => {
  it('handles empty collection (no items)', async () => {
    const empty = {
      info: {
        name: 'Empty',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [],
    }
    const result = await importPostman('proj-1', JSON.stringify(empty))
    expect(result.success).toBe(true)
    expect(result.endpointCount).toBe(0)
    expect(result.folderCount).toBe(0)
    expect(result.warnings?.[0]).toContain('No requests')
  })

  it('imports deeply nested folders (4 levels)', async () => {
    const nested = {
      info: {
        name: 'Deep',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'L1',
          item: [
            {
              name: 'L2',
              item: [
                {
                  name: 'L3',
                  item: [
                    {
                      name: 'L4',
                      item: [
                        {
                          name: 'leaf',
                          request: { method: 'GET', url: 'https://x/y' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    const result = await importPostman('proj-1', JSON.stringify(nested))
    expect(result.success).toBe(true)
    expect(result.folderCount).toBe(4)
    expect(result.endpointCount).toBe(1)

    const folders = memDb
      .prepare('SELECT name, parent_id FROM folders WHERE project_id = ? ORDER BY sort_order')
      .all('proj-1') as Array<{ name: string; parent_id: string | null }>
    expect(folders.map((f) => f.name)).toEqual(['L1', 'L2', 'L3', 'L4'])
    // L1's parent is null, the rest cascade
    expect(folders[0].parent_id).toBeNull()
    expect(folders[1].parent_id).not.toBeNull()
  })

  it('handles requests without a name (falls back to METHOD path)', async () => {
    const noname = {
      info: {
        name: 'NoName',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          // name is empty
          name: '',
          request: { method: 'GET', url: 'https://api.example.com/widgets' },
        },
      ],
    }
    const result = await importPostman('proj-1', JSON.stringify(noname))
    expect(result.success).toBe(true)
    const ep = memDb
      .prepare('SELECT name FROM endpoints WHERE project_id = ?')
      .get('proj-1') as { name: string }
    // falls back to "GET /widgets"
    expect(ep.name).toMatch(/^GET\s+\/widgets/)
  })

  it('rejects malformed JSON gracefully', async () => {
    const result = await importPostman('proj-1', '{this is not json')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to parse Postman collection JSON')
  })

  it('rejects Postman v1 collection (missing item[]) gracefully — no crash', async () => {
    // v1 used `id`, `name`, `requests[]` instead of `info`, `item[]`.
    const v1 = {
      id: 'old-id',
      name: 'Legacy v1',
      order: [],
      requests: [{ id: 'r1', method: 'GET', url: 'https://x/y' }],
    }
    const result = await importPostman('proj-1', JSON.stringify(v1))
    expect(result.success).toBe(false)
    expect(result.error).toContain('Not a valid Postman collection')
  })

  it('warns on unknown schema URL', async () => {
    const weirdSchema = {
      info: { name: 'Weird', schema: 'https://example.com/something-else' },
      item: [],
    }
    const result = await importPostman('proj-1', JSON.stringify(weirdSchema))
    expect(result.success).toBe(true)
    expect(result.warnings?.some((w) => w.includes('Unknown collection schema'))).toBe(true)
  })

  it('extracts variables from URL into endpoint URL field (not URL-decoded)', async () => {
    const withVars = {
      info: {
        name: 'Vars',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'r',
          request: {
            method: 'GET',
            url: {
              raw: '{{baseUrl}}/users/{{userId}}/posts',
              host: ['{{baseUrl}}'],
              path: ['users', '{{userId}}', 'posts'],
            },
          },
        },
      ],
    }
    const result = await importPostman('proj-1', JSON.stringify(withVars))
    expect(result.success).toBe(true)
    const ep = JSON.parse(
      (memDb
        .prepare('SELECT request_schema FROM endpoints WHERE project_id = ?')
        .get('proj-1') as { request_schema: string }).request_schema,
    )
    expect(ep.url).toBe('{{baseUrl}}/users/{{userId}}/posts')
  })
})
