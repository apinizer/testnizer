import { useState } from 'react'
import { useRunnerStore } from '../../stores/runner.store'
import { useEnvironmentStore } from '../../stores/environment.store'
import MethodBadge from '../shared/MethodBadge'
import { ChevronRight, GripVertical } from 'lucide-react'

interface RunnerConfigViewProps {
  projectId: string
  workspaceId?: string
}

export default function RunnerConfigView({ projectId, workspaceId }: RunnerConfigViewProps) {
  const endpoints = useRunnerStore((s) => s.endpoints)
  const toggleEndpoint = useRunnerStore((s) => s.toggleEndpoint)
  const selectAll = useRunnerStore((s) => s.selectAll)
  const deselectAll = useRunnerStore((s) => s.deselectAll)
  const delay = useRunnerStore((s) => s.delay)
  const setDelay = useRunnerStore((s) => s.setDelay)
  const iterations = useRunnerStore((s) => s.iterations)
  const setIterations = useRunnerStore((s) => s.setIterations)
  const stopOnError = useRunnerStore((s) => s.stopOnError)
  const setStopOnError = useRunnerStore((s) => s.setStopOnError)
  const persistResponses = useRunnerStore((s) => s.persistResponses)
  const setPersistResponses = useRunnerStore((s) => s.setPersistResponses)
  const keepVariableValues = useRunnerStore((s) => s.keepVariableValues)
  const setKeepVariableValues = useRunnerStore((s) => s.setKeepVariableValues)
  const saveCookies = useRunnerStore((s) => s.saveCookies)
  const setSaveCookies = useRunnerStore((s) => s.setSaveCookies)
  const run = useRunnerStore((s) => s.run)
  const isRunning = useRunnerStore((s) => s.isRunning)
  const environments = useEnvironmentStore((s) => s.environments)
  const [environmentId, setEnvironmentId] = useState<string>('')

  const allSelected = endpoints.length > 0 && endpoints.every((ep) => ep.selected)
  const selectedCount = endpoints.filter((ep) => ep.selected).length

  const handleRun = () => {
    run(projectId, workspaceId, environmentId || undefined)
  }

  const handleReset = () => {
    selectAll()
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: Run Sequence */}
      <div className="flex w-[55%] flex-col overflow-hidden border-r border-[var(--border)]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
          <span className="font-semibold text-[var(--text)]">Run Sequence</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={allSelected ? deselectAll : selectAll}
              className="cursor-pointer border-none bg-transparent text-[var(--muted)] hover:text-[var(--accent)]"
            >
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="cursor-pointer border-none bg-transparent text-[var(--muted)] hover:text-[var(--accent)]"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Endpoint list */}
        <div className="flex-1 overflow-auto">
          {endpoints.map((ep, index) => (
            <div
              key={ep.id}
              className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 transition-colors hover:bg-[var(--surface)]"
            >
              {/* Row number */}
              <span className="w-6 shrink-0 text-right text-[var(--hint)]">{index + 1}</span>

              {/* Checkbox */}
              <label className="flex shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={ep.selected}
                  onChange={() => toggleEndpoint(ep.id)}
                  className="h-[15px] w-[15px] cursor-pointer accent-[var(--accent)]"
                />
              </label>

              {/* Drag handle + folder icon + chevron (visual, like Postman) */}
              <span className="flex shrink-0 items-center gap-0.5 text-[var(--hint)]">
                <GripVertical size={12} />
                <ChevronRight size={11} />
              </span>

              {/* Method badge */}
              <MethodBadge method={ep.method} />

              {/* Name */}
              <span className="flex-1 truncate text-[var(--text)]">{ep.name}</span>
            </div>
          ))}
          {endpoints.length === 0 && (
            <div className="flex h-full items-center justify-center text-[var(--hint)]">
              No endpoints found in project
            </div>
          )}
        </div>
      </div>

      {/* Right: Configuration */}
      <div className="flex w-[45%] flex-col overflow-auto bg-[var(--white)]">
        <div className="flex-1 overflow-auto px-5 py-4">
          {/* Run configuration */}
          <h3 className="mb-3 font-semibold text-[var(--text)]">Run configuration</h3>
          <div className="mb-4 flex gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-[var(--muted)]">Iterations</label>
              <input
                type="number"
                min={1}
                value={iterations}
                onChange={(e) => setIterations(Number(e.target.value))}
                className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-[var(--muted)]">Delay</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={delay}
                  onChange={(e) => setDelay(Number(e.target.value))}
                  className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                />
                <span className="shrink-0 text-[var(--muted)]">ms</span>
              </div>
            </div>
          </div>

          {/* Environment */}
          <div className="mb-5">
            <label className="mb-1 block text-[var(--muted)]">Environment</label>
            <select
              value={environmentId}
              onChange={(e) => setEnvironmentId(e.target.value)}
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

          {/* Advanced Settings */}
          <h3 className="mb-3 font-semibold text-[var(--text)]">Advanced Settings</h3>
          <div className="space-y-2.5">
            <Checkbox
              label="Persist responses for a session"
              checked={persistResponses}
              onChange={setPersistResponses}
            />
            <Checkbox
              label="Stop run if an error occurs"
              checked={stopOnError}
              onChange={setStopOnError}
            />
            <Checkbox
              label="Keep variable values"
              checked={keepVariableValues}
              onChange={setKeepVariableValues}
            />
            <Checkbox
              label="Save cookies after collection run"
              checked={saveCookies}
              onChange={setSaveCookies}
            />
          </div>

          {/* Start run button */}
          <div className="mt-6">
            <button
              type="button"
              onClick={handleRun}
              disabled={isRunning || selectedCount === 0}
              className="flex cursor-pointer items-center gap-2 rounded-[7px] border-none px-5 py-2 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: '#e86826' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="white" stroke="none">
                <path d="M8 5v14l11-7z" />
              </svg>
              Start run
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
              >
                <path d="M12 3a9 9 0 0 1 9 9h-3l4 4 4-4h-3A11 11 0 0 0 12 1v2z" />
                <path d="M12 21a9 9 0 0 1-9-9h3l-4-4-4 4h3a11 11 0 0 0 11 11v-2z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Checkbox component ─────────────────────────────────────── */

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[var(--text)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-[15px] w-[15px] cursor-pointer rounded accent-[#0066cc]"
      />
      {label}
    </label>
  )
}
