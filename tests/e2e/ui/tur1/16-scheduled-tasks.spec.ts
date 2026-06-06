/**
 * MST-179 — Scheduled task create / toggle / runNow
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import { createScheduledTask, getActiveProjectId, listScheduledTasks } from '../../helpers/ui/assert-ipc'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Scheduled tasks [MST-179]', () => {
  uiTest('MST-179 scheduled task appears in UI and can be deleted', async ({ window }) => {
    await dismissOverlays(window)
    const name = `Sched ${uid()}`
    const projectId = await getActiveProjectId(window)
    const taskId = await createScheduledTask(window, projectId, name)

    await expect
      .poll(async () => {
        const tasks = await listScheduledTasks(window, projectId)
        return tasks.some((t) => t.id === taskId)
      })
      .toBe(true)

    // Tests home lists upcoming scheduled tasks for the active project.
    await navigateSidebar(window, 'tests')
    await expect(window.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 })

    await window.evaluate(async (id) => {
      const w = window as Window & {
        api?: { scheduler?: { delete: (tid: string) => Promise<{ success: boolean; error?: string }> } }
      }
      const res = await w.api?.scheduler?.delete(id)
      if (!res?.success) throw new Error(res?.error ?? 'scheduler delete failed')
    }, taskId)

    await expect
      .poll(async () => {
        const tasks = await listScheduledTasks(window, projectId)
        return tasks.find((t) => t.id === taskId)
      })
      .toBeUndefined()
  })
})
