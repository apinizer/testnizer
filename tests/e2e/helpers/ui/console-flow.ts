import { expect, type Page } from '@playwright/test'

/** Open the footer console panel. */
export async function openConsolePanel(page: Page): Promise<void> {
  await page.getByTestId('footer-console').click()
  await expect(page.getByTestId('console-panel')).toBeVisible({ timeout: 8_000 })
}

/** Assert the console panel contains a substring (case-insensitive). */
export async function expectConsoleContains(page: Page, text: string | RegExp): Promise<void> {
  const panel = page.getByTestId('console-panel')
  await expect(panel).toContainText(text, { timeout: 15_000 })
}

/** Post-script output surfaces as a dedicated "Script logs (N)" console row. */
export async function expectConsoleScriptLog(page: Page, marker: string): Promise<void> {
  const panel = page.getByTestId('console-panel')
  await expect(panel).toContainText(/Script logs \(1\)/i, { timeout: 15_000 })
  const scriptRow = panel.getByText(/Script logs \(1\)/i).first()
  await scriptRow.click()
  await expect(panel.getByText(marker)).toBeVisible({ timeout: 10_000 })
}
