/**
 * Issue #284 — the MQTT engine's MQTT 5.0 surface against a purpose-built
 * MQTT 5 broker (`tests/helpers/mqtt5-stub-broker.ts`; Aedes refuses MQTT 5):
 * CONNECT properties + will properties on the wire, CONNACK reason codes and
 * properties, PUBLISH properties both ways (content type, response topic,
 * correlation data, user properties, message expiry, topic alias), SUBACK
 * refusals, the server's DISCONNECT with its reason code, and that a 3.1.1
 * connection never sends an MQTT 5 field.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  mqttConnect,
  mqttDisconnectAll,
  mqttPublish,
  mqttSubscribe,
  type MqttClosedInfo,
  type MqttEngineEvent,
} from '../../src/main/protocols/mqtt.engine'
import {
  emptyConnectProperties,
  emptyMessageProperties,
  emptyWillProperties,
} from '../../src/shared/mqtt'
import { startMqtt5StubBroker, type Mqtt5StubBroker } from '../helpers/mqtt5-stub-broker'
import { startAedesBroker, type AedesTestBroker } from '../helpers/mqtt-aedes-broker'

let broker: Mqtt5StubBroker
let refusing: Mqtt5StubBroker
let aedes: AedesTestBroker

beforeAll(async () => {
  broker = await startMqtt5StubBroker({ connackProperties: { assignedClientIdentifier: 'srv-1' } })
  refusing = await startMqtt5StubBroker({ refuse: 0x87 })
  aedes = await startAedesBroker()
})
afterEach(() => mqttDisconnectAll())
afterAll(async () => {
  await broker.close()
  await refusing.close()
  await aedes.close()
})

function rec() {
  const events: MqttEngineEvent[] = []
  const closed: MqttClosedInfo[] = []
  const until = async (
    pred: (e: MqttEngineEvent) => boolean,
    ms = 4000,
  ): Promise<MqttEngineEvent> => {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const hit = events.find(pred)
      if (hit) return hit
      await new Promise((r) => setTimeout(r, 10))
    }
    throw new Error('event not seen')
  }
  return {
    events,
    closed,
    until,
    onEvent: (_id: string, e: MqttEngineEvent) => events.push(e),
    onClose: (c: MqttClosedInfo) => closed.push(c),
  }
}

const kv = (key: string, value: string) => ({ id: key, key, value, enabled: true })

describe('issue #284 — MQTT 5 engine', () => {
  it('sends CONNECT properties, the will with its properties, and reads CONNACK properties', async () => {
    const r = rec()
    const res = await mqttConnect({
      url: broker.url,
      version: 5,
      clientId: 'v5-props',
      username: 'u',
      password: 'p',
      settings: { keepAlive: 30, cleanSession: false },
      properties: {
        ...emptyConnectProperties(),
        sessionExpiryInterval: 120,
        receiveMaximum: 20,
        requestResponseInformation: true,
        userProperties: [kv('tenant', 'acme'), { ...kv('off', 'x'), enabled: false }],
      },
      will: {
        topic: 'will/v5',
        content: '{"bye":true}',
        contentType: 'json',
        qos: 1,
        retain: true,
        properties: {
          ...emptyWillProperties(),
          willDelayInterval: 5,
          contentType: 'application/json',
          userProperties: [kv('why', 'crash')],
        },
      },
      onEvent: r.onEvent,
    })
    expect(res.properties).toMatchObject({
      assignedClientIdentifier: 'srv-1',
      topicAliasMaximum: 10,
    })
    const c = broker.connects.at(-1) as Record<string, any>
    expect(c.protocolVersion).toBe(5)
    expect(c.clientId).toBe('v5-props')
    expect(c.clean).toBe(false)
    expect(c.keepalive).toBe(30)
    expect(c.properties).toMatchObject({
      sessionExpiryInterval: 120,
      receiveMaximum: 20,
      requestResponseInformation: true,
      userProperties: { tenant: 'acme' },
    })
    expect(c.properties.userProperties.off).toBeUndefined()
    expect(c.will).toMatchObject({ topic: 'will/v5', qos: 1, retain: true })
    expect(Buffer.from(c.will.payload).toString()).toBe('{"bye":true}')
    expect(c.will.properties).toMatchObject({
      willDelayInterval: 5,
      contentType: 'application/json',
      userProperties: { why: 'crash' },
    })
  })

  it('a refused CONNACK (reason 0x87) rejects with the reason', async () => {
    const r = rec()
    await expect(
      mqttConnect({ url: refusing.url, version: 5, onEvent: r.onEvent }),
    ).rejects.toThrow(/Not authorized/i)
  })

  it('PUBLISH properties travel both ways; a topic alias resolves', async () => {
    const r = rec()
    const c = await mqttConnect({
      url: broker.url,
      version: 5,
      subscriptions: [{ topic: 'props/#', qos: 1 }],
      onEvent: r.onEvent,
    })
    await r.until((e) => e.type === 'system' && e.event === 'subscribed')
    await mqttPublish(c.connectionId, {
      topic: 'props/a',
      content: 'hello',
      contentType: 'text',
      qos: 1,
      retain: false,
      properties: {
        ...emptyMessageProperties(),
        contentType: 'text/plain',
        responseTopic: 'props/reply',
        correlationData: 'req-42',
        messageExpiryInterval: 60,
        payloadFormatIndicator: true,
        topicAlias: 3,
        userProperties: [kv('trace', 't-1'), kv('trace', 't-2')],
      },
    })
    const got = await r.until((e) => e.type === 'message' && e.direction === 'in')
    expect(got).toMatchObject({
      topic: 'props/a',
      payload: 'hello',
      qos: 1,
      properties: {
        contentType: 'text/plain',
        responseTopic: 'props/reply',
        correlationData: 'req-42',
        messageExpiryInterval: 60,
        payloadFormatIndicator: true,
        userProperties: { trace: ['t-1', 't-2'] },
      },
    })
    expect(broker.published.at(-1)).toMatchObject({ topic: 'props/a' })
  })

  it('QoS 2 completes; a refused subscription is a row and a grant, not a throw', async () => {
    const r = rec()
    const c = await mqttConnect({ url: broker.url, version: 5, onEvent: r.onEvent })
    await mqttPublish(c.connectionId, {
      topic: 'q2/x',
      content: 'two',
      contentType: 'text',
      qos: 2,
      retain: false,
    })
    const grants = await mqttSubscribe(c.connectionId, [
      { topic: 'ok/t', qos: 1 },
      { topic: 'forbidden/t', qos: 1 },
    ])
    expect(grants).toEqual([
      { topic: 'ok/t', qos: 1, refused: false },
      { topic: 'forbidden/t', qos: 0x87, refused: true },
    ])
    expect(
      r.events.some(
        (e) => e.type === 'system' && e.event === 'subscribe-refused' && e.topic === 'forbidden/t',
      ),
    ).toBe(true)
  })

  it('the server DISCONNECT is a row with its reason, then one close', async () => {
    const r = rec()
    await mqttConnect({
      url: broker.url,
      version: 5,
      clientId: 'kick-me',
      onEvent: r.onEvent,
      onClose: r.onClose,
    })
    expect(broker.kick('kick-me', 0x8e, 'Session taken over')).toBe(true)
    const row = await r.until((e) => e.type === 'system' && e.event === 'server-disconnect')
    expect(row).toMatchObject({ reasonCode: 0x8e })
    expect((row as { detail: string }).detail).toMatch(/Session taken over/)
    for (let i = 0; i < 50 && r.closed.length === 0; i++)
      await new Promise((x) => setTimeout(x, 10))
    expect(r.closed).toHaveLength(1)
    expect(r.closed[0].reason).toMatch(/Session taken over/)
  })

  it('3.1.1 never sends MQTT 5 fields (Aedes accepts the CONNECT)', async () => {
    const r = rec()
    const c = await mqttConnect({
      url: aedes.url,
      version: 4,
      properties: { ...emptyConnectProperties(), sessionExpiryInterval: 10 },
      will: {
        topic: 'w/t',
        content: 'x',
        contentType: 'text',
        qos: 0,
        retain: false,
        properties: { ...emptyWillProperties(), willDelayInterval: 3 },
      },
      subscriptions: [{ topic: 'v4/t', qos: 1, noLocal: true, retainHandling: 2 }],
      onEvent: r.onEvent,
    })
    await r.until((e) => e.type === 'system' && e.event === 'subscribed')
    await mqttPublish(c.connectionId, {
      topic: 'v4/t',
      content: 'plain',
      contentType: 'text',
      qos: 1,
      retain: false,
      properties: { ...emptyMessageProperties(), contentType: 'text/plain' },
    })
    const got = await r.until((e) => e.type === 'message' && e.direction === 'in')
    expect(got).toMatchObject({ payload: 'plain' })
    expect((got as { properties?: unknown }).properties).toBeUndefined()
  })
})
