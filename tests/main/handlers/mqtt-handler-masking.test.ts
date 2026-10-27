/**
 * Issue #284 × #195 / #196 — the MQTT password never reaches History or the
 * Console. Real handler, real engine, real broker (Aedes with a login), real
 * console logger and History repo; only Electron is stubbed.
 *
 *  - the History row's request snapshot records THAT a password was sent,
 *    never the value; the `configured` template (the editor state, kept for
 *    reopen) has it masked by the name rule; a failed login row too;
 *  - Console lines of connect / publish / receive scrub the password value
 *    wherever it appears (a payload that echoes it, the URL userinfo);
 *  - events go to the renderer that connected, tagged with the connection id.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setupHandlerHarness, makeElectronMock, createTestDb } from './helpers'
import { startAedesBroker, type AedesTestBroker } from '../../helpers/mqtt-aedes-broker'

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

const { registerMqttHandlers } = await import('../../../src/main/ipc/mqtt.handler')
const { mqttDisconnectAll } = await import('../../../src/main/protocols/mqtt.engine')

const SECRET = 'mqtt-canary-pw-5e1d'
let broker: AedesTestBroker

beforeAll(async () => {
  broker = await startAedesBroker({ auth: { username: 'ann', password: SECRET } })
})
afterAll(async () => {
  mqttDisconnectAll()
  await broker.close()
})
beforeEach(() => {
  harness.reset()
  testDb = createTestDb()
  consoleEntries.length = 0
  registerMqttHandlers()
})

type Res = { success: boolean; data?: { connectionId: string }; error?: string }

/** Invoke with a sender that records what it is sent. */
async function invokeWith(sent: Array<[string, unknown]>, channel: string, ...args: unknown[]) {
  const fn = harness.handlers.get(channel)!
  return fn({ sender: { id: 7, send: (c: string, p: unknown) => sent.push([c, p]) } }, ...args)
}

function historyText(): string {
  return JSON.stringify(testDb.prepare('SELECT * FROM history').all())
}

describe('mqtt:connect — History and Console never hold the password', () => {
  it('a successful connect + publish + receive', async () => {
    const sent: Array<[string, unknown]> = []
    const res = (await invokeWith(sent, 'mqtt:connect', {
      url: broker.url,
      version: 4,
      username: 'ann',
      password: SECRET,
      subscriptions: [{ topic: 'echo/#', qos: 1 }],
      _configured: {
        url: broker.url,
        meta: { mqtt: { url: broker.url, username: 'ann', password: SECRET } },
      },
    })) as Res
    expect(res.success, res.error).toBe(true)
    const id = res.data!.connectionId
    for (let i = 0; i < 50 && !sent.some(([, p]) => JSON.stringify(p).includes('subscribed')); i++)
      await new Promise((r) => setTimeout(r, 10))

    const pub = (await harness.invoke('mqtt:publish', id, {
      topic: 'echo/a',
      content: `{"note":"the password is ${SECRET}"}`,
      contentType: 'json',
      qos: 1,
      retain: false,
    })) as Res
    expect(pub.success, pub.error).toBe(true)
    for (
      let i = 0;
      i < 50 && !sent.some(([, p]) => (p as { direction?: string }).direction === 'in');
      i++
    )
      await new Promise((r) => setTimeout(r, 10))

    // Routed to the connecting renderer, tagged with the connection id.
    const events = sent
      .filter(([c]) => c === 'mqtt:event')
      .map(([, p]) => p as Record<string, unknown>)
    expect(events.every((e) => e.connectionId === id)).toBe(true)
    expect(events.some((e) => e.direction === 'in' && e.topic === 'echo/a')).toBe(true)

    expect(historyText()).not.toContain(SECRET)
    const row = testDb.prepare('SELECT request_snapshot FROM history').get() as {
      request_snapshot: string
    }
    expect(JSON.parse(row.request_snapshot)).toMatchObject({ username: 'ann', hasPassword: true })

    expect(consoleEntries.length).toBeGreaterThan(2)
    expect(JSON.stringify(consoleEntries)).not.toContain(SECRET)
    await harness.invoke('mqtt:disconnect', id)
  })

  it('a refused login; a password in the URL userinfo', async () => {
    const res = (await harness.invoke('mqtt:connect', {
      url: broker.url,
      version: 4,
      username: 'ann',
      password: 'wrong-pw-long-enough',
    })) as Res
    expect(res.success).toBe(false)
    const URL_PW = 'url-secret-pw-9b2c'
    const viaUrl = (await harness.invoke('mqtt:connect', {
      url: broker.url.replace('mqtt://', `mqtt://ann:${URL_PW}@`),
      version: 4,
    })) as Res
    expect(viaUrl.success).toBe(false)
    for (const v of ['wrong-pw-long-enough', URL_PW]) {
      expect(historyText()).not.toContain(v)
      expect(JSON.stringify(consoleEntries)).not.toContain(v)
    }
  })
})
