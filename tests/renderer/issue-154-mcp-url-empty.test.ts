/**
 * Issue #154 — clearing an MCP tab's server URL and pressing Ctrl+S must
 * persist the empty URL. `effectiveUrl: mcp.url || url` fell back to the
 * request store's (stale) URL and the restore path skipped an empty `url`,
 * so the old URL came back on reopen.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useMcpStore } from '../../src/renderer/stores/mcp.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import {
  restoreProtocolFromMetadata,
  snapshotProtocol,
} from '../../src/renderer/lib/save-active-request'
import type { Tab } from '../../src/renderer/types'

const TAB: Tab = {
  id: 'mcp-tab',
  name: 'MCP',
  protocol: 'mcp',
  method: 'GET',
  url: '',
  isDirty: false,
  isLoading: false,
} as Tab

beforeEach(() => {
  useTabsStore.setState({ tabs: [TAB], activeTabId: TAB.id })
  useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
  useMcpStore.getState().switchToTab(TAB.id)
})

describe('an intentionally empty MCP URL', () => {
  it('is saved as empty and restored as empty', () => {
    // The row was saved with a URL earlier; the request store still holds it.
    useRequestStore.setState({ url: 'http://old.example/mcp' })
    useMcpStore.getState().setUrl('http://old.example/mcp')
    useMcpStore.getState().setUrl('')

    const snap = snapshotProtocol(TAB)
    expect(snap.effectiveUrl).toBe('')
    expect((snap.protocolMeta.mcp as { url: string }).url).toBe('')

    // Reopen: callers hydrate the request store from the row first.
    useMcpStore.setState({ _tabStates: new Map(), _currentTabId: null })
    useMcpStore.getState().switchToTab(TAB.id)
    useMcpStore.getState().setUrl('http://stale-live-slice/mcp')
    useRequestStore.setState({ url: snap.effectiveUrl })
    restoreProtocolFromMetadata('mcp', snap.protocolMeta)
    expect(useMcpStore.getState().url).toBe('')
  })

  it('rows without a url in their meta still fall back to the stored row URL', () => {
    useRequestStore.setState({ url: 'http://row.example/mcp' })
    restoreProtocolFromMetadata('mcp', { mcp: { transport: 'http' } })
    expect(useMcpStore.getState().url).toBe('http://row.example/mcp')
  })

  it('a non-empty URL still round-trips', () => {
    useMcpStore.getState().setUrl('http://127.0.0.1:3100/mcp')
    const snap = snapshotProtocol(TAB)
    expect(snap.effectiveUrl).toBe('http://127.0.0.1:3100/mcp')
    useMcpStore.getState().setUrl('')
    useRequestStore.setState({ url: snap.effectiveUrl })
    restoreProtocolFromMetadata('mcp', snap.protocolMeta)
    expect(useMcpStore.getState().url).toBe('http://127.0.0.1:3100/mcp')
  })
})
