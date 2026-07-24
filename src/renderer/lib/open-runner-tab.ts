// Open (or activate) the single shared runner tab and seed its sessionStorage
// payload. The runner UI is intentionally one-tab-per-window — opening from
// TestsPanel, the Tests page welcome, or HistoryListPanel all converge here
// so report data and the active state stay consistent.

import { useTabsStore } from '../stores/tabs.store'
import { useUIStore } from '../stores/ui.store'
import { isRunnerBusy } from './runner-activity'

const RUNNER_TAB_ID = 'runner-main'

// Monotonic session token. Two opens can land inside the same millisecond
// (a second right-click → Run), and a repeated Date.now() would look like
// "same session" to the runner tab — it would then keep showing the previous
// screen instead of re-arming (#66).
let sessionCounter = 0
function nextSessionKey(): string {
  sessionCounter += 1
  return `${Date.now()}-${sessionCounter}`
}

export function openOrReuseRunnerTab(
  sessionData?: Record<string, unknown>,
  tabName = 'Runner',
): void {
  const tabsApi = useTabsStore.getState()
  const existing = tabsApi.tabs.find((tab) => tab.protocol === 'runner')
  const tabId = existing ? existing.id : RUNNER_TAB_ID
  const sessionKey = nextSessionKey()

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
 * Open (or re-focus) a runner tab scoped to a specific APIs-tree folder.
 *
 * The runner tab becomes the global active tab and renders immediately. We also
 * flip the sidebar to the **Tests** page so the user lands on the Tests panel
 * (the natural home for a run) rather than staying on the APIs tree (#39).
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
  if (isRunnerBusy(tabId)) {
    // That tab's run is still executing. Re-arming would remount it and take
    // the live progress + Cancel button away while main keeps running — focus
    // the run the user already started instead.
    tabsApi.openTab({ id: tabId, name: folderName || 'Runner', protocol: 'runner', folderId })
    tabsApi.setActiveTab(tabId)
    useUIStore.getState().setActiveSidebarPage('tests')
    return
  }
  // A fresh session token on every Run. When the tab is already open (and even
  // already active, parked on a previous run's results) this is what tells the
  // workbench to re-arm it, so the user always lands on the Start-run screen
  // instead of staring at the old results (#66).
  tabsApi.openTab({
    id: tabId,
    name: folderName || 'Runner',
    protocol: 'runner',
    folderId,
    sessionKey: nextSessionKey(),
  })
  useUIStore.getState().setActiveSidebarPage('tests')
}
