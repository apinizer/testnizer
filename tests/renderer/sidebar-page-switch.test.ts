/**
 * Sidebar page switches are tab-neutral.
 *
 * Open tabs and the active tab are global (one strip shared across every sidebar
 * page); the page only swaps the left panel. So clicking Tools/Tests/Mocks must
 * NOT hide, deselect, or clear any tab. Previously a page switch forced
 * `activeTabId → null` (IconSidebar + the old `rememberAndRestoreForPage`), which
 * unmounted the request editor and lost the user's unsaved edits.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { useRequestStore } from '../../src/renderer/stores/request.store'
import type { Tab } from '../../src/renderer/types'

function httpTab(id: string): Tab {
  return {
    id,
    name: id,
    protocol: 'http',
    method: 'GET',
    url: '',
    isDirty: false,
    isLoading: false,
  }
}

const ALL_PAGES = ['tests', 'mocks', 'tools', 'history', 'docs', 'settings', 'apis'] as const

describe('sidebar page switch — global tabs, no deselect / no loss', () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [httpTab('R1'), httpTab('R2')], activeTabId: 'R2' })
    useUIStore.setState({ activeSidebarPage: 'apis' })
    useRequestStore.setState({ _tabStates: new Map(), _currentTabId: null })
  })

  it('keeps the active tab and the full tab set when switching to Tools', () => {
    useUIStore.getState().setActiveSidebarPage('tools')
    expect(useTabsStore.getState().activeTabId).toBe('R2')
    expect(useTabsStore.getState().tabs.map((t) => t.id)).toEqual(['R1', 'R2'])
    expect(useUIStore.getState().activeSidebarPage).toBe('tools')
  })

  it('never deselects to null on any page switch while tabs are open', () => {
    for (const page of ALL_PAGES) {
      useUIStore.getState().setActiveSidebarPage(page)
      expect(useTabsStore.getState().activeTabId).toBe('R2')
      expect(useTabsStore.getState().tabs).toHaveLength(2)
    }
  })

  it('preserves unsaved request edits across a Tools round-trip', () => {
    const rs = useRequestStore.getState()
    rs.switchToTab('R2')
    rs.setUrl('http://edited.example')

    useUIStore.getState().setActiveSidebarPage('tools')
    useUIStore.getState().setActiveSidebarPage('apis')

    expect(useRequestStore.getState().url).toBe('http://edited.example')
    expect(useTabsStore.getState().activeTabId).toBe('R2')
  })
})
