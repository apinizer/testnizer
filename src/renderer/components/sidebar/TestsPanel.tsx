import { useState, useEffect, useCallback, useRef } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useUIStore } from '../../stores/ui.store'
import { T } from '../../styles/tokens'
import {
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  Play,
  Trash2,
  FolderOpen,
  MoreHorizontal,
  Globe,
  Pencil,
} from 'lucide-react'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import MethodBadge from '../shared/MethodBadge'

/* ── Types ─────────────────────────────────────────────────── */

interface TestSuite {
  id: string
  project_id: string
  name: string
  description: string | null
  sort_order: number
  created_at: number
  updated_at: number
}

interface SuiteEndpoint {
  id: string
  name: string
  method: string | null
  path: string
  protocol: string
  folder_id: string | null
  folder_name: string | null
  sort_order: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => (window as any).api

/* ── Main panel ────────────────────────────────────────────── */

export default function TestsPanel() {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const openTab = useTabsStore((s) => s.openTab)
  const addEndpointsSuiteId = useUIStore((s) => s.addEndpointsSuiteId)

  const [searchQuery, setSearchQuery] = useState('')
  const [suites, setSuites] = useState<TestSuite[]>([])
  const [expandedSuites, setExpandedSuites] = useState<Record<string, boolean>>({})
  const [suiteEndpoints, setSuiteEndpoints] = useState<Record<string, SuiteEndpoint[]>>({})

  // Create suite
  const [showNewSuiteInput, setShowNewSuiteInput] = useState(false)
  const [newSuiteName, setNewSuiteName] = useState('')
  const newSuiteRef = useRef<HTMLInputElement>(null)

  // Rename
  const [renamingSuiteId, setRenamingSuiteId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameRef = useRef<HTMLInputElement>(null)

  // Context menu
  const [contextMenu, setContextMenu] = useState<{ suiteId: string; x: number; y: number } | null>(null)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<TestSuite | null>(null)


  // ─── Load suites ──────────────────────────────────────────
  const loadSuites = useCallback(async () => {
    if (!activeProjectId) return
    const result = await api().testSuite.list(activeProjectId)
    if (result?.success && result.data) setSuites(result.data)
  }, [activeProjectId])

  useEffect(() => { loadSuites() }, [loadSuites])

  // ─── Load endpoints for a suite ───────────────────────────
  const loadSuiteEndpoints = useCallback(async (suiteId: string) => {
    const result = await api().testSuite.listEndpoints(suiteId)
    if (result?.success && result.data) {
      setSuiteEndpoints((prev) => ({ ...prev, [suiteId]: result.data }))
    }
  }, [])

  // Auto-load endpoints when suite is expanded
  useEffect(() => {
    for (const suiteId of Object.keys(expandedSuites)) {
      if (expandedSuites[suiteId] && !suiteEndpoints[suiteId]) {
        loadSuiteEndpoints(suiteId)
      }
    }
  }, [expandedSuites, suiteEndpoints, loadSuiteEndpoints])

  // Reload suite endpoints when AddEndpoints view closes (addEndpointsSuiteId goes null)
  const prevAddSuiteIdRef = useRef<string | null>(null)
  useEffect(() => {
    const prevId = prevAddSuiteIdRef.current
    prevAddSuiteIdRef.current = addEndpointsSuiteId
    // When it transitions from a value to null, reload that suite's endpoints
    if (prevId && !addEndpointsSuiteId) {
      loadSuiteEndpoints(prevId)
      // Auto-expand the suite
      setExpandedSuites((s) => ({ ...s, [prevId]: true }))
    }
  }, [addEndpointsSuiteId, loadSuiteEndpoints])

  // ─── Create suite ─────────────────────────────────────────
  const handleCreateSuite = useCallback(async () => {
    if (!newSuiteName.trim() || !activeProjectId) return
    await api().testSuite.create({ project_id: activeProjectId, name: newSuiteName.trim() })
    setNewSuiteName('')
    setShowNewSuiteInput(false)
    await loadSuites()
  }, [newSuiteName, activeProjectId, loadSuites])

  // ─── Delete suite ─────────────────────────────────────────
  const handleDeleteSuite = useCallback(async () => {
    if (!deleteTarget) return
    await api().testSuite.delete(deleteTarget.id)
    setDeleteTarget(null)
    setContextMenu(null)
    await loadSuites()
  }, [deleteTarget, loadSuites])

  // ─── Rename suite ─────────────────────────────────────────
  const handleRenameSuite = useCallback(async () => {
    if (!renamingSuiteId || !renameValue.trim()) {
      setRenamingSuiteId(null)
      return
    }
    await api().testSuite.update(renamingSuiteId, { name: renameValue.trim() })
    setRenamingSuiteId(null)
    await loadSuites()
  }, [renamingSuiteId, renameValue, loadSuites])

  // ─── Run suite ────────────────────────────────────────────
  const handleRunSuite = useCallback(async (suite: TestSuite) => {
    const eps = suiteEndpoints[suite.id] || []
    if (eps.length === 0) {
      // Load first
      const result = await api().testSuite.listEndpoints(suite.id)
      if (!result?.success || !result.data?.length) return
      const endpointIds = (result.data as SuiteEndpoint[]).map((e: SuiteEndpoint) => e.id)
      runEndpoints(endpointIds, suite.name)
    } else {
      runEndpoints(eps.map((e) => e.id), suite.name)
    }
    setContextMenu(null)
  }, [suiteEndpoints])

  const runEndpoints = useCallback((endpointIds: string[], suiteName: string) => {
    const tabs = useTabsStore.getState().tabs
    const existing = tabs.find((t) => t.protocol === 'runner')
    const tabId = existing ? existing.id : 'runner-main'
    const sessionKey = String(Date.now())

    sessionStorage.setItem(`runner-report-${tabId}`, JSON.stringify({
      autoRun: true,
      endpointIds,
      folderName: suiteName,
    }))

    if (existing) {
      useTabsStore.getState().setActiveTab(existing.id)
      useTabsStore.getState().updateTab(existing.id, { sessionKey })
    } else {
      openTab({ id: tabId, name: 'Runner', protocol: 'runner', sessionKey })
    }
  }, [openTab])

  // ─── Remove endpoint from suite ───────────────────────────
  const handleRemoveEndpoint = useCallback(async (suiteId: string, endpointId: string) => {
    await api().testSuite.removeEndpoint({ suite_id: suiteId, endpoint_id: endpointId })
    await loadSuiteEndpoints(suiteId)
  }, [loadSuiteEndpoints])

  // ─── Focus new suite input ────────────────────────────────
  useEffect(() => {
    if (showNewSuiteInput) newSuiteRef.current?.focus()
  }, [showNewSuiteInput])

  useEffect(() => {
    if (renamingSuiteId) renameRef.current?.focus()
  }, [renamingSuiteId])

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [contextMenu])

  // ─── Filter ───────────────────────────────────────────────
  const filteredSuites = searchQuery.trim()
    ? suites.filter((s) => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : suites

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ fontSize: 13 }}>
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3"
        style={{ height: 44, borderColor: T.border }}
      >
        <span style={{ flex: 1, fontSize: 15, fontWeight: 700, color: T.text }}>Tests</span>
        <button
          type="button"
          onClick={() => { setShowNewSuiteInput(true); setNewSuiteName('') }}
          className="flex cursor-pointer items-center justify-center rounded-[7px] border-none"
          style={{ width: 28, height: 28, background: 'var(--accent)', color: '#fff' }}
          title="New Test Suite"
        >
          <Plus size={15} strokeWidth={2.5} />
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 border-b px-3 py-2" style={{ borderColor: T.border }}>
        <div
          className="flex items-center gap-2 rounded-[7px] px-2.5 py-[5px]"
          style={{ background: 'var(--surface)', border: `1.5px solid ${T.border2}` }}
        >
          <Search size={13} style={{ color: T.ghost, flexShrink: 0 }} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full border-none bg-transparent outline-none"
            style={{ color: T.text, fontFamily: 'inherit', fontSize: 13 }}
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* New suite input */}
        {showNewSuiteInput && (
          <div className="flex items-center gap-2 px-3 py-2">
            <FolderOpen size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <input
              ref={newSuiteRef}
              value={newSuiteName}
              onChange={(e) => setNewSuiteName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateSuite()
                if (e.key === 'Escape') setShowNewSuiteInput(false)
              }}
              onBlur={() => {
                if (newSuiteName.trim()) handleCreateSuite()
                else setShowNewSuiteInput(false)
              }}
              placeholder="Test suite name..."
              className="flex-1 rounded border px-2 py-1 outline-none"
              style={{ fontSize: 13, borderColor: 'var(--accent)', background: 'var(--input-bg)', color: 'var(--text)' }}
            />
          </div>
        )}

        {/* Suite list */}
        {filteredSuites.length === 0 && !showNewSuiteInput ? (
          <div className="mx-3 mt-4 rounded-[7px] border border-dashed py-6 text-center" style={{ borderColor: T.border2 }}>
            <FolderOpen size={28} style={{ color: 'var(--hint)', margin: '0 auto 8px' }} />
            <div style={{ color: 'var(--hint)', fontSize: 13 }}>No test suites yet</div>
            <button
              type="button"
              onClick={() => { setShowNewSuiteInput(true); setNewSuiteName('') }}
              className="mt-2 cursor-pointer border-none bg-transparent font-medium"
              style={{ color: 'var(--accent)', fontSize: 13 }}
            >
              + Create Test Suite
            </button>
          </div>
        ) : (
          filteredSuites.map((suite) => (
            <SuiteNode
              key={suite.id}
              suite={suite}
              expanded={expandedSuites[suite.id] ?? false}
              endpoints={suiteEndpoints[suite.id] || []}
              isRenaming={renamingSuiteId === suite.id}
              renameValue={renameValue}
              renameRef={renameRef}
              onToggle={() => setExpandedSuites((s) => ({ ...s, [suite.id]: !s[suite.id] }))}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ suiteId: suite.id, x: e.clientX, y: e.clientY })
              }}
              onRenameChange={setRenameValue}
              onRenameSubmit={handleRenameSuite}
              onRenameCancel={() => setRenamingSuiteId(null)}
              onRemoveEndpoint={(eid) => handleRemoveEndpoint(suite.id, eid)}
            />
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (() => {
        const suite = suites.find((s) => s.id === contextMenu.suiteId)
        if (!suite) return null
        return (
          <div
            className="fixed z-[500] rounded-lg border py-1"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
              background: 'var(--white)',
              borderColor: 'var(--border)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              minWidth: 160,
            }}
          >
            <ContextMenuItem
              icon={<Play size={13} />}
              label="Run Suite"
              onClick={() => handleRunSuite(suite)}
            />
            <ContextMenuItem
              icon={<Plus size={13} />}
              label="Add Endpoints"
              onClick={() => {
                setContextMenu(null)
                useUIStore.getState().setAddEndpointsSuite(suite.id, suite.name)
              }}
            />
            <ContextMenuItem
              icon={<Pencil size={13} />}
              label="Rename"
              onClick={() => {
                setRenamingSuiteId(suite.id)
                setRenameValue(suite.name)
                setContextMenu(null)
              }}
            />
            <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
            <ContextMenuItem
              icon={<Trash2 size={13} />}
              label="Delete"
              danger
              onClick={() => { setDeleteTarget(suite); setContextMenu(null) }}
            />
          </div>
        )
      })()}

      {/* Delete confirm */}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        itemName={deleteTarget?.name || ''}
        itemType="test suite"
        onConfirm={handleDeleteSuite}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

