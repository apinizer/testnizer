/**
 * Issue #283 × #196 — a multi-argument Socket.IO emit never puts a literal
 * credential in the Console. The real console logger + masking run here (only
 * the engine is stubbed): the handler logs the arguments as ONE JSON array so
 * the name rule (`"password": …`) applies; a comma-joined list would not look
 * like JSON and the value would reach the Console raw.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'

const harness = setupHandlerHarness()
const consoleEntries: unknown[] = []
const win = {
  id: 1,
  isDestroyed: () => false,
  webContents: {
    send: (ch: string, payload: unknown) => {
      if (ch === 'console:log') consoleEntries.push(payload)
    },
  },
}
vi.mock('electron', () => ({
  ...makeElectronMock(),
  BrowserWindow: {
    getFocusedWindow: () => null,
    getAllWindows: () => [win],
    fromWebContents: () => win,
    fromId: () => win,
  },
}))

let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

vi.mock('../../../src/main/protocols/socketio.engine', () => ({
  socketIOConnect: vi.fn(async () => ({ connectionId: 'sio-1', url: 'http://x', namespace: '/' })),
  socketIODisconnect: vi.fn(),
  socketIOCancelConnect: vi.fn(() => true),
  socketIOEmit: vi.fn(),
  socketIOEmitWire: vi.fn(),
  socketIOSetListen: vi.fn(),
  socketIOSubscribe: vi.fn(),
  socketIOUnsubscribe: vi.fn(),
  socketIOSetEventCallback: vi.fn(),
}))

const { registerSocketIOHandlers } = await import('../../../src/main/ipc/socketio.handler')

const SECRET = 'lit-secret-123'

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  consoleEntries.length = 0
  registerSocketIOHandlers()
})

describe('socketio:emitArgs Console entry', () => {
  it('masks a credential inside one of several arguments (body and message)', async () => {
    await harness.invoke('socketio:connect', { url: 'http://x' })
    consoleEntries.length = 0
    await harness.invoke('socketio:emitArgs', 'sio-1', 'login', [
      { content: 'plain text', contentType: 'text' },
      { content: `{"user":"ann","password":"${SECRET}"}`, contentType: 'json' },
      { content: 'AQI=', contentType: 'base64' },
    ])
    expect(consoleEntries).toHaveLength(1)
    const text = JSON.stringify(consoleEntries[0])
    expect(text).not.toContain(SECRET)
    expect(text).toContain('plain text')
    expect(text).toContain('<binary base64>')
  })
})
