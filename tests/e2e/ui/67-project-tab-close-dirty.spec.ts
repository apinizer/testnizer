/**
 * Tester findings on the header's project tabs.
 *
 *   1. (P0, data loss) Edit a request in project A, do not save, switch to B,
 *      press × on A's header tab: A closed and the edits were gone when A was
 *      reopened. `closeProjectTab` dropped A's stashed tab set without asking.
 *      Now the request tab's own unsaved-changes dialog asks; Save writes the
 *      edit to the DB, Discard throws it away, Cancel keeps everything.
 *   7. With ~7 long-named projects open at 1280 px the tabs pushed Save /
 *      Pull / Push / Branch / user menu off screen. Now only the tab strip
 *      flexes: tabs shrink (full name in `title`), then the strip scrolls.
 *
 * Cleanup: every project this spec created is deleted over IPC; the window
 * size is restored.
 */
import { expect, type Page } from '@playwright/test'
import { uiTest } from './_setup'
import {
  E2E_PROJECT_NAME,
  closeAllTabs,
  dismissOverlays,
  ensureCanonicalProject,
  navigateSidebar,
  openHttpRequestTab,
} from '../helpers/ui/bootstrap'
import { fillUrl, saveRequestToTree } from '../helpers/ui/request-flow'
import { getActiveProjectId, listEndpointsByProject } from '../helpers/ui/assert-ipc'
import { createProject, openProject } from '../helpers/ui/workspace-flow'
import { deleteProject } from '../helpers/ui/db-flow'
import { updateProjectIpc } from '../helpers/ui/db-extra'

const uid = (): string => `${Date.now()}`.slice(-7)
const headerTab = (page: Page, title: string) =>
  page.locator(`[data-testid="header-project-tab"][title="${title}"]`)

async function pressProjectClose(page: Page, title: string): Promise<void> {
  const tab = headerTab(page, title).first()
  const id = await tab.getAttribute('data-project-id')
  if (!id) throw new Error(`no header tab for ${title}`)
  await tab.hover()
  await page.getByTestId(`header-project-tab-close-${id}`).click()
}

/** The stored URL of the request named `name` in `projectId` (DB truth). */
async function storedUrl(page: Page, projectId: string, name: string): Promise<string | undefined> {
  const rows = (await listEndpointsByProject(page, projectId)) as Array<{
    name: string
    url?: string
    path?: string
  }>
  const row = rows.find((r) => r.name === name)
  return row ? (row.url ?? row.path) : undefined
}

