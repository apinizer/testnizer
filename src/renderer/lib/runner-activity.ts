/**
 * Which runner tabs currently have a run in flight.
 *
 * `openFolderRunner` bumps a tab's `sessionKey` on every Run so the workbench
 * remounts the runner and the user always lands on the Start-run screen for the
 * folder they picked (issue #66). Remounting a tab whose run is still executing
 * would throw away that instance's `isRunning` state and its progress
 * subscription — the run keeps going in main while the UI shows a fresh config
 * screen with no way to cancel it. So a Run aimed at a BUSY tab focuses it
 * instead of re-arming it.
 *
 * Deliberately module state rather than a store: it is transient UI bookkeeping
 * that nothing renders from, and a store field would invite components to
 * subscribe and re-render on every run start/stop.
 */
const busyTabs = new Set<string>()

export function setRunnerBusy(tabId: string, busy: boolean): void {
  if (busy) busyTabs.add(tabId)
  else busyTabs.delete(tabId)
}

export function isRunnerBusy(tabId: string): boolean {
  return busyTabs.has(tabId)
}

/** Test seam — no production caller. */
export function resetRunnerActivity(): void {
  busyTabs.clear()
}
