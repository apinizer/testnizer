/**
 * Issue #125 — `savedResponse:*` IPC handlers: named response examples
 * pinned to a request (endpoint / saved request / suite item).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb, seedProject, seedWorkspace } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { registerSavedResponseHandlers } = await import('../../../src/main/ipc/saved-response.handler')

let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerSavedResponseHandlers()
})

const snapshot = JSON.stringify({ status: 200, statusText: 'OK', body: '{"ok":true}', headers: {} })

describe('savedResponse:create + list', () => {
  it('creates a named example and lists it for its owner only', async () => {
    const created = (await harness.invoke('savedResponse:create', {
      project_id: projectId,
      owner_type: 'saved_request',
      owner_id: 'sr-1',
      name: '200 success sample',
      protocol: 'http',
      method: 'GET',
      url: 'https://api.test/users',
      status_code: 200,
      response_json: snapshot,
    })) as { success: boolean; data?: { id: string; name: string } }
    expect(created.success).toBe(true)
    expect(created.data?.name).toBe('200 success sample')

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
