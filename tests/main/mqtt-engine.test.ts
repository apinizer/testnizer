/**
 * Issue #284 — the MQTT engine against a real MQTT 3.1.1 broker (Aedes 1.x,
 * `tests/helpers/mqtt-aedes-broker.ts`): connect, subscribe, publish at QoS
 * 0 / 1 / 2, retained messages, binary payloads, the Last Will on an abrupt
 * drop (and not on a user disconnect), a refused login, Cancel, a server-side
 * close reported once, MQTT over WebSocket.
 *
 * Fail-before: there was no MQTT engine at all.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  mqttCancelConnect,
  mqttConnect,
  mqttDisconnect,
  mqttDisconnectAll,
  mqttPublish,
  mqttSubscribe,
  mqttUnsubscribe,
  type MqttClosedInfo,
  type MqttEngineEvent,
} from '../../src/main/protocols/mqtt.engine'
import { startAedesBroker, type AedesTestBroker } from '../helpers/mqtt-aedes-broker'

let broker: AedesTestBroker
let authBroker: AedesTestBroker

beforeAll(async () => {
  broker = await startAedesBroker()
  authBroker = await startAedesBroker({ auth: { username: 'alice', password: 's3cret-pw' } })
})
afterEach(() => mqttDisconnectAll())
afterAll(async () => {
  await broker.close()
  await authBroker.close()
})

function recorder(): {
  events: MqttEngineEvent[]
  closed: MqttClosedInfo[]
  onEvent: (id: string, e: MqttEngineEvent) => void
  onClose: (c: MqttClosedInfo) => void
  waitFor: (pred: (e: MqttEngineEvent) => boolean, ms?: number) => Promise<MqttEngineEvent>
} {
  const events: MqttEngineEvent[] = []
  const closed: MqttClosedInfo[] = []
  const waiters: Array<{
    pred: (e: MqttEngineEvent) => boolean
    resolve: (e: MqttEngineEvent) => void
  }> = []
  return {
    events,
    closed,
    onEvent: (_id, e) => {
      events.push(e)
      for (const w of [...waiters]) {
        if (w.pred(e)) {
          waiters.splice(waiters.indexOf(w), 1)
          w.resolve(e)
        }
      }
    },
    onClose: (c) => closed.push(c),
    waitFor: (pred, ms = 5000) => {
      const hit = events.find(pred)
      if (hit) return Promise.resolve(hit)
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timed out waiting for an event')), ms)
        waiters.push({
          pred,
          resolve: (e) => {
            clearTimeout(t)
            resolve(e)
          },
        })
      })
    },
  }
}

const received = (topic: string) => (e: MqttEngineEvent) =>
  e.type === 'message' && e.direction === 'in' && e.topic === topic

describe('issue #284 — MQTT engine (3.1.1, Aedes)', () => {
  it('connects, subscribes on connect and receives its own QoS 0 / 1 / 2 publishes', async () => {
    const r = recorder()
    const res = await mqttConnect({
      url: broker.url,
      version: 4,
      subscriptions: [{ topic: 'shop/+', qos: 2 }],
      onEvent: r.onEvent,
      onClose: r.onClose,
    })
    expect(res.connectionId).toBeTruthy()
    expect(res.clientId).toMatch(/^testnizer-[0-9a-f]{8}$/)
    await r.waitFor((e) => e.type === 'system' && e.event === 'subscribed' && e.topic === 'shop/+')
    for (const qos of [0, 1, 2] as const) {
      await mqttPublish(res.connectionId, {
        topic: `shop/q${qos}`,
        content: `{"qos":${qos}}`,
        contentType: 'json',
        qos,
        retain: false,
      })
      const got = await r.waitFor(received(`shop/q${qos}`))
      expect(got).toMatchObject({ payload: `{"qos":${qos}}`, binary: false, qos })
    }
    // Every publish also shows as a sent row.
    expect(r.events.filter((e) => e.type === 'message' && e.direction === 'out')).toHaveLength(3)
    expect(mqttDisconnect(res.connectionId)).toBe(true)
    expect(r.closed).toEqual([])
  })

  it('a retained message reaches a later subscriber with the retain flag', async () => {
    const pub = recorder()
    const a = await mqttConnect({ url: broker.url, version: 4, onEvent: pub.onEvent })
    await mqttPublish(a.connectionId, {
      topic: 'retained/one',
      content: 'kept',
      contentType: 'text',
      qos: 1,
      retain: true,
    })
    const sub = recorder()
    await mqttConnect({
      url: broker.url,
      version: 4,
      subscriptions: [{ topic: 'retained/one', qos: 1 }],
      onEvent: sub.onEvent,
    })
    const got = await sub.waitFor(received('retained/one'))
    expect(got).toMatchObject({ payload: 'kept', retain: true })
  })

  it('base64 / hex payloads go out as bytes; non-UTF-8 bytes come back as base64', async () => {
    const r = recorder()
    const c = await mqttConnect({
      url: broker.url,
      version: 4,
      subscriptions: [{ topic: 'bin/#', qos: 0 }],
      onEvent: r.onEvent,
    })
    await r.waitFor((e) => e.type === 'system' && e.event === 'subscribed')
    await mqttPublish(c.connectionId, {
      topic: 'bin/hex',
      content: '01 02 ff',
      contentType: 'hex',
      qos: 0,
      retain: false,
    })
    const got = await r.waitFor(received('bin/hex'))
    expect(got).toMatchObject({ binary: true, payload: 'AQL/' })
    await expect(
      mqttPublish(c.connectionId, {
        topic: 'bin/bad',
        content: 'zz',
        contentType: 'hex',
        qos: 0,
        retain: false,
      }),
    ).rejects.toThrow(/hexadecimal/i)
  })

  it('unsubscribe stops delivery and is reported', async () => {
    const r = recorder()
    const c = await mqttConnect({
      url: broker.url,
      version: 4,
      subscriptions: [{ topic: 'unsub/t', qos: 0 }],
      onEvent: r.onEvent,
    })
    await r.waitFor((e) => e.type === 'system' && e.event === 'subscribed')
    await mqttUnsubscribe(c.connectionId, ['unsub/t'])
    expect(r.events.some((e) => e.type === 'system' && e.event === 'unsubscribed')).toBe(true)
    await mqttPublish(c.connectionId, {
      topic: 'unsub/t',
      content: 'x',
      contentType: 'text',
      qos: 1,
      retain: false,
    })
    await new Promise((res) => setTimeout(res, 150))
    expect(r.events.some(received('unsub/t'))).toBe(false)
    const grants = await mqttSubscribe(c.connectionId, [{ topic: 'unsub/t', qos: 1 }])
    expect(grants).toEqual([{ topic: 'unsub/t', qos: 1, refused: false }])
  })

  it('the Last Will fires on an abrupt drop, not on a user disconnect', async () => {
    const watcher = recorder()
    await mqttConnect({
      url: broker.url,
      version: 4,
      subscriptions: [{ topic: 'will/#', qos: 1 }],
      onEvent: watcher.onEvent,
    })
    await watcher.waitFor((e) => e.type === 'system' && e.event === 'subscribed')

    const polite = recorder()
    const p = await mqttConnect({
      url: broker.url,
      version: 4,
      clientId: 'will-polite',
      will: { topic: 'will/polite', content: 'gone', contentType: 'text', qos: 1, retain: false },
      onEvent: polite.onEvent,
      onClose: polite.onClose,
    })
    mqttDisconnect(p.connectionId)

    const victim = recorder()
    await mqttConnect({
      url: broker.url,
      version: 4,
      clientId: 'will-victim',
      will: { topic: 'will/victim', content: 'died', contentType: 'text', qos: 1, retain: false },
      onEvent: victim.onEvent,
      onClose: victim.onClose,
    })
    await new Promise((res) => setTimeout(res, 50))
    expect(broker.dropClient('will-victim')).toBe(true)
    const will = await watcher.waitFor(received('will/victim'))
    expect(will).toMatchObject({ payload: 'died' })
    expect(watcher.events.some(received('will/polite'))).toBe(false)
    // The dropped client noticed (no reconnection configured): one close.
    await new Promise((res) => setTimeout(res, 100))
    expect(victim.closed).toHaveLength(1)
    expect(polite.closed).toHaveLength(0)
  })

  it('a refused login rejects the connect and does not retry', async () => {
    const r = recorder()
    await expect(
      mqttConnect({
        url: authBroker.url,
        version: 4,
        username: 'alice',
        password: 'wrong',
        onEvent: r.onEvent,
      }),
    ).rejects.toThrow(/Bad username or password|Not authorized/i)
    const ok = await mqttConnect({
      url: authBroker.url,
      version: 4,
      username: 'alice',
      password: 's3cret-pw',
      onEvent: r.onEvent,
    })
    expect(ok.connectionId).toBeTruthy()
  })

  it('a closed port rejects with the transport error', async () => {
    const r = recorder()
    await expect(
      mqttConnect({ url: 'mqtt://127.0.0.1:1', version: 4, onEvent: r.onEvent }),
    ).rejects.toThrow(/ECONNREFUSED|closed/)
  })

  it('a bare host:port gets mqtt://', async () => {
    const r = recorder()
    const c = await mqttConnect({ url: `127.0.0.1:${broker.port}`, version: 4, onEvent: r.onEvent })
    expect(c.url).toBe(broker.url)
  })

  it('MQTT over WebSocket', async () => {
    const r = recorder()
    const c = await mqttConnect({
      url: broker.wsUrl,
      version: 4,
      subscriptions: [{ topic: 'ws/t', qos: 1 }],
      onEvent: r.onEvent,
    })
    await r.waitFor((e) => e.type === 'system' && e.event === 'subscribed')
    await mqttPublish(c.connectionId, {
      topic: 'ws/t',
      content: 'over ws',
      contentType: 'text',
      qos: 1,
      retain: false,
    })
    expect(await r.waitFor(received('ws/t'))).toMatchObject({ payload: 'over ws' })
  })

  it('Cancel aborts a connect that never gets CONNACK', async () => {
    const net = await import('node:net')
    // Accepts TCP but never answers CONNECT.
    const silent = net.createServer(() => {})
    await new Promise<void>((res) => silent.listen(0, '127.0.0.1', res))
    const port = (silent.address() as { port: number }).port
    const r = recorder()
    const pending = mqttConnect({
      url: `mqtt://127.0.0.1:${port}`,
      version: 4,
      pendingId: 'cancel-me',
      onEvent: r.onEvent,
    })
    await new Promise((res) => setTimeout(res, 100))
    expect(mqttCancelConnect('cancel-me')).toBe(true)
    await expect(pending).rejects.toThrow()
    expect(mqttCancelConnect('cancel-me')).toBe(false)
    silent.close()
  })

  it('auto reconnect: a dropped connection reconnects and resubscribes', async () => {
    const r = recorder()
    const c = await mqttConnect({
      url: broker.url,
      version: 4,
      clientId: 'auto-re',
      settings: { autoReconnect: true },
      subscriptions: [{ topic: 'auto/t', qos: 1 }],
      onEvent: r.onEvent,
      onClose: r.onClose,
    })
    await r.waitFor((e) => e.type === 'system' && e.event === 'subscribed')
    broker.dropClient('auto-re')
    await r.waitFor((e) => e.type === 'system' && e.event === 'offline')
    await r.waitFor((e) => e.type === 'system' && e.event === 'reconnected', 8000)
    expect(r.closed).toEqual([])
    await mqttPublish(c.connectionId, {
      topic: 'auto/t',
      content: 'back',
      contentType: 'text',
      qos: 1,
      retain: false,
    })
    expect(await r.waitFor(received('auto/t'))).toMatchObject({ payload: 'back' })
  }, 15_000)
})
