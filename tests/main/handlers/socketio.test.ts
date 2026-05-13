/**
 * Smoke tests for `socketio:*` IPC handlers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [{ id: 1, isDestroyed: () => false, webContents: { send: () => {} } }],
    fromWebContents: () => ({ id: 1, isDestroyed: () => false, webContents: { send: () => {} } }),
    fromId: () => null,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({
  getDb: () => testDb,
}))

let shouldFailConnect = false
vi.mock('../../../src/main/protocols/socketio.engine', () => ({
  socketIOConnect: vi.fn(async () => {
    if (shouldFailConnect) throw new Error('sio failed')
    return { connectionId: 'sio-1' }
  }),
  socketIODisconnect: vi.fn(() => {}),
  socketIOCancelConnect: vi.fn(() => true),
  socketIOEmit: vi.fn(() => {}),
  socketIOSubscribe: vi.fn(() => {}),
  socketIOUnsubscribe: vi.fn(() => {}),
  socketIOSetEventCallback: vi.fn(() => {}),
}))

const { registerSocketIOHandlers } = await import('../../../src/main/ipc/socketio.handler')

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  shouldFailConnect = false
  registerSocketIOHandlers()
})

describe('socketio:connect + disconnect', () => {
  it('connects and returns the engine response', async () => {
    const res = (await harness.invoke('socketio:connect', {
      url: 'http://example',
      namespace: '/chat',
    })) as { success: boolean; data?: { connectionId: string } }
    expect(res.success).toBe(true)
    expect(res.data?.connectionId).toBe('sio-1')
  })

  it('returns error envelope on engine failure', async () => {
    shouldFailConnect = true
    const res = (await harness.invoke('socketio:connect', {
      url: 'http://example',
    })) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/sio failed/)
  })

  it('disconnects a connection', async () => {
    await harness.invoke('socketio:connect', { url: 'http://example' })
    const res = (await harness.invoke('socketio:disconnect', 'sio-1')) as {
      success: boolean
    }
    expect(res.success).toBe(true)
  })
})

describe('socketio:emit + subscribe + unsubscribe', () => {
  it('emits and subscribes successfully', async () => {
    await harness.invoke('socketio:connect', { url: 'http://example' })
    const emit = (await harness.invoke('socketio:emit', 'sio-1', 'msg', { x: 1 })) as {
      success: boolean
    }
    expect(emit.success).toBe(true)

    const sub = (await harness.invoke('socketio:subscribe', 'sio-1', 'msg')) as {
      success: boolean
    }
    expect(sub.success).toBe(true)

    const unsub = (await harness.invoke('socketio:unsubscribe', 'sio-1', 'msg')) as {
      success: boolean
    }
    expect(unsub.success).toBe(true)
  })

  it('cancelConnect returns canceled flag', async () => {
    const res = (await harness.invoke('socketio:cancelConnect', 'pending-x')) as {
      success: boolean
      data?: { canceled: boolean }
    }
    expect(res.success).toBe(true)
    expect(res.data?.canceled).toBe(true)
  })
})
