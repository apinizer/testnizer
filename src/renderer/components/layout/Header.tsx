import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTranslation } from '../../lib/i18n'
import UserMenu from './UserMenu'
import HeaderProjectTabs from './HeaderProjectTabs'
import HeaderProjectActions from './HeaderProjectActions'
import { T } from '../../styles/tokens'

/**
 * Title bar: Home · open-project tabs · project actions + user menu.
 *
 * Only the project-tab strip flexes (tester finding 7): Home and the right
 * group never shrink, so Save / Pull / Push / Branch / user menu stay on
 * screen however many projects are open — the tabs shrink, then scroll.
 */
export default function Header() {
  const goHome = useWorkspaceStore((s) => s.goHome)
  const { t } = useTranslation()

  function handleDoubleClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input')) return
    window.api?.window?.toggleMaximize?.()
  }

  return (
    <header
      data-testid="app-header"
      className="drag-region flex shrink-0 items-center"
      style={{
        height: 44,
        paddingLeft: 72,
        background: 'var(--header-bg)',
        borderBottom: `1px solid ${T.border}`,
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* Home tab */}
      <div
        data-testid="header-home"
        className="no-drag flex items-center cursor-pointer shrink-0"
        style={{
          padding: '0 16px',
          height: '100%',
          borderRight: `1px solid ${T.border}`,
          color: T.muted,
          fontSize: 13,
        }}
        onClick={goHome}
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = T.surface
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.background = 'transparent'
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{ marginRight: 6 }}
        >
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        {t('home.tab')}
      </div>

      {/* Project tabs — one per open project, switchable (#1) */}
      <HeaderProjectTabs />

      {/* Right side — never shrinks */}
      <div
        data-testid="header-actions"
        className="no-drag flex shrink-0 items-center gap-1.5"
        style={{ padding: '0 14px' }}
      >
        <HeaderProjectActions />
        {/* Session / user menu (issue #3) */}
        <UserMenu />
      </div>
    </header>
  )
}
