import { useState, useEffect, useCallback, useRef } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useTabsStore } from '../../stores/tabs.store'
import type { Tab } from '../../types'
import { T } from '../../styles/tokens'
import {
  Plus,
  Search,
  ChevronRight,
  ChevronDown,
  Clock,
  Play,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import type { EndpointRunResult, RunnerReport } from '../../stores/runner.store'

/* ── Section icons ─────────────────────────────────────────── */

function SectionIcon({ bg, children }: { bg: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  )
}

/* ── Run history row (from DB) ───────────────────────────────── */

interface RunHistoryRow {
  id: string
  project_id: string
  duration_ms: number
  total_endpoints: number
  passed_endpoints: number
  failed_endpoints: number
  total_tests: number
  failed_tests: number
  avg_resp_time: number
  results_json: string | null
  started_at: number
}

/* ── Scheduled task row (from DB) ────────────────────────────── */

interface ScheduledTaskRow {
  id: string
  project_id: string
  name: string
  endpoint_ids: string
  folder_id: string | null
  environment_id: string | null
  interval_value: number
  interval_unit: string
  delay_ms: number
  enabled: number
  last_run_at: number | null
  next_run_at: number | null
  created_at: number
}

/* ── Main panel ────────────────────────────────────────────── */

export default function TestsPanel() {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const openTab = useTabsStore((s) => s.openTab)

  const [searchQuery, setSearchQuery] = useState('')
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    runs: true,
    scheduled: true,
  })
  const [runHistory, setRunHistory] = useState<RunHistoryRow[]>([])
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTaskRow[]>([])
  const [showPlusMenu, setShowPlusMenu] = useState(false)
  const plusRef = useRef<HTMLDivElement>(null)

  // Close plus menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) {
        setShowPlusMenu(false)
      }
    }
    if (showPlusMenu) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showPlusMenu])

  // Load run history
  useEffect(() => {
    if (!activeProjectId) return
    window.api?.runner?.history(activeProjectId).then((result: unknown) => {
      const res = result as { success: boolean; data?: RunHistoryRow[] }
      if (res?.success && res.data) setRunHistory(res.data)
    }).catch(() => {})
  }, [activeProjectId])

  // Load scheduled tasks
  const loadScheduledTasks = useCallback(() => {
    if (!activeProjectId) return
    const api = window.api as Record<string, unknown> & { scheduler?: { list: (id: string) => Promise<{ success: boolean; data?: ScheduledTaskRow[] }> } }
    api.scheduler?.list(activeProjectId).then((result) => {
      if (result?.success && result.data) setScheduledTasks(result.data)
    }).catch(() => {})
  }, [activeProjectId])

  useEffect(() => {
    loadScheduledTasks()
  }, [loadScheduledTasks])

  // Listen for scheduled run completions to refresh data
  useEffect(() => {
    const api = window.api as Record<string, unknown> & { scheduler?: { onRunCompleted: (cb: (e: unknown) => void) => () => void } }
    const unsub = api.scheduler?.onRunCompleted?.(() => {
      // Refresh both history and tasks
      loadScheduledTasks()
      if (activeProjectId) {
        window.api?.runner?.history(activeProjectId).then((result: unknown) => {
          const res = result as { success: boolean; data?: RunHistoryRow[] }
          if (res?.success && res.data) setRunHistory(res.data)
        }).catch(() => {})
      }
    })
    return () => { unsub?.() }
  }, [loadScheduledTasks, activeProjectId])

  const RUNNER_TAB_ID = 'runner-main'

  /** Find existing runner tab or create one, reusing the same tab */
  const openOrReuseRunnerTab = useCallback((sessionData?: Record<string, unknown>) => {
    const tabs = useTabsStore.getState().tabs
    const existing = tabs.find((t: Tab) => t.protocol === 'runner')
    const tabId = existing ? existing.id : RUNNER_TAB_ID
    const newSessionKey = String(Date.now())

    if (sessionData) {
      sessionStorage.setItem(`runner-report-${tabId}`, JSON.stringify(sessionData))
    }

    if (existing) {
      // Reuse — activate and bump sessionKey so RunnerTab re-reads sessionStorage
      useTabsStore.getState().setActiveTab(existing.id)
      useTabsStore.getState().updateTab(existing.id, { sessionKey: newSessionKey })
    } else {
      openTab({ id: tabId, name: 'Runner', protocol: 'runner', sessionKey: newSessionKey })
    }
    return tabId
  }, [openTab])

  const openRunnerTab = useCallback(() => {
    setShowPlusMenu(false)
    openOrReuseRunnerTab()
  }, [openOrReuseRunnerTab])

  const openScheduledTasksTab = useCallback(() => {
    openOrReuseRunnerTab({ viewScheduledTasks: true })
  }, [openOrReuseRunnerTab])

  const openAllRunsTab = useCallback(() => {
    openOrReuseRunnerTab({ viewAllRuns: true })
  }, [openOrReuseRunnerTab])

  const openRunReport = useCallback((run: RunHistoryRow) => {
    if (!run.results_json) return
    try {
      const results = JSON.parse(run.results_json) as EndpointRunResult[]
      openOrReuseRunnerTab({
        results,
        report: {
          projectId: run.project_id,
          startedAt: run.started_at,
          completedAt: run.started_at + run.duration_ms,
          totalEndpoints: run.total_endpoints,
          passedEndpoints: run.passed_endpoints,
          failedEndpoints: run.failed_endpoints,
          totalAssertions: run.total_tests,
          passedAssertions: run.total_tests - run.failed_tests,
          failedAssertions: run.failed_tests,
          results,
        },
        startedAt: run.started_at,
      })
    } catch { /* invalid JSON */ }
  }, [openOrReuseRunnerTab])

  const deleteScheduledTask = useCallback(async (taskId: string) => {
    const api = window.api as Record<string, unknown> & { scheduler?: { delete: (id: string) => Promise<{ success: boolean }> } }
    await api.scheduler?.delete(taskId)
    loadScheduledTasks()
  }, [loadScheduledTasks])

  const toggleScheduledTask = useCallback(async (taskId: string) => {
    const api = window.api as Record<string, unknown> & { scheduler?: { toggle: (id: string) => Promise<{ success: boolean }> } }
    await api.scheduler?.toggle(taskId)
    loadScheduledTasks()
  }, [loadScheduledTasks])

  const toggleSection = (key: string) => {
    setExpandedSections((s) => ({ ...s, [key]: !s[key] }))
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) return 'Today ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(1)}s`
  }

  // Filter runs by search
  const filteredHistory = searchQuery.trim()
    ? runHistory.filter((r) => formatDate(r.started_at).toLowerCase().includes(searchQuery.toLowerCase()))
    : runHistory

  const filteredTasks = searchQuery.trim()
    ? scheduledTasks.filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : scheduledTasks

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ fontSize: 13 }}>
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-2 border-b px-3"
        style={{ height: 44, borderColor: T.border }}
      >
        <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: T.text }}>Tests</span>

        {/* + button with dropdown */}
        <div ref={plusRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setShowPlusMenu(!showPlusMenu)}
            className="flex cursor-pointer items-center justify-center rounded-[7px] border-none"
            style={{ width: 28, height: 28, background: 'var(--accent)', color: '#fff' }}
            title="New"
          >
            <Plus size={15} strokeWidth={2.5} />
          </button>
          {showPlusMenu && (
            <div
              className="rounded-[8px] border border-[var(--border)]"
              style={{
                position: 'absolute',
                top: 32,
                right: 0,
                width: 180,
                background: 'var(--white)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
                zIndex: 100,
                padding: '4px 0',
              }}
            >
              <button
                type="button"
                onClick={openRunnerTab}
                className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-3 py-2 text-left hover:bg-[var(--surface)]"
                style={{ fontSize: 13, color: 'var(--text)' }}
              >
                <Play size={14} style={{ color: 'var(--accent)' }} />
                New Run
              </button>
            </div>
          )}
        </div>
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

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto py-1">

        {/* ══ Runs ══ */}
        <SectionHeader
          icon={<SectionIcon bg="#e8f0fe"><Play size={13} style={{ color: '#4285f4' }} /></SectionIcon>}
          label="Runs"
          expanded={expandedSections.runs}
          onToggle={() => toggleSection('runs')}
          onLabelClick={openAllRunsTab}
          action={
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openRunnerTab() }}
              title="New Run"
              className="flex cursor-pointer items-center justify-center rounded-[4px] border-none bg-transparent p-0.5"
              style={{ color: T.ghost }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = T.ghost }}
            >
              <Plus size={14} />
            </button>
          }
        />
        {expandedSections.runs && (
          <div className="pb-2">
            {filteredHistory.length === 0 ? (
              <EmptySection actionLabel="+ New Run" onAction={openRunnerTab} />
            ) : (
              <>
                {filteredHistory.slice(0, 10).map((run) => (
                  <RunHistoryItem
                    key={run.id}
                    date={formatDate(run.started_at)}
                    duration={formatDuration(run.duration_ms)}
                    hasFailed={run.failed_endpoints > 0 || run.failed_tests > 0}
                    onClick={() => openRunReport(run)}
                  />
                ))}
                {filteredHistory.length > 10 && (
                  <div className="px-9 py-1">
                    <button
                      type="button"
                      onClick={openAllRunsTab}
                      className="cursor-pointer border-none bg-transparent hover:underline"
                      style={{ color: 'var(--accent)', fontSize: 13 }}
                    >
                      View all {filteredHistory.length} runs
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ══ Scheduled Tasks ══ */}
        <SectionHeader
          icon={<SectionIcon bg="#e0f2fe"><Clock size={13} style={{ color: '#0369a1' }} /></SectionIcon>}
          label="Scheduled Tasks"
          expanded={expandedSections.scheduled}
          onToggle={() => toggleSection('scheduled')}
          onLabelClick={openScheduledTasksTab}
        />
      </div>
    </div>
  )
}

/* ── Section header ────────────────────────────────────────── */

function SectionHeader({
  icon, label, expanded, onToggle, action, onLabelClick,
}: {
  icon: React.ReactNode; label: string; expanded: boolean; onToggle: () => void
  action?: React.ReactNode; onLabelClick?: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      className="flex w-full items-center gap-2 px-3 py-[7px]"
      style={{ background: hovered ? 'var(--item-hover)' : 'transparent', transition: 'background 0.1s', cursor: 'pointer' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex shrink-0 cursor-pointer items-center border-none bg-transparent p-0"
        style={{ color: T.ghost }}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      <button
        type="button"
        onClick={onLabelClick || onToggle}
        className="flex flex-1 cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left"
      >
        {icon}
        <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{label}</span>
      </button>
      {action && hovered && action}
    </div>
  )
}

/* ── Run history item ──────────────────────────────────────── */

function RunHistoryItem({ date, duration, hasFailed, onClick }: {
  date: string; duration: string; hasFailed: boolean; onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex cursor-pointer items-center gap-2 py-[5px] pl-9 pr-3"
      style={{ background: hovered ? 'var(--item-hover)' : 'transparent', transition: 'background 0.1s' }}
    >
      <span className="inline-block shrink-0 rounded-full" style={{ width: 7, height: 7, background: hasFailed ? '#cc2200' : '#1a7a4a' }} />
      <span style={{ flex: 1, color: 'var(--text)', fontSize: 13 }}>{date}</span>
      <span style={{ fontSize: 13, color: 'var(--muted)', flexShrink: 0 }}>{duration}</span>
    </div>
  )
}

/* ── Scheduled task item (Postman-style) ──────────────────── */

function ScheduledTaskItem({ task, formatDate, onToggle, onDelete }: {
  task: ScheduledTaskRow
  formatDate: (ts: number) => string
  onToggle: () => void
  onDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const endpointCount = (() => {
    try { return (JSON.parse(task.endpoint_ids) as string[]).length } catch { return 0 }
  })()

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex items-start gap-2 py-[6px] pl-9 pr-3"
      style={{ background: hovered ? 'var(--item-hover)' : 'transparent', transition: 'background 0.1s' }}
    >
      {/* Status dot */}
      <span
        className="mt-1.5 inline-block shrink-0 rounded-full"
        style={{ width: 7, height: 7, background: task.enabled ? '#1a7a4a' : '#aaa' }}
      />

      {/* Info */}
      <div className="flex-1" style={{ minWidth: 0 }}>
        <div className="truncate" style={{ color: 'var(--text)', fontWeight: 500, fontSize: 13 }}>
          {task.name}
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 1 }}>
          Runs every {task.interval_value} {task.interval_unit} &middot; {endpointCount} endpoints
        </div>
        {task.next_run_at && task.enabled ? (
          <div style={{ color: 'var(--hint)', fontSize: 13, marginTop: 1 }}>
            Next: {formatDate(task.next_run_at)}
          </div>
        ) : null}
        {task.last_run_at ? (
          <div style={{ color: 'var(--hint)', fontSize: 13, marginTop: 1 }}>
            Last: {formatDate(task.last_run_at)}
          </div>
        ) : null}
      </div>

      {/* Actions (visible on hover) */}
      {hovered && (
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle() }}
            title={task.enabled ? 'Pause' : 'Resume'}
            className="flex cursor-pointer items-center justify-center rounded-[4px] border-none bg-transparent p-0.5"
            style={{ color: task.enabled ? '#1a7a4a' : '#aaa' }}
          >
            {task.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            title="Delete"
            className="flex cursor-pointer items-center justify-center rounded-[4px] border-none bg-transparent p-0.5"
            style={{ color: '#cc2200' }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Empty section ─────────────────────────────────────────── */

function EmptySection({ actionLabel, onAction }: { actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="mx-3 rounded-[7px] border border-dashed py-3 text-center" style={{ borderColor: T.border2 }}>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="cursor-pointer border-none bg-transparent font-medium"
          style={{ color: T.ghost, fontSize: 13 }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  )
}
