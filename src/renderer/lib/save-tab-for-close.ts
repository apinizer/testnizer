/**
 * "Save & Close" for one tab — the ONE implementation behind the request tab's
 * unsaved-changes dialog (Workbench) and the project tab's (Header). Both used
 * to be written inline; the project-close path is the second caller, so the
 * rules live here instead of being copied:
 *
 *  - A Mock MCP editor saves through its own draft path (issue #154): it is not
 *    a request row, the in-place save would report it not applicable.
 *  - Anything else goes through `saveActiveRequestInPlace`, which writes the
 *    ACTIVE tab from the editor stores — the closing tab is made active and
 *    the stores pointed at it first, or a background tab's Save wrote another
 *    tab's content into its row.
 *  - A tab with no row to write to (never saved, or its row was deleted —
 *    issue #269) is not saved and not closed: Save As opens on it, exactly
 *    like Ctrl+S (issue #101).
 *
 * The caller closes the tab only on `'saved'`. `'saveAs'` and `'failed'` keep
 * it open; a failure has already been reported.
 */
import { useTabsStore } from '../stores/tabs.store'
import { useUIStore } from '../stores/ui.store'
import { saveActiveRequestInPlace } from './save-active-request'
import { saveMockMcpDraft } from '../components/mock-mcp/mock-mcp-save'
import { switchActiveTab } from './activate-tab'
import { isRequestLikeTab } from './mark-dirty'
import { toast } from './toast'
import { t } from './i18n'

export type CloseSaveOutcome = 'saved' | 'saveAs' | 'failed'

function reportFailure(error: string | undefined): void {
  toast.error(error ? `${t('toast.saveFailed')}: ${error}` : t('toast.saveFailed'))
}

export async function saveTabForClose(tabId: string): Promise<CloseSaveOutcome> {
  const closing = useTabsStore.getState().tabs.find((x) => x.id === tabId)
  if (!closing) return 'failed'

  if (closing.protocol === 'mockMcpServer') {
    const result = closing.mockMcpServerId ? await saveMockMcpDraft(closing.mockMcpServerId) : null
    if (result && !result.ok) {
      if (result.error) reportFailure(result.error)
      return 'failed'
    }
    return 'saved'
  }

  try {
    // Always, even when `tabId` is already the active tab: the editor stores
    // can lag the tab strip (a project switch restores its active tab before
    // the Workbench effect re-points them), and the save snapshots the stores.
    switchActiveTab(tabId)
    const result = await saveActiveRequestInPlace()
    if (result.notApplicable) {
      if (result.orphaned) toast.info(t('toast.requestOrphaned'))
      const tab = useTabsStore.getState().tabs.find((x) => x.id === tabId)
      if (tab && isRequestLikeTab(tab)) useUIStore.getState().setShowEndpointSaveModal(true)
      return 'saveAs'
    }
    if (!result.success) {
      reportFailure(result.error)
      return 'failed'
    }
    return 'saved'
  } catch (err) {
    reportFailure((err as Error).message)
    return 'failed'
  }
}
