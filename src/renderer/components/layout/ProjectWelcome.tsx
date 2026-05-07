import { Globe, Radio, Cpu, Bot, FileCode2, Hexagon, Activity } from 'lucide-react'
import { useTabsStore } from '../../stores/tabs.store'
import { useRequestStore } from '../../stores/request.store'
import { useResponseStore } from '../../stores/response.store'
import { useTranslation } from '../../lib/i18n'

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
  const { t } = useTranslation()

  function createTab(
    name: string,
    protocol: 'http' | 'soap' | 'websocket' | 'graphql' | 'sse' | 'grpc' | 'ai',
    method?: string,
  ) {
    const id = makeTabId()
    openTab({ id, name, protocol, method: method ?? 'GET', url: '' })
    switchToTab(id)
    clearResponse()
  }

  const actions: ActionCard[] = [
    {
      icon: <Globe size={32} strokeWidth={1.5} />,
      iconBg: '#E3F2FD',
      iconColor: '#1976D2',
      label: t('welcome.newHttpEndpoint'),
      onClick: () => createTab(t('welcome.newEndpointName'), 'http', 'GET'),
    },
    {
      icon: <FileCode2 size={32} strokeWidth={1.5} />,
      iconBg: '#FFF3E0',
      iconColor: '#E65100',
      label: t('newDropdown.soapMethod'),
      onClick: () => createTab(t('welcome.newSoapMethodName'), 'soap', 'POST'),
    },
    {
      icon: <Radio size={32} strokeWidth={1.5} />,
      iconBg: '#E0F7FA',
      iconColor: '#00838F',
      label: t('welcome.websocket'),
      onClick: () => createTab(t('welcome.websocket'), 'websocket'),
    },
    {
      icon: <Cpu size={32} strokeWidth={1.5} />,
      iconBg: '#F3E5F5',
      iconColor: '#6A1B9A',
      label: t('welcome.graphql'),
      onClick: () => createTab(t('welcome.graphql'), 'graphql', 'POST'),
    },
    {
      icon: <Bot size={32} strokeWidth={1.5} />,
      iconBg: '#EDE7F6',
      iconColor: '#5E35B1',
      label: t('welcome.aiSse'),
      onClick: () => createTab(t('welcome.aiSseName'), 'ai'),
    },
    {
      icon: <Hexagon size={32} strokeWidth={1.5} />,
      iconBg: '#E8F5E9',
      iconColor: '#2E7D32',
      label: t('welcome.grpc'),
      onClick: () => createTab(t('welcome.grpc'), 'grpc'),
    },
    {
      icon: <Activity size={32} strokeWidth={1.5} />,
      iconBg: '#E1F5FE',
      iconColor: '#0277BD',
      label: t('welcome.sse'),
      onClick: () => createTab(t('welcome.sse'), 'sse'),
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
            <span className="text-center" style={{ color: 'var(--text)', fontSize: 13, fontWeight: 500 }}>
              {action.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
