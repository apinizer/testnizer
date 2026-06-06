import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar } from '../../helpers/ui/bootstrap'
import { fillUrl } from '../../helpers/ui/request-flow'
import {
  startRunnerTabRun,
  waitRunnerConfigReady,
  waitRunnerTabComplete,
  openScheduledTasksView,
} from '../../helpers/ui/runner-flow'
import {
  createTestSuite,
  addSuiteItem,
  saveActiveSuiteItem,
  runSuiteFromContextMenu,
} from '../../helpers/ui/suite-flow'
import {
  openEnvModal,
  closeEnvModal,
  createEnvironment,
  selectEnvironmentInModal,
  addVariable,
  setActiveEnvironment,
} from '../../helpers/ui/env'
import {
  createScheduledTask,
  getActiveProjectId,
  listEnvironmentsByProject,
  listEnvVariables,
  listScheduledTasks,
} from '../../helpers/ui/assert-ipc'
import { localHttpBin } from '../../helpers/test-servers'

const http = () => localHttpBin()
const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tier 11 — Runner iterations, environment CRUD, scheduled tasks', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('F43 the runner honours an iteration count > 1', async ({ window }) => {
    const suiteName = `Iter Suite ${uid()}`
    await navigateSidebar(window, 'apis')
    await createTestSuite(window, suiteName)
    await addSuiteItem(window, suiteName)
    await fillUrl(window, `${http()}/get?iter=1`)
    await saveActiveSuiteItem(window)

    await runSuiteFromContextMenu(window, suiteName)
    await waitRunnerConfigReady(window)

    // Two iterations → the tab results group rows under "Iteration 1" and
    // "Iteration 2". Asserting the second group proves the loop actually ran
    // more than once (not just a single pass).
    await window.getByTestId('runner-iterations').fill('2')
    await startRunnerTabRun(window)
    await waitRunnerTabComplete(window, 120_000)
    await expect(window.getByTestId('workbench').getByText(/Iteration 2/i).first()).toBeVisible({
      timeout: 30_000,
    })
  })

  uiTest('F44 environment CRUD: create, edit a variable, then delete', async ({ window }) => {
    const envName = `CRUD Env ${uid()}`
    const projectId = await getActiveProjectId(window)

    // Create + add a variable + activate.
    await openEnvModal(window)
    await createEnvironment(window, envName)
    await addVariable(window, { key: 'token', initialValue: 'init-1', currentValue: 'cur-1' })
    await setActiveEnvironment(window)
    await closeEnvModal(window)

    // Persisted with the variable.
    let envs = (await listEnvironmentsByProject(window, projectId)) as Array<{
      id: string
      name: string
    }>
    const created = envs.find((e) => e.name === envName)
    expect(created?.id).toBeTruthy()
    await expect
      .poll(
        async () => {
          const vars = (await listEnvVariables(window, created!.id)) as Array<{
            key: string
            value: string
          }>
          return vars.find((v) => v.key === 'token')?.value
        },
        { timeout: 8_000 },
      )
      .toBe('cur-1')

    // Edit the current value of the variable.
    await openEnvModal(window)
    await selectEnvironmentInModal(window, envName)
    await window.getByTestId('env-var-current').first().fill('cur-2')
    await window.getByTestId('env-var-key').first().blur()
    await closeEnvModal(window)

    await expect
      .poll(
        async () => {
          const vars = (await listEnvVariables(window, created!.id)) as Array<{
            key: string
            value: string
          }>
          return vars.find((v) => v.key === 'token')?.value
        },
        { timeout: 8_000 },
      )
      .toBe('cur-2')

    // Delete the environment via its trash button + confirm dialog.
    await openEnvModal(window)
    await selectEnvironmentInModal(window, envName)
    await window.getByTestId('env-delete').click()
    const confirmInput = window.getByTestId('delete-confirm-input')
    if (await confirmInput.isVisible().catch(() => false)) {
      await confirmInput.fill('delete')
    }
    await window.getByTestId('delete-confirm-btn').click()
    await closeEnvModal(window)

    envs = (await listEnvironmentsByProject(window, projectId)) as Array<{ name: string }>
    expect(envs.find((e) => e.name === envName)).toBeUndefined()
  })

  uiTest('F45 a scheduled task renders in the list and can be deleted', async ({ window }) => {
    const taskName = `Sched ${uid()}`
    const projectId = await getActiveProjectId(window)
    // Creation goes through the scheduler API (the in-product wizard is bound
    // to an existing suite); this flow verifies the user-facing list + delete.
    await createScheduledTask(window, projectId, taskName)

    await openScheduledTasksView(window)

    const row = window.locator(`[data-testid="scheduled-task-row"][data-task-name="${taskName}"]`)
    await expect(row).toBeVisible({ timeout: 10_000 })

    // Delete via the row's trash action + confirm.
    await row.hover()
    await row.getByTestId('scheduled-task-delete').click()
    const confirmInput = window.getByTestId('delete-confirm-input')
    if (await confirmInput.isVisible().catch(() => false)) {
      await confirmInput.fill('delete')
    }
    await window.getByTestId('delete-confirm-btn').click()

    await expect(row).toHaveCount(0, { timeout: 8_000 })
    const tasks = (await listScheduledTasks(window, projectId)) as Array<{ name: string }>
    expect(tasks.find((t) => t.name === taskName)).toBeUndefined()
  })
})
