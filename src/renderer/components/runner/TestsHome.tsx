import { useEffect, useState, useCallback } from 'react'
import { useWorkspaceStore } from '../../stores/workspace.store'
import {
  BarChart2,
  Clock,
  FolderOpen,
  Play,
  ChevronRight,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import type { EndpointRunResult, RunnerReport } from '../../stores/runner.store'
import { useTranslation } from '../../lib/i18n'

interface RunHistoryRow {
  id: string
  project_id: string
  environment_name: string | null
  source: string
  source_label: string | null
  iterations: number
  duration_ms: number
  total_endpoints: number
  passed_endpoints: number
  failed_endpoints: number
  total_tests: number
  passed_tests: number
  failed_tests: number
  skipped_tests: number
  avg_resp_time: number
  results_json: string | null
  started_at: number
}

interface HistoryStats {
  runs: number
  totalEndpoints: number
  passedEndpoints: number
  failedEndpoints: number
}

interface ScheduledTaskRow {
  id: string
  name: string
  enabled: number
  next_run_at: number | null
}

interface TestSuiteRow {
  id: string
  name: string
  created_at: number
}

interface TestsHomeProps {
  onViewAllRuns: () => void
  onViewScheduled: () => void
  onNewRun: () => void
  onViewReport?: (
    results: EndpointRunResult[],
    report: RunnerReport,
    startedAt: number,
    sourceLabel?: string,
  ) => void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = () => (window as any).api

export default function TestsHome({
  onViewAllRuns,
  onViewScheduled,
  onNewRun,
  onViewReport,
}: TestsHomeProps) {
  const { t } = useTranslation()
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const [runs, setRuns] = useState<RunHistoryRow[]>([])
  const [stats, setStats] = useState<HistoryStats>({
    runs: 0,
    totalEndpoints: 0,
    passedEndpoints: 0,
    failedEndpoints: 0,
  })
  const [tasks, setTasks] = useState<ScheduledTaskRow[]>([])
  const [suites, setSuites] = useState<TestSuiteRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!activeProjectId) return
    setLoading(true)
    try {
      const [runRes, statsRes, taskRes, suiteRes] = await Promise.all([
        api().runner?.history(activeProjectId),
        api().runner?.historyStats?.(activeProjectId),
        api().scheduler?.list(activeProjectId),
        api().testSuite?.list(activeProjectId),
      ])
      if (runRes?.success && runRes.data) setRuns(runRes.data)
      if (statsRes?.success && statsRes.data) setStats(statsRes.data)
      if (taskRes?.success && taskRes.data) setTasks(taskRes.data)
      if (suiteRes?.success && suiteRes.data) setSuites(suiteRes.data)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [activeProjectId])

  useEffect(() => {
    load()
  }, [load])

  // Listen for scheduled run completions to refresh data
  useEffect(() => {
    const unsub = api().scheduler?.onRunCompleted?.(() => {
      load()
    })
    return () => {
      unsub?.()
    }
  }, [load])

  const totalEndpointsRun = stats.totalEndpoints
  const passedEndpoints = stats.passedEndpoints
  const failedEndpoints = stats.failedEndpoints
  const runSessions = stats.runs
  const activeTasks = tasks.filter((t) => t.enabled).length
  const recentRuns = runs.slice(0, 5)
  const recentSuites = suites.slice(0, 5)

  const openReport = (run: RunHistoryRow) => {
    if (!run.results_json || !onViewReport) return
    try {
      const results = JSON.parse(run.results_json) as EndpointRunResult[]
      const report: RunnerReport = {
        projectId: run.project_id,
        startedAt: run.started_at,
        completedAt: run.started_at + run.duration_ms,
        totalEndpoints: run.total_endpoints,
        passedEndpoints: run.passed_endpoints,
        failedEndpoints: run.failed_endpoints,
        totalAssertions: run.total_tests,
        passedAssertions: run.passed_tests,
        failedAssertions: run.failed_tests,
        results,
      }
      onViewReport(results, report, run.started_at, run.source_label || run.source || 'Runner')
    } catch {
      /* invalid */
    }
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday)
      return (
        t('testsHome.today') +
        ', ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      )
    return (
      d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ', ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    )
  }

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    const s = ms / 1000
    if (s < 60) return `${s.toFixed(1)}s`
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ fontSize: 13 }}>
      {/* Header */}
      <div
        className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-6"
        style={{ height: 48 }}
      >
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 16, flex: 1 }}>
          {t('testsHome.title')}
        </span>
        <button
          type="button"
          onClick={onNewRun}
          className="flex cursor-pointer items-center gap-1.5 rounded-[6px] border-none px-3 py-1.5 font-medium text-white hover:opacity-90"
          style={{ background: 'var(--accent)', fontSize: 13 }}
        >
          <Play size={13} />
          {t('testsHome.newRun')}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-5">
        {loading ? (
          <div className="text-center" style={{ color: 'var(--hint)' }}>
            {t('testsHome.loading')}
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 16,
                marginBottom: 28,
              }}
            >
              <SummaryCard
                icon={<BarChart2 size={18} style={{ color: '#4285f4' }} />}
                iconBg="#e8f0fe"
                label={t('testsHome.endpointsTested')}
                primary={String(totalEndpointsRun)}
                sub={
                  totalEndpointsRun > 0
                    ? `${passedEndpoints} ${t('testsHome.passed')} • ${failedEndpoints} ${t('testsHome.failed')} • ${runSessions} ${runSessions === 1 ? t('testsHome.run') : t('testsHome.runs')}`
                    : t('testsHome.noRunsYet')
                }
                onClick={onViewAllRuns}
              />
              <SummaryCard
                icon={<Clock size={18} style={{ color: '#0369a1' }} />}
                iconBg="#e0f2fe"
                label={t('testsHome.scheduledTasks')}
                primary={String(tasks.length)}
                sub={
                  tasks.length > 0
                    ? `${activeTasks} ${t('testsHome.active')}`
                    : t('testsHome.noScheduledTasks')
                }
                onClick={onViewScheduled}
              />
              <SummaryCard
                icon={<FolderOpen size={18} style={{ color: 'var(--accent)' }} />}
                iconBg="var(--accent-light)"
                label={t('testsHome.testSuites')}
                primary={String(suites.length)}
                sub={
                  suites.length > 0
                    ? t('testsHome.manageFromSidebar')
                    : t('testsHome.noTestSuitesYet')
                }
              />
            </div>

            {/* Two-column layout */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                gap: 20,
              }}
            >
              {/* Recent Runs */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                    {t('testsHome.recentRuns')}
                  </h3>
                  {runs.length > 0 && (
                    <button
                      type="button"
                      onClick={onViewAllRuns}
                      className="flex cursor-pointer items-center gap-1 border-none bg-transparent"
                      style={{ color: 'var(--accent)', fontSize: 13 }}
                    >
                      {t('testsHome.viewAll')} <ChevronRight size={12} />
                    </button>
                  )}
                </div>
                <div
                  className="rounded-[8px] border"
                  style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
                >
                  {recentRuns.length === 0 ? (
                    <div
                      className="py-6 text-center"
                      style={{ color: 'var(--hint)', fontSize: 13 }}
                    >
                      {t('testsHome.noRunsYet')}
                    </div>
                  ) : (
                    recentRuns.map((run, idx) => {
                      const failed = run.failed_endpoints > 0 || run.failed_tests > 0
                      return (
                        <div
                          key={run.id}
                          onClick={() => openReport(run)}
                          className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface)]"
                          style={{
                            borderTop: idx === 0 ? undefined : '1px solid var(--border)',
                          }}
                        >
                          {failed ? (
                            <XCircle size={15} style={{ color: '#cc2200', flexShrink: 0 }} />
                          ) : (
                            <CheckCircle2 size={15} style={{ color: '#1a7a4a', flexShrink: 0 }} />
                          )}
                          <div className="flex-1 truncate">
                            <div style={{ color: 'var(--text)', fontWeight: 500 }}>
                              {formatDate(run.started_at)}
                            </div>
                            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                              {run.source_label || run.source} • {run.total_endpoints}{' '}
                              {t('testsHome.endpoints')} • {run.passed_tests}/{run.total_tests}{' '}
                              {t('testsHome.testsLabel')}
                            </div>
                          </div>
                          <div style={{ color: 'var(--muted)', fontSize: 13, flexShrink: 0 }}>
                            {formatDuration(run.duration_ms)}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </section>

              {/* Test Suites + Scheduled overview */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                    {t('testsHome.testSuites')}
                  </h3>
                </div>
                <div
                  className="rounded-[8px] border"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--white)',
                    marginBottom: 16,
                  }}
                >
                  {recentSuites.length === 0 ? (
                    <div
                      className="py-6 text-center"
                      style={{ color: 'var(--hint)', fontSize: 13 }}
                    >
                      {t('testsHome.noTestSuitesYet')}
                    </div>
                  ) : (
                    recentSuites.map((suite, idx) => (
                      <div
                        key={suite.id}
                        className="flex items-center gap-3 px-4 py-2.5"
                        style={{
                          borderTop: idx === 0 ? undefined : '1px solid var(--border)',
                        }}
                      >
                        <FolderOpen size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                        <div className="flex-1 truncate">
                          <div style={{ color: 'var(--text)', fontWeight: 500 }}>{suite.name}</div>
                          <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                            {t('testsHome.createdOn')} {formatDate(suite.created_at)}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="mb-2 flex items-center justify-between">
                  <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                    {t('testsHome.upcomingScheduled')}
                  </h3>
                  {tasks.length > 0 && (
                    <button
                      type="button"
                      onClick={onViewScheduled}
                      className="flex cursor-pointer items-center gap-1 border-none bg-transparent"
                      style={{ color: 'var(--accent)', fontSize: 13 }}
                    >
                      {t('testsHome.viewAll')} <ChevronRight size={12} />
                    </button>
                  )}
                </div>
                <div
                  className="rounded-[8px] border"
                  style={{ borderColor: 'var(--border)', background: 'var(--white)' }}
                >
                  {tasks.length === 0 ? (
                    <div
                      className="py-6 text-center"
                      style={{ color: 'var(--hint)', fontSize: 13 }}
                    >
                      {t('testsHome.noScheduledTasks')}
                    </div>
                  ) : (
                    tasks.slice(0, 5).map((task, idx) => (
                      <div
                        key={task.id}
                        onClick={onViewScheduled}
                        className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-[var(--surface)]"
                        style={{
                          borderTop: idx === 0 ? undefined : '1px solid var(--border)',
                        }}
                      >
                        <span
                          className="inline-block shrink-0 rounded-full"
                          style={{
                            width: 8,
                            height: 8,
                            background: task.enabled ? '#1a7a4a' : '#aaa',
                          }}
                        />
                        <div className="flex-1 truncate">
                          <div style={{ color: 'var(--text)', fontWeight: 500 }}>{task.name}</div>
                          <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                            {task.enabled && task.next_run_at
                              ? `${t('testsHome.next')}: ${formatDate(task.next_run_at)}`
                              : t('testsHome.paused')}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ── Summary card ──────────────────────────────────────────── */

function SummaryCard({
  icon,
  iconBg,
  label,
  primary,
  sub,
  onClick,
}: {
  icon: React.ReactNode
  iconBg: string
  label: string
  primary: string
  sub: string
  onClick?: () => void
}) {
  const clickable = !!onClick
  return (
    <div
      onClick={onClick}
      className="rounded-[10px] border p-4"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--white)',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'box-shadow 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        if (clickable) {
          ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
        }
      }}
      onMouseLeave={(e) => {
        if (clickable) {
          ;(e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
        }
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="flex items-center justify-center rounded-[6px]"
          style={{ width: 32, height: 32, background: iconBg }}
        >
          {icon}
        </span>
        <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>{label}</span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>
        {primary}
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>
    </div>
  )
}