/* ── Suite node (folder) ──────────────────────────────────── */

function SuiteNode({
  suite, expanded, endpoints, isRenaming, renameValue, renameRef,
  onToggle, onContextMenu, onRenameChange, onRenameSubmit, onRenameCancel,
  onRemoveEndpoint,
}: {
  suite: TestSuite
  expanded: boolean
  endpoints: SuiteEndpoint[]
  isRenaming: boolean
  renameValue: string
  renameRef: React.RefObject<HTMLInputElement>
  onToggle: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onRenameChange: (v: string) => void
  onRenameSubmit: () => void
  onRenameCancel: () => void
  onRemoveEndpoint: (endpointId: string) => void
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <div>
      {/* Suite header */}
      <div
        className="flex items-center gap-1.5 px-3 py-[6px]"
        style={{ background: hovered ? 'var(--item-hover)' : 'transparent', cursor: 'pointer' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={onToggle}
        onContextMenu={onContextMenu}
      >
        <span style={{ color: T.ghost, flexShrink: 0 }}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <FolderOpen size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />

        {isRenaming ? (
          <input
            ref={renameRef as React.RefObject<HTMLInputElement>}
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit()
              if (e.key === 'Escape') onRenameCancel()
            }}
            onBlur={onRenameSubmit}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 rounded border px-1.5 py-0.5 outline-none"
            style={{ fontSize: 13, borderColor: 'var(--accent)', background: 'var(--input-bg)', color: 'var(--text)' }}
          />
        ) : (
          <span className="flex-1 truncate" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            {suite.name}
          </span>
        )}

        <span style={{ fontSize: 13, color: 'var(--hint)', flexShrink: 0 }}>
          {endpoints.length > 0 ? endpoints.length : ''}
        </span>

        {hovered && !isRenaming && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onContextMenu(e) }}
            className="flex shrink-0 cursor-pointer items-center border-none bg-transparent p-0"
            style={{ color: T.ghost }}
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>

      {/* Endpoints */}
      {expanded && (
        <div>
          {endpoints.length === 0 ? (
            <div className="py-2 pl-10 pr-3" style={{ color: 'var(--hint)', fontSize: 13 }}>
              No endpoints. Right-click to add.
            </div>
          ) : (
            endpoints.map((ep) => (
              <EndpointItem
                key={ep.id}
                endpoint={ep}
                onRemove={() => onRemoveEndpoint(ep.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

/* ── Endpoint item in suite ───────────────────────────────── */

function EndpointItem({ endpoint, onRemove }: { endpoint: SuiteEndpoint; onRemove: () => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className="flex items-center gap-2 py-[4px] pl-10 pr-3"
      style={{ background: hovered ? 'var(--item-hover)' : 'transparent' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {endpoint.method ? (
        <MethodBadge method={endpoint.method} small />
      ) : (
        <Globe size={12} style={{ color: 'var(--hint)' }} />
      )}
      <span className="flex-1 truncate" style={{ fontSize: 13, color: 'var(--text)' }}>
        {endpoint.name}
      </span>
      {endpoint.folder_name && (
        <span className="shrink-0 truncate" style={{ fontSize: 12, color: 'var(--hint)', maxWidth: 80 }}>
          {endpoint.folder_name}
        </span>
      )}
      {hovered && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="flex shrink-0 cursor-pointer items-center border-none bg-transparent p-0"
          title="Remove from suite"
          style={{ color: '#cc2200' }}
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  )
}

/* ── Context menu item ────────────────────────────────────── */

function ContextMenuItem({ icon, label, danger, onClick }: {
  icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-1.5 text-left transition-colors hover:bg-[var(--surface)]"
      style={{ fontSize: 13, color: danger ? '#cc2200' : 'var(--text)' }}
    >
      {icon}
      {label}
    </button>
  )
}

