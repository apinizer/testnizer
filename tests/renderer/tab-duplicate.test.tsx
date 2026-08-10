/**
 * Duplicate Tab on an APIs request.
 *
 * Reported: right-click an APIs tab → Duplicate lands on the protocol picker
 * ("New Request" grid) instead of a copy. Tabs under Tests were fine.
 *
 * The cause was a collision between two correct-looking pieces:
 *
 *   - `openTab` deduplicates on `endpointId` / `savedRequestId`, so one logical
 *     resource never opens twice.
 *   - `handleDuplicateTab` built the copy by carrying those same ids over.
 *
 * So `openTab` matched the SOURCE tab, refocused it and returned without
 * creating anything; the switch that followed pointed `activeTabId` at an id
 * that had never been added, leaving no active tab — and the Workbench renders
 * the page welcome when there is no active tab. Suite-item tabs escaped it
 * because their branch returns earlier, having created a real row.
 *
 * The fix follows the convention the rest of the app already uses: the tree's
 * own Duplicate, and the suite-item branch, both create a REAL copy. So does
 * this now.
 */
import * as React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { isBlankScratchTab } from '../../src/renderer/lib/tab-kind'
import type { Tab } from '../../src/renderer/types'

function tab(over: Partial<Tab> & { id: string }): Tab {
  return {
    name: 'Req',
    protocol: 'http',
    method: 'GET',
    url: 'https://example.test/x',
    isDirty: false,
    isLoading: false,
    ...over,
  } as Tab
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [], activeTabId: null })
})

describe('openTab deduplicates on the row a tab is backed by', () => {
  it('refocuses instead of opening a second tab for the same endpoint', () => {
    const store = useTabsStore.getState()
    store.openTab(tab({ id: 't1', endpointId: 'ep-1' }))
    store.openTab(tab({ id: 't2', name: 'Req (copy)', endpointId: 'ep-1' }))

    // This is the behaviour the duplicate handler collided with — it is
    // deliberate and stays.
    expect(useTabsStore.getState().tabs).toHaveLength(1)
    expect(useTabsStore.getState().activeTabId).toBe('t1')
  })

  it('has nothing to match on when the copy carries no row id', () => {
    const store = useTabsStore.getState()
    store.openTab(tab({ id: 't1', endpointId: 'ep-1' }))
    store.openTab(tab({ id: 't2', name: 'Req (copy)' }))

    expect(useTabsStore.getState().tabs).toHaveLength(2)
    expect(useTabsStore.getState().activeTabId).toBe('t2')
  })
})

describe('the failure mode the user saw', () => {
  it('leaves no active tab when the switch targets an id that was never added', () => {
    const store = useTabsStore.getState()
    store.openTab(tab({ id: 't1', endpointId: 'ep-1' }))

    // What the old duplicate did: openTab deduped (no new tab), then switched.
    store.openTab(tab({ id: 't2', name: 'Req (copy)', endpointId: 'ep-1' }))
    store.setActiveTab('t2')

    const s = useTabsStore.getState()
    const active = s.tabs.find((t) => t.id === s.activeTabId)
    // No active tab → the Workbench renders the page welcome, which is the
    // protocol grid in the bug report.
    expect(active).toBeUndefined()
  })
})

describe('a duplicate must not be mistaken for a blank scratch tab', () => {
  it('is identified by its row, not by its name', () => {
    // Belt-and-braces against the other way this screen can appear (issue #69).
    expect(isBlankScratchTab({ name: 'New Request', url: '' } as Tab)).toBe(true)
    expect(isBlankScratchTab({ name: 'Req (copy)', url: '' } as Tab)).toBe(false)
    expect(
      isBlankScratchTab({ name: 'New Request', url: '', endpointId: 'ep-2' } as Tab),
    ).toBe(false)
  })
})
