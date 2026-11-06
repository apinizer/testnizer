/**
 * Tests for mock-server importers (OpenAPI + Postman).
 * Uses an in-memory SQLite mocked at the module level so the repo CRUD calls
 * inside the importers run against a clean schema per test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let memDb: Database.Database

vi.mock('../../src/main/db/database', () => ({
  getDb: () => memDb,
  initDatabase: () => {},
}))

// Import after the mock so the importers + repo see the in-memory db.
import { importOpenApi, importPostman } from '../../src/main/mock/importers'

function freshDb(): Database.Database {
  const d = new Database(':memory:')
  d.pragma('foreign_keys = ON')
  d.exec(`
    CREATE TABLE mock_servers (id TEXT PRIMARY KEY, base_path TEXT NOT NULL DEFAULT '');
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
      enabled INTEGER NOT NULL DEFAULT 1,
      stream_config TEXT
    );
  `)
  d.prepare(`INSERT INTO mock_servers (id) VALUES (?)`).run('server-1')
  return d
}

beforeEach(() => {
  memDb = freshDb()
})

// ─── OpenAPI ───────────────────────────────────────────────────

const minimalOpenApi = {
  openapi: '3.0.3',
  info: { title: 'Test', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        summary: 'List users',
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': {
                example: [{ id: 1, name: 'Alice' }],
              },
            },
          },
        },
      },
      post: {
        summary: 'Create user',
        responses: {
          '201': {
            description: 'Created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { id: { type: 'integer' }, name: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
    '/users/{id}': {
      get: {
        summary: 'Get user by ID',
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { example: { id: 1, name: 'Alice' } } },
          },
          '404': { description: 'Not found' },
        },
      },
    },
  },
}

describe('importOpenApi', () => {
  it('creates one endpoint per path+method', async () => {
    const r = await importOpenApi('server-1', JSON.stringify(minimalOpenApi))
    expect(r.ok).toBe(true)
    expect(r.endpointsCreated).toBe(3)
    expect(r.responsesCreated).toBeGreaterThanOrEqual(3)

    const eps = memDb
      .prepare('SELECT method, path, path_mode FROM mock_endpoints ORDER BY method, path')
      .all() as { method: string; path: string; path_mode: string }[]
    expect(eps).toEqual([
      { method: 'GET', path: '/users', path_mode: 'exact' },
      { method: 'GET', path: '/users/:id', path_mode: 'param' },
      { method: 'POST', path: '/users', path_mode: 'exact' },
    ])
  })

  it('uses examples as response bodies when provided', async () => {
    const r = await importOpenApi('server-1', JSON.stringify(minimalOpenApi))
    expect(r.ok).toBe(true)
    const row = memDb
      .prepare(
        `SELECT body FROM mock_responses
         WHERE endpoint_id = (SELECT id FROM mock_endpoints WHERE method = 'GET' AND path = '/users')`,
      )
      .get() as { body: string }
    expect(JSON.parse(row.body)).toEqual([{ id: 1, name: 'Alice' }])
  })

  it('synthesises a sample body from a schema when no example', async () => {
    const r = await importOpenApi('server-1', JSON.stringify(minimalOpenApi))
    expect(r.ok).toBe(true)
    const row = memDb
      .prepare(
        `SELECT body FROM mock_responses
         WHERE endpoint_id = (SELECT id FROM mock_endpoints WHERE method = 'POST' AND path = '/users')`,
      )
      .get() as { body: string }
    const parsed = JSON.parse(row.body)
    expect(parsed).toMatchObject({ id: expect.any(Number), name: expect.any(String) })
  })

  it('parses YAML', async () => {
    const yaml = `
openapi: 3.0.3
info:
  title: T
  version: '1.0.0'
paths:
  /ping:
    get:
      responses:
        '200':
          description: OK
`
    const r = await importOpenApi('server-1', yaml)
    expect(r.ok).toBe(true)
    expect(r.endpointsCreated).toBe(1)
  })

  it('reports an error for malformed input', async () => {
    const r = await importOpenApi('server-1', '{ not json')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('reports an error when paths is missing', async () => {
    const r = await importOpenApi('server-1', JSON.stringify({ openapi: '3.0.3' }))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/paths/i)
  })
})

// ─── Postman ────────────────────────────────────────────────────

const minimalPostman = {
  info: { name: 'Sample', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/' },
  item: [
    {
      name: 'Get users',
      request: {
        method: 'GET',
        url: { raw: 'https://api.example.com/users', path: ['users'] },
      },
      response: [
        {
          name: 'OK',
          code: 200,
          status: 'OK',
          header: [{ key: 'Content-Type', value: 'application/json' }],
          body: '[{"id":1}]',
          _postman_previewlanguage: 'json',
        },
      ],
    },
    {
      name: 'Folder',
      item: [
        {
          name: 'Get one',
          request: {
            method: 'GET',
            url: { raw: 'https://api.example.com/users/{{userId}}' },
          },
          response: [],
        },
      ],
    },
    {
      name: 'String request',
      request: 'https://api.example.com/health',
    },
  ],
}

describe('importOpenApi: Swagger 2.0, hostile and odd specs (issue #319)', () => {
  const bodies = (): string[] =>
    (memDb.prepare('SELECT body FROM mock_responses').all() as { body: string }[]).map(
      (r) => r.body,
    )

  it('keeps the bodies of Swagger 2.0 responses, which have no content key', async () => {
    const res = await importOpenApi(
      'server-1',
      JSON.stringify({
        swagger: '2.0',
        info: { title: 't', version: '1' },
        produces: ['application/json'],
        paths: {
          '/example': {
            get: {
              responses: {
                200: { description: 'ok', examples: { 'application/json': { id: 7 } } },
              },
            },
          },
          '/schema': {
            get: {
              responses: {
                200: {
                  description: 'ok',
                  schema: { type: 'object', properties: { name: { type: 'string' } } },
                },
              },
            },
          },
        },
      }),
    )
    expect(res.ok).toBe(true)
    expect(bodies().map((b) => JSON.parse(b))).toEqual([{ id: 7 }, { name: 'string' }])
  })

  it('does not read a local file named by a $ref, and says so', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mock-ref-'))
    const secret = join(dir, 'secret.json')
    writeFileSync(secret, JSON.stringify({ example: 'CANARY-LOCAL-FILE' }))
    try {
      const res = await importOpenApi(
        'server-1',
        JSON.stringify({
          openapi: '3.0.0',
          info: { title: 't', version: '1' },
          paths: {
            '/a': {
              get: {
                responses: {
                  200: {
                    description: 'ok',
                    content: { 'application/json': { schema: { $ref: secret } } },
                  },
                },
              },
            },
          },
        }),
      )
      expect(res.ok).toBe(true)
      expect(bodies().join()).not.toContain('CANARY-LOCAL-FILE')
      expect(res.warnings.join()).toContain('1 reference(s)')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a schema that refers to itself imports with a finite body', async () => {
    const res = await importOpenApi(
      'server-1',
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 't', version: '1' },
        paths: {
          '/tree': {
            get: {
              responses: {
                200: {
                  description: 'ok',
                  content: {
                    'application/json': { schema: { $ref: '#/components/schemas/Node' } },
                  },
                },
              },
            },
          },
        },
        components: {
          schemas: {
            Node: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                next: { $ref: '#/components/schemas/Node' },
              },
            },
          },
        },
      }),
    )
    expect(res.ok).toBe(true)
    expect(res.endpointsCreated).toBe(1)
    expect(JSON.parse(bodies()[0]).id).toBe('string')
  })

  it('an empty document is a clean error, not a crash', async () => {
    const res = await importOpenApi('server-1', '')
    expect(res.ok).toBe(false)
    expect(res.endpointsCreated).toBe(0)
  })

  it('a null response definition imports as an empty response', async () => {
    const res = await importOpenApi(
      'server-1',
      JSON.stringify({
        openapi: '3.0.0',
        info: { title: 't', version: '1' },
        paths: { '/a': { get: { responses: { 204: null } } } },
      }),
    )
    expect(res.ok).toBe(true)
    expect(res.responsesCreated).toBe(1)
  })
})

describe('importPostman', () => {
  it('walks nested folders and turns each item into an endpoint', () => {
    const r = importPostman('server-1', JSON.stringify(minimalPostman))
    expect(r.ok).toBe(true)
    expect(r.endpointsCreated).toBe(3)
    const eps = memDb
      .prepare('SELECT method, path, path_mode FROM mock_endpoints ORDER BY path')
      .all() as { method: string; path: string; path_mode: string }[]
    expect(eps).toEqual(
      expect.arrayContaining([
        { method: 'GET', path: '/health', path_mode: 'exact' },
        { method: 'GET', path: '/users', path_mode: 'exact' },
        { method: 'GET', path: '/users/:userId', path_mode: 'param' },
      ]),
    )
  })

  it('turns each saved Postman example into a mock response', () => {
    const r = importPostman('server-1', JSON.stringify(minimalPostman))
    expect(r.ok).toBe(true)
    const row = memDb
      .prepare(
        `SELECT status_code, body, headers FROM mock_responses
         WHERE endpoint_id = (SELECT id FROM mock_endpoints WHERE path = '/users')`,
      )
      .get() as { status_code: number; body: string; headers: string }
    expect(row.status_code).toBe(200)
    expect(row.body).toBe('[{"id":1}]')
    expect(JSON.parse(row.headers)).toEqual([{ name: 'Content-Type', value: 'application/json' }])
  })

  it('falls back to a default 200 response when none provided', () => {
    importPostman('server-1', JSON.stringify(minimalPostman))
    const rows = memDb
      .prepare(
        `SELECT status_code FROM mock_responses
         WHERE endpoint_id = (SELECT id FROM mock_endpoints WHERE path = '/users/:userId')`,
      )
      .all() as { status_code: number }[]
    expect(rows).toEqual([{ status_code: 200 }])
  })

  it('reports an error for non-collection JSON', () => {
    const r = importPostman('server-1', JSON.stringify({ foo: 'bar' }))
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/item/i)
  })
})

// ─── Server base path ──────────────────────────────────────────

const paths = (): string[] =>
  (memDb.prepare('SELECT path FROM mock_endpoints ORDER BY path').all() as { path: string }[]).map(
    (r) => r.path,
  )
const pathsOf = async (doc: object): Promise<string[]> => {
  const r = await importOpenApi('server-1', JSON.stringify(doc))
  expect(r.ok).toBe(true)
  return paths()
}
const op = { responses: { '200': { description: 'ok' } } }
const v3 = (extra: object, p: object = { '/pets': { get: op } }): object => ({
  openapi: '3.0.3',
  info: { title: 'T', version: '1' },
  paths: p,
  ...extra,
})

describe('importOpenApi: the path the server puts before every endpoint', () => {
  it('binds the server path too: the real API answers at /v1/pets', async () => {
    expect(await pathsOf(v3({ servers: [{ url: 'https://api.example.com/v1' }] }))).toEqual([
      '/v1/pets',
    ])
  })

  it('a param path keeps its mode behind the prefix', async () => {
    const doc = v3({ servers: [{ url: '/api/v2/' }] }, { '/pets/{id}': { get: op } })
    await importOpenApi('server-1', JSON.stringify(doc))
    expect(memDb.prepare('SELECT path, path_mode FROM mock_endpoints').all()).toEqual([
      { path: '/api/v2/pets/:id', path_mode: 'param' },
    ])
  })

  it('a server at the root adds nothing', async () => {
    expect(await pathsOf(v3({ servers: [{ url: 'https://api.example.com/' }] }))).toEqual(['/pets'])
  })

  it('fills server variables from their defaults', async () => {
    const servers = [
      {
        url: 'https://{host}/{version}',
        variables: { host: { default: 'x.io' }, version: { default: 'v3' } },
      },
    ]
    expect(await pathsOf(v3({ servers }))).toEqual(['/v3/pets'])
  })

  it('reads Swagger 2.0 basePath', async () => {
    const doc = {
      swagger: '2.0',
      info: { title: 'T', version: '1' },
      host: 'x.io',
      basePath: '/v2',
      paths: { '/pets': { get: op } },
    }
    expect(await pathsOf(doc)).toEqual(['/v2/pets'])
  })

  it('the nearest servers win: operation, then path item, then document', async () => {
    const doc = v3(
      { servers: [{ url: '/doc' }] },
      {
        '/a': { get: op },
        '/b': { servers: [{ url: '/item' }], get: op },
        '/c': { servers: [{ url: '/item' }], get: { ...op, servers: [{ url: '/operation' }] } },
      },
    )
    expect(await pathsOf(doc)).toEqual(['/doc/a', '/item/b', '/operation/c'])
  })

  it('the prefix alone answers the spec path /', async () => {
    expect(await pathsOf(v3({ servers: [{ url: '/v1' }] }, { '/': { get: op } }))).toEqual(['/v1'])
  })

  it('does not double a prefix the mock server already strips', async () => {
    memDb.prepare('UPDATE mock_servers SET base_path = ?').run('/v1')
    expect(await pathsOf(v3({ servers: [{ url: 'https://x.io/v1' }] }))).toEqual(['/pets'])
  })

  it('says so when the servers disagree', async () => {
    const r = await importOpenApi(
      'server-1',
      JSON.stringify(v3({ servers: [{ url: '/v1' }, { url: '/v2' }] })),
    )
    expect(paths()).toEqual(['/v1/pets'])
    expect(r.warnings.join()).toContain('/v1')
  })

  it('servers that only differ by host are no news', async () => {
    const servers = [{ url: 'https://a.io/v1' }, { url: 'https://b.io/v1/' }]
    const r = await importOpenApi('server-1', JSON.stringify(v3({ servers })))
    expect(r.warnings).toEqual([])
  })
})

// ─── Composed schemas ──────────────────────────────────────────

const sampleOf = async (schema: object): Promise<unknown> => {
  const responses = {
    '200': { description: 'ok', content: { 'application/json': { schema } } },
  }
  await importOpenApi('server-1', JSON.stringify(v3({}, { '/s': { get: { responses } } })))
  const row = memDb.prepare('SELECT body FROM mock_responses').get() as { body: string }
  return JSON.parse(row.body)
}

describe('importOpenApi: sample bodies from composed schemas', () => {
  const pet = { type: 'object', properties: { name: { type: 'string' } } }
  const cat = { type: 'object', properties: { lives: { type: 'integer' } } }

  it('allOf merges every part', async () => {
    expect(await sampleOf({ allOf: [pet, cat] })).toEqual({ name: 'string', lives: 0 })
  })

  it('allOf merges with the properties beside it', async () => {
    const schema = { type: 'object', allOf: [pet], properties: { id: { type: 'integer' } } }
    expect(await sampleOf(schema)).toEqual({ name: 'string', id: 0 })
  })

  it('a part with no shape does not blank the rest', async () => {
    expect(await sampleOf({ allOf: [pet, { description: 'a pet' }] })).toEqual({ name: 'string' })
  })

  it.each(['oneOf', 'anyOf'])('%s takes the first branch', async (key) => {
    expect(await sampleOf({ [key]: [pet, cat] })).toEqual({ name: 'string' })
  })

  it.each(['oneOf', 'anyOf'])('%s skips a null branch', async (key) => {
    expect(await sampleOf({ [key]: [{ type: 'null' }, pet] })).toEqual({ name: 'string' })
  })

  it('a primitive inside allOf stays that primitive', async () => {
    expect(await sampleOf({ allOf: [{ type: 'integer' }] })).toBe(0)
  })

  it('reads the OpenAPI 3.1 nullable type and const', async () => {
    const schema = {
      type: 'object',
      properties: { a: { type: ['string', 'null'] }, b: { const: 'fixed' } },
    }
    expect(await sampleOf(schema)).toEqual({ a: 'string', b: 'fixed' })
  })

  it('a schema composed of itself ends instead of overflowing', async () => {
    const schema = {
      openapi: '3.0.3',
      info: { title: 'T', version: '1' },
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: { id: { type: 'integer' } },
            oneOf: [{ $ref: '#/components/schemas/Node' }, { type: 'object' }],
          },
        },
      },
      paths: {
        '/s': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Node' } },
                },
              },
            },
          },
        },
      },
    }
    const r = await importOpenApi('server-1', JSON.stringify(schema))
    expect(r.ok).toBe(true)
    const row = memDb.prepare('SELECT body FROM mock_responses').get() as { body: string }
    expect(JSON.parse(row.body)).toMatchObject({ id: 0 })
  })
})

// ─── Other Postman versions ────────────────────────────────────

const endpointRows = (): unknown[] =>
  memDb.prepare('SELECT method, path FROM mock_endpoints ORDER BY path').all()

describe('importPostman: every collection version', () => {
  it('reads a v1 collection, with its saved responses', () => {
    const r = importPostman(
      'server-1',
      JSON.stringify({
        id: 'c',
        name: 'Old',
        order: ['r1'],
        folders: [],
        requests: [
          {
            id: 'r1',
            name: 'Pets',
            method: 'GET',
            url: 'https://x.io/v1/pets/:id',
            responses: [
              { name: 'found', responseCode: { code: 201, name: 'Created' }, text: '{"id":1}' },
            ],
          },
        ],
      }),
    )
    expect(r).toMatchObject({ ok: true, endpointsCreated: 1, responsesCreated: 1 })
    expect(endpointRows()).toEqual([{ method: 'GET', path: '/v1/pets/:id' }])
    expect(memDb.prepare('SELECT status_code, body FROM mock_responses').all()).toEqual([
      { status_code: 201, body: '{"id":1}' },
    ])
  })

  const v3Doc = {
    $kind: 'collection',
    name: 'New',
    items: [
      {
        $kind: 'collection',
        name: 'Folder',
        items: [
          {
            $kind: 'http-request',
            name: 'Pets',
            method: 'POST',
            url: 'https://x.io/v1/pets',
            examples: [
              {
                name: 'made',
                response: {
                  statusCode: 201,
                  headers: [{ key: 'X-A', value: '1' }],
                  body: { type: 'json', content: '{"id":1}' },
                },
              },
            ],
          },
        ],
      },
      { $kind: 'websocket-request', name: 'Socket', url: 'wss://x.io' },
      { $kind: 'kafka-request', name: 'Topic' },
    ],
  }

  it('reads a v3 JSON collection; what a mock cannot answer is named', () => {
    const r = importPostman('server-1', JSON.stringify(v3Doc))
    expect(r).toMatchObject({ ok: true, endpointsCreated: 1, responsesCreated: 1 })
    expect(endpointRows()).toEqual([{ method: 'POST', path: '/v1/pets' }])
    expect(memDb.prepare('SELECT status_code, body FROM mock_responses').all()).toEqual([
      { status_code: 201, body: '{"id":1}' },
    ])
    expect(r.warnings.join('\n')).toContain('"Socket"')
    expect(r.warnings.join('\n')).toContain('"Topic"')
  })

  it('reads a collection in YAML', () => {
    const r = importPostman(
      'server-1',
      [
        'info:',
        '  name: Y',
        '  schema: https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        'item:',
        '  - name: Pets',
        '    request:',
        '      method: GET',
        '      url: https://x.io/pets',
      ].join('\n'),
    )
    expect(r).toMatchObject({ ok: true, endpointsCreated: 1 })
    expect(endpointRows()).toEqual([{ method: 'GET', path: '/pets' }])
  })

  it('refuses an oversized v3 collection instead of walking it', () => {
    let deep: object = { $kind: 'http-request', url: 'https://x.io/a' }
    for (let i = 0; i < 200; i++) deep = { $kind: 'collection', items: [deep] }
    const r = importPostman('server-1', JSON.stringify({ $kind: 'collection', items: [deep] }))
    expect(r.ok).toBe(false)
    expect(endpointRows()).toEqual([])
  })

  it.each([
    ['an environment', { _postman_variable_scope: 'environment', values: [] }],
    ['one file of a v3 folder', { $kind: 'http-request', url: 'https://x.io' }],
  ])('refuses %s', (_label, doc) => {
    const r = importPostman('server-1', JSON.stringify(doc))
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })
})

describe('schema composition next to a type (outside review)', () => {
  const sampleBody = async (schema: object): Promise<string> => {
    const serverId = crypto.randomUUID()
    memDb.prepare('INSERT INTO mock_servers (id) VALUES (?)').run(serverId)
    const r = await importOpenApi(
      serverId,
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'T', version: '1' },
        paths: {
          '/a': {
            get: {
              responses: {
                200: { description: 'ok', content: { 'application/json': { schema } } },
              },
            },
          },
        },
      }),
    )
    expect(r.ok, r.error).toBe(true)
    const row = memDb.prepare('SELECT body FROM mock_responses').get() as { body: string }
    return row.body
  }

  it('type + oneOf samples the enum, not the word "string"', async () => {
    const body = await sampleBody({ type: 'string', oneOf: [{ enum: ['cat'] }, { enum: ['dog'] }] })
    expect(JSON.parse(body)).toBe('cat')
  })

  it('type + allOf samples the enum', async () => {
    expect(JSON.parse(await sampleBody({ type: 'string', allOf: [{ enum: ['cat'] }] }))).toBe('cat')
  })

  it('a plain type still samples as before', async () => {
    expect(JSON.parse(await sampleBody({ type: 'string' }))).toBe('string')
  })
})

describe('a Postman v3 item a mock cannot answer (outside review)', () => {
  it('the warning names it', async () => {
    const serverId = crypto.randomUUID()
    memDb.prepare('INSERT INTO mock_servers (id) VALUES (?)').run(serverId)
    const r = await importPostman(
      serverId,
      JSON.stringify({
        $kind: 'collection',
        name: 'Shop',
        items: [
          { $kind: 'http-request', name: 'List', method: 'GET', url: 'http://x/list' },
          { $kind: 'kafka-request', name: 'Billing events' },
        ],
      }),
    )
    expect(r.ok, r.error).toBe(true)
    expect(r.warnings.join(' ')).toMatch(/Billing events/)
  })
})
