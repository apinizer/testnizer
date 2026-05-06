import { Globe, FileText, Bot, FileCode2, Cpu, Hexagon } from 'lucide-react'
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
      name: t('welcome.newEndpointName'),
      protocol: 'http',
      method: 'GET',
      url: '',
    })
  }

  function createSoapMethod() {
    if (!activeTabId) return
    updateTab(activeTabId, {
      name: t('welcome.newSoapMethodName'),
      protocol: 'soap',
      method: 'POST',
      url: '',
    })
  }

  function createWebSocket() {
    const id = makeTabId()
    openTab({ id, name: t('welcome.websocket'), protocol: 'websocket', method: 'GET', url: '' })
  }

  function createGraphQL() {
    const id = makeTabId()
    openTab({ id, name: t('welcome.graphql'), protocol: 'graphql', method: 'POST', url: '' })
  }

  function createAiSse() {
    const id = makeTabId()
    openTab({ id, name: t('welcome.aiSseName'), protocol: 'sse', url: '' })
  }

  function createGrpc() {
    const id = makeTabId()
    openTab({ id, name: t('welcome.grpc'), protocol: 'grpc', method: 'POST', url: '' })
  }

  const actions: QuickAction[] = [
    {
      icon: <Globe size={28} strokeWidth={1.5} />,
      iconBg: '#E3F2FD',
      label: t('welcome.newHttpEndpoint'),
      onClick: createHttpEndpoint,
    },
    {
      icon: <FileCode2 size={28} strokeWidth={1.5} />,
      iconBg: '#FFF3E0',
      label: t('newDropdown.soapMethod'),
      onClick: createSoapMethod,
    },
    {
      icon: <FileText size={28} strokeWidth={1.5} />,
      iconBg: '#E0F7FA',
      label: t('welcome.websocket'),
      onClick: createWebSocket,
    },
    {
      icon: <Cpu size={28} strokeWidth={1.5} />,
      iconBg: '#F3E5F5',
      label: t('welcome.graphql'),
      onClick: createGraphQL,
    },
    {
      icon: <Bot size={28} strokeWidth={1.5} />,
      iconBg: '#EDE7F6',
      label: t('welcome.aiSse'),
      onClick: createAiSse,
    },
    {
      icon: <Hexagon size={28} strokeWidth={1.5} />,
      iconBg: '#E8F5E9',
      label: t('welcome.grpc'),
      onClick: createGrpc,
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
