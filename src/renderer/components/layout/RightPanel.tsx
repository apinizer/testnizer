import { useEffect, useRef } from 'react'
import { Code2, Variable, ChevronRight } from 'lucide-react'
import { useUIStore, selectRightPanelCollapsed } from '../../stores/ui.store'
import RunnerVariables from '../runner/RunnerVariables'
import GenerateCodePane from './GenerateCodePane'
import { useTranslation } from '../../lib/i18n'
import {
  rightPanelOverlayWidth,
  rightPanelRenderedWidth,
  type RightPanelMode,
} from '../../lib/narrow-layout'
import { Z } from '../../lib/z-index'

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

const DOCKED_CLASS =
  'flex shrink-0 flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--white)]'
const OVERLAY_CLASS =
  'absolute inset-y-0 right-0 flex flex-col overflow-hidden border-l border-[var(--border)] bg-[var(--white)] shadow-[var(--shadow-drop)]'

/**
 * Right-side panel that hosts tabs like Postman:
 * [Variables | Code | ...]
 * Collapsible via a thin icon rail. Used inside the Workbench.
 *
 * `mode` (issue #251, decided by `rightPanelMode` in WorkbenchMainRow):
 * 'docked' is a flex sibling of the editor; 'overlay' is a drawer over the
 * right edge of the (positioned) row, closed by the collapse button or by
 * Escape pressed inside it. Neither mode writes the stored width.
 */
export default function RightPanel({
  rowWidth = 0,
  mode = 'docked',
}: {
  rowWidth?: number
  mode?: RightPanelMode
}) {
  const { t } = useTranslation()
  // Preference OR the narrow-editor auto-collapse (issues #251 / #257).
  const collapsed = useUIStore(selectRightPanelCollapsed)
  const activeTab = useUIStore((s) => s.rightPanelTab)
  const setTab = useUIStore((s) => s.setRightPanelTab)
  const toggleCollapsed = useUIStore((s) => s.toggleRightPanel)
  const width = useUIStore((s) => s.rightPanelWidth)
  const panelRef = useRef<HTMLDivElement>(null)
  const overlay = mode === 'overlay'

  // Opened from the rail, the clicked rail button unmounts and focus falls to
  // the body: move it into the drawer so Escape closes it. Never steals focus
  // from a control the user is in (e.g. a resize turning docked into overlay).
  useEffect(() => {
    if (collapsed || !overlay) return
    const active = document.activeElement
    if (active && active !== document.body) return
    panelRef.current?.focus({ preventScroll: true })
  }, [collapsed, overlay])

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

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (!overlay || e.key !== 'Escape' || e.defaultPrevented) return
    // React events bubble through portals: only Escape from the panel's own DOM.
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return
    e.preventDefault()
    e.stopPropagation()
    toggleCollapsed()
  }

  return (
    <div
      ref={panelRef}
      data-testid="right-panel"
      data-mode={mode}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={overlay ? OVERLAY_CLASS : DOCKED_CLASS}
      // Docked: never more than leaves the URL bar its room (issue #251).
      // Overlay: the stored width, leaving a strip of the editor visible.
      // The stored preference itself is untouched either way.
      style={
        overlay
          ? { width: rightPanelOverlayWidth(rowWidth, width), zIndex: Z.DRAWER }
          : { width: rightPanelRenderedWidth(rowWidth, width) }
      }
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
