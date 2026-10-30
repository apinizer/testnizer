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
import { startMqtt5StubBroker, type Mqtt5StubBroker } from '../../helpers/mqtt5-stub-broker'
import { mqttMetaOf, type MqttRequestFields } from '../../../src/shared/realtime-meta'
import {
  DEFAULT_MQTT_SETTINGS,
  emptyConnectProperties,
  emptyLastWill,
  emptyMessageProperties,
  emptyPublishDraft,
  emptyWillProperties,
} from '../../../src/shared/mqtt'

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

/**
 * Issue #284 × #195 / #196 — MQTT 5 CONNECT and will USER PROPERTIES with a
 * credential-like name (`x-api-key`, `authorization`) are credentials, the
 * same rule the renderer's localStorage withholding uses (header-name rule,
 * `MQTT_CREDENTIALS`). Neither History (the `configured` editor template the
 * row reopens from) nor the Console may hold their values — by name where
 * they sit in a user-property row, and by VALUE wherever else they appear
 * (a message that echoes one). A neutral property (`tenant`) is kept.
 */
describe('mqtt:connect — credential-named MQTT 5 user properties (issue #284)', () => {
  const KEY = 'CANARY-mqtt-apikey-41d7'
  const AUTHZ = 'CANARY-mqtt-will-authz-93be'
  const kv = (key: string, value: string) => ({ id: key, key, value, enabled: true })
  let v5: Mqtt5StubBroker

  beforeAll(async () => {
    v5 = await startMqtt5StubBroker()
  })
  afterAll(async () => {
    mqttDisconnectAll()
    await v5.close()
  })

  /** The renderer's own editor state → `_configured` and the wire payload. */
  function request(url: string) {
    const fields: MqttRequestFields = {
      url,
      clientId: 'up-canary',
      version: 5,
      username: '',
      password: '',
      settings: DEFAULT_MQTT_SETTINGS,
      properties: {
        ...emptyConnectProperties(),
        userProperties: [kv('x-api-key', KEY), kv('tenant', 'acme-tenant-1')],
      },
      lastWill: {
        ...emptyLastWill(),
        topic: 'will/up',
        payload: 'bye',
        properties: { ...emptyWillProperties(), userProperties: [kv('authorization', AUTHZ)] },
      },
      topics: [],
      composer: emptyPublishDraft(),
      savedMessages: [],
    }
    return {
      url,
      clientId: fields.clientId,
      version: 5,
      properties: fields.properties,
      will: {
        topic: fields.lastWill.topic,
        content: fields.lastWill.payload,
        contentType: 'text',
        qos: 0,
        retain: false,
        properties: fields.lastWill.properties,
      },
      subscriptions: [{ topic: 'echo/#', qos: 1 }],
      _configured: { url, meta: { mqtt: mqttMetaOf(fields) } },
    }
  }

  it('connect + an echoing message: History and Console never hold the values', async () => {
    const sent: Array<[string, unknown]> = []
    const res = (await invokeWith(sent, 'mqtt:connect', request(v5.url))) as Res
    expect(res.success, res.error).toBe(true)
    // The broker got the real values (masking is for History / Console only).
    expect(JSON.stringify(v5.connects.at(-1))).toContain(KEY)
    const id = res.data!.connectionId
    for (let i = 0; i < 50 && !sent.some(([, p]) => JSON.stringify(p).includes('subscribed')); i++)
      await new Promise((r) => setTimeout(r, 10))

    const pub = (await harness.invoke('mqtt:publish', id, {
      topic: 'echo/a',
      content: `plain echo ${KEY} / ${AUTHZ}`,
      contentType: 'text',
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
    await harness.invoke('mqtt:disconnect', id)

    const history = historyText()
    expect(history).toContain('acme-tenant-1')
    expect(history).toContain('x-api-key')
    expect(consoleEntries.length).toBeGreaterThan(2)
    for (const v of [KEY, AUTHZ]) {
      expect(history).not.toContain(v)
      expect(JSON.stringify(consoleEntries)).not.toContain(v)
    }
  })

  it('History: the name rule masks credential-named user properties the connect never sends', async () => {
    // Composer / saved-message PUBLISH properties ride only in `configured`
    // (the editor template) — they are not connection secrets, so only the
    // `userProperties` name rule in sensitive-scrub keeps them off disk.
    const COMPOSER = 'CANARY-mqtt-composer-auth-5c0e'
    const SAVED = 'CANARY-mqtt-saved-apikey-77a1'
    const req = request(v5.url)
    const mqtt = req._configured.meta.mqtt as Record<string, unknown>
    mqtt.composer = {
      ...emptyPublishDraft(),
      topic: 'cmd',
      properties: { ...emptyMessageProperties(), userProperties: [kv('authorization', COMPOSER)] },
    }
    mqtt.savedMessages = [
      {
        ...emptyPublishDraft(),
        id: 'm1',
        name: 'Saved',
        properties: { ...emptyMessageProperties(), userProperties: [kv('x-api-key', SAVED)] },
      },
    ]
    const res = (await harness.invoke('mqtt:connect', req)) as Res
    expect(res.success, res.error).toBe(true)
    await harness.invoke('mqtt:disconnect', res.data!.connectionId)
    const history = historyText()
    expect(history).toContain('authorization')
    expect(history).not.toContain(COMPOSER)
    expect(history).not.toContain(SAVED)
  })

  it('a refused CONNECT: the History row and the Console line hold no value either', async () => {
    const refusing = await startMqtt5StubBroker({ refuse: 0x87 })
    try {
      const res = (await harness.invoke('mqtt:connect', request(refusing.url))) as Res
      expect(res.success).toBe(false)
    } finally {
      await refusing.close()
    }
    expect(historyText()).toContain('acme-tenant-1')
    for (const v of [KEY, AUTHZ]) {
      expect(historyText()).not.toContain(v)
      expect(JSON.stringify(consoleEntries)).not.toContain(v)
    }
  })
})
