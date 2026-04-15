import { Globe, Zap, FileText } from 'lucide-react'
import { useTabsStore } from '../../stores/tabs.store'
import { useTranslation } from '../../lib/i18n'

function makeTabId(): string {
  return 'tab-' + Math.random().toString(36).substring(2, 10)
}

interface QuickAction {
  icon: React.ReactNode
  iconBg: string
  label: string
  onClick: () => void
}

export default function NewRequestWelcome() {
  const openTab = useTabsStore((s) => s.openTab)
  const updateTab = useTabsStore((s) => s.updateTab)
  const activeTabId = useTabsStore((s) => s.activeTabId)
  const { t } = useTranslation()

  function createHttpEndpoint() {
    if (!activeTabId) return
    updateTab(activeTabId, {
      name: 'New Endpoint',
      protocol: 'http',
      method: 'GET',
      url: '',
    })
  }

  function createQuickRequest() {
    if (!activeTabId) return
    updateTab(activeTabId, {
      name: 'Quick Request',
      protocol: 'http',
      method: 'GET',
      url: '',
    })
  }

  function createWebSocket() {
    const id = makeTabId()
    openTab({ id, name: 'WebSocket', protocol: 'websocket', method: 'GET', url: '' })
  }

  const actions: QuickAction[] = [
    {
      icon: <Globe size={28} strokeWidth={1.5} />,
      iconBg: '#E3F2FD',
      label: 'New HTTP Endpoint',
      onClick: createHttpEndpoint,
    },
    {
      icon: <FileText size={28} strokeWidth={1.5} />,
      iconBg: '#EDE7F6',
      label: 'New WebSocket',
      onClick: createWebSocket,
    },
    {
      icon: <Zap size={28} strokeWidth={1.5} />,
      iconBg: '#E8F5E9',
      label: 'Quick Request',
      onClick: createQuickRequest,
    },
  ]

  return (
    <div className="flex h-full flex-col items-center justify-center" style={{ background: 'var(--white)' }}>
      <div className="flex flex-wrap items-center justify-center gap-5" style={{ maxWidth: 720 }}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-8 transition-all hover:border-[var(--accent)] hover:shadow-md"
            style={{ width: 160, minHeight: 140, background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div
              className="flex items-center justify-center rounded-xl"
              style={{ width: 52, height: 52, background: action.iconBg }}
            >
              <span style={{ color: 'var(--accent)' }}>{action.icon}</span>
            </div>
            <span className="text-center font-medium text-[var(--text)]">
              {action.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
