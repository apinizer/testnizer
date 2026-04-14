import { Globe, Zap, Radio, Cpu } from 'lucide-react'
import { useTabsStore } from '../../stores/tabs.store'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'

function makeTabId(): string {
  return 'tab-' + Math.random().toString(36).substring(2, 10)
}

interface ActionCard {
  icon: React.ReactNode
  iconBg: string
  iconColor: string
  label: string
  onClick: () => void
}

export default function ProjectWelcome() {
  const openTab = useTabsStore((s) => s.openTab)
  const switchToTab = useRequestStore((s) => s.switchToTab)
  const clearResponse = useResponseStore((s) => s.clearResponse)

  function createTab(name: string, protocol: 'http' | 'websocket' | 'graphql', method = 'GET') {
    const id = makeTabId()
    openTab({ id, name, protocol, method, url: '' })
    switchToTab(id)
    clearResponse()
  }

  const actions: ActionCard[] = [
    {
      icon: <Globe size={32} strokeWidth={1.5} />,
      iconBg: '#E3F2FD',
      iconColor: '#1976D2',
      label: 'New HTTP Endpoint',
      onClick: () => createTab('New Endpoint', 'http', 'GET'),
    },
    {
      icon: <Zap size={32} strokeWidth={1.5} />,
      iconBg: '#E8F5E9',
      iconColor: '#388E3C',
      label: 'Quick Request',
      onClick: () => createTab('Quick Request', 'http', 'GET'),
    },
    {
      icon: <Radio size={32} strokeWidth={1.5} />,
      iconBg: '#E0F7FA',
      iconColor: '#00838F',
      label: 'WebSocket',
      onClick: () => createTab('WebSocket', 'websocket'),
    },
    {
      icon: <Cpu size={32} strokeWidth={1.5} />,
      iconBg: '#F3E5F5',
      iconColor: '#6A1B9A',
      label: 'GraphQL',
      onClick: () => createTab('GraphQL', 'graphql', 'POST'),
    },
  ]

  return (
    <div className="flex h-full flex-col items-center justify-center" style={{ background: 'var(--white)' }}>
      <div className="flex flex-wrap items-center justify-center gap-5" style={{ maxWidth: 800 }}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className="flex cursor-pointer flex-col items-center gap-3 rounded-xl transition-all"
            style={{
              width: 160,
              minHeight: 140,
              padding: '28px 16px 20px',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
            onMouseOver={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
              ;(e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(124,115,230,0.10)'
            }}
            onMouseOut={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
              ;(e.currentTarget as HTMLElement).style.boxShadow = 'none'
            }}
          >
            <div
              className="flex items-center justify-center rounded-xl"
              style={{ width: 56, height: 56, background: action.iconBg }}
            >
              <span style={{ color: action.iconColor }}>{action.icon}</span>
            </div>
            <span className="text-center" style={{ color: 'var(--text)', fontSize: 14, fontWeight: 500 }}>
              {action.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
