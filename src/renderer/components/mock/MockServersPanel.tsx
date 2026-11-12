/**
 * Sidebar panel that lists all mock servers in the active project: header +
 * search + one group per type — HTTP, MCP, SSE, AI (issues #140, #221), in
 * the dialog's order — that share one row design.
 *
 * Layout follows the APIs panel (LeftPanel.tsx): a 44px header, a search box
 * with a magnifier, sizes in px. Tailwind spacing is rem-based and the app
 * sets the root font size to the user's font size (13px by default), so
 * `h-11` would render ~36px and drift from the other panels.
 *
 * The header "+" opens a type menu (HTTP / MCP / SSE / AI); every entry and
 * each group's hover "+" open the same "New mock server" dialog with that
 * type preselected. With no server at all the panel shows one empty state
 * instead of four empty groups.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Activity, Bot, Cloud, Globe, Plus, Server } from 'lucide-react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useMockStore } from '../../stores/mock.store'
import { useMockMcpStore } from '../../stores/mock-mcp.store'
import { useTranslation } from '../../lib/i18n'
import { T } from '../../styles/tokens'
import { normalizeMockServerKind } from '../../../shared/mock-kind'
import MockMcpServersSection from '../mock-mcp/MockMcpServersSection'
import MockKindServersSection from './MockKindServersSection'
import NewMockServerModal from './NewMockServerModal'
import LeftPanelCollapseButton from '../layout/LeftPanelCollapseButton'
import { matchesMockQuery } from './mock-kind-ui'
import type { MockKind } from './new-mock-server'

export default function MockServersPanel() {
  const { t } = useTranslation()
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const loadServers = useMockStore((s) => s.loadServers)
  const httpServers = useMockStore((s) => s.servers)
  const mcpAll = useMockMcpStore((s) => s.servers)
  const mcpLoadedFor = useMockMcpStore((s) => s.projectId)
  const [query, setQuery] = useState('')
  // The kind preselected in the open "New mock server" dialog; null = closed.
  const [newKind, setNewKind] = useState<MockKind | null>(null)

  useEffect(() => {
    if (activeProjectId) void loadServers(activeProjectId)
  }, [activeProjectId, loadServers])

  // Same "never show the previous project's list" rule as the MCP section.
  const mcpServers = useMemo(
    () => (mcpLoadedFor && mcpLoadedFor === activeProjectId ? mcpAll : []),
    [mcpLoadedFor, activeProjectId, mcpAll],
  )
  const total = httpServers.length + mcpServers.length
  const matchCount = useMemo(() => {
    if (!query.trim()) return total
    const http = httpServers.filter((s) =>
      matchesMockQuery(query, {
        name: s.name,
        kind: normalizeMockServerKind(s.kind),
        port: s.port,
      }),
    ).length
    const mcp = mcpServers.filter((s) =>
      matchesMockQuery(query, { name: s.name, kind: 'mcp', port: s.port }),
    ).length
    return http + mcp
  }, [query, total, httpServers, mcpServers])

  const panelEmpty = total === 0 && !query.trim()

  return (
    <div className="flex h-full flex-col">
      {/* Header — 44px, same as the APIs panel */}
      <div
        style={{
          height: 44,
          borderBottom: `1px solid ${T.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 10px',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 15, flex: 1, color: T.text }}>
          {t('mock.sidebarTitle')}
        </span>
        <MockNewMenu disabled={!activeProjectId} onPick={setNewKind} />
        <LeftPanelCollapseButton />
      </div>

      {/* Search — filters every group; same box as the APIs panel */}
      <div style={{ padding: '8px 10px', borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: T.surface,
            border: `1.5px solid ${T.border2}`,
            borderRadius: 8,
            padding: '6px 10px',
            gap: 7,
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke={T.ghost}
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            data-testid="mock-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('mock.searchServers')}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 13,
              color: T.text,
              width: '100%',
              fontFamily: 'inherit',
            }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {panelEmpty && (
          <div
            data-testid="mock-panel-empty"
            className="mx-3 mt-4 rounded-[7px] border border-dashed py-6 text-center"
            style={{ borderColor: T.border2 }}
          >
            <Server size={28} style={{ color: 'var(--hint)', margin: '0 auto 8px' }} />
            <div style={{ color: 'var(--hint)', fontSize: 13 }}>{t('mock.panelEmptyTitle')}</div>
            <button
              type="button"
              data-testid="mock-panel-empty-create"
              disabled={!activeProjectId}
              onClick={() => setNewKind('http')}
              className="mt-2 cursor-pointer border-none bg-transparent font-medium disabled:cursor-not-allowed disabled:opacity-50"
              style={{ color: 'var(--accent)', fontSize: 13 }}
            >
              {t('mock.panelEmptyCreate')}
            </button>
          </div>
        )}

        {query.trim() && matchCount === 0 && (
          <div
            data-testid="mock-no-matches"
            className="px-4 py-4 text-center"
            style={{ color: 'var(--muted)', fontSize: 13 }}
          >
            {t('mock.noMatches')}
          </div>
        )}

        {/* The groups stay mounted while hidden: the MCP group loads its own list. */}
        <div hidden={panelEmpty}>
          <MockKindServersSection
            kind="http"
            query={query}
            onAdd={() => setNewKind('http')}
            disabled={!activeProjectId}
          />
          <MockMcpServersSection query={query} onAdd={() => setNewKind('mcp')} />
          <MockKindServersSection
            kind="sse"
            query={query}
            onAdd={() => setNewKind('sse')}
            disabled={!activeProjectId}
          />
          <MockKindServersSection
            kind="ai"
            query={query}
            onAdd={() => setNewKind('ai')}
            disabled={!activeProjectId}
          />
        </div>
      </div>

      {newKind && <NewMockServerModal initialKind={newKind} onClose={() => setNewKind(null)} />}
    </div>
  )
}

interface MenuItem {
  kind: MockKind
  label: string
  icon: ReactNode
  iconColor: string
  bg: string
}

/** Header "+": a small type menu, styled like the APIs panel's New menu. */
function MockNewMenu({
  disabled,
  onPick,
}: {
  disabled: boolean
  onPick: (kind: MockKind) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const updatePosition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 6, left: rect.left })
  }, [])

  useEffect(() => {
    if (open) updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const items: MenuItem[] = [
    {
      kind: 'http',
      label: t('mockNew.addHttp'),
      icon: <Globe size={16} strokeWidth={1.75} />,
      iconColor: '#1976D2',
      bg: '#E3F2FD',
    },
    {
      kind: 'mcp',
      label: t('mockMcp.new'),
      icon: <Cloud size={16} strokeWidth={1.75} />,
      iconColor: '#0277BD',
      bg: '#E1F5FE',
    },
    {
      kind: 'sse',
      label: t('mockNew.addSse'),
      icon: <Activity size={16} strokeWidth={1.75} />,
      iconColor: '#0277BD',
      bg: '#E1F5FE',
    },
    {
      kind: 'ai',
      label: t('mockNew.addAi'),
      icon: <Bot size={16} strokeWidth={1.75} />,
      iconColor: '#5E35B1',
      bg: '#EDE7F6',
    },
  ]

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          data-testid="mock-new-menu"
          className="fixed z-[9999] w-64 rounded-xl border border-[var(--border)] bg-[var(--white)] p-2"
          style={{
            top: pos.top,
            left: pos.left,
            boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
            animation: 'slideDown 0.15s ease',
          }}
        >
          <div className="mb-1 ml-1 font-medium uppercase tracking-widest text-[var(--hint)]">
            {t('mock.newServer')}
          </div>
          {items.map((item) => (
            <button
              key={item.kind}
              type="button"
              role="menuitem"
              data-testid={`mock-new-option-${item.kind}`}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-[7px] transition-colors hover:bg-[var(--bg)]"
              style={{
                color: 'var(--text)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onClick={() => {
                setOpen(false)
                onPick(item.kind)
              }}
            >
              <div
                aria-hidden="true"
                className="flex shrink-0 items-center justify-center rounded-[7px]"
                style={{ width: 28, height: 28, background: item.bg, color: item.iconColor }}
              >
                {item.icon}
              </div>
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )
    : null

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        data-testid="mock-new"
        title={t('mock.newServer')}
        aria-label={t('mock.newServer')}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        className="flex cursor-pointer items-center justify-center rounded-[7px] border-none disabled:cursor-not-allowed disabled:opacity-50"
        style={{ width: 28, height: 28, background: 'var(--accent)', color: '#fff' }}
      >
        <Plus size={15} strokeWidth={2.5} />
      </button>
      {menu}
    </div>
  )
}
