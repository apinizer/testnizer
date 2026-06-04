/**
 * Smoke tests for workspace IPC handlers.
 *
 * Envelope + happy path + error path for the five `workspace:*` channels.
 * Uses the shared in-memory DB helper and an electron-module stub to drive
 * handlers without a real Electron process.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  setupHandlerHarness,
  makeElectronMock,
  createTestDb,
} from './helpers'

const harness = setupHandlerHarness()

vi.mock('electron', () => makeElectronMock())

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

const { registerWorkspaceHandlers } = await import('../../../src/main/ipc/workspace.handler')

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  registerWorkspaceHandlers()
})

describe('workspace:list', () => {
  it('returns success envelope', async () => {
    const res = (await harness.invoke('workspace:list')) as {
      success: boolean
      data?: unknown[]
    }
    expect(res.success).toBe(true)
    expect(Array.isArray(res.data)).toBe(true)
  })
})

describe('workspace:create', () => {
  it('creates and returns the new workspace', async () => {
    const res = (await harness.invoke('workspace:create', {
      name: 'New WS',
      description: 'desc',
      color: '#123',
    })) as { success: boolean; data?: { id: string; name: string } }

    expect(res.success).toBe(true)
    expect(res.data?.name).toBe('New WS')
    expect(typeof res.data?.id).toBe('string')
  })

  it('rejects missing required field with error envelope', async () => {
    // name is non-null in schema — missing it must surface as a failure
    const res = (await harness.invoke('workspace:create', { description: 'x' })) as {
      success: boolean
      error?: string
    }
    expect(res.success).toBe(false)
    expect(typeof res.error).toBe('string')
  })
})

describe('workspace:get', () => {
  it('returns the workspace by id', async () => {
    const created = (await harness.invoke('workspace:create', { name: 'A' })) as {
      data: { id: string }
    }
    const res = (await harness.invoke('workspace:get', created.data.id)) as {
      success: boolean
      data?: { id: string }
    }
    expect(res.success).toBe(true)
    expect(res.data?.id).toBe(created.data.id)
  })

  it('returns success with undefined data for unknown id', async () => {
    const res = (await harness.invoke('workspace:get', 'no-such-id')) as {
      success: boolean
      data?: unknown
    }
    expect(res.success).toBe(true)
    expect(res.data == null).toBe(true)
  })
})

describe('workspace:update and delete', () => {
  it('updates a workspace name', async () => {
    const created = (await harness.invoke('workspace:create', { name: 'A' })) as {
      data: { id: string }
    }
    const res = (await harness.invoke('workspace:update', created.data.id, {
      name: 'B',
    })) as { success: boolean }
    expect(res.success).toBe(true)
  })

  it('deletes a workspace', async () => {
    const created = (await harness.invoke('workspace:create', { name: 'A' })) as {
      data: { id: string }
    }
    const res = (await harness.invoke('workspace:delete', created.data.id)) as {
      success: boolean
    }
    expect(res.success).toBe(true)
  })
})
