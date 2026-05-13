/**
 * Sidebar panel that lists all mock servers in the active project.
 * Mirrors the visual style of ToolsPanel: header + search + list.
 * Clicking a row opens a tab with `protocol = mockServer`.
 */

import { useEffect, useMemo, useState } from 'react'
import { Plus, Play, Square, Trash2, Server } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useMockStore } from '../../stores/mock.store'
import { useTranslation } from '../../lib/i18n'
import { T } from '../../styles/tokens'

export default function MockServersPanel() {
  const { t } = useTranslation()
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const servers = useMockStore((s) => s.servers)
  const statusByServer = useMockStore((s) => s.statusByServer)
  const errorByServer = useMockStore((s) => s.errorByServer)
  const loadServers = useMockStore((s) => s.loadServers)
  const createServer = useMockStore((s) => s.createServer)
  const startServer = useMockStore((s) => s.startServer)
  const stopServer = useMockStore((s) => s.stopServer)
  const deleteServer = useMockStore((s) => s.deleteServer)
  const openTab = useTabsStore((s) => s.openTab)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newPort, setNewPort] = useState('3001')
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    if (activeProjectId) loadServers(activeProjectId)
  }, [activeProjectId, loadServers])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return servers
    return servers.filter((s) => s.name.toLowerCase().includes(q))
  }, [servers, query])

  async function handleCreate(): Promise<void> {
    setCreateError(null)
    if (!activeProjectId) {
      setCreateError(t('mock.noActiveProject'))
      return
    }
    const port = Number(newPort)
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      setCreateError(t('mock.invalidPort'))
      return
    }
    if (!newName.trim()) {
      setCreateError(t('mock.nameRequired'))
      return
    }
    const created = await createServer({
      projectId: activeProjectId,
      name: newName.trim(),
      port,
    })
    if (!created) {
      setCreateError(t('mock.createFailed'))
      return
    }
    setNewName('')
    setNewPort(String(port + 1))
    setCreating(false)
    openTab({
      id: `mock-${created.id}`,
      name: created.name,
      protocol: 'mockServer',
      mockServerId: created.id,
      isPreview: false,
    })
  }

  function handleOpen(serverId: string, name: string): void {
    openTab({
      id: `mock-${serverId}`,
      name,
      protocol: 'mockServer',
      mockServerId: serverId,
      isPreview: false,
    })
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        style={{
          height: 44,
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          flexShrink: 0,
          gap: 6,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 15, color: T.text, flex: 1 }}>
          {t('mock.sidebarTitle')}
        </span>
        <button
          onClick={() => setCreating((v) => !v)}
          title={t('mock.newServer')}
          style={{
            background: T.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            width: 26,
            height: 26,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <Plus size={14} />
        </button>
      </div>

      {creating && (
        <div
          style={{
            padding: '10px',
            borderBottom: `1px solid ${T.border}`,
            background: T.surface,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('mock.namePlaceholder')}
            style={{
              padding: '6px 8px',
              fontSize: 12,
              border: `1px solid ${T.border}`,
              borderRadius: 4,
              background: T.white,
              color: T.text,
            }}
          />
          <input
            type="number"
            value={newPort}
            onChange={(e) => setNewPort(e.target.value)}
            placeholder="3001"
            min={1}
            max={65535}
            style={{
              padding: '6px 8px',
              fontSize: 12,
              border: `1px solid ${T.border}`,
              borderRadius: 4,
              background: T.white,
              color: T.text,
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleCreate}
              style={{
                flex: 1,
                padding: '6px 8px',
                background: T.accent,
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t('mock.create')}
            </button>
            <button
              onClick={() => {
                setCreating(false)
                setCreateError(null)
              }}
              style={{
                padding: '6px 8px',
                background: T.white,
                color: T.muted,
                border: `1px solid ${T.border}`,
                borderRadius: 4,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {t('mock.cancel')}
            </button>
          </div>
          {createError && <div style={{ color: '#cc2200', fontSize: 11 }}>{createError}</div>}
        </div>
      )}

      {/* Search */}
      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${T.border}` }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('mock.searchServers')}
          style={{
            width: '100%',
            padding: '6px 10px',
            fontSize: 12,
            border: `1.5px solid ${T.border2}`,
            borderRadius: 8,
            background: T.surface,
            color: T.text,
          }}
        />
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: T.muted, fontSize: 12 }}>
            {servers.length === 0 ? t('mock.noServersYet') : t('mock.noMatches')}
          </div>
        ) : (
          filtered.map((s) => {
            const status = statusByServer[s.id] ?? 'stopped'
            const error = errorByServer[s.id]
            const dotColor =
              status === 'running'
                ? '#1a7a4a'
                : status === 'starting'
                  ? '#b35a00'
                  : status === 'error'
                    ? '#cc2200'
                    : '#999'
            return (
              <div
                key={s.id}
                onClick={() => handleOpen(s.id, s.name)}
                style={{
                  padding: '10px 12px',
                  borderBottom: `1px solid ${T.border}`,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Server size={14} color={T.muted} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: T.text,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.name}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: T.muted,
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: dotColor,
                      }}
                    />
                    {s.host}:{s.port} · {status}
                    {error && status === 'error' && (
                      <span style={{ color: '#cc2200' }} title={error}>
                        · {error.slice(0, 30)}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  {status === 'running' ? (
                    <IconBtn
                      title={t('mock.stop')}
                      onClick={() => stopServer(s.id)}
                      color="#cc2200"
                    >
                      <Square size={12} />
                    </IconBtn>
                  ) : (
                    <IconBtn
                      title={t('mock.start')}
                      onClick={() => startServer(s.id)}
                      color="#1a7a4a"
                    >
                      <Play size={12} />
                    </IconBtn>
                  )}
                  <IconBtn
                    title={t('mock.delete')}
                    onClick={() => {
                      if (confirm(t('mock.confirmDelete'))) deleteServer(s.id)
                    }}
                    color="#cc2200"
                  >
                    <Trash2 size={12} />
                  </IconBtn>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function IconBtn({
  title,
  onClick,
  color,
  children,
}: {
  title: string
  onClick: () => void
  color: string
  children: React.ReactNode
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{
        background: 'transparent',
        border: `1px solid ${T.border}`,
        borderRadius: 4,
        width: 22,
        height: 22,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color,
      }}
    >
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>
        {children}
      </span>
    </button>
  )
}
