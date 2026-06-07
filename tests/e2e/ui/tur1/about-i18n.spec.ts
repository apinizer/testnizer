/**
 * MST-311 P1  About tab i18n regression
 *
 * The About pane (ProjectDetailModal → About tab → <AboutPane/>) renders its
 * labels through `t('about.*')`. i18n's `t()` returns the RAW key on a miss
 * (i18n.ts:2933 `?? key`), so a missing/renamed `about.*` key would surface as
 * literal text like "about.version" in the UI. This regression test asserts no
 * such raw key leaks into the rendered text, that the human subtitle shows, and
 * that the VERSION/PLATFORM/ELECTRON grid rows are present (not blank/keys).
 */
import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { dismissOverlays } from '../../helpers/ui/bootstrap'

uiTest.describe('Tur1 — About i18n regression [MST-311]', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  uiTest('MST-311 About tab shows human-readable i18n, no raw keys', async ({ window }) => {
    // Open the project detail modal and switch to the About tab.
    await window.getByTestId('nav-settings').click()
    const modal = window.getByTestId('project-detail-modal')
    await expect(modal).toBeVisible({ timeout: 8_000 })

    const aboutTab = window.getByTestId('project-detail-tab-about')
    await expect(aboutTab).toBeVisible({ timeout: 8_000 })
    await aboutTab.click()

    // Scope assertions to the modal so worker-shared surfaces don't pollute.
    // Human-readable subtitle from `about.subtitle` (EN locale default).
    await expect(modal.getByText('Application version, runtime and license info.')).toBeVisible({
      timeout: 8_000,
    })

    // No raw i18n key leakage: the full visible text must not contain a token
    // shaped like `about.<lowercase>` (e.g. "about.version", "about.platform").
    const text = (await modal.innerText()) ?? ''
    expect(text).not.toMatch(/\babout\.[a-z]/)

    // Grid rows render human labels (not the raw keys).
    await expect(modal.getByText('Version', { exact: true }).first()).toBeVisible()
    await expect(modal.getByText('Platform', { exact: true }).first()).toBeVisible()
    await expect(modal.getByText('Electron', { exact: true }).first()).toBeVisible()

    // Close the modal.
    await window.keyboard.press('Escape')
    await expect(modal).toBeHidden({ timeout: 5_000 })
  })
})
