// Which sidebar page a tab "lives" on. Used by IconSidebar to clear the
// active tab on page switches and by Workbench to filter the tab strip
// so a runner tab stays out of the APIs page (and vice versa).
//
// Tab kind takes priority over protocol — a suite-item tab carries an
// http/soap/ws protocol but the testSuiteItemId pins it to the Tests page.
// Same story for mockServerId.
//
// - APIs   → request-style protocols (http/soap/ws/graphql/grpc/sse/...)
// - Tests  → suite-item tabs + `runner` protocol
// - Mocks  → mock-server tabs + `mockServer` protocol
// - Tools  → tools.* protocol tabs (also visible on APIs since Cmd+K
//            opens tools while the user is browsing the APIs page)
// - history / docs / settings → no own tabs

export type SidebarPage = 'apis' | 'tests' | 'docs' | 'history' | 'tools' | 'mocks' | 'settings'

export interface TabPageRef {
  protocol: string
  testSuiteItemId?: string
  mockServerId?: string
}

export function tabBelongsToPage(tab: TabPageRef, page: SidebarPage): boolean {
  if (tab.testSuiteItemId) return page === 'tests'
  if (tab.mockServerId) return page === 'mocks'
  if (tab.protocol === 'runner') return page === 'tests'
  if (tab.protocol === 'mockServer') return page === 'mocks'
  if (tab.protocol.startsWith('tools.')) return page === 'apis' || page === 'tools'
  return page === 'apis'
}
