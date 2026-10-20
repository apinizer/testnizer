import { useState } from 'react'
import { useTabsStore } from '../stores/tabs.store'
import { useTabSubTabStore } from '../stores/tab-subtab.store'

/**
 * The selected sub-tab of an editor, remembered per open request tab
 * (issue #205). Drop-in for `useState<K>(defaultKey)` in an editor that
 * Workbench remounts on every tab switch.
 *
 * - `scope` names the editor ('request', 'soap', …) so two editors never read
 *   each other's choice.
 * - `keys` is the editor's sub-tab list; a stored value that is not in it is
 *   ignored and `defaultKey` is shown instead.
 * - With no active tab (an editor mounted outside the tab strip) the choice
 *   falls back to plain local state.
 */
export function useTabSubTab<K extends string>(
  scope: string,
  keys: readonly K[],
  defaultKey: K,
): [K, (key: K) => void] {
  const tabId = useTabsStore((s) => s.activeTabId)
  const stored = useTabSubTabStore((s) => (tabId ? s.byTab[tabId]?.[scope] : undefined))
  const setSubTab = useTabSubTabStore((s) => s.setSubTab)
  const [local, setLocal] = useState<K>(defaultKey)

  if (!tabId) return [local, setLocal]

  const current = keys.find((k) => k === stored) ?? defaultKey
  return [current, (key: K) => setSubTab(tabId, scope, key)]
}
