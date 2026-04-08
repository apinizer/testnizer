import { useState } from 'react'
import { Globe, Box, FileText, Zap, ChevronDown, Code2, Radio, Cpu, Rss } from 'lucide-react'
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
  const [showMore, setShowMore] = useState(false)

  function createTab(name: string, protocol: 'http' | 'soap' | 'websocket' | 'graphql' | 'grpc' | 'sse', method = 'GET') {
    const id = makeTabId()
    openTab({ id, name, protocol, method, url: '' })
    switchToTab(id)
    clearResponse()
  }

  const mainActions: ActionCard[] = [
    {
      icon: <Globe size={32} strokeWidth={1.5} />,
      iconBg: '#E3F2FD',
      iconColor: '#1976D2',
      label: t('projectWelcome.newHttpEndpoint'),
      onClick: () => createTab('New Endpoint', 'http', 'GET'),
    },
    {
      icon: <Box size={32} strokeWidth={1.5} />,
      iconBg: '#FCE4EC',
      iconColor: '#C2185B',
      label: t('projectWelcome.newSchema'),
      onClick: () => {}, // Schema editing — placeholder
    },
    {
      icon: <FileText size={32} strokeWidth={1.5} />,
      iconBg: '#EDE7F6',
      iconColor: '#7B1FA2',
      label: t('projectWelcome.newMarkdown'),
      onClick: () => {}, // Markdown — placeholder
    },
    {
      icon: <Zap size={32} strokeWidth={1.5} />,
      iconBg: '#E8F5E9',
      iconColor: '#388E3C',
      label: t('projectWelcome.quickRequest'),
      onClick: () => createTab('Quick Request', 'http', 'GET'),
    },
  ]

  const moreActions: ActionCard[] = [
    {
      icon: <Code2 size={28} strokeWidth={1.5} />,
      iconBg: '#FFF3E0',
      iconColor: '#E65100',
      label: 'SOAP',
      onClick: () => createTab('SOAP Request', 'soap', 'POST'),
    },
    {
      icon: <Radio size={28} strokeWidth={1.5} />,
      iconBg: '#E0F7FA',
      iconColor: '#00838F',
      label: 'WebSocket',
      onClick: () => createTab('WebSocket', 'websocket', 'GET'),
    },
    {
      icon: <Cpu size={28} strokeWidth={1.5} />,
      iconBg: '#F3E5F5',
      iconColor: '#6A1B9A',
      label: 'GraphQL',
      onClick: () => createTab('GraphQL', 'graphql', 'POST'),
    },
    {
      icon: <Rss size={28} strokeWidth={1.5} />,
      iconBg: '#E8EAF6',
      iconColor: '#283593',
      label: 'SSE',
      onClick: () => createTab('SSE', 'sse', 'GET'),
    },
  ]

  return (
    <div className="flex h-full flex-col items-center justify-center" style={{ background: 'var(--white)' }}>
      {/* Main action cards */}
      <div className="flex flex-wrap items-center justify-center gap-5" style={{ maxWidth: 800 }}>
        {mainActions.map((action) => (
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
            <span className="text-center text-[0.875rem] font-medium" style={{ color: 'var(--text)' }}>
              {action.label}
            </span>
          </button>
        ))}
      </div>

      {/* More toggle */}
      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        className="mt-5 flex cursor-pointer items-center gap-1 text-[0.875rem]"
        style={{ background: 'transparent', border: 'none', color: 'var(--muted)' }}
      >
        {t('projectWelcome.more')}
        <ChevronDown
          size={14}
          style={{
            transform: showMore ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.2s',
          }}
        />
      </button>

      {/* More actions */}
      {showMore && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-4" style={{ maxWidth: 700 }}>
          {moreActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className="flex cursor-pointer flex-col items-center gap-2 rounded-lg transition-all"
              style={{
                width: 120,
                minHeight: 100,
                padding: '16px 12px 12px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
              onMouseOver={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
              }}
              onMouseOut={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
              }}
            >
              <div
                className="flex items-center justify-center rounded-lg"
                style={{ width: 44, height: 44, background: action.iconBg }}
              >
                <span style={{ color: action.iconColor }}>{action.icon}</span>
              </div>
              <span className="text-center text-[0.8rem] font-medium" style={{ color: 'var(--text)' }}>
                {action.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