uiTest.describe('Header project tabs — unsaved requests and many projects', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await closeAllTabs(window)
  })

  uiTest(
    'closing a project tab with an unsaved request asks; Save writes it, Discard drops it',
    async ({ window }) => {
      uiTest.setTimeout(180_000)
      const name = `Dirty Close ${uid()}`
      const reqName = `orders-${uid()}`
      const base = 'http://127.0.0.1:9/orders'
      const created: string[] = []
      try {
        await window.getByTestId('header-home').click()
        await createProject(window, name)
        const pid = await getActiveProjectId(window, name)
        created.push(pid)
        await navigateSidebar(window, 'apis')

        // A saved request, then an unsaved edit on it.
        await openHttpRequestTab(window)
        await fillUrl(window, base)
        await saveRequestToTree(window, reqName)
        await expect.poll(() => storedUrl(window, pid, reqName)).toBe(base)
        await fillUrl(window, `${base}?edited=save`)
        await expect(
          window.locator('[data-testid="endpoint-tab"][data-active="true"]'),
        ).toHaveAttribute('data-dirty', 'true')

        // Hide it: switch to the canonical project, then × on the HIDDEN tab.
        await headerTab(window, E2E_PROJECT_NAME).first().click()
        await expect(headerTab(window, E2E_PROJECT_NAME).first()).toHaveAttribute(
          'data-active',
          'true',
        )
        await pressProjectClose(window, name)
        const dialog = window.getByTestId('unsaved-changes-dialog')
        await expect(dialog).toBeVisible()
        await expect(dialog).toHaveAttribute('data-scope', 'project')
        await expect(dialog).toContainText(name)
        await expect(dialog.getByTestId('unsaved-names')).toContainText(reqName)
        await window.screenshot({ path: 'test-results/screens/67-project-dirty-dialog.png' })

        // Cancel: nothing closes, nothing is written.
        await dialog.getByTestId('unsaved-cancel-btn').click()
        await expect(dialog).toBeHidden()
        await expect(headerTab(window, name)).toHaveCount(1)
        expect(await storedUrl(window, pid, reqName)).toBe(base)

        // Save: the edit reaches the DB, the project closes, the user is
        // back on the project they were in.
        await pressProjectClose(window, name)
        await expect(dialog).toBeVisible()
        await dialog.getByTestId('unsaved-save-btn').click()
        await expect(dialog).toBeHidden({ timeout: 15_000 })
        await expect(headerTab(window, name)).toHaveCount(0)
        await expect(headerTab(window, E2E_PROJECT_NAME).first()).toHaveAttribute(
          'data-active',
          'true',
        )
        await expect.poll(() => storedUrl(window, pid, reqName)).toBe(`${base}?edited=save`)

        // Discard on the ACTIVE project: the edit is dropped, the row keeps
        // the saved value, and reopening shows no unsaved tab.
        await openProject(window, name)
        await navigateSidebar(window, 'apis')
        await window.getByTestId('tree-node').filter({ hasText: reqName }).first().click()
        await fillUrl(window, `${base}?edited=discard`)
        await expect(
          window.locator('[data-testid="endpoint-tab"][data-active="true"]'),
        ).toHaveAttribute('data-dirty', 'true')
        await pressProjectClose(window, name)
        await expect(dialog).toBeVisible()
        await dialog.getByTestId('unsaved-discard-btn').click()
        await expect(dialog).toBeHidden()
        await expect(headerTab(window, name)).toHaveCount(0)
        expect(await storedUrl(window, pid, reqName)).toBe(`${base}?edited=save`)
        await openProject(window, name)
        await expect(window.locator('[data-testid="endpoint-tab"][data-dirty="true"]')).toHaveCount(
          0,
        )
      } finally {
        await dismissOverlays(window)
        await ensureCanonicalProject(window)
        for (const id of created) await deleteProject(window, id).catch(() => {})
      }
    },
  )

  uiTest(
    'seven long-named projects at 1280 px keep the header actions on screen',
    async ({ app, window }) => {
      uiTest.setTimeout(240_000)
      const original = await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        const [width, height] = w.getContentSize()
        w.setContentSize(1280, 800)
        return { width, height }
      })
      const created: string[] = []
      const tag = uid()
      try {
        for (let i = 1; i <= 6; i++) {
          const name = `Customer Onboarding Platform Integration ${i} ${tag}`
          await window.getByTestId('header-home').click()
          await createProject(window, name)
          created.push(await getActiveProjectId(window, name))
          // The first one is a git project, so the header also renders Pull
          // and Push (`save_mode` git|both) — the widest right-hand group. The
          // next `createProject` re-reads the project list, so the header sees
          // the new mode without a reload.
          if (i === 1) await updateProjectIpc(window, created[0], { save_mode: 'git' })
        }
        await expect(window.getByTestId('header-project-tab')).toHaveCount(7, { timeout: 10_000 })
        const gitTab = window.locator(
          `[data-testid="header-project-tab"][data-project-id="${created[0]}"]`,
        )
        await gitTab.click()
        await expect(gitTab).toHaveAttribute('data-active', 'true')
        await expect(window.getByTestId('header-pull')).toHaveCount(1)
        await expect(window.getByTestId('header-push')).toHaveCount(1)

        for (const id of [
          'header-pull',
          'header-push',
          'header-save',
          'branch-pill',
          'user-menu-trigger',
        ]) {
          await expect(window.getByTestId(id).first()).toBeInViewport({ ratio: 1 })
        }
        const viewport = await window.evaluate(() => document.documentElement.clientWidth)
        const actions = await window.getByTestId('header-actions').boundingBox()
        expect(actions).not.toBeNull()
        expect(actions!.x + actions!.width).toBeLessThanOrEqual(viewport)

        // Tabs shrank (or the strip scrolls) instead of growing the header.
        const strip = window.getByTestId('header-project-tabs')
        const box = await strip.boundingBox()
        expect(box!.x + box!.width).toBeLessThanOrEqual(actions!.x + 1)
        const widths = await window
          .getByTestId('header-project-tab')
          .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
        for (const w of widths) {
          expect(w).toBeGreaterThanOrEqual(95)
          expect(w).toBeLessThanOrEqual(201)
        }
        // The full name stays reachable as the tab's tooltip.
        await expect(
          headerTab(window, `Customer Onboarding Platform Integration 1 ${tag}`),
        ).toHaveCount(1)
        await window.screenshot({ path: 'test-results/screens/67-header-seven-projects-1280.png' })

        // The last tab is reachable: activating it scrolls it into view.
        const last = window.getByTestId('header-project-tab').last()
        await last.click()
        await expect(last).toHaveAttribute('data-active', 'true')
        await expect(last).toBeInViewport()
        await expect(window.getByTestId('header-save')).toBeInViewport({ ratio: 1 })
        await expect(window.getByTestId('user-menu-trigger')).toBeInViewport({ ratio: 1 })
      } finally {
        await dismissOverlays(window)
        // These projects hold no edits: × closes them with no dialog.
        // Cleanup only: a tab a failed step never opened has nothing to close.
        for (const id of created) {
          const close = window.getByTestId(`header-project-tab-close-${id}`)
          if ((await close.count()) > 0) await close.click({ force: true }).catch(() => {})
        }
        await ensureCanonicalProject(window)
        for (const id of created) await deleteProject(window, id).catch(() => {})
        await app.evaluate(({ BrowserWindow }, size) => {
          BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height)
        }, original)
      }
    },
  )
})
