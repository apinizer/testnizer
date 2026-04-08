import { X, Home } from 'lucide-react'
import { useTabsStore } from '../../stores/tabs.store'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTranslation } from '../../lib/i18n'

const METHOD_COLORS: Record<string, string> = {
  GET: '#0066cc',
  POST: '#1a7a4a',
  PUT: '#b35a00',
  PATCH: '#0a7a5a',
  DELETE: '#cc2200',
  HEAD: '#6b21a8',
  OPTIONS: '#888888',
}

export default function Header() {
  const tabs = useTabsStore((s) => s.tabs)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const setActiveTab = useTabsStore((s) => s.setActiveTab)
  const closeTab = useTabsStore((s) => s.closeTab)
  const switchToTab = useRequestStore((s) => s.switchToTab)
  const removeTabState = useRequestStore((s) => s.removeTabState)
  const clearResponse = useResponseStore((s) => s.clearResponse)
  const goHome = useWorkspaceStore((s) => s.goHome)
  const activeProject = useWorkspaceStore((s) => {
    const pid = s.activeProjectId
    return s.projects.find((p) => p.id === pid)
  })
  const { t } = useTranslation()

  // Whether project tab is active (no request tab selected)
  const isProjectTabActive = !activeTabId || !tabs.find((tab) => tab.id === activeTabId)

  function handleDoubleClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input')) return
    window.api?.window?.toggleMaximize?.()
  }

  function handleSwitchTab(tabId: string) {
    if (tabId === activeTabId) return
    switchToTab(tabId)
    clearResponse()
    setActiveTab(tabId)
  }

  function handleCloseTab(tabId: string) {
    removeTabState(tabId)
    closeTab(tabId)
    // After closing, switch to the new active tab
    const newActiveId = useTabsStore.getState().activeTabId
    if (newActiveId) {
      switchToTab(newActiveId)
      clearResponse()
    }
  }

  function handleProjectTabClick() {
    // Deselect all request tabs → show project welcome
    setActiveTab(null)
    clearResponse()
  }

  function handleCloseProject() {
    // Go back to home/project list
    goHome()
  }

  return (
    <header
      className="drag-region flex shrink-0 items-end"
      style={{
        height: 44,
        paddingLeft: 72,
        background: 'var(--bg)',
        borderBottom: '1px solid var(--border-split)',
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* Tab strip */}
      <div className="no-drag flex h-[44px] flex-1 items-end overflow-hidden">
        {/* Home tab */}
        <div
          className="flex h-[36px] cursor-pointer items-center gap-1.5 px-3 text-[0.825rem]"
          style={{
            background: 'transparent',
            borderLeft: '1px solid transparent',
            borderRight: '1px solid transparent',
            borderTop: 'none',
            borderBottom: 'none',
            color: 'var(--muted)',
            minWidth: 60,
            borderRadius: '6px 6px 0 0',
            marginBottom: -1,
          }}
          onClick={handleCloseProject}
          title={t('home.tab')}
        >
          <Home size={14} />
          <span className="text-[0.875rem]">{t('home.tab')}</span>
        </div>

        {/* Active project tab */}
        {activeProject && (
          <div
            className={`tab-item group relative flex h-[36px] cursor-pointer items-center gap-1.5 px-3 text-[0.825rem] ${isProjectTabActive ? 'tab-item-active' : ''}`}
            style={{
              background: isProjectTabActive ? 'var(--white)' : 'transparent',
              borderLeft: isProjectTabActive ? '1px solid var(--border-split)' : '1px solid transparent',
              borderRight: isProjectTabActive ? '1px solid var(--border-split)' : '1px solid transparent',
              borderTop: 'none',
              borderBottom: 'none',
              color: 'var(--heading)',
              minWidth: 92,
              maxWidth: 200,
              borderRadius: '6px 6px 0 0',
              marginBottom: -1,
            }}
            onClick={handleProjectTabClick}
          >
            <span className="truncate text-[0.875rem] font-medium">{activeProject.name}</span>

            {/* Close project tab (X) */}
            <button
              type="button"
              className="ml-auto hidden shrink-0 items-center justify-center rounded-full group-hover:inline-flex"
              style={{
                width: 18,
                height: 18,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--muted)',
              }}
              onClick={(e) => {
                e.stopPropagation()
                handleCloseProject()
              }}
              onMouseOver={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'var(--fill-5)'
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Request tabs */}
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId
          const methodColor = METHOD_COLORS[tab.method || ''] || 'var(--muted)'
          return (
            <div
              key={tab.id}
              className={`tab-item group relative flex h-[36px] cursor-pointer items-center gap-1.5 px-3 text-[0.825rem] ${isActive ? 'tab-item-active' : ''}`}
              style={{
                background: isActive ? 'var(--white)' : 'transparent',
                borderLeft: isActive ? '1px solid var(--border-split)' : '1px solid transparent',
                borderRight: isActive ? '1px solid var(--border-split)' : '1px solid transparent',
                borderTop: 'none',
                borderBottom: 'none',
                color: isActive ? 'var(--heading)' : 'var(--text)',
                minWidth: 92,
                maxWidth: 200,
                borderRadius: '6px 6px 0 0',
                marginBottom: -1,
              }}
              onClick={() => handleSwitchTab(tab.id)}
            >
              {/* Method label */}
              <span
                className="shrink-0 text-[0.875rem] font-bold uppercase"
                style={{ color: methodColor }}
              >
                {tab.method || tab.protocol?.toUpperCase() || ''}
              </span>

              {/* Tab name */}
              <span className="truncate">{tab.name}</span>

              {/* Dirty indicator */}
              {tab.isDirty && (
                <span
                  className="absolute right-2 top-2 rounded-full"
                  style={{
                    width: 6,
                    height: 6,
                    background: 'var(--accent)',
                  }}
                />
              )}

              {/* Close button */}
              <button
                type="button"
                className="ml-auto hidden shrink-0 items-center justify-center rounded-full group-hover:inline-flex"
                style={{
                  width: 18,
                  height: 18,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--muted)',
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  handleCloseTab(tab.id)
                }}
                onMouseOver={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'var(--fill-5)'
                }}
                onMouseOut={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'transparent'
                }}
              >
                <X size={12} />
              </button>
            </div>
          )
        })}

      </div>
    </header>
  )
}
