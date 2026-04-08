import { Save } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useUIStore } from '../../stores/ui.store'
import { useBranchStore } from '../../stores/branch.store'
import { useTranslation } from '../../lib/i18n'
import ProjectIcon from '../shared/ProjectIcon'
import { T } from '../../styles/tokens'

export default function Header() {
  const goHome = useWorkspaceStore((s) => s.goHome)
  const setShowSaveModal = useUIStore((s) => s.setShowSaveModal)
  const activeBranch = useBranchStore((s) => s.getActiveBranch())
  const activeProject = useWorkspaceStore((s) => {
    const pid = s.activeProjectId
    return s.projects.find((p) => p.id === pid)
  })
  const { t } = useTranslation()

  function handleDoubleClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input')) return
    window.api?.window?.toggleMaximize?.()
  }

  return (
    <header
      className="drag-region flex shrink-0 items-center"
      style={{
        height: 44,
        paddingLeft: 72,
        background: T.white,
        borderBottom: `1px solid ${T.border}`,
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* Home tab */}
      <div
        className="no-drag flex items-center cursor-pointer shrink-0"
        style={{
          padding: '0 16px',
          height: '100%',
          borderRight: `1px solid ${T.border}`,
          color: T.muted,
          fontSize: 14,
        }}
        onClick={goHome}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = T.surface }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
        {t('home.tab')}
      </div>

      {/* Project tab */}
      {activeProject && (
        <div
          className="no-drag group flex items-center gap-1.5 cursor-pointer shrink-0"
          style={{
            padding: '0 16px',
            height: '100%',
            fontSize: 14,
            fontWeight: 500,
            borderBottom: `2px solid ${T.accent}`,
            color: T.text,
          }}
        >
          <ProjectIcon name={activeProject.name} size={18} color={T.accent} />
          <span className="truncate" style={{ maxWidth: 160 }}>{activeProject.name}</span>
          <span
            className="hidden cursor-pointer group-hover:inline"
            style={{ color: T.ghost, fontSize: 16, marginLeft: 4 }}
            onClick={(e) => {
              e.stopPropagation()
              goHome()
            }}
          >
            ×
          </span>
        </div>
      )}

      {/* "..." menu */}
      <div
        className="no-drag flex items-center cursor-pointer shrink-0"
        style={{ padding: '0 8px', color: T.ghost, fontSize: 18 }}
      >
        ···
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side */}
      <div className="no-drag flex items-center gap-2 shrink-0" style={{ padding: '0 14px' }}>
        {/* Branch pill */}
        <div
          className="flex items-center gap-1.5 cursor-pointer"
          style={{
            padding: '4px 10px',
            background: T.surface,
            border: `1.5px solid ${T.border2}`,
            borderRadius: 20,
            fontSize: 12,
            color: T.sub,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span style={{ fontWeight: 500 }}>{activeBranch?.name || 'main'}</span>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        {/* Save */}
        <button
          type="button"
          onClick={() => setShowSaveModal(true)}
          className="flex items-center gap-1 cursor-pointer"
          style={{
            background: 'transparent',
            border: `1px solid ${T.border}`,
            borderRadius: 7,
            padding: '4px 10px',
            color: T.muted,
            fontSize: 12,
          }}
          title="Save Project (Cmd+S)"
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = T.accent
            ;(e.currentTarget as HTMLElement).style.borderColor = T.accent
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = T.muted
            ;(e.currentTarget as HTMLElement).style.borderColor = T.border
          }}
        >
          <Save size={12} />
        </button>

        {/* Avatar */}
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: T.accent,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            color: 'white',
            cursor: 'pointer',
          }}
        >
          A
        </div>
      </div>
    </header>
  )
}
