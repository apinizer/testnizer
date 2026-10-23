/**
 * Issue #269 (P0 data loss) — an in-place save of a request whose row is gone
 * (deleted from the sidebar, or dropped by a git switch / pull replace) was
 * reported as a success: `endpoint:update` / `savedRequest:update` handed the
 * repo's `undefined` to `ipcResult`, which wrapped it as `{ success: true }`.
 * The renderer then toasted "Request saved" and marked the tab clean while
 * nothing was written. The three update handlers now refuse with
 * `{ success: false, notFound: true }` — the stable marker the renderer turns
 * into "this request no longer exists, choose where to save it".
 *
 * `testSuiteItem:update` already answered `success: false` ("Item not found"),
 * so its bug was an error toast rather than a false success; what it lacked
 * was the marker, without which the renderer could not offer Save As.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import crypto from 'node:crypto'
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
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const { registerEndpointHandlers } = await import('../../../src/main/ipc/endpoint.handler')
const { registerTestSuiteHandlers } = await import('../../../src/main/ipc/test-suite.handler')

type Res = { success: boolean; data?: unknown; error?: string; notFound?: boolean }

let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerEndpointHandlers()
  registerTestSuiteHandlers()
})

function seedSuite(): string {
  const now = Date.now()
  const suite = crypto.randomUUID()
  testDb
    .prepare(
      `INSERT INTO test_suites (id, project_id, name, sort_order, created_at, updated_at)
       VALUES (?, ?, 'Suite', 0, ?, ?)`,
    )
    .run(suite, projectId, now, now)
  return suite
}

describe('update of a row that no longer exists (issue #269)', () => {
  it('endpoint:update on a deleted endpoint fails with the notFound marker', async () => {
    const created = (await harness.invoke('endpoint:create', {
      project_id: projectId,
      name: 'Gone',
      method: 'GET',
      path: '/gone',
    })) as { data: { id: string } }
    await harness.invoke('endpoint:delete', created.data.id)

    const res = (await harness.invoke('endpoint:update', created.data.id, {
      method: 'POST',
      path: '/edited',
      request_schema: '{}',
    })) as Res
    expect(res.success).toBe(false)
    expect(res.notFound).toBe(true)
    expect(res.error).toMatch(/not found/i)
  })

  it('endpoint:update on an existing endpoint still succeeds (no false notFound)', async () => {
    const created = (await harness.invoke('endpoint:create', {
      project_id: projectId,
      name: 'Here',
      method: 'GET',
      path: '/here',
    })) as { data: { id: string } }
    const res = (await harness.invoke('endpoint:update', created.data.id, {
      method: 'POST',
    })) as Res
    expect(res.success).toBe(true)
    expect(res.notFound).toBeUndefined()
  })

  it('savedRequest:update on a deleted saved request fails with the notFound marker', async () => {
    const created = (await harness.invoke('savedRequest:create', {
      project_id: projectId,
      name: 'Gone',
      method: 'GET',
      url: 'https://x.test',
    })) as { data: { id: string } }
    await harness.invoke('savedRequest:delete', created.data.id)

    const res = (await harness.invoke('savedRequest:update', created.data.id, {
      url: 'https://x.test/edited',
    })) as Res
    expect(res.success).toBe(false)
    expect(res.notFound).toBe(true)
  })

  it('savedRequest:update with a folder move on a deleted row also carries the marker', async () => {
    const res = (await harness.invoke('savedRequest:update', 'never-existed', {
      folder_id: 'some-folder',
    })) as Res
    expect(res.success).toBe(false)
    expect(res.notFound).toBe(true)
  })

  it('testSuiteItem:update on a deleted item fails with the notFound marker', async () => {
    const suiteId = seedSuite()
    const created = (await harness.invoke('testSuiteItem:create', {
      suite_id: suiteId,
      protocol: 'http',
      name: 'Gone',
    })) as { data: { id: string } }
    await harness.invoke('testSuiteItem:delete', created.data.id)

    const res = (await harness.invoke('testSuiteItem:update', created.data.id, {
      url: 'https://x.test',
    })) as Res
    expect(res.success).toBe(false)
    expect(res.notFound).toBe(true)

    const got = (await harness.invoke('testSuiteItem:get', created.data.id)) as Res
    expect(got.success).toBe(false)
    expect(got.notFound).toBe(true)
  })
})
