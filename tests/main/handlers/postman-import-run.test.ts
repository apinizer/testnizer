/**
 * Issue #276 — what a Postman import writes is what Run executes.
 *
 *  - `protocolProfileBehavior.followRedirects: false` (collection-level,
 *    inherited) reaches the runner: the 302 comes back instead of being
 *    followed. Before, `protocolProfileBehavior` was dropped and Run followed.
 *  - Collection auth placed on the project (requests stored as `inherit`)
 *    still sends the same Authorization header on Run as the old baked auth.
 *
 * Real `runner:execute` against a local server; electron-store is a fake.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import {
  createTestDb,
  makeElectronMock,
  seedProject,
  seedWorkspace,
  setupHandlerHarness,
} from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
    fromWebContents: () => null,
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

class FakeStore {
  get(): unknown {
    return undefined
  }
  set(): void {}
}
vi.mock('electron-store', () => ({ default: FakeStore }))

const { registerRunnerHandlers } = await import('../../../src/main/ipc/runner.handler')
const { importPostman } = await import('../../../src/main/import/postman')
const { registerTestSuiteHandlers } = await import('../../../src/main/ipc/test-suite.handler')

/** Short fingerprint of a header value (the body never carries the credential). */
const sha = (v: string): string => createHash('sha256').update(v).digest('hex').slice(0, 16)
const fingerprint = (auth: string): string =>
  `scheme=${auth.split(' ')[0]};len=${auth.length};sha=${sha(auth)}`

let server: Server
let base = ''

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        if (req.url?.startsWith('/hop')) {
          res.writeHead(302, { Location: '/ok' })
          res.end()
          return
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        // Echo a fingerprint, not the credential: Run masks credential values in
        // recorded bodies (issue #195), which would hide what we assert on.
        const auth = req.headers.authorization ?? ''
        res.end(`scheme=${auth.split(' ')[0]};len=${auth.length};sha=${sha(auth)}`)
      })
      server.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        resolve()
      })
    }),
)
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

let workspaceId: string
let projectId: string
beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  workspaceId = seedWorkspace(testDb)
  projectId = seedProject(testDb, workspaceId)
  registerRunnerHandlers()
  registerTestSuiteHandlers()
})
afterEach(() => testDb.close())

interface Row {
  name?: string
  status: number | null
  body?: string
  responseBody?: string
}

async function runAll(only?: string[]): Promise<Row[]> {
  const ids =
    only ??
    (
      testDb
        .prepare('SELECT id FROM endpoints WHERE project_id = ? ORDER BY sort_order')
        .all(projectId) as Array<{ id: string }>
    ).map((r) => r.id)
  const res = (await harness.invoke('runner:execute', {
    projectId,
    workspaceId,
    endpointIds: ids,
  })) as { success: boolean; data?: { results: Row[] } }
  expect(res.success).toBe(true)
  return res.data!.results
}

const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

