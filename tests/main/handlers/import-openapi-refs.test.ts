/**
 * An OpenAPI import stores what the spec means, not what its text looks like:
 * references followed, path parameters read, `{id}` a real path variable. Asserted
 * on the stored rows, and on the request the real engine sends from them.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type Database from 'better-sqlite3'
import { setupHandlerHarness, makeElectronMock, seedProject, seedWorkspace } from './helpers'
import { applyPathVariables, readPathVariables } from '../../../src/shared/path-variables'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: Database.Database
const realDb = await vi.importActual<typeof import('../../../src/main/db/database')>(
  '../../../src/main/db/database',
)
vi.mock('../../../src/main/db/database', async (orig) => ({
  ...(await orig<typeof import('../../../src/main/db/database')>()),
  getDb: () => testDb,
}))
vi.mock('../../../src/main/lib/secure-storage', () => ({
  encryptSecret: (s: string | null | undefined) => (s ? `enc:${s}` : null),
  decryptSecret: (s: string | null | undefined) => (s ? s.replace(/^enc:/, '') : null),
  isEncryptedSecret: (s: unknown): s is string => typeof s === 'string' && s.startsWith('enc:'),
  isEncryptionAvailable: () => true,
}))
vi.mock('electron-store', () => ({
  default: class {
    get(): unknown {
      return undefined
    }
    set(): void {}
    delete(): void {}
  },
}))

const { registerImportExportHandlers } = await import('../../../src/main/ipc/import-export.handler')
const { executeHttpRequest } = await import('../../../src/main/protocols/http.engine')

let server: Server
let serverUrl = ''
const seen: string[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req.url ?? '')
    res.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  serverUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

let projectId = ''
beforeEach(() => {
  harness.reset()
  seen.length = 0
  testDb = realDb.openAndMigrate(':memory:')
  registerImportExportHandlers()
  projectId = seedProject(testDb, seedWorkspace(testDb), 'Refs')
})

interface Stored {
  name: string
  method: string
  path: string
  schema: {
    url: string
    params?: Array<{ key: string; value: string }>
    headers?: Array<{ key: string; value: string }>
    body?: { type: string; content?: string }
    paramMeta?: Record<string, unknown>
    pathVariables?: Array<{ key: string; value: string; description?: string }>
  }
  responses: Record<string, { description?: string }>
}

async function importSpec(spec: object | string, warnings?: string[]): Promise<Stored[]> {
  const res = (await harness.invoke('import:openApi', {
    projectId,
    content: typeof spec === 'string' ? spec : JSON.stringify(spec),
  })) as { success: boolean; error?: string; data?: { success: boolean; warnings?: string[] } }
  expect(res.success, res.error).toBe(true)
  warnings?.push(...(res.data?.warnings ?? []))
  const rows = testDb
    .prepare('SELECT name, method, path, request_schema, response_schemas FROM endpoints')
    .all() as Array<{
    name: string
    method: string
    path: string
    request_schema: string
    response_schemas: string
  }>
  return rows.map((r) => ({
    name: r.name,
    method: r.method,
    path: r.path,
    schema: JSON.parse(r.request_schema),
    responses: JSON.parse(r.response_schemas),
  }))
}

/** All four shapes a real multi-part spec uses. */
const SPEC = {
  openapi: '3.0.3',
  info: { title: 'Pets', version: '1' },
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/pets/{petId}': {
      // Path-level parameters apply to every operation of the path.
      parameters: [{ $ref: '#/components/parameters/PetId' }],
      post: {
        summary: 'Update pet',
        parameters: [
          { $ref: '#/components/parameters/Limit' },
          { $ref: '#/components/parameters/Trace' },
        ],
        requestBody: { $ref: '#/components/requestBodies/Pet' },
        responses: {
          200: { $ref: '#/components/responses/Ok' },
          404: { $ref: '#/components/responses/Missing' },
        },
      },
    },
  },
  components: {
    parameters: {
      PetId: {
        name: 'petId',
        in: 'path',
        required: true,
        description: 'The pet',
        schema: { type: 'string', example: '7' },
      },
      Limit: { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
      Trace: { name: 'X-Trace', in: 'header', schema: { type: 'string', default: 'on' } },
    },
    requestBodies: {
      Pet: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Pet' },
            example: { name: 'Rex' },
          },
        },
      },
    },
    responses: {
      Ok: {
        description: 'The updated pet',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
      },
      Missing: { description: 'No such pet' },
    },
    schemas: {
      Pet: { type: 'object', properties: { name: { type: 'string' } } },
    },
  },
}

