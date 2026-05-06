/**
 * End-to-end tests for OpenAPI / Swagger import + export.
 *
 * Strategy: mock `electron` so that `ipcMain.handle` captures handlers into a
 * map, then mock `../../src/main/db/database` to expose a real in-memory
 * better-sqlite3 instance with the schema we care about. The actual
 * `importOpenApi` and `exportProjectAsOpenApi` functions are exercised through
 * their registered IPC handlers.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const ipcHandlers = new Map<string, Handler>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      ipcHandlers.set(channel, fn)
    },
    removeHandler: (channel: string) => {
      ipcHandlers.delete(channel)
    },
  },
  dialog: {
    showSaveDialog: () => Promise.resolve({ canceled: true }),
    showOpenDialog: () => Promise.resolve({ canceled: true }),
  },
  BrowserWindow: class {
    static getAllWindows() {
      return []
    }
  },
}))

let memDb: Database.Database

vi.mock('../../src/main/db/database', () => ({
  getDb: () => memDb,
  initDatabase: () => {},
}))

// Stub the gRPC engine so loading it doesn't pull in @grpc/grpc-js native bits
// in a Vitest environment. We don't exercise gRPC import here.
vi.mock('../../src/main/protocols/grpc.engine', () => ({
  loadProto: () => Promise.resolve({}),
}))

// Import after mocks so the module captures the mocked electron + db.
import { registerImportExportHandlers } from '../../src/main/ipc/import-export.handler'

interface ImportResult {
  success: boolean
  collectionId?: string
  endpointCount?: number
  folderCount?: number
  suggestedEnvVars?: Record<string, string>
  warnings?: string[]
  error?: string
}

interface IpcResponse<T> {
  success: boolean
  data?: T
  error?: string
}

beforeAll(() => {
  registerImportExportHandlers()
})

function freshDb(): Database.Database {
  const d = new Database(':memory:')
  d.pragma('foreign_keys = ON')
  d.exec(`
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
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
    CREATE TABLE folders (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
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
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
    );
  `)
  return d
}

function seedProject(id: string, name = 'Test Project', description: string | null = null) {
  const wsId = randomUUID()
  const now = Date.now()
  memDb
    .prepare(
      'INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    )
    .run(wsId, 'Default', now, now)
  memDb
    .prepare(
      'INSERT INTO projects (id, workspace_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, wsId, name, description, now, now)
}

async function importOpenApi(
  projectId: string,
  content: string,
  folderId: string | null = null,
  sourceUrl?: string,
): Promise<IpcResponse<ImportResult>> {
  const handler = ipcHandlers.get('import:openApi')!
  return handler({}, { projectId, content, format: 'openapi', folderId, sourceUrl }) as Promise<
    IpcResponse<ImportResult>
  >
}

async function exportOpenApi(projectId: string): Promise<IpcResponse<string>> {
  const handler = ipcHandlers.get('export:openApi')!
  return (await handler({}, projectId)) as IpcResponse<string>
}

beforeEach(() => {
  memDb = freshDb()
})

// ─── Realistic Petstore-style OpenAPI 3.0.3 ───────────────────

const petstoreSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Petstore API',
    description: 'Sample Petstore for testing',
    version: '1.0.0',
  },
  servers: [{ url: 'https://petstore.example.com/api/v1' }],
  tags: [
    { name: 'pets', description: 'Pet operations' },
    { name: 'store', description: 'Store operations' },
  ],
  components: {
    schemas: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'integer', format: 'int64' },
          name: { type: 'string', example: 'doggie' },
          status: { type: 'string', enum: ['available', 'pending', 'sold'] },
        },
      },
      NewPet: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          tag: { type: 'string' },
        },
      },
      Error: {
        type: 'object',
        properties: { code: { type: 'integer' }, message: { type: 'string' } },
      },
    },
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      basicAuth: { type: 'http', scheme: 'basic' },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/pets': {
      get: {
        tags: ['pets'],
        summary: 'List all pets',
        operationId: 'listPets',
        description: 'Returns paginated pet list',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            description: 'How many to return',
            required: false,
            schema: { type: 'integer', default: 20 },
          },
          {
            name: 'X-Trace-Id',
            in: 'header',
            description: 'Trace identifier',
            required: false,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'A list of pets',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
              },
            },
          },
        },
      },
      post: {
        tags: ['pets'],
        summary: 'Create a pet',
        operationId: 'createPet',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/NewPet' },
              example: { name: 'fluffy', tag: 'cat' },
            },
          },
        },
        responses: {
          '201': { description: 'Created' },
          default: {
            description: 'unexpected error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        tags: ['pets'],
        summary: 'Get pet by id',
        operationId: 'getPet',
        parameters: [
          { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
            },
          },
          '404': { description: 'Not Found' },
        },
        security: [{ apiKey: [] }],
      },
      delete: {
        tags: ['pets'],
        summary: 'Delete pet',
        operationId: 'deletePet',
        parameters: [
          { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '204': { description: 'No Content' } },
        security: [{ basicAuth: [] }],
      },
    },
    '/store/inventory': {
      get: {
        tags: ['store'],
        summary: 'Inventory by status',
        operationId: 'getInventory',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
}

const swaggerSpec = {
  swagger: '2.0',
  info: { title: 'Legacy API', version: '1.0.0', description: 'Swagger 2.0 sample' },
  host: 'legacy.example.com',
  basePath: '/api/v1',
  schemes: ['https'],
  consumes: ['application/json'],
  produces: ['application/json'],
  tags: [{ name: 'users' }, { name: 'orders' }],
  securityDefinitions: {
    apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
  },
  paths: {
    '/users': {
      get: {
        tags: ['users'],
        summary: 'List users',
        parameters: [
          { name: 'page', in: 'query', required: false, type: 'integer', default: 1 },
          { name: 'pageSize', in: 'query', required: false, type: 'integer', default: 50 },
        ],
        responses: { '200': { description: 'OK' } },
      },
      post: {
        tags: ['users'],
        summary: 'Create user',
        parameters: [
          {
            name: 'body',
            in: 'body',
            required: true,
            schema: { type: 'object', properties: { name: { type: 'string' } } },
          },
        ],
        responses: { '201': { description: 'Created' } },
      },
    },
    '/orders/{orderId}': {
      get: {
        tags: ['orders'],
        summary: 'Get order',
        parameters: [
          { name: 'orderId', in: 'path', required: true, type: 'string' },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
}

// ─── Tests ─────────────────────────────────────────────────────

describe('OpenAPI 3.0.3 import — Petstore', () => {
  it('creates one endpoint per path/method', async () => {
    const projectId = randomUUID()
    seedProject(projectId)

    const r = await importOpenApi(projectId, JSON.stringify(petstoreSpec))
    expect(r.success).toBe(true)
    expect(r.data?.endpointCount).toBe(5)

    const rows = memDb
      .prepare('SELECT method, path, name, description FROM endpoints WHERE project_id = ? ORDER BY sort_order')
      .all(projectId) as Array<{ method: string; path: string; name: string; description: string | null }>
    const methods = rows.map((r) => `${r.method} ${r.path}`)
    expect(methods).toContain('GET https://petstore.example.com/api/v1/pets')
    expect(methods).toContain('POST https://petstore.example.com/api/v1/pets')
    expect(methods).toContain('GET https://petstore.example.com/api/v1/pets/{petId}')
    expect(methods).toContain('DELETE https://petstore.example.com/api/v1/pets/{petId}')
  })

  it('extracts baseUrl into suggestedEnvVars', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    const r = await importOpenApi(projectId, JSON.stringify(petstoreSpec))
    expect(r.data?.suggestedEnvVars?.baseUrl).toBe('https://petstore.example.com/api/v1')
  })

  it('creates folders from tags', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    await importOpenApi(projectId, JSON.stringify(petstoreSpec))

    const folders = memDb
      .prepare('SELECT name FROM folders WHERE project_id = ?')
      .all(projectId) as Array<{ name: string }>
    const names = folders.map((f) => f.name).sort()
    expect(names).toEqual(['pets', 'store'])
  })

  it('maps query and header parameters; path params remain in URL', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    await importOpenApi(projectId, JSON.stringify(petstoreSpec))

    const listPets = memDb
      .prepare('SELECT request_schema FROM endpoints WHERE name = ?')
      .get('List all pets') as { request_schema: string } | undefined
    expect(listPets).toBeDefined()
    const schema = JSON.parse(listPets!.request_schema)
    expect(schema.method).toBe('GET')
    expect(schema.params).toHaveLength(1)
    expect(schema.params[0]).toMatchObject({ key: 'limit', value: 20, description: 'How many to return' })
    expect(schema.headers).toHaveLength(1)
    expect(schema.headers[0]).toMatchObject({ key: 'X-Trace-Id', description: 'Trace identifier' })
  })

  it('persists request body when JSON content is present', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    await importOpenApi(projectId, JSON.stringify(petstoreSpec))

    const createPet = memDb
      .prepare('SELECT request_schema FROM endpoints WHERE name = ?')
      .get('Create a pet') as { request_schema: string }
    const schema = JSON.parse(createPet.request_schema)
    expect(schema.body.type).toBe('json')
    expect(typeof schema.body.content).toBe('string')
    // The body content is JSON-stringified schema (with $ref preserved or resolved)
    expect(schema.body.content.length).toBeGreaterThan(0)
  })

  it('persists responses object as response_schemas', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    await importOpenApi(projectId, JSON.stringify(petstoreSpec))

    const row = memDb
      .prepare('SELECT response_schemas FROM endpoints WHERE name = ?')
      .get('List all pets') as { response_schemas: string }
    const responses = JSON.parse(row.response_schemas)
    expect(responses['200']).toBeDefined()
    expect(responses['200'].description).toBe('A list of pets')
  })

  it('preserves operation description on the endpoint row', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    await importOpenApi(projectId, JSON.stringify(petstoreSpec))

    const row = memDb
      .prepare('SELECT description FROM endpoints WHERE name = ?')
      .get('List all pets') as { description: string | null }
    expect(row.description).toBe('Returns paginated pet list')
  })

  it('returns success even when no endpoints (empty paths)', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    const r = await importOpenApi(
      projectId,
      JSON.stringify({ openapi: '3.0.3', info: { title: 'Empty', version: '1' }, paths: {} }),
    )
    expect(r.success).toBe(true)
    expect(r.data?.endpointCount).toBe(0)
    expect(r.data?.warnings).toContain('No endpoints found in the document')
  })
})

// ─── Swagger 2.0 ───────────────────────────────────────────────

describe('Swagger 2.0 import', () => {
  it('parses host/basePath/schemes into baseUrl', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    const r = await importOpenApi(projectId, JSON.stringify(swaggerSpec))
    expect(r.success).toBe(true)
    expect(r.data?.suggestedEnvVars?.baseUrl).toBe('https://legacy.example.com/api/v1')
  })

  it('creates endpoints for all paths/methods', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    await importOpenApi(projectId, JSON.stringify(swaggerSpec))
    const rows = memDb
      .prepare('SELECT method, path FROM endpoints WHERE project_id = ?')
      .all(projectId) as Array<{ method: string; path: string }>
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.method).sort()).toEqual(['GET', 'GET', 'POST'])
    expect(rows.find((r) => r.path.endsWith('/orders/{orderId}'))).toBeDefined()
  })
})

// ─── servers[] handling ────────────────────────────────────────

describe('servers[] handling', () => {
  it('uses absolute server URL', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    const spec = {
      openapi: '3.0.0',
      info: { title: 'X', version: '1' },
      servers: [{ url: 'https://api.example.com/v2' }],
      paths: { '/ping': { get: { responses: { '200': { description: 'OK' } } } } },
    }
    const r = await importOpenApi(projectId, JSON.stringify(spec))
    expect(r.data?.suggestedEnvVars?.baseUrl).toBe('https://api.example.com/v2')
    const row = memDb.prepare('SELECT path FROM endpoints WHERE project_id = ?').get(projectId) as
      | { path: string }
      | undefined
    expect(row?.path).toBe('https://api.example.com/v2/ping')
  })

  it('resolves relative server URL against sourceUrl', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    const spec = {
      openapi: '3.0.0',
      info: { title: 'X', version: '1' },
      servers: [{ url: '/api/v3' }],
      paths: { '/ping': { get: { responses: { '200': { description: 'OK' } } } } },
    }
    const r = await importOpenApi(
      projectId,
      JSON.stringify(spec),
      null,
      'https://docs.example.com/openapi.json',
    )
    expect(r.data?.suggestedEnvVars?.baseUrl).toBe('https://docs.example.com/api/v3')
  })

  it('keeps relative server URL when no sourceUrl supplied', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    const spec = {
      openapi: '3.0.0',
      info: { title: 'X', version: '1' },
      servers: [{ url: '/api/v3' }],
      paths: { '/ping': { get: { responses: { '200': { description: 'OK' } } } } },
    }
    const r = await importOpenApi(projectId, JSON.stringify(spec))
    expect(r.data?.suggestedEnvVars?.baseUrl).toBe('/api/v3')
  })
})

// ─── Auth / security schemes ───────────────────────────────────

describe('OpenAPI security schemes', () => {
  it('parses spec containing bearer + apiKey + basic without crashing', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    const r = await importOpenApi(projectId, JSON.stringify(petstoreSpec))
    expect(r.success).toBe(true)
    // Endpoints created — but importer currently does not wire auth into
    // request_schema.auth. That's an asserted behavior gap (see bug list).
    const rows = memDb
      .prepare('SELECT request_schema FROM endpoints WHERE project_id = ?')
      .all(projectId) as Array<{ request_schema: string }>
    for (const row of rows) {
      const schema = JSON.parse(row.request_schema)
      // Bug: auth always falls back to 'none' regardless of operation.security
      expect(schema.auth).toEqual({ type: 'none' })
    }
  })
})

// ─── Examples ──────────────────────────────────────────────────

describe('OpenAPI examples', () => {
  it('does NOT prefer top-level example over schema (current behavior)', async () => {
    // The importer serializes the schema into body.content. The provided
    // `example` field on the media type is dropped. This test pins the
    // current (lossy) behavior so any future fix is intentional.
    const projectId = randomUUID()
    seedProject(projectId)
    await importOpenApi(projectId, JSON.stringify(petstoreSpec))

    const createPet = memDb
      .prepare('SELECT request_schema FROM endpoints WHERE name = ?')
      .get('Create a pet') as { request_schema: string }
    const schema = JSON.parse(createPet.request_schema)
    expect(schema.body.type).toBe('json')
    // The example { name: 'fluffy', tag: 'cat' } was provided in the spec
    // but the importer stores the SCHEMA, not the example.
    expect(schema.body.content).not.toContain('fluffy')
  })
})

// ─── $ref schemas ──────────────────────────────────────────────

describe('OpenAPI $ref handling', () => {
  it('preserves $ref strings as-is in body content (no resolution)', async () => {
    // Importer stringifies the raw schema verbatim, including $ref.
    const projectId = randomUUID()
    seedProject(projectId)
    await importOpenApi(projectId, JSON.stringify(petstoreSpec))

    const createPet = memDb
      .prepare('SELECT request_schema FROM endpoints WHERE name = ?')
      .get('Create a pet') as { request_schema: string }
    const schema = JSON.parse(createPet.request_schema)
    expect(schema.body.content).toContain('$ref')
    expect(schema.body.content).toContain('#/components/schemas/NewPet')
  })

  it('does not crash on deeply nested $refs / circular schemas', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    const spec = {
      openapi: '3.0.3',
      info: { title: 'Circular', version: '1' },
      components: {
        schemas: {
          Tree: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              children: { type: 'array', items: { $ref: '#/components/schemas/Tree' } },
            },
          },
        },
      },
      paths: {
        '/tree': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Tree' } } },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const r = await importOpenApi(projectId, JSON.stringify(spec))
    expect(r.success).toBe(true)
    expect(r.data?.endpointCount).toBe(1)
  })
})

// ─── OpenAPI 3.1 with anyOf/oneOf ──────────────────────────────

describe('OpenAPI 3.1 + anyOf/oneOf', () => {
  it('handles anyOf/oneOf without crashing', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    const spec = {
      openapi: '3.1.0',
      info: { title: 'Polymorphic', version: '1' },
      paths: {
        '/items': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { type: 'object', properties: { kind: { const: 'a' } } },
                      { type: 'object', properties: { kind: { const: 'b' } } },
                    ],
                  },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const r = await importOpenApi(projectId, JSON.stringify(spec))
    expect(r.success).toBe(true)
    expect(r.data?.endpointCount).toBe(1)
  })
})

// ─── YAML parsing ──────────────────────────────────────────────

describe('YAML input', () => {
  it('parses YAML-formatted OpenAPI spec', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    const yaml = [
      'openapi: 3.0.3',
      'info:',
      '  title: YAML API',
      '  version: 1.0.0',
      'servers:',
      '  - url: https://yaml.example.com',
      'paths:',
      '  /ping:',
      '    get:',
      '      summary: Ping',
      '      responses:',
      "        '200': { description: OK }",
    ].join('\n')

    const r = await importOpenApi(projectId, yaml)
    expect(r.success).toBe(true)
    expect(r.data?.endpointCount).toBe(1)
    expect(r.data?.suggestedEnvVars?.baseUrl).toBe('https://yaml.example.com')
  })
})

// ─── Round-trip: import → export → re-import ──────────────────

describe('Round-trip import → export → re-import', () => {
  it('preserves paths, methods, and parameters', async () => {
    const projectIdA = randomUUID()
    seedProject(projectIdA, 'RT Source')
    const importR = await importOpenApi(projectIdA, JSON.stringify(petstoreSpec))
    expect(importR.success).toBe(true)

    const exportR = await exportOpenApi(projectIdA)
    expect(exportR.success).toBe(true)
    const exported = JSON.parse(exportR.data!)
    expect(exported.openapi).toBe('3.0.3')
    expect(exported.info.title).toBe('RT Source')

    // Exporter uses the absolute URL stored on the endpoint as the path key —
    // bug: the exported spec keys paths by full URL instead of just the
    // relative path. Pin behavior so we notice if it ever changes.
    const exportedPathKeys = Object.keys(exported.paths)
    expect(exportedPathKeys.length).toBeGreaterThan(0)
    expect(
      exportedPathKeys.some((k) => k.includes('/pets')),
    ).toBe(true)

    // Re-import into a fresh project and assert endpoint count matches.
    const projectIdB = randomUUID()
    seedProject(projectIdB, 'RT Destination')
    const reimport = await importOpenApi(projectIdB, exportR.data!)
    expect(reimport.success).toBe(true)
    // Same number of endpoints survives the round-trip.
    expect(reimport.data?.endpointCount).toBe(importR.data?.endpointCount)
  })

  it('round-trip preserves request body media type', async () => {
    const projectIdA = randomUUID()
    seedProject(projectIdA)
    const spec = {
      openapi: '3.0.3',
      info: { title: 'BodyTest', version: '1' },
      servers: [{ url: 'https://a.example.com' }],
      paths: {
        '/items': {
          post: {
            summary: 'Create item',
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { name: { type: 'string' } } },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    await importOpenApi(projectIdA, JSON.stringify(spec))
    const exported = JSON.parse((await exportOpenApi(projectIdA)).data!)

    // Find the operation regardless of how the path was keyed.
    const ops: Array<Record<string, unknown>> = []
    for (const pathKey of Object.keys(exported.paths)) {
      for (const method of Object.keys(exported.paths[pathKey])) {
        ops.push(exported.paths[pathKey][method])
      }
    }
    expect(ops).toHaveLength(1)
    const op = ops[0] as { requestBody?: { content?: Record<string, unknown> } }
    expect(op.requestBody?.content?.['application/json']).toBeDefined()
  })

  it('exports project with no endpoints as a valid (empty paths) doc', async () => {
    const projectId = randomUUID()
    seedProject(projectId, 'EmptyProj')
    const r = await exportOpenApi(projectId)
    expect(r.success).toBe(true)
    const doc = JSON.parse(r.data!)
    expect(doc.openapi).toBe('3.0.3')
    expect(doc.info.title).toBe('EmptyProj')
    expect(doc.paths).toEqual({})
  })
})

// ─── Edge: invalid input ───────────────────────────────────────

describe('Edge cases', () => {
  it('returns error for non-OpenAPI document', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    const r = await importOpenApi(projectId, JSON.stringify({ random: 'doc' }))
    expect(r.success).toBe(true)
    // The IPC wrapper returns success:true with a nested ImportResult that
    // carries success:false on parse errors.
    expect(r.data?.success).toBe(false)
    expect(r.data?.error).toMatch(/Not a valid OpenAPI/)
  })

  it('returns error for unparseable input', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    const r = await importOpenApi(projectId, '<<not json or yaml>>: : :')
    expect(r.data?.success === false || r.success === false).toBe(true)
  })

  it('handles operation without summary or operationId', async () => {
    const projectId = randomUUID()
    seedProject(projectId)
    const spec = {
      openapi: '3.0.3',
      info: { title: 'X', version: '1' },
      paths: {
        '/anon': {
          get: { responses: { '200': { description: 'OK' } } },
        },
      },
    }
    await importOpenApi(projectId, JSON.stringify(spec))
    const row = memDb
      .prepare('SELECT name FROM endpoints WHERE project_id = ?')
      .get(projectId) as { name: string }
    expect(row.name).toBe('GET /anon')
  })
})
