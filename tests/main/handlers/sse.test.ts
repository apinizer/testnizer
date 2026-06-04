/**
 * Smoke tests for `sse:*` IPC handlers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [],
    fromWebContents: () => ({ id: 1, isDestroyed: () => false, webContents: { send: () => {} } }),
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

let shouldFailConnect = false
vi.mock('../../../src/main/protocols/sse.engine', () => ({
  connect: vi.fn(async () => {
    if (shouldFailConnect) throw new Error('cannot connect')
    return { connectionId: 'sse-1' }
  }),
  disconnect: vi.fn(() => ({ ok: true })),
  cancelConnect: vi.fn(() => true),
}))

const { registerSseHandlers } = await import('../../../src/main/ipc/sse.handler')

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  shouldFailConnect = false
  registerSseHandlers()
})

describe('sse:connect + sse:disconnect', () => {
  it('returns connection id on success', async () => {
    const res = (await harness.invoke('sse:connect', {
      url: 'http://example/stream',
      method: 'GET',
    })) as { success: boolean; data?: { connectionId: string } }
    expect(res.success).toBe(true)
    expect(res.data?.connectionId).toBe('sse-1')
  })

  it('returns error envelope on engine failure', async () => {
    shouldFailConnect = true
    const res = (await harness.invoke('sse:connect', {
      url: 'http://example/stream',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/cannot connect/)
  })

  it('disconnects an existing connection', async () => {
    await harness.invoke('sse:connect', { url: 'http://example' })
    const res = (await harness.invoke('sse:disconnect', 'sse-1')) as {
      success: boolean
    }
    expect(res.success).toBe(true)
  })
})

describe('sse:cancelConnect', () => {
  it('returns success envelope with canceled flag', async () => {
    const res = (await harness.invoke('sse:cancelConnect', 'pending-1')) as {
      success: boolean
      data?: { canceled: boolean }
    }
    expect(res.success).toBe(true)
    expect(res.data?.canceled).toBe(true)
  })
})
