/**
 * Issue #123 — the APIs search filter and folder expansion are scoped per
 * project header tab and restored when switching back.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject } from '../../helpers/ui/bootstrap'
import { createProject } from '../../helpers/ui/workspace-flow'
import { treeAddFolder, treeSearch } from '../../helpers/ui/tree'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { deleteProject } from '../../helpers/ui/db-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
const headerTab = (page: import('@playwright/test').Page, title: string) =>
  page.locator(`[data-testid="header-project-tab"][title="${title}"]`)

uiTest.describe('Tur1 — per-project tree state [issue #123]', () => {
  uiTest(
    'search + expansion do not leak between project tabs and are restored',
    async ({ window }) => {
      uiTest.setTimeout(120_000)
      await dismissOverlays(window)
      await ensureCanonicalProject(window)
      const pa = `PA ${uid()}`
      const pb = `PB ${uid()}`
      const deep = `Deep-${uid()}`
      const ids: string[] = []
      try {
        await window.getByTestId('header-home').click()
        await createProject(window, pa)
        ids.push(await getActiveProjectId(window, pa))
        await treeAddFolder(window, pa, deep)
        await treeSearch(window, deep.toLowerCase())
        await expect(window.getByTestId('tree-search')).toHaveValue(deep.toLowerCase())

        await window.getByTestId('header-home').click()
        await createProject(window, pb)
        ids.push(await getActiveProjectId(window, pb))
        // Fresh project: no inherited filter.
        await expect(window.getByTestId('tree-search')).toHaveValue('')
        await treeSearch(window, 'nothing-here')

        // Back to A: its own search + folder come back.
        await headerTab(window, pa).first().click()
        await expect(window.getByTestId('tree-search')).toHaveValue(deep.toLowerCase())
        await expect(window.getByTestId('tree-node').filter({ hasText: deep })).toBeVisible()

        // And B kept its own.
        await headerTab(window, pb).first().click()
        await expect(window.getByTestId('tree-search')).toHaveValue('nothing-here')
      } finally {
        await window
          .getByTestId('tree-search')
          .fill('')
          .catch(() => {})
        for (const id of ids) await deleteProject(window, id).catch(() => {})
        await ensureCanonicalProject(window)
      }
    },
  )
})
