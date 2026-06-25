import { useWorkspaceStore } from '../../stores/workspace.store'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import { T } from '../../styles/tokens'
import TreeView from '../sidebar/TreeView'
import NewDropdown from '../sidebar/NewDropdown'
import ImportDropdown from '../sidebar/ImportDropdown'
import HistorySidebar from '../sidebar/HistorySidebar'
import TestsPanel from '../sidebar/TestsPanel'
import ToolsPanel from '../sidebar/ToolsPanel'
import MockServersPanel from '../mock/MockServersPanel'

export default function LeftPanel() {
  const searchQuery = useWorkspaceStore((s) => s.searchQuery)
  const setSearchQuery = useWorkspaceStore((s) => s.setSearchQuery)
  const collapseAllNodes = useWorkspaceStore((s) => s.collapseAllNodes)
  const expandAllNodes = useWorkspaceStore((s) => s.expandAllNodes)
  // "Expanded" when any non-module node is open — module roots are always in
  // the open set, so the toggle compares against the top-level module ids.
  const anyExpanded = useWorkspaceStore((s) => {
    for (const id of s.openNodeIds) {
      if (!s.treeData.some((m) => m.id === id)) return true
    }
    return false
  })
  const activeSidebarPage = useUIStore((s) => s.activeSidebarPage)
  const width = useUIStore((s) => s.leftPanelWidth)
  const { t } = useTranslation()

  return (
    <div
      data-testid="left-panel"
      style={{
        width,
        minWidth: width,
        background: T.white,
        borderRight: `1px solid ${T.border}`,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {activeSidebarPage === 'history' ? (
        <HistorySidebar />
      ) : activeSidebarPage === 'tests' ? (
        <TestsPanel />
      ) : activeSidebarPage === 'tools' ? (
        <ToolsPanel />
      ) : activeSidebarPage === 'mocks' ? (
        <MockServersPanel />
      ) : (
        <>
          {/* Panel header — 44px */}
          <div
            style={{
              height: 44,
              borderBottom: `1px solid ${T.border}`,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 10px',
              flexShrink: 0,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 15, flex: 1, color: T.text }}>
              {t('leftPanel.apis')}
            </span>

            {/* Collapse / expand all folders in one action (issue #39). */}
            <button
              type="button"
              data-testid="tree-collapse-all"
              onClick={() => (anyExpanded ? collapseAllNodes() : expandAllNodes())}
              title={anyExpanded ? t('leftPanel.collapseAll') : t('leftPanel.expandAll')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 26,
                borderRadius: 6,
                border: 'none',
                background: 'transparent',
                color: T.muted,
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = T.surface
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {anyExpanded ? (
                  // chevrons pointing together = collapse
                  <>
                    <polyline points="7 11 12 6 17 11" />
                    <polyline points="7 18 12 13 17 18" />
                  </>
                ) : (
                  // chevrons pointing apart = expand
                  <>
                    <polyline points="7 6 12 11 17 6" />
                    <polyline points="7 13 12 18 17 13" />
                  </>
                )}
              </svg>
            </button>

            {/* Import dropdown (lands users on step 2 of the import wizard) */}
            <ImportDropdown />

            {/* New dropdown (+ button) */}
            <NewDropdown />
          </div>

          {/* Search */}
          <div
            style={{
              padding: '8px 10px',
              borderBottom: `1px solid ${T.border}`,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                background: T.surface,
                border: `1.5px solid ${T.border2}`,
                borderRadius: 8,
                padding: '6px 10px',
                gap: 7,
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke={T.ghost}
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="tree-search"
                placeholder={t('leftPanel.search')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: 13,
                  color: T.text,
                  width: '100%',
                  fontFamily: 'inherit',
                }}
              />
            </div>
          </div>

          {/* Tree */}
          <TreeView />
        </>
      )}
    </div>
  )
}
