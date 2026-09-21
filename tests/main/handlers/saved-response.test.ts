/**
 * Issue #125 — `savedResponse:*` IPC handlers: named response examples
 * pinned to a request (endpoint / saved request / suite item).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
  seedProject,
  seedWorkspace,
} from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { registerSavedResponseHandlers } =
  await import('../../../src/main/ipc/saved-response.handler')

let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO saved_requests (id, project_id, name, protocol, method, url, params, headers, assertions, sort_order, created_at, updated_at)
       VALUES ('sr-1', ?, 'S', 'http', 'GET', 'http://x', '[]', '[]', '[]', 0, ?, ?)`,
    )
    .run(projectId, now, now)
  testDb
    .prepare(
      `INSERT INTO endpoints (id, project_id, name, protocol, method, path, status, sort_order, created_at, updated_at)
       VALUES ('ep-1', ?, 'E', 'http', 'GET', '/x', 'developing', 0, ?, ?)`,
    )
    .run(projectId, now, now)
  testDb
    .prepare(
      `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at) VALUES ('ts-1', ?, 'T', 0, ?, ?)`,
    )
    .run(projectId, now, now)
  testDb
    .prepare(
      `INSERT INTO test_suite_items (id, suite_id, protocol, name, request_schema, sort_order, created_at, updated_at)
       VALUES ('item-1', 'ts-1', 'http', 'I', '{}', 0, ?, ?)`,
    )
    .run(now, now)
  registerSavedResponseHandlers()
})

const snapshot = JSON.stringify({ status: 200, statusText: 'OK', body: '{"ok":true}', headers: {} })

describe('savedResponse:create + list', () => {
  it('creates a named example and lists it for its owner only', async () => {
    const created = (await harness.invoke('savedResponse:create', {
      // project_id is deliberately WRONG here: main must resolve it from the owner row.
      project_id: 'bogus-project',
      owner_type: 'saved_request',
      owner_id: 'sr-1',
      name: '200 success sample',
      protocol: 'http',
      method: 'GET',
      url: 'https://api.test/users',
      status_code: 200,
      response_json: snapshot,
    })) as { success: boolean; data?: { id: string; name: string; project_id: string } }
    expect(created.success).toBe(true)
    expect(created.data?.name).toBe('200 success sample')
    expect(created.data?.project_id).toBe(projectId)

    const list = (await harness.invoke('savedResponse:list', 'saved_request', 'sr-1')) as {
      success: boolean
      data?: Array<{ id: string; response_json: string; status_code: number }>
    }
    expect(list.success).toBe(true)
    expect(list.data).toHaveLength(1)
    expect(list.data?.[0].status_code).toBe(200)
    expect(JSON.parse(list.data![0].response_json).body).toBe('{"ok":true}')

    const other = (await harness.invoke('savedResponse:list', 'endpoint', 'sr-1')) as {
      data?: unknown[]
    }
    expect(other.data).toEqual([])
  })

  it('newest first', async () => {
    for (const name of ['first', 'second']) {
      await harness.invoke('savedResponse:create', {
        owner_type: 'endpoint',
        owner_id: 'ep-1',
        name,
        response_json: snapshot,
      })
      await new Promise((r) => setTimeout(r, 2))
    }
    const list = (await harness.invoke('savedResponse:list', 'endpoint', 'ep-1')) as {
      data: Array<{ name: string }>
    }
    expect(list.data.map((r) => r.name)).toEqual(['second', 'first'])
  })

  it('rejects an owner row that no longer exists (stale tab) instead of creating an orphan', async () => {
    const res = (await harness.invoke('savedResponse:create', {
      owner_type: 'endpoint',
      owner_id: 'deleted-ep',
      name: 'x',
      response_json: snapshot,
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/no longer exists/i)
  })

  it('rejects a missing owner or empty snapshot with a structured error', async () => {
    const noOwner = (await harness.invoke('savedResponse:create', {
      owner_type: 'endpoint',
      owner_id: '',
      name: 'x',
      response_json: snapshot,
    })) as { success: boolean; error?: string }
    expect(noOwner.success).toBe(false)
    expect(noOwner.error).toMatch(/save the request/i)

    const noBody = (await harness.invoke('savedResponse:create', {
      owner_type: 'endpoint',
      owner_id: 'ep-1',
      name: 'x',
      response_json: '',
    })) as { success: boolean }
    expect(noBody.success).toBe(false)

    const blankName = (await harness.invoke('savedResponse:create', {
      owner_type: 'endpoint',
      owner_id: 'ep-1',
      name: '   ',
      response_json: snapshot,
    })) as { success: boolean; error?: string }
    expect(blankName.success).toBe(false)
    expect(blankName.error).toMatch(/name/i)
  })
})

describe('savedResponse:rename + delete', () => {
  it('renames and deletes by id', async () => {
    const created = (await harness.invoke('savedResponse:create', {
      owner_type: 'test_suite_item',
      owner_id: 'item-1',
      name: 'old',
      response_json: snapshot,
    })) as { data: { id: string } }

    const renamed = (await harness.invoke('savedResponse:rename', created.data.id, 'new name')) as {
      success: boolean
      data: boolean
    }
    expect(renamed.success).toBe(true)
    expect(renamed.data).toBe(true)
    let list = (await harness.invoke('savedResponse:list', 'test_suite_item', 'item-1')) as {
      data: Array<{ name: string }>
    }
    expect(list.data[0].name).toBe('new name')

    const deleted = (await harness.invoke('savedResponse:delete', created.data.id)) as {
      success: boolean
      data: boolean
    }
    expect(deleted.data).toBe(true)
    list = (await harness.invoke('savedResponse:list', 'test_suite_item', 'item-1')) as {
      data: Array<{ name: string }>
    }
    expect(list.data).toEqual([])

    const again = (await harness.invoke('savedResponse:delete', created.data.id)) as {
      success: boolean
      data: boolean
    }
    expect(again.success).toBe(true)
    expect(again.data).toBe(false)
  })
})

describe('listByProject / get / request_json (examples in the APIs tree)', () => {
  it('listByProject returns every example of the project WITHOUT the JSON blobs', async () => {
    await harness.invoke('savedResponse:create', {
      owner_type: 'saved_request',
      owner_id: 'sr-1',
      name: '200 OK',
      status_code: 200,
      response_json: snapshot,
      request_json: JSON.stringify({ configured: { method: 'GET', url: '{{base}}/x' } }),
    })
    await harness.invoke('savedResponse:create', {
      owner_type: 'endpoint',
      owner_id: 'ep-1',
      name: '404',
      status_code: 404,
      response_json: snapshot,
    })
    const res = (await harness.invoke('savedResponse:listByProject', projectId)) as {
      success: boolean
      data: Array<Record<string, unknown>>
    }
    expect(res.success).toBe(true)
    expect(res.data).toHaveLength(2)
    expect(res.data.map((r) => r.owner_id).sort()).toEqual(['ep-1', 'sr-1'])
    for (const row of res.data) {
      expect(row).not.toHaveProperty('response_json')
      expect(row).not.toHaveProperty('request_json')
      expect(row).toHaveProperty('status_code')
    }
    const other = (await harness.invoke('savedResponse:listByProject', 'nope')) as {
      data: unknown[]
    }
    expect(other.data).toEqual([])
  })

  it('get returns the full row, and a structured error once it is gone', async () => {
    const created = (await harness.invoke('savedResponse:create', {
      owner_type: 'saved_request',
      owner_id: 'sr-1',
      name: 'x',
      response_json: snapshot,
      request_json: JSON.stringify({ configured: { method: 'GET', url: 'u' } }),
    })) as { data: { id: string } }
    const got = (await harness.invoke('savedResponse:get', created.data.id)) as {
      success: boolean
      data: { response_json: string; request_json: string }
    }
    expect(got.success).toBe(true)
    expect(got.data.response_json).toBe(snapshot)
    expect(JSON.parse(got.data.request_json).configured.url).toBe('u')
    await harness.invoke('savedResponse:delete', created.data.id)
    const gone = (await harness.invoke('savedResponse:get', created.data.id)) as {
      success: boolean
      error?: string
    }
    expect(gone.success).toBe(false)
    expect(gone.error).toMatch(/no longer exists/)
  })

  it('masks credential headers in the stored request snapshot (sent AND configured), in main', async () => {
    const created = (await harness.invoke('savedResponse:create', {
      owner_type: 'saved_request',
      owner_id: 'sr-1',
      name: 'auth',
      response_json: snapshot,
      request_json: JSON.stringify({
        configured: {
          method: 'GET',
          url: '{{base}}',
          headers: [
            { id: '1', key: 'Authorization', value: 'Bearer {{token}}', enabled: true },
            { id: '2', key: 'Accept', value: 'application/json', enabled: true },
          ],
        },
        sent: {
          method: 'GET',
          url: 'https://api.test',
          headers: {
            authorization: 'Bearer real-secret',
            Cookie: 'session=abc',
            Accept: 'application/json',
          },
          body: '{}',
        },
      }),
    })) as { data: { id: string; request_json: string } }
    const stored = created.data.request_json
    expect(stored).not.toContain('real-secret')
    expect(stored).not.toContain('session=abc')
    expect(stored).not.toContain('Bearer {{token}}')
    const parsed = JSON.parse(stored) as {
      configured: { headers: Array<{ key: string; value: string }> }
      sent: { headers: Record<string, string> }
    }
    expect(parsed.sent.headers.Accept).toBe('application/json')
    expect(parsed.sent.headers.authorization).toBe('••••••')
    expect(parsed.configured.headers[1].value).toBe('application/json')
    // Raw DB row is masked too — not just the echo.
    const row = testDb
      .prepare('SELECT request_json FROM saved_responses WHERE id = ?')
      .get(created.data.id) as { request_json: string }
    expect(row.request_json).not.toContain('real-secret')
  })

  it('stores NULL request_json when the renderer sends none or garbage', async () => {
    const none = (await harness.invoke('savedResponse:create', {
      owner_type: 'saved_request',
      owner_id: 'sr-1',
      name: 'a',
      response_json: snapshot,
    })) as { data: { request_json: string | null } }
    expect(none.data.request_json).toBeNull()
    const garbage = (await harness.invoke('savedResponse:create', {
      owner_type: 'saved_request',
      owner_id: 'sr-1',
      name: 'b',
      response_json: snapshot,
      request_json: '{not json',
    })) as { data: { request_json: string | null } }
    expect(garbage.data.request_json).toBeNull()
  })
})
