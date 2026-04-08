import {
  Globe,
  FlaskConical,
  BookOpen,
  History,
  Settings,
  Users
} from 'lucide-react'
import { useUIStore } from '../../stores/ui.store'
import { useTranslation } from '../../lib/i18n'
import appIcon from '../../assets/icon.png'

type SidebarPage = 'apis' | 'tests' | 'docs' | 'history' | 'settings'

interface NavItem {
  id: SidebarPage | 'invite'
  icon: React.ReactNode
  label: string
  action?: () => void
}

export default function IconSidebar() {
  const activePage = useUIStore((s) => s.activeSidebarPage)
  const setActivePage = useUIStore((s) => s.setActiveSidebarPage)
  const setShowSettingsModal = useUIStore((s) => s.setShowSettingsModal)
  const { t } = useTranslation()

  const topItems: NavItem[] = [
    { id: 'apis', icon: <Globe size={20} />, label: t('sidebar.apis') },
    { id: 'tests', icon: <FlaskConical size={20} />, label: t('sidebar.tests') },
    { id: 'docs', icon: <BookOpen size={20} />, label: t('sidebar.docs') },
    { id: 'history', icon: <History size={20} />, label: t('sidebar.history') },
  ]

  const bottomItems: NavItem[] = [
    {
      id: 'settings',
      icon: <Settings size={20} />,
      label: t('sidebar.settings'),
      action: () => setShowSettingsModal(true)
    },
    { id: 'invite', icon: <Users size={20} />, label: t('sidebar.invite') },
  ]

  function handleClick(item: NavItem) {
    if (item.action) {
      item.action()
    } else if (item.id !== 'invite') {
      setActivePage(item.id as SidebarPage)
    }
  }

  return (
    <div
      className="flex shrink-0 flex-col items-center overflow-hidden"
      style={{
        width: 80,
        minWidth: 80,
        background: 'var(--nav-bg)',
        padding: '0 4px',
        paddingTop: 48,
        userSelect: 'none',
      }}
    >
      {/* App Logo in rounded box */}
      <div
        title="Apinizer API Tester"
        style={{
          width: 42,
          height: 42,
          borderRadius: 12,
          background: '#ffffff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.10)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
          flexShrink: 0,
        }}
      >
        <img
          src={appIcon}
          alt="Apinizer API Tester"
          style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 6 }}
        />
      </div>

      {/* Top nav items */}
      <div className="flex flex-1 flex-col items-center" style={{ gap: 4 }}>
        {topItems.map((item) => {
          const isActive = activePage === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleClick(item)}
              className={`nav-item ${isActive ? 'nav-item-active' : ''}`}
              title={item.label}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          )
        })}
      </div>

      {/* Bottom nav items */}
      <div className="flex flex-col items-center" style={{ gap: 4, marginBottom: 24 }}>
        {bottomItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => handleClick(item)}
            className="nav-item"
            title={item.label}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}

        {/* Avatar */}
        <div
          className="flex items-center justify-center rounded-full text-[0.825rem] font-bold text-white"
          style={{
            width: 32,
            height: 32,
            background: 'var(--accent)',
            marginTop: 16,
            cursor: 'pointer',
          }}
        >
          A
        </div>
      </div>
    </div>
  )
}
