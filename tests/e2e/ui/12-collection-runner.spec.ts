import { expect } from '@playwright/test'
import { uiTest } from './_setup'
import { closeAllTabs, dismissOverlays, openCommandPalette } from '../helpers/ui/bootstrap'

uiTest.describe('Collection runner', () => {
  uiTest.beforeEach(async ({ window }) => {
    await dismissOverlays(window)
  })

  /**
   * The palette opens the runner TAB, not the old modal.
   *
   * `CollectionRunnerModal`'s run path dropped seven payload fields — setup and
   * teardown phases, both hook scripts, iteration data, `stopOnError` and
   * `persistResponses` — so the same run behaved differently depending on where
   * it was started from. The palette now routes to `openOrReuseRunnerTab()`,
   * the surface that is actually maintained.
   */
  uiTest('opens the runner tab from the command palette', async ({ window }) => {
    await openCommandPalette(window)
    await window
      .getByRole('option', { name: /Open collection runner|Koleksiyon çalıştırıcısını aç/i })
      .click()

    const workbench = window.getByTestId('workbench')
    await expect(workbench.getByText('Run Sequence')).toBeVisible({ timeout: 20_000 })
    // The tab carries the full run configuration the modal never sent.
    await expect(workbench.getByTestId('runner-iterations')).toBeVisible()
    await expect(workbench.getByTestId('runner-start')).toBeVisible()
    // …and it is a tab, so it survives Escape rather than being dismissed by it.
    await window.keyboard.press('Escape')
    await expect(workbench.getByText('Run Sequence')).toBeVisible()

    await closeAllTabs(window)
  })

  uiTest('the iterations box can be cleared and retyped', async ({ window }) => {
    // Same class the testers reported on the Password Generator length field:
    // clamping on every keystroke meant the box could never be emptied, so a
    // typed digit landed beside the old value.
    await openCommandPalette(window)
    await window
      .getByRole('option', { name: /Open collection runner|Koleksiyon çalıştırıcısını aç/i })
      .click()

    const iterations = window.getByTestId('workbench').getByTestId('runner-iterations')
    await expect(iterations).toBeVisible({ timeout: 20_000 })
    await iterations.fill('')
    await expect(iterations).toHaveValue('')
    await iterations.fill('3')
    await expect(iterations).toHaveValue('3')

    await closeAllTabs(window)
  })
})
