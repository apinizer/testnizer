// Open (or activate) the single shared runner tab and seed its sessionStorage
// payload. The runner UI is intentionally one-tab-per-window — opening from
// TestsPanel, the Tests page welcome, or HistoryListPanel all converge here
// so report data and the active state stay consistent.

import { useTabsStore } from '../stores/tabs.store'
import { useUIStore } from '../stores/ui.store'

const RUNNER_TAB_ID = 'runner-main'

export function openOrReuseRunnerTab(
  sessionData?: Record<string, unknown>,
  tabName = 'Runner',
): void {
  const tabsApi = useTabsStore.getState()
  const existing = tabsApi.tabs.find((tab) => tab.protocol === 'runner')
  const tabId = existing ? existing.id : RUNNER_TAB_ID
  const sessionKey = String(Date.now())

  if (sessionData) {
    sessionStorage.setItem(`runner-report-${tabId}`, JSON.stringify(sessionData))
  }

  if (existing) {
    tabsApi.setActiveTab(existing.id)
    tabsApi.updateTab(existing.id, { sessionKey })
  } else {
    tabsApi.openTab({ id: tabId, name: tabName, protocol: 'runner', sessionKey })
  }
}

/**
 * Open (or re-focus) a runner tab scoped to a specific APIs-tree folder and
 * navigate to the page the runner renders on.
 *
 * A runner tab `tabBelongsToPage` the **Tests** page (sidebar-pages.ts), so a
 * runner opened from the APIs sidebar becomes the active tab but stays hidden
 * behind the APIs view — the Workbench treats the off-page active tab as absent
 * and shows the APIs welcome instead. That made the folder context-menu "Run"
 * look like a no-op (#39). Switching the sidebar page here surfaces the runner.
 */
export function openFolderRunner(folderId: string, folderName?: string): void {
  const tabsApi = useTabsStore.getState()
  tabsApi.openTab({
    id: 'runner-' + folderId,
    name: folderName || 'Runner',
    protocol: 'runner',
    folderId,
  })
  useUIStore.getState().setActiveSidebarPage('tests')
}
