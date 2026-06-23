/**
 * Regression coverage for the tab-editing data-loss + duplicate-selection bugs.
 *
 *   issue #23 — Query Params / Authorization / Body typed without clicking Save
 *   were lost when the user clicked another API and came back. The tree-click /
 *   open-tab paths run `openPreviewTab → switchToTab → loadFromEndpoint`; on a
 *   re-focus `switchToTab` restored the in-memory edits but `loadFromEndpoint`
 *   then clobbered them with the pristine DB row. The fix gates the DB reload on
 *   the tab being clean — a dirty tab's working copy is authoritative.
 *
 *   issue #24 — after a few clicks two tabs rendered as the active tab. The
 *   clean-preview-replace path kept the OLD slot id while swapping endpointId,
 *   so `tab.id` stopped equalling `tab-${endpointId}`; re-opening the original
 *   endpoint then minted a second tab whose `tab-${id}` collided with the stale
 *   slot. The fix makes the replace adopt the incoming payload id (restoring the
 *   invariant) plus an id-level dedup guard.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Tab } from '../../src/renderer/types'

function endpointTab(id: string, endpointId: string, name = endpointId): Tab {
  return {
    id,
    name,
    protocol: 'http',
    method: 'GET',
    url: '',
    endpointId,
    isDirty: false,
    isLoading: false,
    isPreview: false,
  }
}

// ─── issue #23 — unsaved edits survive a re-focus ───────────────

describe('request.store.loadFromEndpoint — preserves unsaved working copy (issue #23)', () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
  })

  it('does NOT overwrite Query Params edited but not saved when the endpoint is re-opened', () => {
    useTabsStore.setState({ tabs: [endpointTab('tab-A', 'A')], activeTabId: 'tab-A' })
    const rs = useRequestStore.getState()
    rs.switchToTab('tab-A')

    // Fresh open hydrates from the DB row.
    rs.loadFromEndpoint({
      method: 'GET',
      url: 'http://api/a',
      params: [{ id: 'p0', key: 'orig', value: '1', enabled: true }],
    })
    expect(useRequestStore.getState().params[0].key).toBe('orig')

    // User edits the params without saving → tab goes dirty.
    useRequestStore.getState().setParams([{ id: 'p1', key: 'edited', value: '2', enabled: true }])
    expect(useTabsStore.getState().tabs[0].isDirty).toBe(true)

    // Re-focus replays the open sequence: switchToTab restores the edits, then
    // loadFromEndpoint is handed the pristine DB row again.
    useRequestStore.getState().switchToTab('tab-A')
    useRequestStore.getState().loadFromEndpoint({
      method: 'GET',
      url: 'http://api/a',
      params: [{ id: 'p0', key: 'orig', value: '1', enabled: true }],
    })

    // The edits win — the DB reload was skipped because the tab is dirty.
    const params = useRequestStore.getState().params
    expect(params).toHaveLength(1)
    expect(params[0].key).toBe('edited')
  })

  it('still hydrates from the DB row on a fresh (clean) open', () => {
    useTabsStore.setState({ tabs: [endpointTab('tab-B', 'B')], activeTabId: 'tab-B' })
    const rs = useRequestStore.getState()
    rs.switchToTab('tab-B')

    rs.loadFromEndpoint({
      method: 'POST',
      url: 'http://api/b',
      params: [{ id: 'pb', key: 'fromdb', value: '9', enabled: true }],
    })

    expect(useRequestStore.getState().url).toBe('http://api/b')
    expect(useRequestStore.getState().params[0].key).toBe('fromdb')
  })
})

// ─── issue #24 — never two tabs sharing the active id ───────────

describe('tabs.store.openPreviewTab — no duplicate-id / double-active tab (issue #24)', () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
  })

  it('keeps tab.id ≡ tab-${endpointId} and never mints two tabs with one id', () => {
    const open = (id: string, endpointId: string, name: string) =>
      useTabsStore.getState().openPreviewTab({
        id,
        name,
        protocol: 'http',
        method: 'GET',
        url: `/${endpointId}`,
        endpointId,
      })

    // 1. Endpoint A opens as a preview.
    open('tab-A', 'A', 'Updates a pet')
    // 2. Endpoint B replaces the clean preview — the slot must adopt tab-B,
    //    NOT keep tab-A (the old decoupling bug).
    open('tab-B', 'B', 'Finds pets by status')
    let tabs = useTabsStore.getState().tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0].id).toBe('tab-B')
    expect(tabs[0].endpointId).toBe('B')

    // 3. Edit the preview so the next open pins it instead of replacing.
    useTabsStore.getState().markDirty('tab-B', true)

    // 4. Re-open endpoint A: B pins, a fresh A preview opens. No id collision.
    open('tab-A', 'A', 'Updates a pet')
    tabs = useTabsStore.getState().tabs
    const ids = tabs.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)

    // Exactly one tab carries the active id → only one renders as selected.
    const activeId = useTabsStore.getState().activeTabId
    expect(tabs.filter((t) => t.id === activeId)).toHaveLength(1)
    // Both endpoints are still present, each on its own physical tab.
    expect(tabs.find((t) => t.endpointId === 'A')).toBeDefined()
    expect(tabs.find((t) => t.endpointId === 'B')).toBeDefined()
  })
})
