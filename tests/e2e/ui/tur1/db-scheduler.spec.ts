/**
 * MST-277, MST-278 — Scheduled task persistence
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'
import { createScheduledTask, listScheduledTasks } from '../../helpers/ui/assert-ipc'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — DB scheduler [MST-277, MST-278]', () => {
  uiTest('MST-277 scheduled task CRUD persists in list', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const name = `Sched ${uid()}`
    const id = await createScheduledTask(window, projectId, name)
    const tasks = (await listScheduledTasks(window, projectId)) as Array<{ id: string; name: string }>
    expect(tasks.some((t) => t.id === id && t.name === name)).toBe(true)

    const del = await window.evaluate(async (tid) => {
      const w = window as Window & {
        api?: { scheduler?: { delete: (id: string) => Promise<{ success: boolean }> } }
      }
      return w.api?.scheduler?.delete(tid)
    }, id)
    expect(del?.success).toBe(true)
  })

  uiTest('MST-278 scheduled task history endpoint returns envelope', async ({ window }) => {
    await dismissOverlays(window)
    const projectId = await getActiveProjectId(window)
    const id = await createScheduledTask(window, projectId, `Hist ${uid()}`)
    const hist = await window.evaluate(async (tid) => {
      const w = window as Window & {
        api?: { scheduler?: { history: (id: string) => Promise<{ success: boolean; data?: unknown[] }> } }
      }
      return w.api?.scheduler?.history(tid)
    }, id)
    expect(hist?.success).toBe(true)
    expect(Array.isArray(hist?.data)).toBe(true)
  })
})
