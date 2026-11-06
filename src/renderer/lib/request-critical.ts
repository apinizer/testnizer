import { useRequestStore } from '../stores/request.store'
import { findOpenTabFor } from './open-endpoint-tab'
import { t } from './i18n'
import { toast } from './toast'

/**
 * Set a row's Critical flag from outside its editor (run sequence, issue #315).
 *
 * The flag goes straight to the row. An editor tab open on that row holds its
 * own copy, which its next Ctrl+S — or the auto-save before a run — writes
 * back, so that copy follows without marking the tab dirty.
 */
export async function setRequestCritical(id: string, critical: boolean): Promise<boolean> {
  const res = await window.api.runner.setRequestCritical(id, critical)
  if (!res.success) {
    toast.error(t('runSequence.criticalSaveFailed').replace('{error}', res.error ?? ''))
    return false
  }
  const tab = findOpenTabFor(id)
  if (tab) useRequestStore.getState().syncSavedCritical(tab.id, critical)
  return true
}
