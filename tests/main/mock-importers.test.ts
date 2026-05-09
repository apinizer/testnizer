/**
 * Tests for mock-server importers (OpenAPI + Postman).
 * Uses an in-memory SQLite mocked at the module level so the repo CRUD calls
 * inside the importers run against a clean schema per test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

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
    CREATE TABLE mock_servers (id TEXT PRIMARY KEY);
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
    expect(JSON.parse(row.headers)).toEqual([
      { name: 'Content-Type', value: 'application/json' },
    ])
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
