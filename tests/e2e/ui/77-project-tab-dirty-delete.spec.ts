/**
 * Follow-up to spec 67 (closing a project tab with unsaved requests asks).
 *
 *   A) The header project tab shows the request tab strip's dirty dot while
 *      one of its requests is unsaved — while the project is active and after
 *      the user switched away (hidden project, read from its tab snapshot).
 *      Ctrl+S clears it.
 *   B) Deleting that project from Project Home: the delete confirm says how
 *      many unsaved requests are lost and lists them by name; a project with
 *      none gets the plain confirm.
 *
 * Cleanup: the dirty project is deleted through the UI (which drops its tab
 * snapshot, so no unsaved state is left in the shared window); every project
 * the spec created is also deleted over IPC in `finally`.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { fillUrl, saveRequestToTree } from '../helpers/ui/request-flow'
import { getActiveProjectId } from '../helpers/ui/assert-ipc'
import { createProject, goToProjectHome } from '../helpers/ui/workspace-flow'
import { deleteProject } from '../helpers/ui/db-flow'
import { pressModShortcut } from '../helpers/ui/keyboard'

const uid = (): string => `${Date.now()}`.slice(-7)
const headerTab = (page: Page, title: string) =>
  page.locator(`[data-testid="header-project-tab"][title="${title}"]`).first()

async function openDeleteConfirm(page: Page, projectName: string): Promise<void> {
  await goToProjectHome(page)
  const card = page.getByTestId('project-card').filter({ hasText: projectName }).first()
  await expect(card).toBeVisible()
  await card.hover()
  await card.getByTestId('home-card-menu').click()
  await card.getByTestId('home-card-delete').click()
  await expect(page.getByTestId('delete-confirm-input')).toBeVisible()
}

uiTest.describe('Header project tab dirty dot + project delete warning', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await closeAllTabs(window)
  })

  uiTest(
    'a project with an unsaved request shows the dot and its delete confirm lists the request',
    async ({ window }) => {
      uiTest.setTimeout(180_000)
      const tag = uid()
      const dirtyName = `Dirty Dot ${tag}`
      const cleanName = `Clean Dot ${tag}`
      const reqName = `orders-${tag}`
      const base = 'http://127.0.0.1:9/orders'
      const created: string[] = []
      try {
        // A clean project: open, nothing edited.
        await window.getByTestId('header-home').click()
        await createProject(window, cleanName)
        created.push(await getActiveProjectId(window, cleanName))

        // The dirty project: a saved request, then an unsaved edit on it.
        await window.getByTestId('header-home').click()
        await createProject(window, dirtyName)
        created.push(await getActiveProjectId(window, dirtyName))
        await navigateSidebar(window, 'apis')
        await openHttpRequestTab(window)
        await fillUrl(window, base)
        await saveRequestToTree(window, reqName)
        await expect(headerTab(window, dirtyName)).toHaveAttribute('data-dirty', 'false')
        await expect(headerTab(window, dirtyName).getByTestId('project-tab-dirty')).toHaveCount(0)

        await fillUrl(window, `${base}?edited=1`)
        await expect(
          window.locator('[data-testid="endpoint-tab"][data-active="true"]'),
        ).toHaveAttribute('data-dirty', 'true')
        // Active project: the dot follows the live tab strip.
        const dot = headerTab(window, dirtyName).getByTestId('project-tab-dirty')
        await expect(dot).toHaveCount(1)
        await expect(dot).toHaveAttribute('aria-label', /.+/)

        // Hidden project: switch away, the dot stays (read from its snapshot).
        await headerTab(window, cleanName).click()
        await expect(headerTab(window, cleanName)).toHaveAttribute('data-active', 'true')
        await expect(dot).toHaveCount(1)
        await expect(headerTab(window, cleanName).getByTestId('project-tab-dirty')).toHaveCount(0)
        // Move the pointer off the strip: hover swaps the dot for the ×.
        await window.mouse.move(5, 400)
        await window.screenshot({ path: 'test-results/screens/77-project-tab-dirty-dot.png' })

        // Back on it, Ctrl+S: saved, the dot goes away.
        await headerTab(window, dirtyName).click()
        await expect(headerTab(window, dirtyName)).toHaveAttribute('data-active', 'true')
        // The restored strip is in place before the shortcut fires.
        await expect(
          window.locator('[data-testid="endpoint-tab"][data-active="true"]'),
        ).toHaveAttribute('data-dirty', 'true')
        await pressModShortcut(window, 's')
        await expect(
          window.locator('[data-testid="endpoint-tab"][data-active="true"]'),
        ).toHaveAttribute('data-dirty', 'false', { timeout: 15_000 })
        await expect(dot).toHaveCount(0)

        // A new unsaved edit, then delete the project from Project Home.
        await fillUrl(window, `${base}?edited=2`)
        await expect(dot).toHaveCount(1)

        // The clean project first: plain confirm, no unsaved warning.
        await openDeleteConfirm(window, cleanName)
        await expect(window.getByTestId('delete-unsaved-warning')).toHaveCount(0)
        await window.getByTestId('delete-cancel-btn').click()
        await expect(window.getByTestId('delete-confirm-input')).toBeHidden()

        await openDeleteConfirm(window, dirtyName)
        const warning = window.getByTestId('delete-unsaved-warning')
        await expect(warning).toBeVisible()
        await expect(warning.getByTestId('unsaved-names')).toContainText(reqName)
        await expect(warning.getByTestId('unsaved-names').locator('li')).toHaveCount(1)
        await window.screenshot({ path: 'test-results/screens/77-delete-warning.png' })

        // Confirm the delete: the project and its header tab are gone.
        await window.getByTestId('delete-confirm-input').fill('delete')
        await window.getByTestId('delete-confirm-btn').click()
        await expect(window.getByTestId('delete-confirm-input')).toBeHidden()
        await expect(window.getByTestId('project-card').filter({ hasText: dirtyName })).toHaveCount(
          0,
        )
        // The header is not rendered on Project Home: open the clean project
        // to see the strip, where the deleted project's tab is gone.
        await window.getByTestId('project-card').filter({ hasText: cleanName }).first().click()
        await expect(headerTab(window, cleanName)).toHaveAttribute('data-active', 'true')
        await expect(
          window.locator(`[data-testid="header-project-tab"][title="${dirtyName}"]`),
        ).toHaveCount(0)
      } finally {
        await dismissOverlays(window)
        // Cleanup only: these hold no edits now, × closes them with no dialog;
        // a tab a failed step never opened has nothing to close.
        for (const id of created) {
          const close = window.getByTestId(`header-project-tab-close-${id}`)
          if ((await close.count()) > 0) await close.click({ force: true }).catch(() => {})
        }
        await dismissOverlays(window)
        await ensureCanonicalProject(window)
        for (const id of created) await deleteProject(window, id).catch(() => {})
      }
    },
  )
})
