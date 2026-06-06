import { useState, useEffect, useCallback } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import {
  ArrowLeft,
  Clock,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Play,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'
import EmptyState from '../shared/EmptyState'
import { openOrReuseRunnerTab } from '../../lib/open-runner-tab'
import NewRunButton from './NewRunButton'

type ScheduleType = 'interval' | 'daily' | 'weekly' | 'cron'

interface ScheduledTask {
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
  schedule_type: ScheduleType | null
  schedule_time: string | null
  schedule_days: string | null
  schedule_cron: string | null
  suite_id: string | null
}

interface ScheduledTaskHistoryRow {
  id: string
  iterations: number
  duration_ms: number
  total_endpoints: number
  passed_endpoints: number
  failed_endpoints: number
  total_tests: number
  passed_tests: number
  failed_tests: number
  started_at: number
}

interface ScheduledTaskEndpointRow {
  id: string
  name: string
  method: string | null
  url: string | null
}

interface ScheduledTaskEndpointsPayload {
  items: ScheduledTaskEndpointRow[]
  source: 'suite' | 'apis' | 'empty'
}

function methodColor(method: string | null): { bg: string; fg: string } {
  const m = (method || 'GET').toUpperCase()
  switch (m) {
    case 'GET':
      return { bg: '#e8f4ff', fg: '#0066cc' }
    case 'POST':
      return { bg: '#e8f9f1', fg: '#1a7a4a' }
    case 'PUT':
      return { bg: '#fff4e0', fg: '#b35a00' }
    case 'PATCH':
      return { bg: '#f0faf5', fg: '#0a7a5a' }
    case 'DELETE':
      return { bg: '#fff0f0', fg: '#cc2200' }
    default:
      return { bg: 'var(--surface)', fg: 'var(--muted)' }
  }
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function describeSchedule(task: ScheduledTask): string {
  const type: ScheduleType = task.schedule_type || 'interval'
  if (type === 'daily' && task.schedule_time) {
    return `Daily at ${task.schedule_time}`
  }
  if (type === 'weekly' && task.schedule_time && task.schedule_days) {
    try {
      const days = (JSON.parse(task.schedule_days) as number[])
        .map((d) => WEEKDAY_SHORT[d])
        .filter(Boolean)
        .join(', ')
      return `${days || '—'} at ${task.schedule_time}`
    } catch {
      return `Weekly at ${task.schedule_time}`
    }
  }
  if (type === 'cron' && task.schedule_cron) {
    return `Cron: ${task.schedule_cron}`
  }
  return `Every ${task.interval_value} ${task.interval_unit}`
}

interface TestSuiteRow {
  id: string
  name: string
}

interface ScheduledTasksViewProps {
  onBack: () => void
}

export default function ScheduledTasksView({ onBack }: ScheduledTasksViewProps) {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [suites, setSuites] = useState<TestSuiteRow[]>([])
  const [deleteTarget, setDeleteTarget] = useState<ScheduledTask | null>(null)

  const loadTasks = useCallback(() => {
    if (!activeProjectId) return
    window.api?.scheduler
      ?.list(activeProjectId)
      .then((result) => {
        if (result?.success && result.data) setTasks(result.data)
      })
      .catch(() => {})
  }, [activeProjectId])

  const loadSuites = useCallback(() => {
    if (!activeProjectId) return
    window.api?.testSuite
      ?.list(activeProjectId)
      .then((result) => {
        if (result?.success && result.data) setSuites(result.data as TestSuiteRow[])
      })
      .catch(() => {})
  }, [activeProjectId])

  useEffect(() => {
    loadTasks()
    loadSuites()
  }, [loadTasks, loadSuites])

  // Opening from a suite is the canonical scheduled-task flow: the runner
  // tab gets the suite's items as the run sequence and the config view
  // defaults to "Schedule runs". When no suites exist the NewRunButton
  // disables itself with a tooltip rather than falling through — there's
  // nothing meaningful to schedule without a suite.
  const openSuiteForSchedule = useCallback((suite: { id: string; name: string }) => {
    openOrReuseRunnerTab({
      sourceType: 'suite',
      suiteId: suite.id,
      folderName: suite.name,
      scheduleMode: true,
    })
  }, [])

  // Listen for scheduled run completions
  useEffect(() => {
    const unsub = window.api?.scheduler?.onRunCompleted?.(() => {
      loadTasks()
    })
    return () => {
      unsub?.()
    }
  }, [loadTasks])

  const toggleTask = useCallback(
    async (taskId: string) => {
      await window.api?.scheduler?.toggle(taskId)
      loadTasks()
    },
    [loadTasks],
  )

  const confirmDeleteTask = useCallback(async () => {
    if (!deleteTarget) return
    await window.api?.scheduler?.delete(deleteTarget.id)
    setDeleteTarget(null)
    loadTasks()
  }, [deleteTarget, loadTasks])

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) return 'Today, ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return (
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ', ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ fontSize: 13 }}>
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-4"
        style={{ height: 44 }}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex cursor-pointer items-center justify-center rounded-[6px] border-none bg-transparent p-1"
          style={{ color: 'var(--muted)' }}
        >
          <ArrowLeft size={16} />
        </button>
        <Clock size={16} style={{ color: '#0369a1' }} />
        <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 15, flex: 1 }}>
          Scheduled Tasks
        </span>
        <NewRunButton suites={suites} mode="schedule" onPickSuite={openSuiteForSchedule} />
      </div>

      {/* Description */}
      <div
        className="shrink-0 border-b border-[var(--border)] px-5 py-3"
        style={{ color: 'var(--muted)' }}
      >
        Periodic runs scheduled on this application. Tasks will run automatically at the configured
        interval.
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {tasks.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No scheduled tasks yet"
            description='Use "Schedule runs" in the Runner configuration to create one.'
            size="md"
          />
        ) : (
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                <th
                  style={{
                    padding: '10px 16px',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: 'var(--text)',
                  }}
                >
                  Upcoming run
                </th>
                <th
                  style={{
                    padding: '10px 16px',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: 'var(--text)',
                  }}
                >
                  Schedule
                </th>
                <th
                  style={{
                    padding: '10px 16px',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: 'var(--text)',
                  }}
                >
                  Environment
                </th>
                <th
                  style={{
                    padding: '10px 16px',
                    textAlign: 'left',
                    fontWeight: 600,
                    color: 'var(--text)',
                  }}
                >
                  Endpoints
                </th>
                <th
                  style={{
                    padding: '10px 16px',
                    textAlign: 'right',
                    fontWeight: 600,
                    color: 'var(--text)',
                  }}
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  formatDate={formatDate}
                  onToggle={() => toggleTask(task.id)}
                  onDelete={() => setDeleteTarget(task)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <DeleteConfirmDialog
        open={!!deleteTarget}
        itemName={deleteTarget?.name || ''}
        itemType="scheduled task"
        onConfirm={confirmDeleteTask}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function TaskRow({
  task,
  formatDate,
  onToggle,
  onDelete,
}: {
  task: ScheduledTask
  formatDate: (ts: number) => string
  onToggle: () => void
  onDelete: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [history, setHistory] = useState<ScheduledTaskHistoryRow[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [endpoints, setEndpoints] = useState<ScheduledTaskEndpointsPayload | null>(null)
  const [endpointsLoading, setEndpointsLoading] = useState(false)
  const endpointCount = (() => {
    try {
      return (JSON.parse(task.endpoint_ids) as string[]).length
    } catch {
      return 0
    }
  })()

  // Fetch history lazily — only when the user expands the row, so the
  // table stays cheap for projects with many scheduled tasks.
  useEffect(() => {
    if (!expanded || history !== null) return
    let cancelled = false
    setHistoryLoading(true)
    window.api?.scheduler
      ?.history(task.id)
      .then((res) => {
        if (cancelled) return
        const data = (res as { success?: boolean; data?: ScheduledTaskHistoryRow[] })?.data
        setHistory(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setHistory([])
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [expanded, history, task.id])

  // Same lazy pattern for the endpoint list — content-rich but the
  // resolution requires a join we don't want to pay for every row.
  useEffect(() => {
    if (!expanded || endpoints !== null) return
    let cancelled = false
    setEndpointsLoading(true)
    window.api?.scheduler
      ?.taskEndpoints(task.id)
      .then((res) => {
        if (cancelled) return
        const data = (res as { success?: boolean; data?: ScheduledTaskEndpointsPayload })?.data
        setEndpoints(data && Array.isArray(data.items) ? data : { items: [], source: 'empty' })
      })
      .catch(() => {
        if (!cancelled) setEndpoints({ items: [], source: 'empty' })
      })
      .finally(() => {
        if (!cancelled) setEndpointsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [expanded, endpoints, task.id])

  // Refresh history when this task fires while expanded — otherwise the
  // user has to collapse + reopen to see a freshly completed run.
  useEffect(() => {
    if (!expanded) return
    const unsub = window.api?.scheduler?.onRunCompleted?.((evt) => {
      const ev = evt as { taskId?: string }
      if (ev?.taskId !== task.id) return
      window.api?.scheduler
        ?.history(task.id)
        .then((res) => {
          const data = (res as { success?: boolean; data?: ScheduledTaskHistoryRow[] })?.data
          if (Array.isArray(data)) setHistory(data)
        })
        .catch(() => {})
    })
    return () => {
      unsub?.()
    }
  }, [expanded, task.id])

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`
    const s = ms / 1000
    if (s < 60) return `${s.toFixed(1)}s`
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  }

  return (
    <>
      <tr
        data-testid="scheduled-task-row"
        data-task-name={task.name}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          borderBottom: expanded ? 'none' : '1px solid var(--border)',
          background: hovered ? 'var(--surface)' : 'transparent',
          transition: 'background 0.1s',
        }}
      >
        {/* Upcoming run */}
        <td style={{ padding: '12px 16px', color: 'var(--text)' }}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? 'Hide run history' : 'Show run history'}
              className="flex cursor-pointer items-center justify-center rounded-[4px] border-none bg-transparent p-0.5"
              style={{ color: 'var(--muted)' }}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            {task.enabled && task.next_run_at ? (
              <span>{formatDate(task.next_run_at)}</span>
            ) : (
              <span style={{ color: 'var(--hint)' }}>Paused</span>
            )}
          </div>
        </td>

        {/* Schedule */}
        <td style={{ padding: '12px 16px' }}>
          <div style={{ color: 'var(--text)', fontWeight: 500 }}>{task.name}</div>
          <div style={{ color: 'var(--muted)', marginTop: 2 }}>{describeSchedule(task)}</div>
          {task.last_run_at && (
            <div style={{ color: 'var(--hint)', marginTop: 2 }}>
              Last run: {formatDate(task.last_run_at)}
            </div>
          )}
        </td>

        {/* Environment */}
        <td style={{ padding: '12px 16px', color: 'var(--muted)' }}>
          {task.environment_id || 'No Environment'}
        </td>

        {/* Endpoints */}
        <td style={{ padding: '12px 16px', color: 'var(--muted)' }}>{endpointCount}</td>

        {/* Actions */}
        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                void window.api?.scheduler?.runNow?.(task.id)
                if (!expanded) setExpanded(true)
                // Optimistic refresh prompt: clear cached history so the
                // useEffect re-fetches once the run lands.
                setHistory(null)
              }}
              title="Run now"
              className="flex cursor-pointer items-center justify-center rounded-[4px] border-none bg-transparent p-1"
              style={{ color: 'var(--accent)' }}
            >
              <Play size={14} />
            </button>
            <button
              type="button"
              onClick={onToggle}
              title={task.enabled ? 'Pause' : 'Resume'}
              className="flex cursor-pointer items-center justify-center rounded-[4px] border-none bg-transparent p-1"
              style={{ color: task.enabled ? '#1a7a4a' : '#aaa' }}
            >
              {task.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
            </button>
            <button
              type="button"
              data-testid="scheduled-task-delete"
              onClick={onDelete}
              title="Delete"
              className="flex cursor-pointer items-center justify-center rounded-[4px] border-none bg-transparent p-1"
              style={{ color: '#cc2200' }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
          <td colSpan={5} style={{ padding: '8px 24px 14px 44px' }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: 'var(--muted)',
                marginBottom: 6,
              }}
            >
              Endpoints in this task
              {endpoints?.source === 'suite' && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: 500,
                    textTransform: 'none',
                    letterSpacing: 0,
                    color: 'var(--hint)',
                  }}
                >
                  (from Test Suite)
                </span>
              )}
              {endpoints?.source === 'apis' && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: 500,
                    textTransform: 'none',
                    letterSpacing: 0,
                    color: 'var(--hint)',
                  }}
                >
                  (legacy — ad-hoc APIs selection)
                </span>
              )}
            </div>
            {endpointsLoading ? (
              <div style={{ color: 'var(--hint)', fontSize: 12, marginBottom: 14 }}>Loading…</div>
            ) : !endpoints || endpoints.items.length === 0 ? (
              <div style={{ color: 'var(--hint)', fontSize: 12, marginBottom: 14 }}>
                No endpoints associated with this task.
              </div>
            ) : (
              <div
                className="rounded-[6px] border"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--white)',
                  marginBottom: 14,
                  maxHeight: 200,
                  overflowY: 'auto',
                }}
              >
                {endpoints.items.map((ep, idx) => {
                  const c = methodColor(ep.method)
                  return (
                    <div
                      key={ep.id}
                      className="flex items-center gap-2 px-3 py-1.5"
                      style={{
                        borderTop: idx === 0 ? undefined : '1px solid var(--border)',
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: 'var(--hint)', minWidth: 24 }}>{idx + 1}</span>
                      <span
                        style={{
                          background: c.bg,
                          color: c.fg,
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: 4,
                          minWidth: 56,
                          textAlign: 'center',
                        }}
                      >
                        {(ep.method || 'GET').toUpperCase()}
                      </span>
                      <span style={{ color: 'var(--text)', fontWeight: 500 }}>{ep.name}</span>
                      {ep.url && (
                        <span
                          style={{
                            color: 'var(--muted)',
                            fontFamily: 'ui-monospace, monospace',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {ep.url}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                color: 'var(--muted)',
                marginBottom: 6,
              }}
            >
              Run history
            </div>
            {historyLoading ? (
              <div style={{ color: 'var(--hint)', fontSize: 12 }}>Loading…</div>
            ) : !history || history.length === 0 ? (
              <div style={{ color: 'var(--hint)', fontSize: 12 }}>
                No runs yet — this task hasn't fired since it was created.
              </div>
            ) : (
              <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                    <th style={{ padding: '4px 8px', fontWeight: 600 }}>When</th>
                    <th style={{ padding: '4px 8px', fontWeight: 600 }}>Result</th>
                    <th style={{ padding: '4px 8px', fontWeight: 600 }}>Tests</th>
                    <th style={{ padding: '4px 8px', fontWeight: 600 }}>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, 10).map((row) => {
                    const failed = row.failed_endpoints > 0 || row.failed_tests > 0
                    return (
                      <tr key={row.id}>
                        <td style={{ padding: '4px 8px', color: 'var(--text)' }}>
                          {formatDate(row.started_at)}
                        </td>
                        <td style={{ padding: '4px 8px' }}>
                          {failed ? (
                            <span style={{ color: '#cc2200', display: 'inline-flex', gap: 4 }}>
                              <XCircle size={12} /> {row.passed_endpoints}/{row.total_endpoints}
                            </span>
                          ) : (
                            <span style={{ color: '#1a7a4a', display: 'inline-flex', gap: 4 }}>
                              <CheckCircle2 size={12} /> {row.passed_endpoints}/
                              {row.total_endpoints}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>
                          {row.passed_tests}/{row.total_tests}
                        </td>
                        <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>
                          {formatDuration(row.duration_ms)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
