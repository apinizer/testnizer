import { useState } from 'react'
import { useUIStore } from '../../stores/ui.store'
import { useTabsStore } from '../../stores/tabs.store'
import { saveActiveRequestInPlace } from '../../lib/save-active-request'
import { useTranslation } from '../../lib/i18n'
import { toast } from '../../lib/toast'

export interface UrlBarSaveState {
  save: () => Promise<void>
  loading: boolean
  ok: boolean
  error: string | null
}

/**
 * The URL bar's Save action — ONE handler for the wide layout's `save-btn` and
 * the compact layout's overflow-menu item (issue #251), so the two can never
 * drift. Unsaved / orphaned tab → Save dialog; saved → in place through the
 * same helper as Ctrl+S and "Save & Close".
 */
export function useUrlBarSave(): UrlBarSaveState {
  const { t } = useTranslation()
  const setShowEndpointSaveModal = useUIStore((s) => s.setShowEndpointSaveModal)
  const activeTab = useTabsStore((s) => s.tabs.find((tab) => tab.id === s.activeTabId))
  const [loading, setLoading] = useState(false)
  const [ok, setOk] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(): Promise<void> {
    const isSaved = activeTab?.savedRequestId || activeTab?.endpointId || activeTab?.testSuiteItemId
    if (!isSaved) {
      // Not saved yet — open the Save dialog. A tab whose row was deleted
      // from the sidebar says so (issue #269).
      if (activeTab?.orphaned) toast.info(t('toast.requestOrphaned'))
      setShowEndpointSaveModal(true)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const result = await saveActiveRequestInPlace()
      if (result.notApplicable) {
        // No row to write in place (issue #269) — same fallback as Ctrl+S.
        if (result.orphaned) toast.info(t('toast.requestOrphaned'))
        setShowEndpointSaveModal(true)
        return
      }
      if (!result.success) throw new Error(result.error || 'Save failed')
      setOk(true)
      setTimeout(() => setOk(false), 1500)
    } catch (e) {
      // Never swallow: the user would think the work was saved.
      setError((e as Error).message || 'Save failed')
      setTimeout(() => setError(null), 4000)
    } finally {
      setLoading(false)
    }
  }

  return { save, loading, ok, error }
}
