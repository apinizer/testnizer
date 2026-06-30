// The set of left-sidebar pages. The page only controls which LEFT panel
// (tree/tools/history) is shown — open tabs and the active tab are global and
// shared across all pages (one tab strip), so there is no per-page tab scoping.

export type SidebarPage = 'apis' | 'tests' | 'docs' | 'history' | 'tools' | 'mocks' | 'settings'
