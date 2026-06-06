import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays, navigateSidebar, openHttpRequestTab } from '../helpers/ui/bootstrap'
import { fillMonaco } from '../helpers/ui/monaco'
import { expectScriptsSectionActive } from '../helpers/ui/assertions'

uiTest.describe('Request Scripts & Tests (deep)', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
    await navigateSidebar(window, 'apis')
    await openHttpRequestTab(window)
  })

  uiTest('scripts: switch pre and post', async ({ window }) => {
    await window.getByTestId('req-tab-scripts').click()
    await window.getByTestId('scripts-pre').click()
    await expectScriptsSectionActive(window.getByTestId('scripts-pre'))
    await window.getByTestId('scripts-post').click()
    await expectScriptsSectionActive(window.getByTestId('scripts-post'))
  })

  uiTest('scripts: insert example populates editor', async ({ window }) => {
    await window.getByTestId('req-tab-scripts').click()
    await window.getByTestId('scripts-insert-example').click()
    await expect(window.locator('.monaco-editor').first()).toBeVisible()
  })

  uiTest('scripts: help modal opens', async ({ window }) => {
    await window.getByTestId('req-tab-scripts').click()
    await window.getByTestId('scripts-help').click()
    await expect(window.getByRole('dialog')).toBeVisible({ timeout: 5_000 })
    await window.keyboard.press('Escape')
  })

  uiTest('tests: add status assertion', async ({ window }) => {
    await window.getByTestId('req-tab-tests').click()
    await window.getByTestId('tests-add-assertion').click()
    await window.getByRole('button', { name: /Status code equals/i }).click()
    await expect(window.getByTestId('assertion-enable').first()).toBeVisible()
  })

  uiTest('tests: post-response script editor', async ({ window }) => {
    await window.getByTestId('req-tab-tests').click()
    await fillMonaco(window, 'tests-post-script', 'pm.test("ok", () => pm.response.to.have.status(200));')
    await expect(window.locator('[data-testid="tests-post-script"] .monaco-editor')).toBeVisible()
  })
})
