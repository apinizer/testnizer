import {
  Globe,
  FileText,
  Bot,
  FileCode2,
  Cpu,
  Hexagon,
  Activity,
  Cloud,
  Zap,
  Clock,
} from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useTabsStore } from '../../stores/tabs.store'
import { useHistoryStore } from '../../stores/history.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTranslation } from '../../lib/i18n'
import { makeTabId } from '../../lib/utils'
import MethodBadge from '../shared/MethodBadge'
import type { HistoryEntry, HttpMethod } from '../../types'

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
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const history = useHistoryStore((s) => s.entries)
  const fetchHistory = useHistoryStore((s) => s.fetch)
  const { t } = useTranslation()

  // Pull the 5 most recent history rows for the current project. v1.3.1 B14
  // shipped the welcome screen without any "recent" affordance, so users who
  // closed all their tabs had to re-navigate the tree to reopen a request
  // they'd just been running.
  useEffect(() => {
    void fetchHistory({
      workspaceId: activeWorkspaceId ?? undefined,
      projectId: activeProjectId ?? undefined,
      limit: 20,
    })
  }, [fetchHistory, activeWorkspaceId, activeProjectId])

  const recent: HistoryEntry[] = useMemo(() => {
    const seenUrls = new Set<string>()
    const list: HistoryEntry[] = []
    for (const entry of history) {
      const key = `${entry.method ?? 'GET'} ${entry.url}`
      if (seenUrls.has(key)) continue
      seenUrls.add(key)
      list.push(entry)
      if (list.length >= 5) break
    }
    return list
  }, [history])

  function openRecent(entry: HistoryEntry) {
    const tabId = `recent-${entry.id}`
    const protocol = (entry.protocol || 'http') as HistoryEntry['protocol']
    openTab({
      id: tabId,
      name: `${entry.method || 'GET'} ${entry.url.split('?')[0].slice(0, 50)}`,
      protocol,
      method: entry.method,
      url: entry.url,
    })
  }

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
    openTab({ id, name: t('welcome.aiSseName'), protocol: 'ai', url: '' })
  }

  function createGrpc() {
    const id = makeTabId()
    openTab({ id, name: t('welcome.grpc'), protocol: 'grpc', method: 'POST', url: '' })
  }

  function createSse() {
    const id = makeTabId()
    openTab({ id, name: t('welcome.sse'), protocol: 'sse', url: '' })
  }

  function createMcp() {
    const id = makeTabId()
    openTab({ id, name: t('welcome.mcp'), protocol: 'mcp', url: '' })
  }

  function createSocketIO() {
    const id = makeTabId()
    openTab({ id, name: t('welcome.socketio'), protocol: 'socketio', url: '' })
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
    {
      icon: <Activity size={28} strokeWidth={1.5} />,
      iconBg: '#E1F5FE',
      label: t('welcome.sse'),
      onClick: createSse,
    },
    {
      icon: <Cloud size={28} strokeWidth={1.5} />,
      iconBg: '#E1F5FE',
      label: t('welcome.mcp'),
      onClick: createMcp,
    },
    {
      icon: <Zap size={28} strokeWidth={1.5} />,
      iconBg: '#FFF3E0',
      label: t('welcome.socketio'),
      onClick: createSocketIO,
    },
  ]

  return (
    <div
      className="flex h-full flex-col items-center overflow-y-auto"
      style={{ background: 'var(--white)' }}
    >
      <div
        className="flex w-full flex-col items-center"
        style={{ maxWidth: 760, paddingTop: 32, paddingBottom: 32 }}
      >
        <div className="flex flex-wrap items-center justify-center gap-5">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={action.onClick}
              className="flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-6 py-8 transition-all hover:border-[var(--accent)] hover:shadow-md"
              style={{
                width: 160,
                minHeight: 140,
                background: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
            >
              <div
                className="flex items-center justify-center rounded-xl"
                style={{ width: 52, height: 52, background: action.iconBg }}
              >
                <span style={{ color: 'var(--accent)' }}>{action.icon}</span>
              </div>
              <span className="text-center font-medium text-[var(--text)]">{action.label}</span>
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <div className="mt-10 w-full px-4">
            <div
              className="mb-3 flex items-center gap-2"
              style={{ color: 'var(--muted)', fontWeight: 600 }}
            >
              <Clock size={14} aria-hidden="true" />
              <span>Recent endpoints</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {recent.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => openRecent(entry)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--white)] px-3 py-2 text-left transition-colors hover:border-[var(--accent)] hover:bg-[var(--surface)]"
                >
                  <MethodBadge method={(entry.method as HttpMethod) || 'GET'} />
                  <span
                    className="flex-1 truncate font-mono"
                    style={{ color: 'var(--text)', fontSize: 13 }}
                  >
                    {entry.url}
                  </span>
                  {entry.status_code != null && (
                    <span
                      style={{
                        fontSize: 12,
                        color:
                          entry.status_code >= 400
                            ? '#cc2200'
                            : entry.status_code >= 300
                              ? '#b35a00'
                              : 'var(--green)',
                      }}
                    >
                      {entry.status_code}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--hint)' }}>
                    {relativeTime(entry.executed_at)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function relativeTime(ts: number): string {
  const delta = Math.max(0, Date.now() - ts) / 1000
  if (delta < 60) return 'just now'
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
  return `${Math.floor(delta / 86400)}d ago`
}
