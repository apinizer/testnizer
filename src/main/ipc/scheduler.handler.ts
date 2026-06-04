// src/main/ipc/scheduler.handler.ts
// Testnizer — Scheduled Tasks IPC Handler
//
// Schedule types supported:
//   'interval': fires every interval_value × interval_unit (legacy)
//   'daily'   : fires once a day at schedule_time (HH:MM, local time)
//   'weekly'  : fires on schedule_days (JSON [0..6], Sun=0) at schedule_time
//   'cron'    : 5-field cron expression in schedule_cron (basic support:
//               numbers, *, ranges a-b, step */n and a-b/n, lists a,b,c)
//
// Each task uses setTimeout (not setInterval) so the next fire time is
// recomputed after every run; daily/weekly/cron drift would be a bug.

import { ipcMain, BrowserWindow } from 'electron'
import { getDb } from '../db/database'
import { randomUUID } from 'crypto'

/* ── Types ────────────────────────────────────────────────────── */

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

interface CreateSchedulePayload {
  projectId: string
  name: string
  endpointIds: string[]
  folderId?: string
  environmentId?: string
  intervalValue: number
  intervalUnit: 'minutes' | 'hours' | 'days'
  delayMs?: number
  scheduleType?: ScheduleType
  scheduleTime?: string
  scheduleDays?: number[]
  scheduleCron?: string
  suiteId?: string
}

interface UpdateSchedulePayload extends CreateSchedulePayload {
  id: string
}

/* ── Scheduler State ──────────────────────────────────────────── */

const activeTimers = new Map<string, ReturnType<typeof setTimeout>>()

function intervalToMs(value: number, unit: string): number {
  switch (unit) {
    case 'minutes':
      return value * 60 * 1000
    case 'hours':
      return value * 60 * 60 * 1000
    case 'days':
      return value * 24 * 60 * 60 * 1000
    default:
      return value * 60 * 1000
  }
}

function parseHHMM(value: string | null | undefined): { h: number; m: number } | null {
  if (!value) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return { h, m: min }
}

function parseDays(raw: string | null | undefined): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    }
  } catch {
    /* ignore */
  }
  return []
}

/** Compute the next fire time (ms epoch) for a task. Always strictly in the future. */
export function computeNextRunFor(task: {
  schedule_type: ScheduleType | null
  schedule_time: string | null
  schedule_days: string | null
  schedule_cron: string | null
  interval_value: number
  interval_unit: string
}): number {
  const type: ScheduleType = task.schedule_type || 'interval'
  const now = new Date()

  if (type === 'daily') {
    const t = parseHHMM(task.schedule_time)
    if (!t) return Date.now() + intervalToMs(task.interval_value, task.interval_unit)
    const candidate = new Date(now)
    candidate.setHours(t.h, t.m, 0, 0)
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1)
    }
    return candidate.getTime()
  }

  if (type === 'weekly') {
    const t = parseHHMM(task.schedule_time)
    const days = parseDays(task.schedule_days)
    if (!t || days.length === 0) {
      return Date.now() + intervalToMs(task.interval_value, task.interval_unit)
    }
    for (let offset = 0; offset < 8; offset++) {
      const candidate = new Date(now)
      candidate.setDate(candidate.getDate() + offset)
      candidate.setHours(t.h, t.m, 0, 0)
      if (days.includes(candidate.getDay()) && candidate.getTime() > now.getTime()) {
        return candidate.getTime()
      }
    }
    // Should not reach — fall back to interval.
    return Date.now() + intervalToMs(task.interval_value, task.interval_unit)
  }

  if (type === 'cron') {
    const next = cronNextRun(task.schedule_cron, now)
    if (next) return next.getTime()
    return Date.now() + intervalToMs(task.interval_value, task.interval_unit)
  }

  // 'interval' (default) — legacy behavior, unchanged.
  return Date.now() + intervalToMs(task.interval_value, task.interval_unit)
}

/* ── Minimal cron parser (5 fields: min hour dom month dow) ──── */

interface CronField {
  min: number
  max: number
}

