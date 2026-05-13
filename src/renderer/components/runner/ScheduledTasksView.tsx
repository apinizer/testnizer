import { useState, useEffect, useCallback } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { ArrowLeft, Clock, Trash2, ToggleLeft, ToggleRight, Play } from 'lucide-react'
import DeleteConfirmDialog from '../modals/DeleteConfirmDialog'

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
}

interface ScheduledTasksViewProps {
  onBack: () => void
  onNewRun: () => void
}

export default function ScheduledTasksView({ onBack, onNewRun }: ScheduledTasksViewProps) {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
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

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

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
        <button
          type="button"
          onClick={onNewRun}
          className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border-none px-3 py-1.5 font-semibold text-white"
          style={{ background: '#e86826', fontSize: 13 }}
        >
          <Play size={13} />
          New Run
        </button>
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
          <div
            className="flex flex-col items-center justify-center gap-3 py-16"
            style={{ color: 'var(--hint)' }}
          >
            <Clock size={32} />
            <div style={{ fontSize: 13 }}>No scheduled tasks yet</div>
            <div>Use "Schedule runs" in the Runner configuration to create one.</div>
          </div>
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
  const endpointCount = (() => {
    try {
      return (JSON.parse(task.endpoint_ids) as string[]).length
    } catch {
      return 0
    }
  })()

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: '1px solid var(--border)',
        background: hovered ? 'var(--surface)' : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      {/* Upcoming run */}
      <td style={{ padding: '12px 16px', color: 'var(--text)' }}>
        {task.enabled && task.next_run_at ? (
          <span>{formatDate(task.next_run_at)}</span>
        ) : (
          <span style={{ color: 'var(--hint)' }}>Paused</span>
        )}
      </td>

      {/* Schedule */}
      <td style={{ padding: '12px 16px' }}>
        <div style={{ color: 'var(--text)', fontWeight: 500 }}>{task.name}</div>
        <div style={{ color: 'var(--muted)', marginTop: 2 }}>
          Runs every {task.interval_value} {task.interval_unit}
        </div>
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
            onClick={onToggle}
            title={task.enabled ? 'Pause' : 'Resume'}
            className="flex cursor-pointer items-center justify-center rounded-[4px] border-none bg-transparent p-1"
            style={{ color: task.enabled ? '#1a7a4a' : '#aaa' }}
          >
            {task.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
          </button>
          <button
            type="button"
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
  )
}
