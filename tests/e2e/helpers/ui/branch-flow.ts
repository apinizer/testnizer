import { expect, type Page } from '@playwright/test'

/** Create a new branch from the current one via the branch pill dropdown. */
export async function createBranch(page: Page, name: string): Promise<void> {
  await page.getByTestId('branch-pill').click()
  await page.getByTestId('branch-new').click()
  await page.getByPlaceholder(/New branch from/i).fill(name)
  await page.getByRole('button', { name: /^OK$/i }).click()
  await expect(page.getByTestId('branch-pill')).toContainText(name, { timeout: 15_000 })
  await page.keyboard.press('Escape').catch(() => {})
}

/** Switch to an existing branch by name. */
export async function switchBranch(page: Page, name: string): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {})
  await page.getByTestId('branch-pill').click()
  const item = page.getByTestId('branch-item').filter({ has: page.locator(`[data-branch-name="${name}"]`) })
  await expect(item.first()).toBeVisible({ timeout: 10_000 })
  await item.first().click()
  await expect(page.getByTestId('branch-pill')).toContainText(name, { timeout: 15_000 })
}