function parseCronField(spec: string, field: CronField): number[] {
  const result = new Set<number>()
  const parts = spec.split(',')
  for (const partRaw of parts) {
    const part = partRaw.trim()
    if (!part) continue
    const [range, stepStr] = part.split('/')
    const step = stepStr ? Number(stepStr) : 1
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad cron step in "${part}"`)
    let start = field.min
    let end = field.max
    if (range === '*') {
      // already covers
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number)
      if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error(`Bad cron range "${range}"`)
      start = a
      end = b
    } else {
      const v = Number(range)
      if (!Number.isInteger(v)) throw new Error(`Bad cron value "${range}"`)
      start = v
      end = v
    }
    if (start < field.min || end > field.max || start > end) {
      throw new Error(`Cron value out of range "${range}"`)
    }
    for (let v = start; v <= end; v += step) result.add(v)
  }
  return [...result].sort((a, b) => a - b)
}

function cronNextRun(expr: string | null, from: Date): Date | null {
  if (!expr) return null
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  let mins: number[], hours: number[], doms: number[], months: number[], dows: number[]
  try {
    mins = parseCronField(parts[0], { min: 0, max: 59 })
    hours = parseCronField(parts[1], { min: 0, max: 23 })
    doms = parseCronField(parts[2], { min: 1, max: 31 })
    months = parseCronField(parts[3], { min: 1, max: 12 })
    dows = parseCronField(parts[4], { min: 0, max: 6 })
  } catch {
    return null
  }
  // Walk forward minute-by-minute up to a year ahead. Cheap because the
  // inner check is O(1) and we never hit anywhere near that bound for
  // reasonable cron expressions.
  const cur = new Date(from.getTime() + 60 * 1000 - (from.getTime() % 60000))
  for (let i = 0; i < 60 * 24 * 366; i++) {
    if (
      mins.includes(cur.getMinutes()) &&
      hours.includes(cur.getHours()) &&
      doms.includes(cur.getDate()) &&
      months.includes(cur.getMonth() + 1) &&
      dows.includes(cur.getDay())
    ) {
      return cur
    }
    cur.setMinutes(cur.getMinutes() + 1)
  }
  return null
}

/** True when the cron expression is parseable (renderer-side validation
 *  uses this via IPC so the form can warn before save). */
function cronExpressionValid(expr: string): boolean {
  return cronNextRun(expr, new Date()) !== null
}

/* ── Run execution ────────────────────────────────────────────── */

async function executeScheduledRun(task: ScheduledTask): Promise<void> {
  const db = getDb()
  try {
    const endpointIds = JSON.parse(task.endpoint_ids) as string[]
    if (endpointIds.length === 0) {
      // Nothing to run; just advance the schedule.
      scheduleNextFire(task.id)
      return
    }

    const { executeCollectionForScheduler } = await import('./runner.handler')
    const report = await executeCollectionForScheduler({
      projectId: task.project_id,
      endpointIds,
      environmentId: task.environment_id || undefined,
      delay: task.delay_ms,
      folderName: task.name,
      sourceLabel: `Scheduled: ${task.name}`,
      scheduledTaskId: task.id,
    })

    const nextRun = computeNextRunFor(task)
    db.prepare('UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ? WHERE id = ?').run(
      Date.now(),
      nextRun,
      task.id,
    )

    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('scheduler:runCompleted', {
          taskId: task.id,
          taskName: task.name,
          report,
        })
      }
    }
  } catch (e) {
    console.error(`Scheduled task "${task.name}" failed:`, (e as Error).message)
    const nextRun = computeNextRunFor(task)
    db.prepare('UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ? WHERE id = ?').run(
      Date.now(),
      nextRun,
      task.id,
    )
  } finally {
    // Re-arm the timer for the next fire regardless of run outcome.
    scheduleNextFire(task.id)
  }
}

/** (Re)arm the per-task timer. Reads the freshest row so renames/edits
 *  pick up automatically after the running fire completes. */
function scheduleNextFire(taskId: string): void {
  stopTimer(taskId)
  const db = getDb()
  const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as
    | ScheduledTask
    | undefined
  if (!task || !task.enabled) return
  const next = task.next_run_at ?? computeNextRunFor(task)
  const delay = Math.max(0, next - Date.now())
  const timer = setTimeout(() => {
    void executeScheduledRun(task)
  }, delay)
  activeTimers.set(task.id, timer)
}

function stopTimer(taskId: string): void {
  const existing = activeTimers.get(taskId)
  if (existing) {
    clearTimeout(existing)
    activeTimers.delete(taskId)
  }
}

/** Called on app startup to resume active schedules */
export function startAllSchedulers(): void {
  try {
    const db = getDb()
    const tasks = db
      .prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1')
      .all() as ScheduledTask[]
    for (const task of tasks) {
      // Reset next_run_at if it has drifted into the past while the app
      // was closed, so we don't fire a backlog of stale runs.
      if (!task.next_run_at || task.next_run_at < Date.now()) {
        const next = computeNextRunFor(task)
        db.prepare('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?').run(next, task.id)
      }
      scheduleNextFire(task.id)
    }
  } catch {
    // DB might not have the table yet on first run
  }
}

/** Called on app shutdown */
export function stopAllSchedulers(): void {
  for (const [id] of activeTimers) {
    stopTimer(id)
  }
}

/* ── Register Handlers ────────────────────────────────────────── */

function normalizeSchedulePayload(payload: CreateSchedulePayload): {
  scheduleType: ScheduleType
  scheduleTime: string | null
  scheduleDays: string | null
  scheduleCron: string | null
  error?: string
} {
  const scheduleType: ScheduleType = payload.scheduleType || 'interval'
  let scheduleTime: string | null = null
  let scheduleDays: string | null = null
  let scheduleCron: string | null = null

  if (scheduleType === 'daily' || scheduleType === 'weekly') {
    const t = parseHHMM(payload.scheduleTime)
    if (!t) {
      return {
        scheduleType,
        scheduleTime: null,
        scheduleDays: null,
        scheduleCron: null,
        error: `${scheduleType} schedule requires scheduleTime (HH:MM)`,
      }
    }
    scheduleTime = `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`
  }

  if (scheduleType === 'weekly') {
    if (!Array.isArray(payload.scheduleDays) || payload.scheduleDays.length === 0) {
      return {
        scheduleType,
        scheduleTime,
        scheduleDays: null,
        scheduleCron: null,
        error: 'Weekly schedule requires at least one weekday',
      }
    }
    const days = payload.scheduleDays
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    if (days.length === 0) {
      return {
        scheduleType,
        scheduleTime,
        scheduleDays: null,
        scheduleCron: null,
        error: 'Weekly schedule requires valid weekday values (0–6)',
      }
    }
    scheduleDays = JSON.stringify([...new Set(days)].sort())
  }

  if (scheduleType === 'cron') {
    if (!payload.scheduleCron || !cronExpressionValid(payload.scheduleCron)) {
      return {
        scheduleType,
        scheduleTime,
        scheduleDays,
        scheduleCron: null,
        error: 'Invalid cron expression — expected 5 fields (m h dom mon dow)',
      }
    }
    scheduleCron = payload.scheduleCron.trim()
  }

  return { scheduleType, scheduleTime, scheduleDays, scheduleCron }
}

export function registerSchedulerHandlers(): void {
  ipcMain.handle('scheduler:create', async (_event, payload: CreateSchedulePayload) => {
    try {
      const norm = normalizeSchedulePayload(payload)
      if (norm.error) return { success: false, error: norm.error }

      const db = getDb()
      const id = randomUUID()
      const now = Date.now()
      const nextRun = computeNextRunFor({
        schedule_type: norm.scheduleType,
        schedule_time: norm.scheduleTime,
        schedule_days: norm.scheduleDays,
        schedule_cron: norm.scheduleCron,
        interval_value: payload.intervalValue,
        interval_unit: payload.intervalUnit,
      })

      db.prepare(
        `
        INSERT INTO scheduled_tasks (id, project_id, name, endpoint_ids, folder_id, environment_id,
          interval_value, interval_unit, delay_ms, enabled, next_run_at, created_at,
          schedule_type, schedule_time, schedule_days, schedule_cron, suite_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        id,
        payload.projectId,
        payload.name,
        JSON.stringify(payload.endpointIds),
        payload.folderId || null,
        payload.environmentId || null,
        payload.intervalValue,
        payload.intervalUnit,
        payload.delayMs ?? 0,
        nextRun,
        now,
        norm.scheduleType,
        norm.scheduleTime,
        norm.scheduleDays,
        norm.scheduleCron,
        payload.suiteId || null,
      )

      scheduleNextFire(id)
      const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as ScheduledTask

      return { success: true, data: task }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('scheduler:update', async (_event, payload: UpdateSchedulePayload) => {
    try {
      const norm = normalizeSchedulePayload(payload)
      if (norm.error) return { success: false, error: norm.error }
      const db = getDb()
      const nextRun = computeNextRunFor({
        schedule_type: norm.scheduleType,
        schedule_time: norm.scheduleTime,
        schedule_days: norm.scheduleDays,
        schedule_cron: norm.scheduleCron,
        interval_value: payload.intervalValue,
        interval_unit: payload.intervalUnit,
      })
      db.prepare(
        `
        UPDATE scheduled_tasks SET
          name = ?, endpoint_ids = ?, folder_id = ?, environment_id = ?,
          interval_value = ?, interval_unit = ?, delay_ms = ?,
          schedule_type = ?, schedule_time = ?, schedule_days = ?, schedule_cron = ?,
          suite_id = ?, next_run_at = ?
        WHERE id = ?
      `,
      ).run(
        payload.name,
        JSON.stringify(payload.endpointIds),
        payload.folderId || null,
        payload.environmentId || null,
        payload.intervalValue,
        payload.intervalUnit,
        payload.delayMs ?? 0,
        norm.scheduleType,
        norm.scheduleTime,
        norm.scheduleDays,
        norm.scheduleCron,
        payload.suiteId || null,
        nextRun,
        payload.id,
      )
      scheduleNextFire(payload.id)
      const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(payload.id)
      return { success: true, data: task }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('scheduler:list', async (_event, projectId: string) => {
    try {
      const db = getDb()
      const tasks = db
        .prepare('SELECT * FROM scheduled_tasks WHERE project_id = ? ORDER BY created_at DESC')
        .all(projectId)
      return { success: true, data: tasks }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('scheduler:delete', async (_event, taskId: string) => {
    try {
      const db = getDb()
      stopTimer(taskId)
      db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(taskId)
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('scheduler:toggle', async (_event, taskId: string) => {
    try {
      const db = getDb()
      const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as
        | ScheduledTask
        | undefined
      if (!task) return { success: false, error: 'Task not found' }

      const newEnabled = task.enabled ? 0 : 1
      const nextRun = newEnabled ? computeNextRunFor(task) : null
      db.prepare('UPDATE scheduled_tasks SET enabled = ?, next_run_at = ? WHERE id = ?').run(
        newEnabled,
        nextRun,
        taskId,
      )

      if (newEnabled) {
        scheduleNextFire(taskId)
      } else {
        stopTimer(taskId)
      }

      return { success: true, data: { enabled: newEnabled } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // History view: every runner_history row attributed to this scheduled
  // task. The FK column was added in the runner_history migration above —
  // legacy rows without it fall back to a source_label match on the
  // current task name, which works as long as the task wasn't renamed.
  ipcMain.handle('scheduler:history', async (_event, taskId: string) => {
    try {
      const db = getDb()
      const task = db.prepare('SELECT name FROM scheduled_tasks WHERE id = ?').get(taskId) as
        | { name: string }
        | undefined
      const rows = db
        .prepare(
          `SELECT * FROM runner_history
           WHERE scheduled_task_id = ?
              OR (scheduled_task_id IS NULL AND source = 'Scheduler' AND source_label = ?)
           ORDER BY started_at DESC
           LIMIT 200`,
        )
        .all(taskId, task ? `Scheduled: ${task.name}` : `Scheduled: __none__`)
      return { success: true, data: rows }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // Resolve the endpoint set behind a scheduled task to displayable rows
  // (id + name + method + url). Suite-backed tasks read from
  // test_suite_items; legacy ad-hoc tasks read from the endpoints table.
  // This is what powers the "Endpoints in this task" list in the expand row
  // — sidesteps the renderer having to know about either schema.
  ipcMain.handle('scheduler:taskEndpoints', async (_event, taskId: string) => {
    try {
      const db = getDb()
      const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as
        | ScheduledTask
        | undefined
      if (!task) return { success: false, error: 'Task not found' }
      let ids: string[] = []
      try {
        ids = JSON.parse(task.endpoint_ids) as string[]
      } catch {
        ids = []
      }
      if (ids.length === 0) return { success: true, data: { items: [], source: 'empty' } }

      if (task.suite_id) {
        const placeholders = ids.map(() => '?').join(',')
        const rows = db
          .prepare(
            `SELECT id, name, method, url FROM test_suite_items WHERE id IN (${placeholders})`,
          )
          .all(...ids) as Array<{
          id: string
          name: string
          method: string | null
          url: string | null
        }>
        // Preserve the order the user stored on the schedule itself rather
        // than whatever SQLite returns; the run sequence is meaningful.
        const byId = new Map(rows.map((r) => [r.id, r]))
        const ordered = ids
          .map((id) => byId.get(id))
          .filter((r): r is (typeof rows)[number] => Boolean(r))
        return { success: true, data: { items: ordered, source: 'suite' } }
      }

      // Legacy / ad-hoc APIs-tree task. Kept readable so old tasks still
      // surface their endpoint list even though the create flow now only
      // exposes the suite path.
      const placeholders = ids.map(() => '?').join(',')
      const rows = db
        .prepare(`SELECT id, name, method, url FROM endpoints WHERE id IN (${placeholders})`)
        .all(...ids) as Array<{
        id: string
        name: string
        method: string | null
        url: string | null
      }>
      const byId = new Map(rows.map((r) => [r.id, r]))
      const ordered = ids
        .map((id) => byId.get(id))
        .filter((r): r is (typeof rows)[number] => Boolean(r))
      return { success: true, data: { items: ordered, source: 'apis' } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('scheduler:runNow', async (_event, taskId: string) => {
    try {
      const db = getDb()
      const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as
        | ScheduledTask
        | undefined
      if (!task) return { success: false, error: 'Task not found' }
      void executeScheduledRun(task)
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  // Lightweight validator the renderer uses to give immediate feedback
  // while the user types a cron expression.
  ipcMain.handle('scheduler:validateCron', async (_event, expr: string) => {
    try {
      return { success: true, data: { valid: cronExpressionValid(expr) } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
