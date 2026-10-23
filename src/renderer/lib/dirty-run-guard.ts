import type { Tab } from '../types'
import { useTabsStore } from '../stores/tabs.store'
import { saveActiveRequestInPlace } from './save-active-request'
import { toast } from './toast'

/**
 * `t` loaded on demand, like `withheld-before-send.ts` does: `i18n` pulls in
 * `ui.store`, and this module is reachable from `runner.store` — the import
 * graph stays what it was (see tests/main/renderer-stores-node-import.test.ts).
 */
async function message(key: string, vars: Record<string, string>): Promise<string> {
  const { t } = await import('./i18n')
  return Object.entries(vars).reduce((text, [k, v]) => text.replace(`{${k}}`, v), t(key))
}

/**
 * The collection runner executes the LAST SAVED snapshot of each request (it
 * reads endpoints / saved requests / test_suite_items straight from the DB). So
 * if a request is open in a tab with unsaved edits, a run would silently use
 * stale data — the script / assertion / URL changes the user just made wouldn't
 * apply (issue: "edited a suite item, ran it, old behaviour").
 *
 * Before a run we therefore:
 *   1. Auto-save the ACTIVE tab when it's part of this run and dirty — that's
 *      the dominant case (edit a request, hit Run) and `saveActiveRequestInPlace`
 *      already persists it cleanly (handles testSuiteItem / savedRequest /
 *      endpoint targets alike).
 *   2. Warn about any OTHER dirty tabs in the run set. Those can't be saved
 *      without switching to each (their edits live in the per-tab cache, not the
 *      live protocol stores), so we surface them rather than silently run stale.
 *
 * Returns the names of run items that still hold unsaved edits after the
 * auto-save (i.e. the warned ones) — handy for tests / callers that want detail.
 */
export async function saveDirtyRunItemsBeforeRun(itemIds: string[]): Promise<string[]> {
  const ids = new Set(itemIds)
  const linkOf = (t: Tab): string | undefined =>
    t.testSuiteItemId ?? t.endpointId ?? t.savedRequestId

  const { tabs, activeTabId } = useTabsStore.getState()
  const active = tabs.find((t) => t.id === activeTabId)

  // 1) Auto-save the active tab if it's a dirty member of this run.
  const activeLink = active ? linkOf(active) : undefined
  // A run member whose row is gone (issue #269): the save unbinds the tab and
  // keeps it dirty, so step 2 no longer sees it as a run item — name it here
  // rather than letting the run go on without a word about the lost edits.
  const orphanedNames: string[] = []
  if (active?.isDirty && activeLink && ids.has(activeLink)) {
    try {
      const result = await saveActiveRequestInPlace()
      if (result?.orphaned) orphanedNames.push(active.name)
    } catch {
      // A save failure must not block the run — fall through to the warning so
      // the user at least knows this item may be stale.
    }
  }
  if (orphanedNames.length > 0) {
    toast.warning(await message('runner.orphanedRunItems', { names: orphanedNames.join(', ') }))
  }

  // 2) Warn about the remaining dirty run items (not the active tab, or active
  // save failed). Re-read the store so a successful auto-save above clears it.
  const after = useTabsStore.getState()
  const stillDirty = after.tabs.filter((t) => {
    if (!t.isDirty) return false
    const link = linkOf(t)
    return !!link && ids.has(link)
  })
  if (stillDirty.length === 0) return orphanedNames
  const names = stillDirty.map((t) => t.name)
  toast.warning(
    await message('runner.unsavedRunItems', {
      count: String(names.length),
      names: names.join(', '),
    }),
  )
  return [...orphanedNames, ...names]
}
