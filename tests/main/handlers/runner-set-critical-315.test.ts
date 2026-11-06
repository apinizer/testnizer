/**
 * Issue #315 — the run sequence sets a row's Critical flag: the same column and
 * key the Settings tab's Ctrl+S writes (issue #304), read back by the same
 * Runner lookup, for all three row kinds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const { registerRunnerHandlers, criticalRequestIds } =
  await import('../../../src/main/ipc/runner.handler')
const { withCriticalFlag } = await import('../../../src/shared/request-settings')

let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerRunnerHandlers()
})
afterEach(() => testDb.close())

const SCHEMA = JSON.stringify({ headers: [{ key: 'A', value: '1' }], timeout: 5000 })

function seedEndpoint(schema: string = SCHEMA): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status, request_schema, response_schemas, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'E', 'http', 'GET', '/e', 'active', ?, '[]', 0, ?, ?)`,
    )
    .run(id, projectId, schema, now, now)
  return id
}

function seedSaved(metadata: string | null): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO saved_requests (id, project_id, folder_id, name, protocol, method, url, metadata, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'S', 'http', 'GET', '/s', ?, 0, ?, ?)`,
    )
    .run(id, projectId, metadata, now, now)
  return id
}

function seedItem(): string {
  const id = crypto.randomUUID()
  const suite = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      'INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    )
    .run(suite, projectId, 'Suite', now, now)
  testDb
    .prepare(
      `INSERT INTO test_suite_items (id, suite_id, folder_id, protocol, name, method, url, request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'http', 'I', 'GET', '/i', ?, 0, ?, ?)`,
    )
    .run(id, suite, SCHEMA, now, now)
  return id
}

const column = (table: string, col: string, id: string): string =>
  (testDb.prepare(`SELECT ${col} AS v FROM ${table} WHERE id = ?`).get(id) as { v: string }).v

const set = (id: string, critical: boolean) =>
  harness.invoke('runner:setRequestCritical', id, critical) as Promise<{
    success: boolean
    notFound?: boolean
    error?: string
  }>

describe('issue #315 — runner:setRequestCritical', () => {
  it.each([
    ['endpoint', 'endpoints', 'request_schema', () => seedEndpoint()],
    ['saved request', 'saved_requests', 'metadata', () => seedSaved(SCHEMA)],
    ['suite item', 'test_suite_items', 'request_schema', () => seedItem()],
  ])('%s: on, then off, other keys kept', async (_kind, table, col, seed) => {
    const id = seed()
    expect((await set(id, true)).success).toBe(true)
    expect(JSON.parse(column(table, col, id))).toEqual({ ...JSON.parse(SCHEMA), critical: true })
    expect(criticalRequestIds([id]).has(id)).toBe(true)

    expect((await set(id, false)).success).toBe(true)
    // Off removes the key — an unmarked row is the row it was.
    expect(column(table, col, id)).toBe(SCHEMA)
    expect(criticalRequestIds([id]).has(id)).toBe(false)
  })

  it('a saved request with no metadata gets just the flag', async () => {
    const id = seedSaved(null)
    await set(id, true)
    expect(JSON.parse(column('saved_requests', 'metadata', id))).toEqual({ critical: true })
  })

  it('a deleted row answers notFound', async () => {
    const res = await set('gone', true)
    expect(res).toMatchObject({ success: false, notFound: true })
  })

  it('a malformed column is reported and left as it was', async () => {
    const id = seedEndpoint('{broken SECRET-VALUE')
    const res = await set(id, true)
    expect(res.success).toBe(false)
    // The toast shows this message; `JSON.parse` would quote the column.
    expect(res.error).not.toContain('SECRET-VALUE')
    expect(column('endpoints', 'request_schema', id)).toBe('{broken SECRET-VALUE')
  })

  it('only a literal true turns it on', async () => {
    const id = seedEndpoint()
    await harness.invoke('runner:setRequestCritical', id, 'yes')
    expect(column('endpoints', 'request_schema', id)).toBe(SCHEMA)
  })
})

describe('issue #315 — withCriticalFlag', () => {
  it('handles empty columns', () => {
    expect(withCriticalFlag(null, true)).toBe('{"critical":true}')
    expect(withCriticalFlag('', false)).toBe('{}')
    expect(() => withCriticalFlag('[1]', true)).toThrow()
  })
})
