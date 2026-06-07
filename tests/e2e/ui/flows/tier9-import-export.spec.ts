/**
 * MST-069, MST-071 — OpenAPI + Postman UI import wizards
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, ensureCanonicalProject, navigateSidebar } from '../../helpers/ui/bootstrap'
import { importFixtureViaIpc } from '../../helpers/ui/import-flow'
import { treeSearch } from '../../helpers/ui/tree'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

uiTest.describe('Tier 9 — Import / Export UI [MST-069, MST-071]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await ensureCanonicalProject(window)
    await navigateSidebar(window, 'apis')
  })

  uiTest('MST-069 OpenAPI 3.0 UI wizard imports endpoints into tree', async ({ window }) => {
    const folder = `OpenAPI ${uid()}`
    await importFixtureViaIpc(window, 'openapi', 'openapi-3.0.json', folder)
    await treeSearch(window, 'List pets')
    await expect(
      window.getByTestId('tree-node').filter({ hasText: /listPets|List pets|\/pets/i }).first(),
    ).toBeVisible({ timeout: 15_000 })
  })

  uiTest('MST-071 Postman v2.1 UI wizard imports nested collection', async ({ window }) => {
    const folder = `Postman ${uid()}`
    await importFixtureViaIpc(window, 'postman', 'postman-v2.1.json', folder)
    await treeSearch(window, 'Get user by id')
    await expect(window.getByTestId('tree-node').filter({ hasText: /Get user by id|Users/i }).first()).toBeVisible({
      timeout: 15_000,
    })
  })
})
