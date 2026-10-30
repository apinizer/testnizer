/**
 * Issue #283 — History and Console show the Socket.IO target the client
 * actually connects to: the namespace on the PATH, the query apart
 * (`sioTarget`). The handler used to concatenate `url + namespace`, so a URL
 * with Params (`wss://h/x?room=1`) + `/chat` was shown as
 * `wss://h/x?room=1/chat` — the namespace inside the query.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'
import { sioDisplayTarget } from '../../../src/main/protocols/socketio-client'

const harness = setupHandlerHarness()
const consoleEntries: Array<{ url?: string }> = []
const win = {
  id: 1,
  isDestroyed: () => false,
  webContents: {
    send: (ch: string, payload: unknown) => {
      if (ch === 'console:log') consoleEntries.push(payload as { url?: string })
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
  socketIOConnect: vi.fn(async () => ({ connectionId: 'sio-1', url: 'x', namespace: '/chat' })),
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
const engine = await import('../../../src/main/protocols/socketio.engine')

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  consoleEntries.length = 0
  registerSocketIOHandlers()
})

const historyUrls = (): string[] =>
  (testDb.prepare('SELECT url FROM history').all() as Array<{ url: string }>).map((r) => r.url)

describe('sioDisplayTarget', () => {
  it('puts the namespace on the path and keeps the query after it', () => {
    expect(sioDisplayTarget('wss://h/x?room=1', '/chat')).toBe('wss://h/x/chat?room=1')
    expect(sioDisplayTarget('http://h:1/', '/')).toBe('http://h:1')
    expect(sioDisplayTarget('http://h:1', undefined)).toBe('http://h:1')
    expect(sioDisplayTarget('http://h:1#frag', 'chat')).toBe('http://h:1/chat')
  })
})

describe('socketio:connect History / Console target', () => {
  it('success: the namespace goes on the path, not into the query', async () => {
    const res = (await harness.invoke('socketio:connect', {
      url: 'wss://h/x?room=1',
      namespace: '/chat',
    })) as { success: boolean }
    expect(res.success).toBe(true)
    await harness.invoke('socketio:disconnect', 'sio-1')
    expect(historyUrls()).toEqual(['wss://h/x/chat?room=1'])
    expect(consoleEntries.map((e) => e.url)).toEqual([
      'wss://h/x/chat?room=1',
      'wss://h/x/chat?room=1',
    ])
  })

  it('a failed connect shows the same target', async () => {
    vi.mocked(engine.socketIOConnect).mockRejectedValueOnce(new Error('refused'))
    await harness.invoke('socketio:connect', { url: 'wss://h/x?room=1', namespace: '/chat' })
    expect(historyUrls()).toEqual(['wss://h/x/chat?room=1'])
    expect(consoleEntries[0].url).toBe('wss://h/x/chat?room=1')
  })
})
