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
  const tabId = 'runner-' + folderId
  // RunnerTab defaults a fresh tab to the Tests *overview* ('home'), not the
  // run config — explicit entry points opt into 'config' themselves. Without
  // this the folder runner opened on the generic Overview instead of a run
  // scoped to the folder (#39). RunnerTab's view initializer restores 'config'
  // when this key is set AND the tab carries a folder scope.
  sessionStorage.setItem(`runner-view-${tabId}`, 'config')
  tabsApi.openTab({
    id: tabId,
    name: folderName || 'Runner',
    protocol: 'runner',
    folderId,
  })
  useUIStore.getState().setActiveSidebarPage('tests')
}
