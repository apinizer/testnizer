import { useUIStore } from '../../stores/ui.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { T } from '../../styles/tokens'
import ProjectIcon from '../shared/ProjectIcon'

type SidebarPage = 'apis' | 'tests' | 'docs' | 'history' | 'settings'

interface NavItem {
  id: SidebarPage
  label: string
  icon: (active: boolean) => React.ReactNode
  action?: () => void
}

function GlobeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.7} strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function CheckIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.7} strokeLinecap="round">
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  )
}

function ClockIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2 : 1.7} strokeLinecap="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function CogIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export default function IconSidebar() {
  const activePage = useUIStore((s) => s.activeSidebarPage)
  const setActivePage = useUIStore((s) => s.setActiveSidebarPage)
  const setShowProjectDetailModal = useUIStore((s) => s.setShowProjectDetailModal)
  const activeProject = useWorkspaceStore((s) => {
    const pid = s.activeProjectId
    return s.projects.find((p) => p.id === pid)
  })

  const topItems: NavItem[] = [
    { id: 'apis', label: 'APIs', icon: (a) => <GlobeIcon active={a} /> },
    { id: 'tests', label: 'Tests', icon: (a) => <CheckIcon active={a} /> },
    { id: 'history', label: 'History', icon: (a) => <ClockIcon active={a} /> },
  ]

  const bottomItems: NavItem[] = [
    { id: 'settings', label: 'Settings', icon: () => <CogIcon />, action: () => setShowProjectDetailModal(true) },
  ]

  function handleClick(item: NavItem) {
    if (item.action) {
      item.action()
    } else {
      setActivePage(item.id as SidebarPage)
    }
  }

  return (
    <div
      style={{
        width: T.sidebarW,
        minWidth: T.sidebarW,
        background: T.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        flexShrink: 0,
        paddingTop: 12,
      }}
    >
      {/* Project icon */}
      <div style={{ marginBottom: 8, flexShrink: 0 }}>
        <ProjectIcon
          name={activeProject?.display_name || activeProject?.name || 'P'}
          emoji={activeProject?.icon_emoji || undefined}
          color={activeProject?.icon_color || '#2D5FA0'}
          size={32}
        />
      </div>

      {/* Top nav */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: 1, width: '100%' }}>
        {topItems.map((item) => {
          const active = activePage === item.id
          return (
            <div
              key={item.id}
              onClick={() => handleClick(item)}
              style={{
                width: 'calc(100% - 8px)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                padding: '9px 4px',
                cursor: 'pointer',
                color: active ? T.accent : T.ghost,
                background: active ? T.accentBg : 'transparent',
                borderRadius: 8,
                margin: '0 4px',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!active) (e.currentTarget as HTMLElement).style.background = T.surface
              }}
              onMouseLeave={(e) => {
                if (!active) (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              {item.icon(active)}
              <span style={{ fontSize: 13, fontWeight: active ? 600 : 400, fontFamily: 'inherit' }}>{item.label}</span>
            </div>
          )
        })}
      </div>

      {/* Bottom nav */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, paddingBottom: 10, width: '100%' }}>
        {bottomItems.map((item) => (
          <div
            key={item.id}
            onClick={() => handleClick(item)}
            style={{
              width: 'calc(100% - 8px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              padding: '9px 4px',
              cursor: 'pointer',
              color: T.ghost,
              borderRadius: 8,
              margin: '0 4px',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = T.surface }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
          >
            {item.icon(false)}
            <span style={{ fontSize: 13, fontFamily: 'inherit' }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
