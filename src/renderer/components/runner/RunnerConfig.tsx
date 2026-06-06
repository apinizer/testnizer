import { useEffect, useRef, useState } from 'react'
import { useEnvironmentStore } from '../../stores/environment.store'

type RunMode = 'manual' | 'schedule'
type ScheduleType = 'interval' | 'daily' | 'weekly' | 'cron'

export interface SchedulePayload {
  scheduleType: ScheduleType
  intervalValue: number
  intervalUnit: 'minutes' | 'hours' | 'days'
  scheduleTime?: string
  scheduleDays?: number[]
  scheduleCron?: string
}

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
  onSchedule?: (payload: SchedulePayload) => void
  isRunning: boolean
  selectedCount: number
  // Default tab. Bumping `initialRunModeKey` re-applies it even if the user
  // already toggled the radio — used when "New Run" is pressed from the
  // Scheduled Tasks view, where the default should be 'schedule'.
  initialRunMode?: RunMode
  initialRunModeKey?: number
  // When false, the "Schedule runs" radio is hidden and Manual is forced.
  // The product decision is that schedules are owned by Test Suites — APIs-
  // tree runs are one-shots only, so the suite of features the schedule
  // path implies (Scheduled Tasks list, history-by-task, etc.) only ever
  // surfaces when the runner is actually wired to a suite.
  canSchedule?: boolean
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
  initialRunMode = 'manual',
  initialRunModeKey,
  canSchedule = true,
}: RunnerConfigProps) {
  const environments = useEnvironmentStore((s) => s.environments)
  const [runMode, setRunMode] = useState<RunMode>(canSchedule ? initialRunMode : 'manual')
  // Force-manual when scheduling is not allowed for this source. This
  // overrides any stale state if the user previously had Schedule selected
  // on a suite run and then opened a fresh APIs run in the same tab.
  useEffect(() => {
    if (!canSchedule && runMode === 'schedule') setRunMode('manual')
  }, [canSchedule, runMode])
  // Re-apply the parent's preferred default whenever the parent bumps the key
  // (i.e. entered config from a different entry point). Bare prop change is
  // not enough — once the user clicks a radio, runMode diverges from the
  // prop and we don't want stale entry-point changes to fight that. Keying
  // it lets the parent be explicit: "this is a fresh open, snap back".
  const lastAppliedKey = useRef(initialRunModeKey)
  useEffect(() => {
    if (initialRunModeKey !== undefined && initialRunModeKey !== lastAppliedKey.current) {
      lastAppliedKey.current = initialRunModeKey
      setRunMode(initialRunMode)
    }
  }, [initialRunMode, initialRunModeKey])
  const [scheduleType, setScheduleType] = useState<ScheduleType>('interval')
  const [scheduleInterval, setScheduleInterval] = useState('60')
  const [scheduleUnit, setScheduleUnit] = useState<'minutes' | 'hours' | 'days'>('minutes')
  const [scheduleTime, setScheduleTime] = useState('09:00')
  const [scheduleDays, setScheduleDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [scheduleCron, setScheduleCron] = useState('0 9 * * *')
  const [cronError, setCronError] = useState<string | null>(null)
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  // Debounced cron validation — calls main process so the rules stay in
  // one place. Users see immediate feedback instead of waiting for the
  // submit to surface a parse failure.
  useEffect(() => {
    if (scheduleType !== 'cron') {
      setCronError(null)
      return
    }
    const expr = scheduleCron.trim()
    if (!expr) {
      setCronError('Cron expression is empty')
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      window.api?.scheduler
        ?.validateCron(expr)
        .then((res) => {
          if (cancelled) return
          const valid = (res as { success?: boolean; data?: { valid?: boolean } })?.data?.valid
          setCronError(valid ? null : 'Invalid cron — expected 5 fields (m h dom mon dow)')
        })
        .catch(() => {
          if (!cancelled) setCronError('Could not validate cron expression')
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [scheduleCron, scheduleType])

  const toggleDay = (dow: number) => {
    setScheduleDays((prev) =>
      prev.includes(dow) ? prev.filter((d) => d !== dow) : [...prev, dow].sort(),
    )
  }

  const handleStart = () => {
    if (runMode === 'schedule' && onSchedule) {
      // Build the payload. Validation: daily/weekly need a time, weekly
      // needs at least one weekday, cron must parse. Local feedback only
      // — the main process re-validates too.
      if ((scheduleType === 'daily' || scheduleType === 'weekly') && !scheduleTime) {
        setScheduleError('Pick a time of day')
        return
      }
      if (scheduleType === 'weekly' && scheduleDays.length === 0) {
        setScheduleError('Pick at least one weekday')
        return
      }
      if (scheduleType === 'cron' && cronError) {
        setScheduleError(cronError)
        return
      }
      setScheduleError(null)
      onSchedule({
        scheduleType,
        intervalValue: Math.max(1, Number(scheduleInterval) || 60),
        intervalUnit: scheduleUnit,
        scheduleTime:
          scheduleType === 'daily' || scheduleType === 'weekly' ? scheduleTime : undefined,
        scheduleDays: scheduleType === 'weekly' ? scheduleDays : undefined,
        scheduleCron: scheduleType === 'cron' ? scheduleCron.trim() : undefined,
      })
    } else {
      onRun()
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ fontSize: 13 }}>
      {/* Content */}
      <div className="flex-1 overflow-auto px-5 py-4">
        {/* Choose how to run. When the runner is sourced from APIs (not a
         *  Test Suite) the schedule path is intentionally unavailable —
         *  scheduled tasks live on suites, by design. */}
        {canSchedule ? (
          <>
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
          </>
        ) : null}

        {/* Schedule config (when schedule mode selected) */}
        {runMode === 'schedule' && (
          <div
            className="mb-5 rounded-[8px] border border-[var(--border)] p-3"
            style={{ background: 'var(--surface)' }}
          >
            <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 10 }}>
              Schedule Configuration
            </div>

            {/* Schedule type selector — four mutually exclusive modes. We
             *  default to 'interval' for backwards compat with the legacy
             *  every-N flow; the other three were added to bring this in
             *  line with Postman / cron-style schedulers. */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 4,
                marginBottom: 12,
                padding: 2,
                background: 'var(--white)',
                borderRadius: 6,
                border: '1px solid var(--border)',
              }}
            >
              {(
                [
                  { id: 'interval', label: 'Interval' },
                  { id: 'daily', label: 'Daily' },
                  { id: 'weekly', label: 'Weekly' },
                  { id: 'cron', label: 'Cron' },
                ] as { id: ScheduleType; label: string }[]
              ).map((opt) => {
                const active = scheduleType === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setScheduleType(opt.id)
                      setScheduleError(null)
                    }}
                    className="flex-1 cursor-pointer rounded-[4px] border-none px-2 py-1"
                    style={{
                      background: active ? 'var(--accent-light)' : 'transparent',
                      color: active ? 'var(--accent-text)' : 'var(--muted)',
                      fontWeight: active ? 600 : 500,
                      fontSize: 12,
                    }}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>

            {scheduleType === 'interval' && (
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
            )}

            {scheduleType === 'daily' && (
              <div className="flex items-center gap-2">
                <span style={{ color: 'var(--muted)' }}>Every day at</span>
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  style={{ fontSize: 13 }}
                />
                <span style={{ color: 'var(--hint)', fontSize: 12 }}>(local time)</span>
              </div>
            )}

            {scheduleType === 'weekly' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="flex items-center gap-2">
                  <span style={{ color: 'var(--muted)' }}>At</span>
                  <input
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-2 py-1 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                    style={{ fontSize: 13 }}
                  />
                  <span style={{ color: 'var(--hint)', fontSize: 12 }}>(local time)</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {WEEKDAY_LABELS.map((label, idx) => {
                    const active = scheduleDays.includes(idx)
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => toggleDay(idx)}
                        className="cursor-pointer rounded-[6px] border px-2.5 py-1"
                        style={{
                          background: active ? 'var(--accent)' : 'var(--white)',
                          borderColor: active ? 'var(--accent)' : 'var(--border)',
                          color: active ? '#fff' : 'var(--text)',
                          fontSize: 12,
                          fontWeight: active ? 600 : 500,
                        }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {scheduleType === 'cron' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input
                  type="text"
                  value={scheduleCron}
                  onChange={(e) => setScheduleCron(e.target.value)}
                  placeholder="m h dom mon dow  (e.g. 0 9 * * 1-5)"
                  className="rounded-[6px] border border-[var(--border)] bg-[var(--white)] px-2 py-1.5 text-[var(--text)] outline-none focus:border-[var(--accent)]"
                  style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace' }}
                />
                {cronError ? (
                  <div style={{ color: '#cc2200', fontSize: 12 }}>{cronError}</div>
                ) : (
                  <div style={{ color: 'var(--hint)', fontSize: 12 }}>
                    5 fields, local time. Supports <code>*</code>, <code>a-b</code>,{' '}
                    <code>*/n</code>, lists <code>a,b,c</code>.
                  </div>
                )}
              </div>
            )}

            {scheduleError && (
              <div style={{ color: '#cc2200', fontSize: 12, marginTop: 8 }}>{scheduleError}</div>
            )}
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
              data-testid="runner-iterations"
              value={iterations}
              onFocus={(e) => e.currentTarget.select()}
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
                onFocus={(e) => e.currentTarget.select()}
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
            data-testid="runner-start"
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
