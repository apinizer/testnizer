/**
 * #18 — Protocol state must round-trip through snapshotProtocol /
 * restoreProtocolFromMetadata. GraphQL had no branch at all (its query/
 * variables/headers were never captured), so save → close → reopen dropped
 * them. This pins the GraphQL round-trip and the generic mechanism.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { snapshotProtocol, restoreProtocolFromMetadata } from '../../src/renderer/lib/save-active-request'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Tab } from '../../src/renderer/types'

beforeEach(() => {
  ;(globalThis as unknown as { window: { api: unknown } }).window = { api: {} }
})

describe('protocol persistence round-trip (#18)', () => {
  it('captures and restores GraphQL url/query/variables/headers', () => {
    useGraphQLStore.setState({
      ...useGraphQLStore.getState(),
      url: 'https://gql.test/graphql',
      query: 'query { me { id } }',
      variables: '{"x":1}',
      headers: [{ id: 'h1', key: 'Authorization', value: 'Bearer t', enabled: true }],
    })

    const snap = snapshotProtocol({ id: 'tab-1', protocol: 'graphql', name: 'GQL' } as Tab)
    expect(snap.protocolMeta).toHaveProperty('graphql')

    // Simulate close (state cleared) then reopen.
    useGraphQLStore.setState({
      ...useGraphQLStore.getState(),
      url: '',
      query: '',
      variables: '{}',
      headers: [],
    })
    restoreProtocolFromMetadata('graphql', snap.protocolMeta)

    const g = useGraphQLStore.getState()
    expect(g.url).toBe('https://gql.test/graphql')
    expect(g.query).toBe('query { me { id } }')
    expect(g.variables).toBe('{"x":1}')
    expect(g.headers.map((h) => [h.key, h.value])).toEqual([['Authorization', 'Bearer t']])
  })
})

/**
 * MST-120 — tab-scoped protocol stores must not clobber a just-restored slice
 * with their default when the Workbench's `switchToTab` useEffect fires AFTER
 * `restoreProtocolFromMetadata`. The reopen flow (open-endpoint-tab.ts) calls
 * restore synchronously inside the same task that sets the active tab; the
 * Workbench effect runs later and re-runs `switchToTab(activeTabId)`. If the
 * restored values aren't already cached under the new tab id, that later
 * switch loads `emptyState()` and the saved url/headers are lost
 * (e.g. ws-url snaps back to the wss://echo.websocket.org default).
 */
describe('MST-120 — restore survives the post-restore switchToTab race', () => {
  const SAVED_URL = 'wss://saved.example.test/socket'
  const REOPENED_TAB = 'tab-reopened-ws'

  function snapshotSavedWsTab(): Record<string, unknown> {
    // Stand the store up as the tab the user configured + saved, then capture.
    useWebSocketStore.getState().switchToTab('tab-source-ws')
    useWebSocketStore.setState({
      url: SAVED_URL,
      customHeaders: [{ id: 'h1', key: 'X-Save-Test', value: 'mst120', enabled: true }],
      composerContent: '{"saved":"mst120"}',
    })
    return snapshotProtocol({
      id: 'tab-source-ws',
      protocol: 'websocket',
      name: 'WS',
    } as Tab).protocolMeta
  }

  it('keeps the restored WebSocket url after the Workbench effect re-switches', () => {
    const meta = snapshotSavedWsTab()

    // Simulate close + reopen on a brand-new tab id: the store is currently
    // pointed at a *different* tab and has NO cache entry for the reopened one.
    useWebSocketStore.getState().switchToTab('tab-some-other')
    expect(useWebSocketStore.getState().url).not.toBe(SAVED_URL)

    // openPreviewTab → activeTabId becomes the reopened tab (set first, exactly
    // as the real open flow does before calling restore).
    useTabsStore.setState({
      tabs: [
        {
          id: REOPENED_TAB,
          name: 'WS',
          protocol: 'websocket',
          isDirty: false,
          isLoading: false,
        } as Tab,
      ],
      activeTabId: REOPENED_TAB,
    })

    // Synchronous restore (open-endpoint-tab does this in the same task).
    restoreProtocolFromMetadata('websocket', meta)
    expect(useWebSocketStore.getState().url).toBe(SAVED_URL)

    // The Workbench useEffect fires AFTER restore and re-runs switchToTab for
    // the now-active tab. With the fix this is idempotent; without it the
    // restored url would be clobbered by emptyState()'s default here.
    useWebSocketStore.getState().switchToTab(REOPENED_TAB)
    expect(useWebSocketStore.getState().url).toBe(SAVED_URL)

    // Restore must not flip the tab dirty — reopening a saved request is clean.
    const reopened = useTabsStore.getState().tabs.find((t) => t.id === REOPENED_TAB)
    expect(reopened?.isDirty).toBe(false)
  })
})
