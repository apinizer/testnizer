import { useTabsStore } from '../stores/tabs.store'

/**
 * Activate the tab `delta` places from the active one, wrapping at both ends —
 * the command palette's Next / Previous tab and Mod+Alt+Right / Left.
 */
export function activateAdjacentTab(delta: 1 | -1): void {
  const s = useTabsStore.getState()
  if (s.tabs.length === 0) return
  const idx = s.tabs.findIndex((tab) => tab.id === s.activeTabId)
  const next = s.tabs[(idx + delta + s.tabs.length) % s.tabs.length]
  s.setActiveTab(next.id)
}