describe('issue #276 — imported settings and inherited auth on Run', () => {
  it('collection protocolProfileBehavior.followRedirects=false is honoured (302 kept)', async () => {
    const r = await importPostman(
      projectId,
      JSON.stringify({
        info: { name: 'R', schema: SCHEMA },
        protocolProfileBehavior: { followRedirects: false },
        item: [
          { name: 'kept', request: { method: 'GET', url: `${base}/hop` } },
          {
            name: 'followed',
            request: { method: 'GET', url: `${base}/hop` },
            protocolProfileBehavior: { followRedirects: true },
          },
        ],
      }),
      null,
      { apisTree: true },
    )
    expect(r.success).toBe(true)
    const [kept, followed] = await runAll()
    expect(kept.status).toBe(302)
    expect(followed.status).toBe(200)
  })

  it('collection bearer on the project (requests inherit) sends the same header as before', async () => {
    const r = await importPostman(
      projectId,
      JSON.stringify({
        info: { name: 'A', schema: SCHEMA },
        variable: [{ key: 'tok', value: 'abc123' }],
        auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{tok}}', type: 'string' }] },
        item: [
          { name: 'inherits', request: { method: 'GET', url: `${base}/a` } },
          { name: 'none', request: { method: 'GET', url: `${base}/b`, auth: { type: 'noauth' } } },
        ],
      }),
      null,
      { apisTree: true },
    )
    expect(r.success).toBe(true)
    const schema = JSON.parse(
      (
        testDb.prepare(`SELECT request_schema FROM endpoints WHERE name = 'inherits'`).get() as {
          request_schema: string
        }
      ).request_schema,
    ) as { auth: unknown }
    expect(schema.auth).toEqual({ type: 'inherit' })
    const [inherits, none] = await runAll()
    const text = (row: Row): string => String(row.body ?? row.responseBody ?? '')
    expect(inherits.status).toBe(200)
    expect(text(inherits)).toBe(fingerprint('Bearer abc123'))
    expect(text(none)).toBe(fingerprint(''))
  })

  /**
   * The Import modal's default: a NEW folder. The collection auth goes on that
   * folder and every request is `inherit`. Run from the APIs tree AND from a
   * Test Suite built out of those endpoints (whole folder, and one hand-picked
   * request) must send exactly what the old baked import sent.
   */
  describe('collection auth on the import folder (default "new folder" path)', () => {
    const LITERAL = 'Bearer LITERAL-COLLECTION-TOKEN'
    const coll = (): string =>
      JSON.stringify({
        info: { name: 'F', schema: SCHEMA },
        auth: { type: 'bearer', bearer: [{ key: 'token', value: 'LITERAL-COLLECTION-TOKEN' }] },
        item: [
          {
            name: 'Sub',
            item: [{ name: 'deep', request: { method: 'GET', url: `${base}/deep` } }],
          },
          { name: 'top', request: { method: 'GET', url: `${base}/top` } },
        ],
      })
    const newFolder = (name: string): string => {
      const id = crypto.randomUUID()
      testDb
        .prepare(
          'INSERT INTO folders (id, project_id, parent_id, name, sort_order) VALUES (?, ?, NULL, ?, 0)',
        )
        .run(id, projectId, name)
      return id
    }
    const text = (row: Row): string => String(row.body ?? row.responseBody ?? '')
    const endpointIdsUnder = (folderNames: string[]): string[] =>
      (
        testDb
          .prepare(
            `SELECT e.id FROM endpoints e WHERE e.project_id = ? AND e.folder_id IN (
               SELECT id FROM folders WHERE name IN (${folderNames.map(() => '?').join(',')}))
             ORDER BY e.sort_order`,
          )
          .all(projectId, ...folderNames) as Array<{ id: string }>
      ).map((r) => r.id)

    it('APIs Run: inherit through the import folder = the baked import', async () => {
      const folder = newFolder('Imported')
      await importPostman(projectId, coll(), folder, { apisTree: true })
      const auths = (
        testDb.prepare('SELECT request_schema FROM endpoints').all() as Array<{
          request_schema: string
        }>
      ).map((r) => (JSON.parse(r.request_schema) as { auth: unknown }).auth)
      expect(auths).toEqual([{ type: 'inherit' }, { type: 'inherit' }])

      const baked = newFolder('Baked')
      await importPostman(projectId, coll(), baked, {}) // parser mode: the old shape
      const rows = await runAll()
      expect(rows.map(text)).toEqual(Array(4).fill(fingerprint(LITERAL)))
    })

    it('Test Suite from the whole folder and from one request sends the same header', async () => {
      const folder = newFolder('Imported')
      await importPostman(projectId, coll(), folder, { apisTree: true })
      const endpointIds = endpointIdsUnder(['Imported', 'Sub'])
      expect(endpointIds).toHaveLength(2)

      const suite = (name: string): string => {
        const id = crypto.randomUUID()
        const now = Date.now()
        testDb
          .prepare(
            'INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
          )
          .run(id, projectId, name, now, now)
        return id
      }
      const itemsOf = (suiteId: string): string[] =>
        (
          testDb
            .prepare('SELECT id FROM test_suite_items WHERE suite_id = ? ORDER BY sort_order')
            .all(suiteId) as Array<{ id: string }>
        ).map((r) => r.id)

      // "Create suite from this folder"
      const whole = suite('Whole')
      const r1 = (await harness.invoke('testSuite:importEndpoints', {
        suite_id: whole,
        endpoint_ids: endpointIds,
        source_folder_id: folder,
      })) as { success: boolean }
      expect(r1.success).toBe(true)
      // One request picked by hand (no source folder)
      const single = suite('Single')
      const r2 = (await harness.invoke('testSuite:importEndpoints', {
        suite_id: single,
        endpoint_ids: [endpointIds[1]],
      })) as { success: boolean }
      expect(r2.success).toBe(true)

      const wholeRows = await runAll(itemsOf(whole))
      expect(wholeRows).toHaveLength(2)
      expect(wholeRows.map(text)).toEqual([fingerprint(LITERAL), fingerprint(LITERAL)])
      const singleRows = await runAll(itemsOf(single))
      expect(singleRows.map(text)).toEqual([fingerprint(LITERAL)])
    })
  })
})
