/**
 * Whether a runner tab of the active project has a run in flight.
 *
 * `openFolderRunner` bumps a tab's `sessionKey` on every Run so the workbench
 * remounts the runner and the user always lands on the Start-run screen for the
 * folder they picked (issue #66). A Run aimed at a BUSY tab focuses it instead:
 * re-arming would take the live view away while main keeps running.
 *
 * Read from the live-run store, which outlives the tab's component. This used to
 * be a flag RunnerTab set from an effect, whose cleanup cleared it the moment the
 * user left the tab — so "busy" was only ever true for the tab on screen.
 */
import { liveRunKey, useRunnerLiveStore } from '../stores/runner-live.store'

export function isRunnerBusy(tabId: string): boolean {
  return !!useRunnerLiveStore.getState().runs[liveRunKey(tabId)]?.running
}
