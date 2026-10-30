import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import { formatShortcut } from '../../lib/shortcut-format'
import { isLeftPanelCollapsible } from '../../lib/sidebar-pages'

/** Same notation as the command palette (issue #257: one formatter). */
function toggleShortcut(): string {
  return formatShortcut(['Mod', 'B'])
}

/**
 * Collapse control in a left-panel header (issue #202) — the counterpart of
 * the right panel's collapse chevron. Rendered by each collapsible page's
 * header (APIs, Tools, Security, Mocks); renders nothing on a page whose
 * panel stays open regardless (History, Tests).
 */
export default function LeftPanelCollapseButton() {
  const { t } = useTranslation()
  const page = useUIStore((s) => s.activeSidebarPage)
  const setCollapsed = useUIStore((s) => s.setLeftPanelCollapsed)
  if (!isLeftPanelCollapsible(page)) return null
  const label = t('leftPanel.collapse')
  return (
    <button
      type="button"
      data-testid="left-panel-collapse"
      onClick={() => setCollapsed(true)}
      title={`${label} (${toggleShortcut()})`}
      aria-label={label}
      className="flex h-[26px] w-[26px] shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--text)]"
    >
      <PanelLeftClose size={15} />
    </button>
  )
}

/**
 * Expand control shown in the icon sidebar while the left panel is collapsed
 * (issue #202). Hidden when the panel is open, or on a page whose panel can't
 * be collapsed (it is visible there anyway).
 */
export function LeftPanelExpandButton() {
  const { t } = useTranslation()
  const collapsed = useUIStore((s) => s.isLeftPanelCollapsed)
  const page = useUIStore((s) => s.activeSidebarPage)
  const setCollapsed = useUIStore((s) => s.setLeftPanelCollapsed)
  if (!collapsed || !isLeftPanelCollapsible(page)) return null
  const label = t('leftPanel.expand')
  return (
    <button
      type="button"
      data-testid="left-panel-expand"
      onClick={() => setCollapsed(false)}
      title={`${label} (${toggleShortcut()})`}
      aria-label={label}
      className="mb-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border-none bg-transparent text-[var(--hint)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--accent)]"
    >
      <PanelLeftOpen size={18} />
    </button>
  )
}
