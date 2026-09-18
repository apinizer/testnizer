/**
 * Issue #126 — Rename on the project root of the APIs tree updates the tree
 * label and the header project tab together.
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject } from '../../helpers/ui/bootstrap'
import { createProject } from '../../helpers/ui/workspace-flow'
import { treeRenameRoot } from '../../helpers/ui/tree'
import { getActiveProjectId } from '../../helpers/ui/assert-ipc'
import { deleteProject } from '../../helpers/ui/db-flow'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tur1 — project root rename [issue #126]', () => {
  uiTest(
    'root Rename updates tree + header tab; Delete is not offered on the root',
    async ({ window }) => {
      await dismissOverlays(window)
      await ensureCanonicalProject(window)
      const name = `PR ${uid()}`
      const renamed = `PR renamed ${uid()}`
      let id: string | null = null
      try {
        await window.getByTestId('header-home').click()
        await createProject(window, name)
        id = await getActiveProjectId(window, name)

        // Context menu on the root: Rename present, Delete absent.
        await window.getByTestId('tree-node').first().click({ button: 'right' })
        await expect(
          window
            .getByRole('menuitem', { name: /Rename|Yeniden Adlandır/i })
            .or(window.getByText(/^Rename$|^Yeniden Adlandır$/)),
        ).toBeVisible()
        await expect(window.getByText(/^Delete$|^Sil$/)).toHaveCount(0)
        await window.keyboard.press('Escape')

        await treeRenameRoot(window, renamed)
        await expect(window.getByTestId('tree-node').first()).toContainText(renamed, {
          timeout: 10_000,
        })
        await expect(
          window.locator(`[data-testid="header-project-tab"][title="${renamed}"]`),
        ).toBeVisible()
      } finally {
        if (id) await deleteProject(window, id).catch(() => {})
        await ensureCanonicalProject(window)
      }
    },
  )
})
