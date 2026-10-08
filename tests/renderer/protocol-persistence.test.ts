/**
 * #18 — Protocol state must round-trip through snapshotProtocol /
 * restoreProtocolFromMetadata. GraphQL had no branch at all (its query/
 * variables/headers were never captured), so save → close → reopen dropped
 * them. This pins the GraphQL round-trip and the generic mechanism.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  snapshotProtocol,
  restoreProtocolFromMetadata,
} from '../../src/renderer/lib/save-active-request'
import { useGraphQLStore } from '../../src/renderer/stores/graphql.store'
import { useWebSocketStore } from '../../src/renderer/stores/websocket.store'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
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

/**
 * Issue #137 — MCP had no snapshot/restore branch at all: Ctrl+S wrote only
 * the (never-edited) request-store URL, so reopening an MCP request showed a
 * blank server URL and default transport — and the new custom headers would
 * have been lost the same way. Pins the write branch, the read branch, and
 * the MST-120 pre-switch (`switchProtocolToTab` must know about 'mcp').
 */
describe('MCP snapshot / restore (issue #137)', () => {
  const SAVED_URL = 'http://127.0.0.1:8091/apigateway/project1/mcp-jira/'
  const HEADERS = [
    { id: 'h1', key: 'Authorization', value: 'Bearer {{token}}', enabled: true },
    { id: 'h2', key: 'X-Gateway-Project', value: 'project1', enabled: false },
  ]
  const ENV_VARS = [
    { id: 'e1', key: 'API_KEY', value: '{{apiKey}}', enabled: true },
    { id: 'e2', key: 'DEBUG', value: '1', enabled: false },
  ]
  const REOPENED_TAB = 'tab-reopened-mcp'

  function snapshotSavedMcpTab(): ReturnType<typeof snapshotProtocol> {
    useMcpStore.getState().switchToTab('tab-source-mcp')
    useMcpStore.setState({
      transport: 'sse',
      url: SAVED_URL,
      customHeaders: HEADERS,
      envVars: ENV_VARS,
    })
    return snapshotProtocol({ id: 'tab-source-mcp', protocol: 'mcp', name: 'MCP' } as Tab)
  }

  it('snapshotProtocol writes transport / url / customHeaders / envVars and the MCP url as effectiveUrl', () => {
    const snap = snapshotSavedMcpTab()
    expect(snap.effectiveUrl).toBe(SAVED_URL)
    expect(snap.effectiveMethod).toBe('GET')
    expect(snap.protocolMeta).toEqual({
      mcp: { transport: 'sse', url: SAVED_URL, customHeaders: HEADERS, envVars: ENV_VARS },
    })
  })

  // Issue #139 — the stdio server environment is part of the saved request.
  it('round-trips a stdio command line and its envVars through save → reopen', () => {
    useMcpStore.getState().switchToTab('tab-source-stdio')
    useMcpStore.setState({
      transport: 'stdio',
      url: 'npx -y @modelcontextprotocol/server-everything',
      customHeaders: [],
      envVars: ENV_VARS,
    })
    const { protocolMeta } = snapshotProtocol({
      id: 'tab-source-stdio',
      protocol: 'mcp',
      name: 'MCP',
    } as Tab)

    useMcpStore.getState().switchToTab('tab-other-stdio')
    expect(useMcpStore.getState().envVars.map((r) => r.key)).toEqual([''])
    useTabsStore.setState({
      tabs: [{ id: 'tab-reopen-stdio', name: 'MCP', protocol: 'mcp', isDirty: false } as Tab],
      activeTabId: 'tab-reopen-stdio',
    })
    restoreProtocolFromMetadata('mcp', protocolMeta)
    useMcpStore.getState().switchToTab('tab-reopen-stdio')

    const m = useMcpStore.getState()
    expect(m.transport).toBe('stdio')
    expect(m.url).toBe('npx -y @modelcontextprotocol/server-everything')
    expect(m.envVars.map((r) => [r.key, r.value, r.enabled])).toEqual([
      ['API_KEY', '{{apiKey}}', true],
      ['DEBUG', '1', false],
    ])
    expect(useTabsStore.getState().tabs[0].isDirty).toBe(false)
  })

  it('restore survives the post-restore switchToTab race and leaves the tab clean', () => {
    const { protocolMeta } = snapshotSavedMcpTab()

    // Close + reopen on a brand-new tab id the store has no cache for.
    useMcpStore.getState().switchToTab('tab-some-other')
    expect(useMcpStore.getState().url).not.toBe(SAVED_URL)
    useTabsStore.setState({
      tabs: [
        {
          id: REOPENED_TAB,
          name: 'MCP',
          protocol: 'mcp',
          savedRequestId: 'sr-mcp',
          isDirty: false,
          isLoading: false,
        } as Tab,
      ],
      activeTabId: REOPENED_TAB,
    })

    restoreProtocolFromMetadata('mcp', protocolMeta)
    // Workbench effect re-runs switchToTab for the active tab afterwards.
    useMcpStore.getState().switchToTab(REOPENED_TAB)

    const m = useMcpStore.getState()
    expect(m.transport).toBe('sse')
    expect(m.url).toBe(SAVED_URL)
    expect(m.customHeaders.map((h) => [h.key, h.value, h.enabled])).toEqual([
      ['Authorization', 'Bearer {{token}}', true],
      ['X-Gateway-Project', 'project1', false],
    ])
    const reopened = useTabsStore.getState().tabs.find((t) => t.id === REOPENED_TAB)
    expect(reopened?.isDirty).toBe(false)
  })

  it('falls back to the row url (request store) when the meta carries none', () => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useMcpStore.setState({ url: '', transport: 'http', customHeaders: [] })
    useRequestStore.setState({ url: 'http://row-url.test/mcp' })
    restoreProtocolFromMetadata('mcp', { mcp: { transport: 'http' } })
    expect(useMcpStore.getState().url).toBe('http://row-url.test/mcp')
  })
})
