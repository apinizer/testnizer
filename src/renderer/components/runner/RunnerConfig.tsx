import { useState } from 'react'
import { useEnvironmentStore } from '../../stores/environment.store'

interface RunnerConfigProps {
  delay: number
  setDelay: (v: number) => void
  iterations: number
  setIterations: (v: number) => void
  environmentId: string
  setEnvironmentId: (v: string) => void
  stopOnError: boolean
  setStopOnError: (v: boolean) => void
  persistResponses: boolean
  setPersistResponses: (v: boolean) => void
  keepVariableValues: boolean
  setKeepVariableValues: (v: boolean) => void
  iterationData?: Record<string, string>[]
  setIterationData?: (rows: Record<string, string>[]) => void
  onRun: () => void
  onSchedule?: (interval: number, unit: 'minutes' | 'hours' | 'days') => void
  isRunning: boolean
  selectedCount: number
}

type RunMode = 'manual' | 'schedule'

export default function RunnerConfig({
  delay,
  setDelay,
  iterations,
  setIterations,
  environmentId,
  setEnvironmentId,
  stopOnError,
  setStopOnError,
  persistResponses,
  setPersistResponses,
  keepVariableValues,
  setKeepVariableValues,
  iterationData,
  setIterationData,
  onRun,
  onSchedule,
  isRunning,
  selectedCount,
}: RunnerConfigProps) {
  const environments = useEnvironmentStore((s) => s.environments)
  const [runMode, setRunMode] = useState<RunMode>('manual')
  const [scheduleInterval, setScheduleInterval] = useState('60')
  const [scheduleUnit, setScheduleUnit] = useState<'minutes' | 'hours' | 'days'>('minutes')

  const handleStart = () => {
    if (runMode === 'schedule' && onSchedule) {
      onSchedule(Math.max(1, Number(scheduleInterval) || 60), scheduleUnit)
    } else {
      onRun()
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ fontSize: 13 }}>
      {/* Content */}
      <div className="flex-1 overflow-auto px-5 py-4">
        {/* Choose how to run */}
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
          Choose how to run your collection
        </h3>
        <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label
            className="flex cursor-pointer items-center gap-2"
            style={{ color: 'var(--text)' }}
          >
            <input
              type="radio"
              name="runMode"
              checked={runMode === 'manual'}
              onChange={() => setRunMode('manual')}
              className="accent-[#e86826]"
            />
            Run manually
          </label>
          <label
            className="flex cursor-pointer items-center gap-2"
            style={{ color: 'var(--text)' }}
          >
            <input
              type="radio"
              name="runMode"
              checked={runMode === 'schedule'}
              onChange={() => setRunMode('schedule')}
              className="accent-[#e86826]"
            />
            Schedule runs
          </label>
        </div>

        {/* Schedule config (when schedule mode selected) */}
        {runMode === 'schedule' && (
          <div
            className="mb-5 rounded-[8px] border border-[var(--border)] p-3"
            style={{ background: 'var(--surface)' }}
          >
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
              Schedule Configuration
            </div>
            <div className="flex items-center gap-2">
              <span style={{ color: 'var(--muted)' }}>Run every</span>
              <input
                type="number"
                min={1}
                value={scheduleInterval}
                onChange={(e) => setScheduleInterval(e.target.value)}
                className="w-[60px] rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                style={{ fontSize: 13 }}
              />
              <select
                value={scheduleUnit}
                onChange={(e) => setScheduleUnit(e.target.value as 'minutes' | 'hours' | 'days')}
                className="rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-[var(--text)] outline-none"
                style={{ fontSize: 13 }}
              >
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
            </div>
          </div>
        )}

        {/* Run configuration */}
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
          Run configuration
        </h3>
        <div className="mb-4 flex gap-4">
          <div className="flex-1">
            <label style={{ display: 'block', color: 'var(--muted)', marginBottom: 4 }}>
              Iterations
            </label>
            <input
              type="number"
              min={1}
              value={iterations}
              onChange={(e) => setIterations(Math.max(1, Number(e.target.value)))}
              className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
              style={{ fontSize: 13 }}
            />
          </div>
          <div className="flex-1">
            <label style={{ display: 'block', color: 'var(--muted)', marginBottom: 4 }}>
              Delay
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                step={100}
                value={delay}
                onChange={(e) => setDelay(Math.max(0, Number(e.target.value)))}
                className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                style={{ fontSize: 13 }}
              />
              <span style={{ color: 'var(--muted)', flexShrink: 0 }}>ms</span>
            </div>
          </div>
        </div>

        {/* Iteration Data */}
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
          Iteration Data
          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)', marginLeft: 8 }}>
            (Postman/Insomnia compatible — overrides Iterations)
          </span>
        </h3>
        <IterationDataPicker
          rows={iterationData ?? []}
          onChange={(rows) => setIterationData?.(rows)}
        />

        {/* Advanced Settings */}
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>
          Advanced Settings
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Chk
            label="Persist responses for a session"
            checked={persistResponses}
            onChange={setPersistResponses}
          />
          <Chk
            label="Stop run if an error occurs"
            checked={stopOnError}
            onChange={setStopOnError}
          />
          <Chk
            label="Keep variable values"
            checked={keepVariableValues}
            onChange={setKeepVariableValues}
          />
        </div>

        {/* Start run / Schedule */}
        <div style={{ marginTop: 24 }}>
          <button
            type="button"
            onClick={handleStart}
            disabled={isRunning || selectedCount === 0}
            className="flex cursor-pointer items-center gap-2 rounded-[6px] border-none px-5 py-2 font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: '#e86826', fontSize: 13 }}
          >
            {runMode === 'schedule' ? 'Schedule run' : 'Start run'}
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
            >
              <path d="M12 3a9 9 0 0 1 9 9h-2" />
              <path d="M12 21a9 9 0 0 1-9-9h2" />
              <path d="M19 12l2-2 2 2" />
              <path d="M5 12l-2 2-2-2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function IterationDataPicker({
  rows,
  onChange,
}: {
  rows: Record<string, string>[]
  onChange: (rows: Record<string, string>[]) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [filename, setFilename] = useState<string | null>(null)

  async function pickFile() {
    setError(null)
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json,.csv,text/csv'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setFilename(file.name)
      try {
        const text = await file.text()
        const parsed = parseIterationData(text, file.name)
        onChange(parsed)
        setError(null)
      } catch (e) {
        setError((e as Error).message)
        onChange([])
      }
    }
    input.click()
  }

  return (
    <div
      className="mb-5 rounded-[8px] border border-[var(--border)] p-3"
      style={{ background: 'var(--surface)' }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={pickFile}
          className="cursor-pointer rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-3 py-1.5 text-[var(--text)] hover:bg-[var(--bg)]"
          style={{ fontSize: 13 }}
        >
          Select Data File…
        </button>
        {filename && (
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
            {filename} · {rows.length} iteration{rows.length === 1 ? '' : 's'}
          </span>
        )}
        {rows.length > 0 && (
          <button
            type="button"
            onClick={() => {
              onChange([])
              setFilename(null)
            }}
            className="cursor-pointer text-[var(--muted)] hover:text-[var(--text)]"
            style={{ fontSize: 12, background: 'transparent', border: 'none' }}
          >
            Clear
          </button>
        )}
      </div>
      {error && (
        <div style={{ color: 'var(--red, #cc2200)', fontSize: 12, marginTop: 6 }}>{error}</div>
      )}
      {!filename && !error && (
        <div style={{ color: 'var(--hint)', fontSize: 12, marginTop: 6 }}>
          Provide a JSON array (Postman test data) or CSV. Each row becomes one iteration; access
          values via <code>pm.iterationData.get(&apos;key&apos;)</code>.
        </div>
      )}
    </div>
  )
}

/** Parse iteration data from a Postman-compatible JSON array or a CSV. */
function parseIterationData(text: string, filename: string): Record<string, string>[] {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.json')) {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) throw new Error('JSON data must be an array of row objects')
    return parsed.map((row, i) => {
      if (!row || typeof row !== 'object') {
        throw new Error(`Row ${i} is not an object`)
      }
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
        out[k] = v == null ? '' : String(v)
      }
      return out
    })
  }
  if (lower.endsWith('.csv')) {
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row')
    const headers = parseCsvRow(lines[0])
    return lines.slice(1).map((line) => {
      const cells = parseCsvRow(line)
      const out: Record<string, string> = {}
      headers.forEach((h, i) => {
        out[h] = cells[i] ?? ''
      })
      return out
    })
  }
  throw new Error('Unsupported file format — use .json or .csv')
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      cells.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  cells.push(cur)
  return cells
}

function Chk({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label
      className="flex cursor-pointer items-center gap-2"
      style={{ color: 'var(--text)', fontSize: 13 }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="cursor-pointer accent-[#0066cc]"
        style={{ width: 15, height: 15 }}
      />
      {label}
    </label>
  )
}
