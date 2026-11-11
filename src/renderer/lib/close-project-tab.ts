/**
 * Closing a project's header tab (tester finding: the × threw away unsaved
 * requests without asking).
 *
 * A project's open tabs are either the live strip (active project) or, for a
 * hidden project, only its stashed snapshot in `workspace.store`. The store's
 * `closeProjectTab` refuses while any of them is dirty; this module is the UI
 * side of that rule — the same three choices as closing one request tab:
 *
 *  - Discard → close, and release every tab's editor state (protocol slices,
 *    live connections, a Mock MCP draft). The old close dropped the snapshot
 *    and left all of that behind.
 *  - Save → the project is made active (a hidden project's tabs cannot be
 *    saved from its snapshot: the one save path, `saveActiveRequestInPlace`,
 *    writes the ACTIVE tab), each dirty tab is saved through `saveTabForClose`,
 *    the user is taken back to the project they were in, and the project
 *    closes. The first tab that cannot be saved in place (never-saved draft,
 *    deleted row → Save As) or fails stops the run with the project left open
 *    on that tab, so nothing is lost and the user sees what needs them.
 */
import { useWorkspaceStore, projectOpenTabs, projectDirtyTabs } from '../stores/workspace.store'
import { releaseTabState } from './cleanup-tab-state'
import { switchActiveTab } from './activate-tab'
import { saveTabForClose } from './save-tab-for-close'

/** Close + release. `false` (nothing changed) while a tab is still dirty. */
function closeAndRelease(projectId: string, discardUnsaved: boolean): boolean {
  const tabs = projectOpenTabs(projectId)
  if (!useWorkspaceStore.getState().closeProjectTab(projectId, { discardUnsaved })) return false
  for (const tab of tabs) releaseTabState(tab)
  return true
}

/** × on a project tab: closes it when clean; `'dirty'` means ask the user first. */
export function requestCloseProjectTab(projectId: string): 'closed' | 'dirty' {
  return closeAndRelease(projectId, false) ? 'closed' : 'dirty'
}

/** "Discard": the user chose to throw the unsaved edits away. */
export function discardAndCloseProjectTab(projectId: string): void {
  closeAndRelease(projectId, true)
}

export type ProjectCloseSaveOutcome = 'closed' | 'saveAs' | 'failed'

/** "Save & Close" for a whole project — see the module comment. */
export async function saveAndCloseProjectTab(projectId: string): Promise<ProjectCloseSaveOutcome> {
  const ws = useWorkspaceStore.getState()
  const returnTo = ws.activeProjectId !== projectId ? ws.activeProjectId : null
  if (ws.activeProjectId !== projectId) await ws.setActiveProject(projectId)

  const dirtyIds = projectDirtyTabs(projectId).map((tab) => tab.id)
  for (const id of dirtyIds) {
    const outcome = await saveTabForClose(id)
    if (outcome !== 'saved') return outcome
  }

  if (returnTo && useWorkspaceStore.getState().openProjectIds.includes(returnTo)) {
    await useWorkspaceStore.getState().setActiveProject(returnTo)
  }
  // Fail closed: a tab still dirty after its save (or one made dirty while
  // saving) keeps the project open rather than being dropped.
  if (closeAndRelease(projectId, false)) return 'closed'
  const stillDirty = projectDirtyTabs(projectId)[0]
  if (stillDirty) {
    await useWorkspaceStore.getState().setActiveProject(projectId)
    switchActiveTab(stillDirty.id)
  }
  return 'failed'
}

/**
 * Deleting a project (Project Home, behind its own confirm): its rows are
 * gone, so there is nothing to save its open tabs into — but their editor
 * state and live connections are released like any closed tab's, instead of
 * being left behind with the dropped snapshot.
 */
export async function deleteProjectReleasingTabs(projectId: string): Promise<void> {
  const tabs = projectOpenTabs(projectId)
  await useWorkspaceStore.getState().deleteProject(projectId)
  if (useWorkspaceStore.getState().openProjectIds.includes(projectId)) return
  for (const tab of tabs) releaseTabState(tab)
}
