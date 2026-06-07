import { expect, type Page } from '@playwright/test'

/** Return to Project Home via header home tab (clears active project).
 *
 * When no project is active the app is ALREADY on Project Home and the Header
 * (with header-home) isn't rendered — so only click header-home when it exists,
 * otherwise we're already there. */
export async function goToProjectHome(page: Page): Promise<void> {
  const alreadyHome = await page.getByTestId('project-home').isVisible().catch(() => false)
  if (!alreadyHome) {
    await page.getByTestId('header-home').click()
  }
  await expect(page.getByTestId('project-home')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('home-new-project')).toBeVisible({ timeout: 10_000 })
}

/** Create a new local project from Project Home and open it. */
export async function createProject(page: Page, displayName: string): Promise<void> {
  await page.getByTestId('home-new-project').click()
  await expect(page.getByTestId('new-project-modal')).toBeVisible()
  await page.getByTestId('new-project-next').click()
  await page.getByTestId('new-project-display-name').fill(displayName)
  await page.getByTestId('new-project-name').fill(displayName.replace(/\s+/g, '-').toLowerCase())
  await page.getByTestId('new-project-next').click()
  await page.getByTestId('new-project-create').click()
  await expect(page.getByTestId('new-project-modal')).toBeHidden({ timeout: 30_000 })
  await expect(page.getByTestId('nav-apis')).toBeVisible({ timeout: 15_000 })
}

/** Open an existing project card by display name. */
export async function openProject(page: Page, displayName: string): Promise<void> {
  await goToProjectHome(page)
  await page.getByTestId('project-card').filter({ hasText: displayName }).first().click()
  await expect(page.getByTestId('nav-apis')).toBeVisible({ timeout: 15_000 })
}
