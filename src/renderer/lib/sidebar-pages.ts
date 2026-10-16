// The set of left-sidebar pages. The page only controls which LEFT panel
// (tree/tools/history) is shown — open tabs and the active tab are global and
// shared across all pages (one tab strip), so there is no per-page tab scoping.

export type SidebarPage =
  | 'apis'
  | 'tests'
  | 'docs'
  | 'history'
  | 'tools'
  | 'security'
  | 'mocks'
  | 'settings'

/**
 * Pages whose left panel the user can collapse (Ctrl+B / the panel's collapse
 * button, issue #202). History and Tests keep their panel on purpose: it is
 * the page's only navigation, and the workbench beside it has nothing to show
 * without a selection there.
 */
export function isLeftPanelCollapsible(page: SidebarPage): boolean {
  return page !== 'history' && page !== 'tests'
}
