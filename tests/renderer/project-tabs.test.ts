/**
 * #1 — Multiple project tabs. The core primitive is tabs.store.replaceAllTabs,
 * which swaps the whole open-tab set (used to snapshot/restore each project's
 * tabs on switch) instead of wiping. Pins that it replaces the set and resets
 * transient isLoading.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import type { Tab } from '../../src/renderer/types'

function tab(id: string, isLoading = false): Tab {
  return {
    id,
    name: id.toUpperCase(),
    protocol: 'http',
    method: 'GET',
    url: '',
    isDirty: false,
    isLoading,
  } as Tab
}

beforeEach(() => {
  useTabsStore.setState({ tabs: [tab('a', true)], activeTabId: 'a' })
})

describe('tabs.store.replaceAllTabs (#1)', () => {
  it('replaces the entire open-tab set and its active id', () => {
    useTabsStore.getState().replaceAllTabs([tab('b'), tab('c')], 'c')
    const s = useTabsStore.getState()
    expect(s.tabs.map((t) => t.id)).toEqual(['b', 'c'])
    expect(s.activeTabId).toBe('c')
  })

  it('clears transient isLoading on restored tabs', () => {
    useTabsStore.getState().replaceAllTabs([tab('b', true)], 'b')
    expect(useTabsStore.getState().tabs[0].isLoading).toBe(false)
  })

  it('restoring an empty set (Home) clears tabs', () => {
    useTabsStore.getState().replaceAllTabs([], null)
    const s = useTabsStore.getState()
    expect(s.tabs).toEqual([])
    expect(s.activeTabId).toBeNull()
  })
})
