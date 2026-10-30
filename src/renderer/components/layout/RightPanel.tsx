import { Code2, Variable, ChevronRight } from 'lucide-react'
import { useUIStore, selectRightPanelCollapsed } from '../../stores/ui.store'
import RunnerVariables from '../runner/RunnerVariables'
import GenerateCodePane from './GenerateCodePane'
import { useTranslation } from '../../lib/i18n'

interface RightPanelTabIcon {
  id: 'variables' | 'code'
  icon: React.ReactNode
  /** i18n key (issue #193). */
  labelKey: string
}

const TABS: RightPanelTabIcon[] = [
  { id: 'variables', icon: <Variable size={14} />, labelKey: 'rightPanel.variables' },
  { id: 'code', icon: <Code2 size={14} />, labelKey: 'rightPanel.code' },
]

/**
 * Right-side panel that hosts tabs like Postman:
 * [Variables | Code | ...]
 * Collapsible via a thin icon rail. Used inside the Workbench.
 */
export default function RightPanel() {
  const { t } = useTranslation()
  // Preference OR the narrow-editor auto-collapse (issues #251 / #257).
  const collapsed = useUIStore(selectRightPanelCollapsed)
  const activeTab = useUIStore((s) => s.rightPanelTab)
  const setTab = useUIStore((s) => s.setRightPanelTab)
  const toggleCollapsed = useUIStore((s) => s.toggleRightPanel)
  const width = useUIStore((s) => s.rightPanelWidth)

  // Collapsed — show thin icon rail (64px wide) that expands panel when clicked
  if (collapsed) {
    return (
      <div
        data-testid="right-panel-rail"
        className="flex shrink-0 flex-col items-center gap-1 border-l border-[var(--border)] bg-[var(--bg)] py-2"
        style={{ width: 40 }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`right-panel-rail-${tab.id}`}
            onClick={() => {
              setTab(tab.id)
            }}
            title={t(tab.labelKey)}
            aria-label={t(tab.labelKey)}
            className="flex cursor-pointer items-center justify-center rounded p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--accent)]"
            style={{ background: 'transparent', border: 'none' }}
          >
            {tab.icon}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div
      data-testid="right-panel"
      className="flex shrink-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--white)]"
      style={{ width }}
    >
      {/* Tab bar */}
      <div
        className="flex shrink-0 items-center gap-0 px-1"
        style={{ borderBottom: '1px solid var(--border)', height: 34, background: 'var(--white)' }}
      >
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              title={t(tab.labelKey)}
              className="flex cursor-pointer items-center gap-1.5 px-2.5 transition-colors"
              style={{
                height: 33,
                background: 'transparent',
                border: 'none',
                color: isActive ? 'var(--accent-text)' : 'var(--muted)',
                fontWeight: isActive ? 600 : 400,
                borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
                fontSize: 13,
              }}
            >
              {tab.icon}
              <span>{t(tab.labelKey)}</span>
            </button>
          )
        })}

        <div className="flex-1" />

        {/* Collapse button */}
        <button
          type="button"
          data-testid="right-panel-collapse"
          onClick={toggleCollapsed}
          title={t('rightPanel.collapse')}
          aria-label={t('rightPanel.collapse')}
          className="flex cursor-pointer items-center justify-center rounded p-1 text-[var(--muted)] transition-colors hover:text-[var(--text)]"
          style={{ background: 'transparent', border: 'none' }}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {activeTab === 'variables' && <RunnerVariables fillParent />}
        {activeTab === 'code' && <GenerateCodePane />}
      </div>
    </div>
  )
}

/** Tiny helper export so other parts that want to open a specific tab can */
export function openRightPanelTab(tab: 'variables' | 'code') {
  useUIStore.getState().setRightPanelTab(tab)
}
