/**
 * Issue #275 / #283 — `socketio:*` handler wiring for the new engine hooks:
 *   - the engine's `onClose` becomes a dedicated `socketio:closed` push
 *     ({connectionId, reason}, like `mcp:connectionClosed`), one Console line,
 *     and the per-connection context is dropped;
 *   - connect forwards headers, settings and the listen config;
 *   - `socketio:emitArgs` forwards the arguments and the ack flag and returns
 *     the engine's error (e.g. invalid JSON) as `{success:false}`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'
import type { SocketIOClosedInfo } from '../../../src/main/protocols/socketio.engine'

const harness = setupHandlerHarness()
const sent: Array<[string, unknown]> = []
const win = {
  id: 1,
  isDestroyed: () => false,
  webContents: { send: (ch: string, payload: unknown) => sent.push([ch, payload]) },
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

const logged: Array<{ message: string; level?: string }> = []
vi.mock('../../../src/main/lib/console-logger', () => ({
  logEvent: (e: { message: string; level?: string }) => logged.push(e),
  logRequestResponse: () => {},
}))

let onClose: ((c: SocketIOClosedInfo) => void) | undefined
const connectSpy = vi.fn()
const emitWire = vi.fn()
vi.mock('../../../src/main/protocols/socketio.engine', () => ({
  socketIOConnect: vi.fn(async (opts: { onClose?: (c: SocketIOClosedInfo) => void }) => {
    connectSpy(opts)
    onClose = opts.onClose
    return { connectionId: 'sio-1', url: 'http://x', namespace: '/' }
  }),
  socketIODisconnect: vi.fn(),
  socketIOCancelConnect: vi.fn(() => true),
  socketIOEmit: vi.fn(),
  socketIOEmitWire: (...a: unknown[]) => emitWire(...a),
  socketIOSetListen: vi.fn(),
  socketIOSubscribe: vi.fn(),
  socketIOUnsubscribe: vi.fn(),
  socketIOSetEventCallback: vi.fn(),
}))

const { registerSocketIOHandlers } = await import('../../../src/main/ipc/socketio.handler')

beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  sent.length = 0
  logged.length = 0
  onClose = undefined
  connectSpy.mockClear()
  emitWire.mockReset()
  registerSocketIOHandlers()
})

describe('socketio:closed push (issue #275)', () => {
  it('forwards the engine close to the renderer with its reason and logs it', async () => {
    await harness.invoke('socketio:connect', { url: 'http://x' })
    expect(onClose).toBeTypeOf('function')

    onClose!({ connectionId: 'sio-1', reason: 'io server disconnect' })

    expect(sent).toContainEqual([
      'socketio:closed',
      { connectionId: 'sio-1', reason: 'io server disconnect' },
    ])
    const line = logged.find((l) => l.message.includes('closed by the server'))
    expect(line?.message).toContain('io server disconnect')
    expect(line?.level).toBe('warning')
  })
})

describe('socketio:connect forwards the #283 request fields', () => {
  it('passes headers, settings and the listen config to the engine', async () => {
    await harness.invoke('socketio:connect', {
      url: 'http://x',
      extraHeaders: { 'X-Team': 'a' },
      settings: { path: '/io', retryCount: 2 },
      listen: { all: false, events: ['chat'] },
    })
    expect(connectSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        extraHeaders: { 'X-Team': 'a' },
        settings: { path: '/io', retryCount: 2 },
        listen: { all: false, events: ['chat'] },
      }),
    )
  })
})

describe('socketio:emitArgs (issue #283)', () => {
  it('forwards arguments and the ack flag', async () => {
    const args = [
      { content: '{"a":1}', contentType: 'json' },
      { content: 'AQI=', contentType: 'base64' },
    ]
    const res = (await harness.invoke('socketio:emitArgs', 'sio-1', 'chat', args, {
      ack: true,
    })) as { success: boolean }
    expect(res.success).toBe(true)
    expect(emitWire).toHaveBeenCalledWith('sio-1', 'chat', args, { ack: true })
  })

  it('returns the engine error as a failed envelope', async () => {
    emitWire.mockImplementation(() => {
      throw new Error('Argument 1 is not valid JSON: Unexpected token')
    })
    const res = (await harness.invoke('socketio:emitArgs', 'sio-1', 'chat', [
      { content: '{', contentType: 'json' },
    ])) as { success: boolean; error?: string }
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/not valid JSON/)
  })
})
