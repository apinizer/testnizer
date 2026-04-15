import { CheckSquare, Square, Clock } from 'lucide-react'
import { useRunnerStore } from '../../stores/runner.store'
import type { Project, Environment } from '../../types'
import MethodBadge from '../shared/MethodBadge'

interface RunnerConfigPanelProps {
  projects: Project[]
  environments: Environment[]
}

export default function RunnerConfigPanel({ projects, environments }: RunnerConfigPanelProps) {
  const endpoints = useRunnerStore((s) => s.endpoints)
  const toggleEndpoint = useRunnerStore((s) => s.toggleEndpoint)
  const selectAll = useRunnerStore((s) => s.selectAll)
  const deselectAll = useRunnerStore((s) => s.deselectAll)
  const delay = useRunnerStore((s) => s.delay)
  const setDelay = useRunnerStore((s) => s.setDelay)
  const projectId = useRunnerStore((s) => s.projectId)
  const setProjectId = useRunnerStore((s) => s.setProjectId)
  const environmentId = useRunnerStore((s) => s.environmentId)
  const setEnvironmentId = useRunnerStore((s) => s.setEnvironmentId)
  const isRunning = useRunnerStore((s) => s.isRunning)

  const allSelected = endpoints.length > 0 && endpoints.every((ep) => ep.selected)
  const selectedCount = endpoints.filter((ep) => ep.selected).length

  return (
    <div className="flex w-[320px] shrink-0 flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--bg)]">
      {/* Project selector */}
      <div className="border-b border-[var(--border)] px-4 py-3">
        <label className="mb-1 block font-medium uppercase tracking-wider text-[var(--hint)]">
          Project
        </label>
        <select
          value={projectId ?? ''}
          onChange={(e) => setProjectId(e.target.value || null)}
          disabled={isRunning}
          className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
        >
          <option value="">All Projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Environment selector */}
      <div className="border-b border-[var(--border)] px-4 py-3">
        <label className="mb-1 block font-medium uppercase tracking-wider text-[var(--hint)]">
          Environment
        </label>
        <select
          value={environmentId ?? ''}
          onChange={(e) => setEnvironmentId(e.target.value || null)}
          disabled={isRunning}
          className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
        >
          <option value="">No Environment</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
        </select>
      </div>

      {/* Delay input */}
      <div className="border-b border-[var(--border)] px-4 py-3">
        <label className="mb-1 flex items-center gap-1.5 font-medium uppercase tracking-wider text-[var(--hint)]">
          <Clock size={11} />
          Delay between requests
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            step={100}
            value={delay}
            onChange={(e) => setDelay(Number(e.target.value))}
            disabled={isRunning}
            className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <span className="shrink-0 text-[var(--muted)]">ms</span>
        </div>
      </div>

      {/* Endpoint list header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2">
        <span className="font-medium text-[var(--muted)]">
          Endpoints ({selectedCount}/{endpoints.length})
        </span>
        <button
          type="button"
          onClick={allSelected ? deselectAll : selectAll}
          disabled={isRunning}
          className="flex cursor-pointer items-center gap-1 bg-transparent text-[var(--accent)] hover:underline"
          style={{ border: 'none' }}
        >
          {allSelected ? (
            <>
              <Square size={11} />
              Deselect All
            </>
          ) : (
            <>
              <CheckSquare size={11} />
              Select All
            </>
          )}
        </button>
      </div>

      {/* Endpoint list */}
      <div className="flex-1 overflow-auto py-1">
        {endpoints.map((ep) => (
          <button
            key={ep.id}
            type="button"
            onClick={() => { if (!isRunning) toggleEndpoint(ep.id) }}
            className="flex w-full cursor-pointer items-center gap-2.5 bg-transparent px-4 py-1.5 text-left transition-colors hover:bg-[var(--accent-light)]"
            style={{ border: 'none' }}
          >
            <div
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border"
              style={{
                borderColor: ep.selected ? 'var(--accent)' : 'var(--border2)',
                background: ep.selected ? 'var(--accent)' : 'transparent',
              }}
            >
              {ep.selected && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <MethodBadge method={ep.method} />
            <span className="flex-1 truncate text-[var(--text)]">{ep.name}</span>
          </button>
        ))}
        {endpoints.length === 0 && (
          <div className="px-4 py-6 text-center text-[var(--hint)]">
            No endpoints found in project
          </div>
        )}
      </div>
    </div>
  )
}
