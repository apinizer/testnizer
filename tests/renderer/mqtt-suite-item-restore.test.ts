/**
 * Issue #284 — opening an MQTT Test Suite item restores the MQTT editor from
 * the item's `request_schema.metadata.mqtt` (what `snapshotEndpointForSuite`
 * writes, `tests/main/handlers/mqtt-suite-snapshot.test.ts`):
 * `openSuiteItemTab` → `restoreProtocolFromMetadata('mqtt', …)`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openSuiteItemTab } from '../../src/renderer/lib/open-endpoint-tab'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useMqttStore } from '../../src/renderer/stores/mqtt.store'
import { useWorkspaceStore } from '../../src/renderer/stores/workspace.store'
import { mqttMetaOf, type MqttRequestFields } from '../../src/shared/realtime-meta'
import {
  DEFAULT_MQTT_SETTINGS,
  emptyConnectProperties,
  emptyLastWill,
  emptyPublishDraft,
} from '../../src/shared/mqtt'

const FIELDS: MqttRequestFields = {
  url: 'mqtt://{{broker}}:1883',
  clientId: 'suite-client',
  version: 4,
  username: 'ann',
  password: '{{mqttPw}}',
  settings: { ...DEFAULT_MQTT_SETTINGS, keepAlive: 17 },
  properties: { ...emptyConnectProperties(), userProperties: [] },
  lastWill: { ...emptyLastWill(), topic: 'will/t', payload: 'bye' },
  topics: [
    {
      id: 't1',
      name: 'sensors/#',
      qos: 2,
      subscribe: true,
      description: '',
      noLocal: false,
      retainAsPublished: false,
      retainHandling: 0,
    },
  ],
  composer: { ...emptyPublishDraft(), topic: 'cmd/x', content: 'go' },
  savedMessages: [],
}

beforeEach(() => {
  const item = {
    id: 'it-mqtt',
    suite_id: 's1',
    folder_id: null,
    protocol: 'mqtt',
    name: 'Broker',
    method: 'CONNECT',
    url: FIELDS.url,
    request_schema: JSON.stringify({ url: FIELDS.url, metadata: { mqtt: mqttMetaOf(FIELDS) } }),
    assertions: '[]',
  }
  ;(window as unknown as { api: unknown }).api = {
    testSuiteItem: { get: vi.fn(async () => ({ success: true, data: item })) },
  }
  useWorkspaceStore.setState({ refreshTree: vi.fn().mockResolvedValue(undefined) })
  useTabsStore.setState({ tabs: [], activeTabId: null })
  useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMqttStore.setState({ _tabStates: new Map(), _currentTabId: null })
})

describe('MQTT Test Suite item (issue #284)', () => {
  it('opens with every saved MQTT field', async () => {
    await openSuiteItemTab('it-mqtt')
    const tabs = useTabsStore.getState()
    expect(tabs.tabs.find((t) => t.id === tabs.activeTabId)?.protocol).toBe('mqtt')
    const s = useMqttStore.getState()
    expect(s._currentTabId).toBe(tabs.activeTabId)
    expect(s.url).toBe(FIELDS.url)
    expect(s.clientId).toBe('suite-client')
    expect(s.version).toBe(4)
    expect(s.username).toBe('ann')
    expect(s.password).toBe('{{mqttPw}}')
    expect(s.settings.keepAlive).toBe(17)
    expect(s.lastWill.topic).toBe('will/t')
    expect(s.topics.map((t) => [t.name, t.qos])).toEqual([['sensors/#', 2]])
    expect(s.composer.topic).toBe('cmd/x')
  })
})
