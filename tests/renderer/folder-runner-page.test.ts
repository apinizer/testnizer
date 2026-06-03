/**
 * Folder context-menu "Run" must land the user on a page where the runner is
 * actually visible (regression #39).
 *
 * A runner tab `tabBelongsToPage` the **Tests** page. When "Run" is invoked
 * from the APIs tree, the runner tab becomes active but the visible sidebar
 * page is still APIs, so the Workbench treats the off-page active tab as absent
 * and shows the APIs welcome — the runner never appears and the click looks
 * like a no-op. openFolderRunner() fixes this by switching to the Tests page.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { openFolderRunner } from '../../src/renderer/lib/open-runner-tab'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'
import { tabBelongsToPage } from '../../src/renderer/lib/sidebar-pages'

describe('openFolderRunner — page navigation (#39)', () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: [], activeTabId: null })
    useUIStore.setState({ activeSidebarPage: 'apis' })
    sessionStorage.clear()
  })

  it('opens a runner tab scoped to the folder and activates it', () => {
    openFolderRunner('folder-1', 'My Folder')
    const { tabs, activeTabId } = useTabsStore.getState()
    expect(tabs).toHaveLength(1)
    const tab = tabs[0]
    expect(tab.id).toBe('runner-folder-1')
    expect(tab.protocol).toBe('runner')
    expect(tab.folderId).toBe('folder-1')
    expect(tab.name).toBe('My Folder')
    expect(activeTabId).toBe('runner-folder-1')
  })

  it('switches the sidebar page to Tests so the runner is visible', () => {
    openFolderRunner('folder-1', 'My Folder')
    expect(useUIStore.getState().activeSidebarPage).toBe('tests')

    // The decisive invariant: the runner tab is visible on the now-active page.
    // Without the page switch it would belong to Tests while the user is on
    // APIs — active but hidden (the no-op symptom).
    const tab = useTabsStore.getState().tabs[0]
    expect(tabBelongsToPage(tab, 'tests')).toBe(true)
    expect(tabBelongsToPage(tab, 'apis')).toBe(false)
  })

  it('seeds the runner view to config so it shows the folder run, not Overview', () => {
    // Regression #39 follow-up: a fresh runner tab defaults to the Tests
    // overview; the folder run must land on the run config scoped to the
    // folder. RunnerTab restores 'config' from this key when the tab has a
    // folder scope.
    openFolderRunner('folder-1', 'My Folder')
    expect(sessionStorage.getItem('runner-view-runner-folder-1')).toBe('config')
  })

  it('falls back to a generic name when none is given', () => {
    openFolderRunner('folder-2')
    expect(useTabsStore.getState().tabs[0].name).toBe('Runner')
  })
})
