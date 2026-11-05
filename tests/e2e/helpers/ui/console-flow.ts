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

/** Open the footer Console panel if it is not open yet (idempotent — the footer button toggles). */
export async function ensureConsolePanelOpen(page: Page): Promise<void> {
  const panel = page.getByTestId('console-panel')
  // optional: the drawer may already be open from an earlier test; the expect below proves it is open either way.
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByTestId('footer-console').click()
  }
  await expect(panel).toBeVisible({ timeout: 8_000 })
}

/**
 * Expand the console row whose visible text contains `needle` (a unique marker
 * baked into the request URL) and return its expanded `actual-request-panel`,
 * with the "Network" section open so the URL/method rows render.
 * The console list is virtualized + worker-shared, so we scope to a unique
 * marker and click the matching row to expand it.
 */
export async function expandActualRequest(page: Page, needle: string) {
  const list = page.getByTestId('console-list')
  // The collapsible header is the inner `cursor-pointer` flex row; scope to the
  // one whose visible text carries our unique marker (collapsed row shows the
  // entry URL, which includes the marker query param).
  const row = list.locator('div.cursor-pointer', { hasText: needle }).first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  await row.click()
  // The expanded detail is the row header's SIBLING inside the same entry
  // container — locate it structurally (filtering the panel by the marker text
  // would fail: the URL lives in the "Network" section, which starts COLLAPSED,
  // so the marker is not in the panel's DOM yet).
  const panel = row.locator('xpath=..').getByTestId('actual-request-panel')
  await expect(panel).toBeVisible({ timeout: 8_000 })
  // Open the collapsed "Network" section so the URL/method KV rows render.
  const networkHeader = panel.locator('div.cursor-pointer', { hasText: /^Network$/ }).first()
  await networkHeader.click()
  await expect(panel.getByText('URL:', { exact: true })).toBeVisible({ timeout: 5_000 })
  return panel
}