describe('OpenAPI references', () => {
  it('a $ref parameter stores its real name, not "undefined"', async () => {
    const [row] = await importSpec(SPEC)
    expect(row.schema.params?.map((p) => [p.key, p.value])).toEqual([['limit', '20']])
    expect(row.schema.headers?.find((h) => h.key === 'X-Trace')?.value).toBe('on')
    expect(JSON.stringify(row.schema)).not.toContain('undefined')
  })

  it('a $ref requestBody stores the body', async () => {
    const [row] = await importSpec(SPEC)
    expect(row.schema.body?.type).toBe('json')
    expect(JSON.parse(row.schema.body?.content ?? 'null')).toEqual({ name: 'Rex' })
  })

  it('a $ref response stores the response, not a stub', async () => {
    const [row] = await importSpec(SPEC)
    expect(row.responses['200'].description).toBe('The updated pet')
    expect(row.responses['404'].description).toBe('No such pet')
    expect(JSON.stringify(row.responses)).not.toContain('$ref')
  })

  it('path-level parameters are read', async () => {
    const [row] = await importSpec(SPEC)
    expect(row.schema.pathVariables?.[0]).toMatchObject({
      key: 'petId',
      value: '7',
      description: 'The pet',
    })
  })

  it('a reference that points nowhere warns and keeps the operation', async () => {
    const warnings: string[] = []
    const rows = await importSpec(
      {
        ...SPEC,
        paths: {
          '/a': {
            get: { summary: 'A', parameters: [{ $ref: '#/components/parameters/Gone' }] },
          },
          '/b': { get: { summary: 'B', responses: {} } },
        },
      },
      warnings,
    )
    expect(rows.map((r) => r.name).sort()).toEqual(['A', 'B'])
    expect(warnings.join(' ')).toMatch(/point at nothing/)
  })

  it('a reference to another file or URL warns and is not followed', async () => {
    const warnings: string[] = []
    const rows = await importSpec(
      {
        ...SPEC,
        paths: {
          '/a': {
            get: {
              summary: 'A',
              parameters: [{ $ref: `${serverUrl}/params.yaml#/Limit` }],
              responses: {},
            },
          },
        },
      },
      warnings,
    )
    expect(rows).toHaveLength(1)
    expect(warnings.join(' ')).toMatch(/other files or URLs were not followed/)
    expect(seen).toEqual([])
  })

  it('a schema that refers to itself imports, and its example ends', async () => {
    const started = Date.now()
    const [row] = await importSpec({
      ...SPEC,
      paths: {
        '/tree': {
          post: {
            summary: 'Tree',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Node' } },
              },
            },
            responses: { 200: { description: 'ok' } },
          },
        },
      },
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              children: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
            },
          },
        },
      },
    })
    expect(Date.now() - started).toBeLessThan(5000)
    expect(row.schema.body?.type).toBe('json')
    expect(JSON.parse(row.schema.body?.content ?? 'null')).toHaveProperty('name')
  })
})

describe('OpenAPI path templates', () => {
  it('the engine sends {petId} as literal text, which no server routes', async () => {
    // Why the import converts: this is what a stored `{petId}` would send.
    const res = await executeHttpRequest({
      method: 'GET',
      url: `${serverUrl}/pets/{petId}`,
    })
    expect(res.error).toBeUndefined()
    expect(seen[0]).toMatch(/^\/pets\/(%7BpetId%7D|\{petId\})$/)
  })

  it('{petId} imports as :petId with a row, and Send reaches the real path', async () => {
    const [row] = await importSpec({ ...SPEC, servers: [{ url: serverUrl }] })
    expect(row.schema.url).toBe(`${serverUrl}/pets/:petId`)
    expect(row.path).toBe(`${serverUrl}/pets/:petId`)
    expect(readPathVariables(row.schema).map((v) => [v.key, v.value])).toEqual([['petId', '7']])

    // Send's own order: path variables first, then the engine.
    const url = applyPathVariables(row.schema.url, readPathVariables(row.schema))
    const res = await executeHttpRequest({ method: 'GET', url })
    expect(res.error).toBeUndefined()
    expect(seen[0]).toBe('/pets/7')
  })

  it('a brace that is only part of a segment stays literal and warns', async () => {
    const warnings: string[] = []
    const [row] = await importSpec(
      {
        ...SPEC,
        paths: { '/files/{name}.json': { get: { summary: 'F', responses: {} } } },
      },
      warnings,
    )
    expect(row.schema.url).toContain('/files/{name}.json')
    expect(warnings.join(' ')).toMatch(/\{name\}\.json/)
  })

  it('export gives {petId} back', async () => {
    await importSpec(SPEC)
    const res = (await harness.invoke('export:openApi', projectId)) as {
      success: boolean
      data?: { paths?: Record<string, unknown> } | string
    }
    expect(res.success).toBe(true)
    expect(JSON.stringify(res.data)).toContain('/pets/{petId}')
    expect(JSON.stringify(res.data)).not.toContain('/pets/:petId')
  })
})
