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
  const activeSidebarPage = useUIStore((s) => s.activeSidebarPage)
  const { t } = useTranslation()

  return (
    <div
      style={{
        width: T.panelW,
        minWidth: T.panelW,
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
