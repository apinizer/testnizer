// Open (or activate) the single shared runner tab and seed its sessionStorage
// payload. The runner UI is intentionally one-tab-per-window — opening from
// TestsPanel, the Tests page welcome, or HistoryListPanel all converge here
// so report data and the active state stay consistent.

import { useTabsStore } from '../stores/tabs.store'

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
