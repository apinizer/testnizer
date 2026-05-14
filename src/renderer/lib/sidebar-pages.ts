// Which sidebar page a tab protocol "lives" in. Used by IconSidebar to
// clear the active tab on page switches and by Workbench to filter the
// tab strip so a runner tab stays out of the APIs page (and vice versa).
//
// - APIs hosts every request-style protocol (http/soap/ws/graphql/etc.)
// - Tests hosts the collection runner
// - Mocks hosts mock-server editors
// - Tools / history / docs / settings share the tab strip; tools tabs
//   stay visible regardless of which page is active since the Tools
//   page only swaps the left panel.

export type SidebarPage = 'apis' | 'tests' | 'docs' | 'history' | 'tools' | 'mocks' | 'settings'

export function tabBelongsToPage(protocol: string, page: SidebarPage): boolean {
  if (page === 'apis') return protocol !== 'runner' && protocol !== 'mockServer'
  if (page === 'tests') return protocol === 'runner'
  if (page === 'mocks') return protocol === 'mockServer'
  return true
}
