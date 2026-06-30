/**
 * Folder context-menu "Run" opens a runner tab and lands the user on the Tests
 * page so they see the run alongside the Tests panel (regression #39).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { openFolderRunner } from '../../src/renderer/lib/open-runner-tab'
import { useTabsStore } from '../../src/renderer/stores/tabs.store'
import { useUIStore } from '../../src/renderer/stores/ui.store'

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

  it('switches the sidebar page to Tests so the user lands on the Tests panel', () => {
    openFolderRunner('folder-1', 'My Folder')
    expect(useUIStore.getState().activeSidebarPage).toBe('tests')
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
