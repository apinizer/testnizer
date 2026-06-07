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
  // data-branch-name is ON the branch-item element itself — match the combined
  // selector, not a descendant via filter({ has }).
  const item = page.locator(`[data-testid="branch-item"][data-branch-name="${name}"]`)
  // The pill toggles the dropdown, and a preceding createBranch can leave it in
  // an already-open state — so clicking once would close it. Open it explicitly:
  // click, and if the item list didn't appear, click again to toggle it open.
  await page.getByTestId('branch-pill').click()
  if (!(await item.first().isVisible().catch(() => false))) {
    await page.getByTestId('branch-pill').click()
  }
  await expect(item.first()).toBeVisible({ timeout: 10_000 })
  await item.first().click()
  await expect(page.getByTestId('branch-pill')).toContainText(name, { timeout: 15_000 })
}

/**
 * Restore the worker-shared project to its default branch (named "main").
 * Best-effort cleanup for specs that create/switch feature branches — leaving a
 * feature branch active hides the canonical tree from later specs. No-ops when
 * already on the default branch.
 */
export async function switchToDefaultBranch(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => {})
  const pill = page.getByTestId('branch-pill')
  if (!(await pill.isVisible().catch(() => false))) return
  if (((await pill.textContent()) ?? '').includes('main')) return
  await switchBranch(page, 'main')
}
