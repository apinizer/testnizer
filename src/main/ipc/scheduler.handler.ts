// src/main/ipc/scheduler.handler.ts
// Apinizer API Tester — Scheduled Tasks IPC Handler

import { ipcMain, BrowserWindow } from 'electron'
import { getDb } from '../db/database'
import { randomUUID } from 'crypto'

/* ── Types ────────────────────────────────────────────────────── */

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

interface CreateSchedulePayload {
  projectId: string
  name: string
  endpointIds: string[]
  folderId?: string
  environmentId?: string
  intervalValue: number
  intervalUnit: 'minutes' | 'hours' | 'days'
  delayMs?: number
}

/* ── Scheduler State ──────────────────────────────────────────── */

const activeTimers = new Map<string, ReturnType<typeof setInterval>>()

function intervalToMs(value: number, unit: string): number {
  switch (unit) {
    case 'minutes': return value * 60 * 1000
    case 'hours': return value * 60 * 60 * 1000
    case 'days': return value * 24 * 60 * 60 * 1000
    default: return value * 60 * 1000
  }
}

function computeNextRun(intervalValue: number, intervalUnit: string): number {
  return Date.now() + intervalToMs(intervalValue, intervalUnit)
}

async function executeScheduledRun(task: ScheduledTask): Promise<void> {
  const db = getDb()
  try {
    const endpointIds = JSON.parse(task.endpoint_ids) as string[]
    if (endpointIds.length === 0) return

    // Trigger execution via the runner:execute IPC — but since we're in main process,
    // we call the runner execution directly
    const { executeCollectionForScheduler } = await import('./runner.handler')
    const report = await executeCollectionForScheduler({
      projectId: task.project_id,
      endpointIds,
      environmentId: task.environment_id || undefined,
      delay: task.delay_ms,
      folderName: task.name,
      sourceLabel: `Scheduled: ${task.name}`,
    })

    // Update last_run_at and next_run_at
    const nextRun = computeNextRun(task.interval_value, task.interval_unit)
    db.prepare('UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ? WHERE id = ?')
      .run(Date.now(), nextRun, task.id)

    // Notify renderer about the completed scheduled run
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
    // Still update timestamps
    const nextRun = computeNextRun(task.interval_value, task.interval_unit)
    db.prepare('UPDATE scheduled_tasks SET last_run_at = ?, next_run_at = ? WHERE id = ?')
      .run(Date.now(), nextRun, task.id)
  }
}

function startTimer(task: ScheduledTask): void {
  stopTimer(task.id)
  const ms = intervalToMs(task.interval_value, task.interval_unit)
  const timer = setInterval(() => {
    executeScheduledRun(task)
  }, ms)
  activeTimers.set(task.id, timer)
}

function stopTimer(taskId: string): void {
  const existing = activeTimers.get(taskId)
  if (existing) {
    clearInterval(existing)
    activeTimers.delete(taskId)
  }
}

/** Called on app startup to resume active schedules */
export function startAllSchedulers(): void {
  try {
    const db = getDb()
    const tasks = db.prepare(
      'SELECT * FROM scheduled_tasks WHERE enabled = 1'
    ).all() as ScheduledTask[]
    for (const task of tasks) {
      startTimer(task)
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

export function registerSchedulerHandlers(): void {
  ipcMain.handle('scheduler:create', async (_event, payload: CreateSchedulePayload) => {
    try {
      const db = getDb()
      const id = randomUUID()
      const now = Date.now()
      const nextRun = computeNextRun(payload.intervalValue, payload.intervalUnit)

      db.prepare(`
        INSERT INTO scheduled_tasks (id, project_id, name, endpoint_ids, folder_id, environment_id,
          interval_value, interval_unit, delay_ms, enabled, next_run_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
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
        now
      )

      const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as ScheduledTask
      startTimer(task)

      return { success: true, data: task }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('scheduler:list', async (_event, projectId: string) => {
    try {
      const db = getDb()
      const tasks = db.prepare(
        'SELECT * FROM scheduled_tasks WHERE project_id = ? ORDER BY created_at DESC'
      ).all(projectId)
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
      const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as ScheduledTask | undefined
      if (!task) return { success: false, error: 'Task not found' }

      const newEnabled = task.enabled ? 0 : 1
      const nextRun = newEnabled ? computeNextRun(task.interval_value, task.interval_unit) : null
      db.prepare('UPDATE scheduled_tasks SET enabled = ?, next_run_at = ? WHERE id = ?')
        .run(newEnabled, nextRun, taskId)

      if (newEnabled) {
        const updated = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId) as ScheduledTask
        startTimer(updated)
      } else {
        stopTimer(taskId)
      }

      return { success: true, data: { enabled: newEnabled } }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  })
}
