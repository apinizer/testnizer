/**
 * Issue #8 — the unsaved-change "blue dot" dirty indicator used to fire only
 * for HTTP requests. Every protocol store's mutating setters now call the
 * shared `markActiveTabDirty` helper so editing a SOAP / WebSocket / SSE /
 * Socket.IO / gRPC / GraphQL request flags its tab dirty too.
 *
 * `markActiveTabDirty` only marks tabs that are backed by a saved request /
 * endpoint, so each case below opens a tab carrying a `savedRequestId` and
 * makes it active before driving a representative setter.
 *
 * It must ALSO stay clean across the hydration paths: switching to a tab and
 * re-hydrating protocol state via `restoreProtocolFromMetadata` (which reuses
 * the same setters) must NOT flag the freshly-opened request dirty.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useSoapStore } from '../../src/renderer/stores/soap.store'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useSseStore } from '../../src/renderer/stores/sse.store'
import { useSocketIOStore } from '../../src/renderer/stores/socketio.store'
import { useGrpcStore } from '../../src/renderer/stores/grpc.store'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { snapshotProtocol, restoreProtocolFromMetadata } from '../../src/renderer/lib/save-active-request'
import type { Tab } from '../../src/renderer/types'

/** Open a single tab backed by a saved request and make it the active tab. */
function openSavedTab(id: string, protocol: Tab['protocol']): void {
  useTabsStore.setState({
    tabs: [
      {
        id,
        name: 'Saved request',
        protocol,
        savedRequestId: `sr-${id}`,
        isDirty: false,
        isLoading: false,
      },
    ],
    activeTabId: id,
  })
}

function isActiveTabDirty(): boolean {
  const { tabs, activeTabId } = useTabsStore.getState()
  return tabs.find((t) => t.id === activeTabId)?.isDirty ?? false
}

beforeEach(() => {
  // The save/restore helpers reach for window.api; a bare object is enough
  // since we never exercise the network paths here.
  ;(globalThis as unknown as { window: { api: unknown } }).window = { api: {} }
  useTabsStore.setState({ tabs: [], activeTabId: null })
})

describe('protocol dirty indicator (#8)', () => {
  it('SOAP: setRawXml flags the active saved-request tab dirty', () => {
    openSavedTab('tab-soap', 'soap')
    expect(isActiveTabDirty()).toBe(false)
    useSoapStore.getState().setRawXml('<Envelope/>')
    expect(isActiveTabDirty()).toBe(true)
  })

  it('WebSocket: setUrl flags the active saved-request tab dirty', () => {
    openSavedTab('tab-ws', 'websocket')
    expect(isActiveTabDirty()).toBe(false)
    useWebSocketStore.getState().setUrl('wss://example.test/socket')
    expect(isActiveTabDirty()).toBe(true)
  })

  it('SSE: setUrl flags the active saved-request tab dirty', () => {
    openSavedTab('tab-sse', 'sse')
    expect(isActiveTabDirty()).toBe(false)
    useSseStore.getState().setUrl('https://example.test/stream')
    expect(isActiveTabDirty()).toBe(true)
  })

  it('Socket.IO: setEmitEvent flags the active saved-request tab dirty', () => {
    openSavedTab('tab-sio', 'socketio')
    expect(isActiveTabDirty()).toBe(false)
    useSocketIOStore.getState().setEmitEvent('chat:new')
    expect(isActiveTabDirty()).toBe(true)
  })

  it('gRPC: setRequestBody flags the active saved-request tab dirty', () => {
    openSavedTab('tab-grpc', 'grpc')
    expect(isActiveTabDirty()).toBe(false)
    useGrpcStore.getState().setRequestBody('{"name":"x"}')
    expect(isActiveTabDirty()).toBe(true)
  })

  it('GraphQL: setQuery flags the active saved-request tab dirty', () => {
    openSavedTab('tab-gql', 'graphql')
    expect(isActiveTabDirty()).toBe(false)
    useGraphQLStore.getState().setQuery('query { me { id } }')
    expect(isActiveTabDirty()).toBe(true)
  })

  it('does not flag a scratch tab (no saved request / endpoint backing)', () => {
    useTabsStore.setState({
      tabs: [
        { id: 'tab-scratch', name: 'Scratch', protocol: 'graphql', isDirty: false, isLoading: false },
      ],
      activeTabId: 'tab-scratch',
    })
    useGraphQLStore.getState().setQuery('query { me { id } }')
    expect(isActiveTabDirty()).toBe(false)
  })

  it('switchToTab does NOT flag the target tab dirty (hydration path)', () => {
    openSavedTab('tab-ws', 'websocket')
    // switchToTab loads cached/empty state — must not be treated as a user edit.
    useWebSocketStore.getState().switchToTab('tab-ws')
    expect(isActiveTabDirty()).toBe(false)
  })

  it('restoreProtocolFromMetadata does NOT flag a freshly-opened tab dirty', () => {
    // Build a metadata bag the way snapshotProtocol would, off a configured store.
    useGraphQLStore.setState({
      ...useGraphQLStore.getState(),
      url: 'https://gql.test/graphql',
      query: 'query { me { id } }',
      variables: '{"x":1}',
      headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer t', enabled: true }],
    })
    const snap = snapshotProtocol({ id: 'tab-gql', protocol: 'graphql', name: 'GQL' } as Tab)

    // Simulate reopening the saved request: open the tab (clean), then hydrate.
    openSavedTab('tab-gql', 'graphql')
    restoreProtocolFromMetadata('graphql', snap.protocolMeta)

    // The setters fired during restore must NOT leave the tab looking edited.
    expect(isActiveTabDirty()).toBe(false)
    // ...and the state was actually hydrated.
    expect(useGraphQLStore.getState().query).toBe('query { me { id } }')
  })
})
