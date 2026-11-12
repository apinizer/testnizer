/**
 * A name typed with `$&` / `$1` / `{name}` reaches the screen exactly as typed.
 *
 * UI sentences used to be filled with `t(k).replace('{name}', value)`. The value
 * was a replacement STRING: `$&` turned into the placeholder itself and a later
 * `.replace` filled the `{name}` the user had typed. Every template now goes
 * through `fillTemplate` (`t(key, values)`); the source guard is
 * `tests/renderer/no-template-replace.test.ts`. These are two of the migrated
 * sites, seen in the real app:
 *   - Run Sequence row checkbox: `runSequence.selectRequest` ("Select {name}"),
 *   - Command palette: `command.action.switchEnvironment` ("Use environment: {name}").
 * Before the fix both read `… {name} {name} …` for the names below.
 *
 * Cleanup: the saved request is deleted via IPC, the environment through the
 * modal (store and DB stay in step, and an environment left behind could stay
 * active for every spec after this one); tabs are closed.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  fillCommandPalette,
  navigateSidebar,
  openCommandPalette,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { fillUrl, saveRequestToTree } from '../helpers/ui/request-flow'
import { getActiveProjectId } from '../helpers/ui/assert-ipc'
import { refreshWorkspaceTree } from '../helpers/ui/import-flow'
import {
  closeEnvModal,
  createEnvironment,
  openEnvModal,
  selectEnvironmentInModal,
} from '../helpers/ui/env'
import { closeCollectionRunner, openCollectionRunner } from '../helpers/ui/runner-flow'
import { localHttpBin } from '../helpers/test-servers'

const uid = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const SCREENS = 'test-results/screens'

async function deleteSavedRequestsNamed(
  page: Page,
  projectId: string,
  name: string,
): Promise<void> {
  await page.evaluate(
    async ({ pid, n }) => {
      const api = (
        window as unknown as {
          api: {
            savedRequest: {
              list: (id: string) => Promise<{ data?: Array<{ id: string; name: string }> }>
              delete: (id: string) => Promise<unknown>
            }
          }
        }
      ).api
      const rows = (await api.savedRequest.list(pid)).data ?? []
      for (const r of rows) if (r.name === n) await api.savedRequest.delete(r.id)
    },
    { pid: projectId, n: name },
  )
}

async function deleteEnvViaUi(page: Page, name: string): Promise<void> {
  await openEnvModal(page)
  const row = page.getByTestId('environment-modal').getByRole('button', { name, exact: true })
  if ((await row.count()) > 0) {
    await selectEnvironmentInModal(page, name)
    await page.getByTestId('env-delete').click()
    // EnvironmentModal's delete dialog has no typed confirmation (no `requireTyping`).
    await expect(page.getByTestId('delete-confirm-input')).toHaveCount(0)
    await page.getByTestId('delete-confirm-btn').click()
    await expect(row).toHaveCount(0, { timeout: 8_000 })
  }
  await closeEnvModal(page)
}

uiTest.describe('79 — `$&` and `{name}` in a name stay as typed in UI sentences', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
    await closeAllTabs(window)
  })

  uiTest.afterEach(async ({ window }) => {
    await window.keyboard.press('Escape').catch(() => {})
    await closeAllTabs(window)
  })

  uiTest('Run Sequence names the request as typed', async ({ window }) => {
    const name = `Orders $& {name} ${uid()}`
    const projectId = await getActiveProjectId(window)
    try {
      await openHttpRequestTab(window)
      await fillUrl(window, `${localHttpBin()}/get?n=dollar`)
      await saveRequestToTree(window, name)
      const active = window.locator('[data-testid="endpoint-tab"][data-active="true"]')
      await expect(active).toHaveAttribute('data-tab-name', name, { timeout: 8_000 })
      await expect(active.getByTestId('tab-close')).toHaveAttribute(
        'aria-label',
        `Close tab ${name}`,
      )

      await openCollectionRunner(window)
      const checkbox = window
        .getByTestId('workbench')
        .getByRole('checkbox', { name: `Select ${name}`, exact: true })
      await expect(checkbox).toHaveCount(1, { timeout: 10_000 })
      await checkbox.scrollIntoViewIfNeeded()
      await expect(checkbox).toHaveAttribute('aria-label', `Select ${name}`)
      await window.screenshot({ path: `${SCREENS}/79-dollar-name-runner.png` })
    } finally {
      await closeCollectionRunner(window).catch(() => {})
      await deleteSavedRequestsNamed(window, projectId, name)
      await refreshWorkspaceTree(window).catch(() => {})
    }
  })

  uiTest('the command palette names the environment as typed', async ({ window }) => {
    const id = uid()
    const name = `Env $& $1 {name} ${id}`
    try {
      await openEnvModal(window)
      await createEnvironment(window, name)
      await closeEnvModal(window)

      await openCommandPalette(window)
      await fillCommandPalette(window, id)
      const option = window
        .getByTestId('command-palette')
        .getByRole('option')
        .filter({ hasText: id })
      await expect(option).toHaveCount(1, { timeout: 8_000 })
      // The label span alone: exact text, no icon / shortcut around it.
      await expect(option.locator('span.truncate')).toHaveText(`Use environment: ${name}`)
      await window.screenshot({ path: `${SCREENS}/79-dollar-name-confirm.png` })

      // Leave without choosing it.
      await window.keyboard.press('Escape')
      await expect(window.getByTestId('command-palette')).toBeHidden({ timeout: 5_000 })
    } finally {
      await window.keyboard.press('Escape').catch(() => {})
      await deleteEnvViaUi(window, name).catch(() => {})
    }
  })
})
