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

/**
 * Issue #283 (security) — the connection's own auth values are scrubbed from
 * EVERY Console entry, the way History scrubs them (`extra_secrets`). On a v2
 * server the token travels in the handshake QUERY, and a v2 refusal / transport
 * error can carry the URL or the bare token. The Console used to get no
 * `secrets` at all, so only the name rule applied.
 */
describe('socketio Console: the auth values are scrubbed everywhere (issue #283)', () => {
  const CANARY = 'CANARY-sio-tok-7f3a91c2'
  const v2 = () => ({
    url: 'http://h.test:3000',
    namespace: '/chat',
    auth: { token: CANARY },
    settings: { version: '2' },
  })
  const historyText = (): string => JSON.stringify(testDb.prepare('SELECT * FROM history').all())
  type ConnectOpts = { onClose: (i: { connectionId: string; reason: string }) => void }

  it('a v2 handshake error carrying the token in the URL query never shows it', async () => {
    const { socketIOConnect } = await import('../../../src/main/protocols/socketio.engine')
    vi.mocked(socketIOConnect).mockRejectedValueOnce(
      new Error(`xhr poll error: GET http://h.test:3000/socket.io/?token=${CANARY}&EIO=3 failed`),
    )
    const res = (await harness.invoke('socketio:connect', v2())) as { success: boolean }
    expect(res.success).toBe(false)
    expect(consoleEntries.length).toBeGreaterThan(0)
    expect(JSON.stringify(consoleEntries)).not.toContain(CANARY)
    expect(historyText()).toContain('h.test')
    expect(historyText()).not.toContain(CANARY)
  })

  it('a v2 refusal that echoes the bare token never shows it', async () => {
    const { socketIOConnect } = await import('../../../src/main/protocols/socketio.engine')
    vi.mocked(socketIOConnect).mockRejectedValueOnce(
      new Error(`Authentication error: unknown ${CANARY}`),
    )
    await harness.invoke('socketio:connect', v2())
    expect(consoleEntries.length).toBeGreaterThan(0)
    expect(JSON.stringify(consoleEntries)).not.toContain(CANARY)
    expect(historyText()).not.toContain(CANARY)
  })

  it('success path: emits, a server close and disconnect scrub the token too', async () => {
    const { socketIOConnect } = await import('../../../src/main/protocols/socketio.engine')
    const res = (await harness.invoke('socketio:connect', v2())) as { success: boolean }
    expect(res.success).toBe(true)
    await harness.invoke('socketio:emit', 'sio-1', 'echo', `the server said ${CANARY}`)
    await harness.invoke('socketio:emitArgs', 'sio-1', 'echo', [
      { content: `plain ${CANARY}`, contentType: 'text' },
    ])
    const opts = vi.mocked(socketIOConnect).mock.calls.at(-1)![0] as unknown as ConnectOpts
    opts.onClose({ connectionId: 'sio-1', reason: `kicked: ${CANARY}` })
    expect(consoleEntries.length).toBeGreaterThanOrEqual(4)
    expect(JSON.stringify(consoleEntries)).not.toContain(CANARY)
    expect(historyText()).not.toContain(CANARY)
    const row = testDb.prepare('SELECT request_snapshot FROM history').get() as {
      request_snapshot: string
    }
    expect(JSON.parse(row.request_snapshot)).toMatchObject({ hasAuth: true })
  })

  it('a failed emit and a disconnect after a connect scrub the token', async () => {
    await harness.invoke('socketio:connect', v2())
    const { socketIOEmit } = await import('../../../src/main/protocols/socketio.engine')
    vi.mocked(socketIOEmit).mockImplementationOnce(() => {
      throw new Error(`write failed for ${CANARY}`)
    })
    consoleEntries.length = 0
    await harness.invoke('socketio:emit', 'sio-1', 'echo', 'x')
    await harness.invoke('socketio:disconnect', 'sio-1')
    expect(consoleEntries).toHaveLength(2)
    expect(JSON.stringify(consoleEntries)).not.toContain(CANARY)
  })
})
