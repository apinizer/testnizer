/**
 * Smoke tests for `ws:*` IPC handlers.
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
vi.mock('../../../src/main/protocols/websocket.engine', () => ({
  connect: vi.fn(async () => {
    if (shouldFailConnect) throw new Error('handshake failed')
    return { connectionId: 'ws-1' }
  }),
  disconnect: vi.fn(() => ({ ok: true })),
  cancelConnect: vi.fn(() => true),
  sendMessage: vi.fn(() => ({ sent: true })),
}))

const { registerWebSocketHandlers } = await import(
  '../../../src/main/ipc/websocket.handler'
)

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  shouldFailConnect = false
  registerWebSocketHandlers()
})

describe('ws:connect + ws:disconnect', () => {
  it('returns success with connection id on connect', async () => {
    const res = (await harness.invoke('ws:connect', {
      url: 'ws://example',
    })) as { success: boolean; data?: { connectionId: string } }
    expect(res.success).toBe(true)
    expect(res.data?.connectionId).toBe('ws-1')
  })

  it('returns error envelope on engine failure', async () => {
    shouldFailConnect = true
    const res = (await harness.invoke('ws:connect', {
      url: 'ws://example',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/handshake failed/)
  })

  it('disconnects a connection', async () => {
    await harness.invoke('ws:connect', { url: 'ws://example' })
    const res = (await harness.invoke('ws:disconnect', 'ws-1')) as { success: boolean }
    expect(res.success).toBe(true)
  })
})

describe('ws:send + ws:cancelConnect', () => {
  it('sends a message and returns engine result', async () => {
    await harness.invoke('ws:connect', { url: 'ws://example' })
    const res = (await harness.invoke('ws:send', 'ws-1', 'hello')) as {
      success: boolean
      data?: { sent: boolean }
    }
    expect(res.success).toBe(true)
    expect(res.data?.sent).toBe(true)
  })

  it('cancelConnect returns envelope with canceled flag', async () => {
    const res = (await harness.invoke('ws:cancelConnect', 'pending-x')) as {
      success: boolean
      data?: { canceled: boolean }
    }
    expect(res.success).toBe(true)
    expect(res.data?.canceled).toBe(true)
  })
})
