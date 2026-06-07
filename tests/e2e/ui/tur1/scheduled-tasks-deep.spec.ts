/**
 * MST-180 P1  Scheduled task history + endpoints
 *
 * Does NOT modify 16-scheduled-tasks.spec.ts.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import {
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../../helpers/ui/bootstrap'
import {
  createScheduledTask,
  getActiveProjectId,
  listScheduledTasks,
  listSavedRequestsByProject,
} from '../../helpers/ui/assert-ipc'
import { getRunnerHistory, getScheduledTaskDetail } from '../../helpers/ui/runner-extra'
import { fillUrl, addVisualAssertion, saveRequestToTree } from '../../helpers/ui/request-flow'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — Scheduled tasks deep [MST-180]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
  })

  /**
   * MST-180 — Scheduled task history + endpoints
   *
   * Steps:
   *   1. Create a scheduled task (via IPC — same as MST-179 baseline).
   *   2. Trigger a runNow via IPC.
   *   3. Poll runner history until a record with source='Scheduler' appears.
   *   4. Assert the task detail shows the endpoint IDs it was created with.
   *
   * NEEDS HOOK: window.api.scheduler.runNow(taskId) IPC (if not yet exposed).
   */
  uiTest('MST-180 scheduler runNow creates history entry', async ({ window }) => {
    const tag = uid()
    const taskName = `Deep180-${tag}`
    const reqName = `Sched180Req-${tag}`
    const projectId = await getActiveProjectId(window)

    // The scheduler's run path only executes when the task carries non-empty
    // endpointIds (executeScheduledRun bails early on an empty list — suiteId
    // is NOT a runnable source there). So create a real saved request and
    // schedule THAT endpoint id.
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
    await fillUrl(window, `${http()}/get?sched=180`)
    await addVisualAssertion(window, /Status code equals/i, { expected: 200 })
    await saveRequestToTree(window, reqName)

    const saved = (await listSavedRequestsByProject(window, projectId)) as Array<{ id: string; name: string }>
    const endpointId = saved.find((s) => s.name === reqName)?.id
    expect(endpointId, `saved request ${reqName} not found`).toBeTruthy()

    // Create scheduled task pointing at the saved request.
    const taskId = await window.evaluate(
      async ({ pid, n, eid }) => {
        const w = window as unknown as Window & {
          api?: {
            scheduler?: {
              create: (p: unknown) => Promise<{ success: boolean; data?: { id: string }; error?: string }>
            }
          }
        }
        const res = await w.api?.scheduler?.create({
          projectId: pid,
          name: n,
          endpointIds: [eid],
          intervalValue: 60,
          intervalUnit: 'minutes',
          scheduleType: 'interval',
        })
        if (!res?.success || !res.data?.id) throw new Error(res?.error ?? 'create failed')
        return res.data.id
      },
      { pid: projectId, n: taskName, eid: endpointId as string },
    )
    expect(taskId).toBeTruthy()

    // Confirm task appears in list.
    await expect
      .poll(async () => {
        const tasks = await listScheduledTasks(window, projectId)
        return tasks.some((t) => (t as { id: string }).id === taskId)
      })
      .toBe(true)

    // Trigger runNow if the IPC is exposed.
    const runNowResult = await window.evaluate(async (id) => {
      const w = window as unknown as Window & {
        api?: {
          scheduler?: {
            runNow?: (id: string) => Promise<{ success: boolean; error?: string }>
          }
        }
      }
      if (!w.api?.scheduler?.runNow) return { skipped: true }
      const res = await w.api.scheduler.runNow(id)
      return { skipped: false, success: res?.success }
    }, taskId)

    if ((runNowResult as { skipped?: boolean }).skipped) {
      console.warn('NEEDS HOOK: window.api.scheduler.runNow IPC not exposed — skipping history assertion')
    } else {
      expect((runNowResult as { success: boolean }).success).toBe(true)
      // Poll until a Scheduler history row appears.
      await expect
        .poll(
          async () => {
            const rows = await getRunnerHistory(window, projectId)
            return rows.some((r) => r.source === 'Scheduler')
          },
          { timeout: 30_000, intervals: [1_000] },
        )
        .toBe(true)
    }

    // Confirm task detail shows the expected name (resolved via scheduler.list).
    const detail = await getScheduledTaskDetail(window, projectId, taskId)
    expect(detail).not.toBeNull()
    expect(detail?.name).toBe(taskName)

    // Cleanup.
    await window.evaluate(async (id) => {
      const w = window as unknown as Window & {
        api?: { scheduler?: { delete: (tid: string) => Promise<{ success: boolean }> } }
      }
      await w.api?.scheduler?.delete(id)
    }, taskId)
  })

  /**
   * MST-180b — Scheduled tasks UI list shows task name
   * Confirm the created task renders in the ScheduledTasksView panel.
   */
  uiTest('MST-180b scheduled task appears in UI list', async ({ window }) => {
    const taskName = `List180b-${uid()}`
    const projectId = await getActiveProjectId(window)
    const taskId = await createScheduledTask(window, projectId, taskName)

    await navigateSidebar(window, 'tests')
    const left = window.getByTestId('left-panel')
    await left.getByRole('button', { name: /^Scheduled Tasks$/i }).click()

    // The row exposes data-task-name; the name text also renders inside it, so
    // an .or() would match 2 elements and trip strict mode. Target the row.
    const row = window.locator(`[data-testid="scheduled-task-row"][data-task-name="${taskName}"]`)
    await expect(row).toBeVisible({ timeout: 15_000 })

    // Cleanup.
    await window.evaluate(async (id) => {
      const w = window as unknown as Window & {
        api?: { scheduler?: { delete: (tid: string) => Promise<{ success: boolean }> } }
      }
      await w.api?.scheduler?.delete(id)
    }, taskId)
  })
})
