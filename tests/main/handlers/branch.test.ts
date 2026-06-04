/**
 * Smoke tests for `branch:*` IPC handlers.
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

const { registerBranchHandlers } = await import('../../../src/main/ipc/branch.handler')

let projectId: string

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
  registerBranchHandlers()
})

describe('branch:ensureDefault + list + create', () => {
  it('ensures a default branch and lists it', async () => {
    const ensure = (await harness.invoke('branch:ensureDefault', projectId)) as {
      success: boolean
      data?: { id: string }
    }
    expect(ensure.success).toBe(true)
    expect(typeof ensure.data?.id).toBe('string')

    const list = (await harness.invoke('branch:list', projectId)) as {
      success: boolean
      data?: unknown[]
    }
    expect(list.success).toBe(true)
    expect((list.data ?? []).length).toBeGreaterThan(0)
  })

  it('creates a new branch on top of the default', async () => {
    const def = (await harness.invoke('branch:ensureDefault', projectId)) as {
      data: { id: string }
    }
    const created = (await harness.invoke('branch:create', {
      project_id: projectId,
      name: 'feature/x',
      parent_branch_id: def.data.id,
    })) as { success: boolean; data?: { id: string } }
    expect(created.success).toBe(true)
  })

  it('returns an error envelope when listing with a bogus FK constraint', async () => {
    // listing a non-existent project just returns empty array, but
    // create needs project_id to be valid — pass undefined to trigger
    // SQLite NOT NULL violation.
    const res = (await harness.invoke('branch:create', { name: 'x' })) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
  })
})

describe('branch:rename + delete', () => {
  it('renames and then refuses to delete the default', async () => {
    const def = (await harness.invoke('branch:ensureDefault', projectId)) as {
      data: { id: string }
    }
    // Rename succeeds
    const ren = (await harness.invoke('branch:rename', def.data.id, 'renamed')) as {
      success: boolean
    }
    expect(ren.success).toBe(true)

    // Deleting the default is refused with success: false
    const del = (await harness.invoke('branch:delete', def.data.id)) as {
      success: boolean
      error?: string
    }
    expect(del.success).toBe(false)
    expect(typeof del.error).toBe('string')
  })

  it('rename returns success: false when the branch does not exist', async () => {
    const res = (await harness.invoke('branch:rename', 'no-such-id', 'x')) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
  })
})
