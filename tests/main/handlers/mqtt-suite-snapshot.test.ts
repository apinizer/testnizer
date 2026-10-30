/**
 * Issue #284 — an MQTT request added to a Test Suite keeps its protocol block.
 * `snapshotEndpointForSuite` copies the source into the suite item's
 * `request_schema`; the suite tab restores from `request_schema.metadata`
 * (`openSuiteItemTab` → `restoreProtocolFromMetadata` → `readMqttMeta`).
 * Both sources are covered: an endpoint (`request_schema.metadata.mqtt`) and
 * a saved request (`saved_requests.metadata.mqtt`, request settings lifted to
 * the top of the item's schema, issue #185).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'node:crypto'
import { createTestDb, makeElectronMock, seedProject, seedWorkspace } from './helpers'
import { mqttMetaOf, readMqttMeta, type MqttRequestFields } from '../../../src/shared/realtime-meta'
import {
  DEFAULT_MQTT_SETTINGS,
  emptyConnectProperties,
  emptyLastWill,
  emptyPublishDraft,
  emptyWillProperties,
} from '../../../src/shared/mqtt'

vi.mock('electron', () => makeElectronMock())
let testDb: ReturnType<typeof createTestDb>
vi.mock('../../../src/main/db/database', () => ({ getDb: () => testDb }))

const { snapshotEndpointForSuite } = await import('../../../src/main/ipc/test-suite.handler')

const kv = (key: string, value: string) => ({ id: key, key, value, enabled: true })

/** A request with every MQTT field set away from its default. */
const FIELDS: MqttRequestFields = {
  url: 'mqtts://{{broker}}:8883',
  clientId: 'suite-client',
  version: 4,
  username: 'ann',
  password: '{{mqttPw}}',
  settings: { ...DEFAULT_MQTT_SETTINGS, keepAlive: 17, cleanSession: false },
  properties: {
    ...emptyConnectProperties(),
    sessionExpiryInterval: 99,
    userProperties: [kv('tenant', 'acme')],
  },
  lastWill: {
    ...emptyLastWill(),
    topic: 'will/t',
    payload: '{"bye":1}',
    type: 'json',
    qos: 1,
    retain: true,
    properties: { ...emptyWillProperties(), willDelayInterval: 3 },
  },
  topics: [
    {
      id: 't1',
      name: 'sensors/#',
      qos: 2,
      subscribe: true,
      description: 'all sensors',
      noLocal: true,
      retainAsPublished: false,
      retainHandling: 1,
    },
  ],
  composer: { ...emptyPublishDraft(), topic: 'cmd/x', content: 'go', qos: 1 },
  savedMessages: [{ ...emptyPublishDraft(), id: 'm1', name: 'Ping', topic: 'p', content: 'ping' }],
}
const META = mqttMetaOf(FIELDS)

let projectId = ''
beforeEach(() => {
  testDb = createTestDb()
  projectId = seedProject(testDb, seedWorkspace(testDb))
})

function seedEndpoint(): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO endpoints (id, project_id, folder_id, name, protocol, method, path, status,
         request_schema, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'Broker', 'mqtt', 'CONNECT', '', 'developing', ?, 0, ?, ?)`,
    )
    .run(
      id,
      projectId,
      JSON.stringify({ url: FIELDS.url, timeout: 7_000, metadata: { mqtt: META } }),
      now,
      now,
    )
  return id
}

function seedSaved(): string {
  const id = crypto.randomUUID()
  const now = Date.now()
  testDb
    .prepare(
      `INSERT INTO saved_requests
         (id, project_id, folder_id, name, protocol, method, url, params, headers, body, auth,
          pre_script, post_script, assertions, metadata, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, 'Saved broker', 'mqtt', 'CONNECT', ?, '[]', '[]', NULL, NULL, NULL, NULL,
               '[]', ?, 0, ?, ?)`,
    )
    .run(id, projectId, FIELDS.url, JSON.stringify({ mqtt: META, timeout: 7_000 }), now, now)
  return id
}

describe('Test Suite snapshot of an MQTT request (issue #284)', () => {
  it.each([
    ['endpoint', seedEndpoint],
    ['saved request', seedSaved],
  ])('%s: request_schema.metadata.mqtt is intact and restores every field', (_l, seed) => {
    const snap = snapshotEndpointForSuite(seed())
    expect(snap).not.toBeNull()
    expect(snap!.protocol).toBe('mqtt')
    expect(snap!.url).toBe(FIELDS.url)
    const schema = JSON.parse(snap!.request_schema) as {
      timeout?: number
      metadata?: { mqtt?: unknown }
    }
    expect(schema.metadata?.mqtt).toEqual(JSON.parse(JSON.stringify(META)))
    expect(schema.timeout).toBe(7_000)
    // What the suite tab's restore reads back: every field, unchanged.
    expect(readMqttMeta(schema.metadata?.mqtt)).toEqual(JSON.parse(JSON.stringify(FIELDS)))
  })
})
