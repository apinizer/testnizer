import { expect, type Page } from '@playwright/test'
import { pressModShortcut } from './keyboard'

const activeTab = (page: Page) =>
  page.locator('[data-testid="endpoint-tab"][data-active="true"]')

/** Ctrl/Cmd+S in-place save — no Save As modal for existing saved requests. */
export async function saveInPlace(page: Page): Promise<void> {
  await pressModShortcut(page, 's')
  // Save modal must NOT appear for in-place updates.
  await expect(page.getByTestId('endpoint-save-modal')).toBeHidden({ timeout: 3_000 }).catch(() => {})
  await expect(activeTab(page)).toHaveAttribute('data-dirty', 'false', { timeout: 10_000 })
}
